import type { RuntimeSettings, SettingsStore } from "../settings.js";
import type { DataSyncService } from "./data-sync.js";
import { isGaokaoCnRateLimitError, type GaokaoCnAdapter, type GaokaoCnSyncOptions, type GaokaoCnSyncResult } from "./gaokao-cn-adapter.js";
import type { SrgaoxiaoSyncService } from "./srgaoxiao-sync.js";

type GaokaoJobKey = "gaokaoCnPlan" | "gaokaoCnScore";
type JobKey = "colleges" | "srgaoxiao" | GaokaoJobKey;
type GaokaoProgressTarget = "plan" | "score" | "all";

interface JobState {
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

interface GaokaoSchedulerResult {
  ok: boolean;
  source: string;
  batchCount?: number;
  total: number;
  candidateTotal: number;
  offset: number;
  nextOffset: number;
  mapped: number;
  planRows: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
  sourceRequests?: number;
  sourceRequestBudget?: number | null;
  requestBudgetExhausted?: boolean;
  skippedRequests?: number;
  skipped: number;
  errorCount: number;
  errors: Array<{ university: string; message: string }>;
  savedAt: string;
}

export interface AutoSyncStatus {
  jobs: Record<
    JobKey,
    JobState & {
      enabled: boolean;
      intervalHours: number;
      nextRunAt: string | null;
      cursorOffset?: number | null;
      lastResult?: GaokaoSchedulerResult | null;
      cooldownUntil?: string | null;
      retryAt?: string | null;
    }
  >;
}

const TICK_MS = 60 * 1000;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 24 * 30;

export class AutoSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly states: Record<JobKey, JobState> = {
    colleges: { running: false, lastStartedAt: null, lastFinishedAt: null, lastError: null },
    srgaoxiao: { running: false, lastStartedAt: null, lastFinishedAt: null, lastError: null },
    gaokaoCnPlan: { running: false, lastStartedAt: null, lastFinishedAt: null, lastError: null },
    gaokaoCnScore: { running: false, lastStartedAt: null, lastFinishedAt: null, lastError: null }
  };

  constructor(
    private readonly settings: SettingsStore,
    private readonly dataSync: DataSyncService,
    private readonly srgaoxiaoSync: SrgaoxiaoSyncService,
    private readonly gaokaoCn: GaokaoCnAdapter
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 10_000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): void {
    setTimeout(() => void this.tick(), 1000);
  }

  resetGaokaoCnProgress(target: GaokaoProgressTarget = "all"): void {
    const keys: GaokaoJobKey[] =
      target === "plan" ? ["gaokaoCnPlan"] : target === "score" ? ["gaokaoCnScore"] : ["gaokaoCnPlan", "gaokaoCnScore"];
    for (const key of keys) {
      this.settings.setInternal(this.gaokaoCursorSignatureKey(key), "");
      this.settings.setInternal(this.gaokaoCursorOffsetKey(key), "0");
      this.settings.setInternal(this.gaokaoLastResultKey(key), "");
      this.clearGaokaoRateLimitCooldown(key);
      this.clearGaokaoRetry(key);
      this.states[key].lastError = null;
    }
    this.clearGaokaoAdapterRateLimitCooldown();
  }

  status(): AutoSyncStatus {
    const runtime = this.settings.runtime().sync;
    const planOptions = this.gaokaoPlanOptions(runtime);
    const scoreOptions = this.gaokaoScoreOptions(runtime);
    return {
      jobs: {
        colleges: {
          ...this.states.colleges,
          enabled: runtime.collegesAutoEnabled,
          intervalHours: clampInterval(runtime.collegesIntervalHours),
          nextRunAt: this.nextRunAt("colleges", runtime.collegesAutoEnabled, runtime.collegesIntervalHours)
        },
        srgaoxiao: {
          ...this.states.srgaoxiao,
          enabled: runtime.srgaoxiaoAutoEnabled,
          intervalHours: clampInterval(runtime.srgaoxiaoIntervalHours),
          nextRunAt: this.nextRunAt("srgaoxiao", runtime.srgaoxiaoAutoEnabled, runtime.srgaoxiaoIntervalHours)
        },
        gaokaoCnPlan: {
          ...this.states.gaokaoCnPlan,
          enabled: runtime.gaokaoCnAutoEnabled,
          intervalHours: clampInterval(runtime.gaokaoCnPlanIntervalHours),
          nextRunAt: this.nextRunAt("gaokaoCnPlan", runtime.gaokaoCnAutoEnabled, runtime.gaokaoCnPlanIntervalHours),
          cursorOffset: this.gaokaoCursor("gaokaoCnPlan", gaokaoSignature(planOptions)),
          lastResult: this.gaokaoLastResult("gaokaoCnPlan"),
          cooldownUntil: this.gaokaoRateLimitCooldownUntil("gaokaoCnPlan"),
          retryAt: this.gaokaoRetryAt("gaokaoCnPlan")
        },
        gaokaoCnScore: {
          ...this.states.gaokaoCnScore,
          enabled: runtime.gaokaoCnAutoEnabled,
          intervalHours: clampInterval(runtime.gaokaoCnScoreIntervalHours),
          nextRunAt: this.nextRunAt("gaokaoCnScore", runtime.gaokaoCnAutoEnabled, runtime.gaokaoCnScoreIntervalHours),
          cursorOffset: this.gaokaoCursor("gaokaoCnScore", gaokaoSignature(scoreOptions)),
          lastResult: this.gaokaoLastResult("gaokaoCnScore"),
          cooldownUntil: this.gaokaoRateLimitCooldownUntil("gaokaoCnScore"),
          retryAt: this.gaokaoRetryAt("gaokaoCnScore")
        }
      }
    };
  }

  private async tick(): Promise<void> {
    const runtime = this.settings.runtime().sync;
    if (runtime.collegesAutoEnabled && this.isDue("colleges", runtime.collegesIntervalHours)) {
      void this.run("colleges", () => this.dataSync.sync());
    }
    if (runtime.srgaoxiaoAutoEnabled && this.isDue("srgaoxiao", runtime.srgaoxiaoIntervalHours)) {
      const reviewMaxPages = Math.max(1, Math.min(100, Math.floor(runtime.srgaoxiaoReviewMaxPages)));
      void this.run("srgaoxiao", () =>
        this.srgaoxiaoSync.sync({
          full: true,
          refreshReviews: "changed",
          reviewMaxPages
        })
      );
    }
    if (
      runtime.gaokaoCnAutoEnabled &&
      !this.isAnyGaokaoCnRunning() &&
      this.isDue("gaokaoCnPlan", runtime.gaokaoCnPlanIntervalHours)
    ) {
      void this.run(
        "gaokaoCnPlan",
        () => this.syncGaokaoCnBatches(
          "gaokaoCnPlan",
          this.gaokaoPlanOptions(runtime),
          runtime.gaokaoCnBatchesPerRun,
          runtime.gaokaoCnBatchDelayMs,
          runtime.gaokaoCnRateLimitCooldownMinutes
        ),
        clampRetryLimit(runtime.gaokaoCnRetryLimit)
      );
    }
    if (
      runtime.gaokaoCnAutoEnabled &&
      !this.isAnyGaokaoCnRunning() &&
      this.isDue("gaokaoCnScore", runtime.gaokaoCnScoreIntervalHours)
    ) {
      void this.run(
        "gaokaoCnScore",
        () => this.syncGaokaoCnBatches(
          "gaokaoCnScore",
          this.gaokaoScoreOptions(runtime),
          runtime.gaokaoCnBatchesPerRun,
          runtime.gaokaoCnBatchDelayMs,
          runtime.gaokaoCnRateLimitCooldownMinutes
        ),
        clampRetryLimit(runtime.gaokaoCnRetryLimit)
      );
    }
  }

  private async syncGaokaoCnBatches(
    key: GaokaoJobKey,
    options: GaokaoCnSyncOptions,
    maxBatches: number,
    batchDelayMs: number,
    rateLimitCooldownMinutes = 720
  ): Promise<GaokaoCnSyncResult | null> {
    const batches = clampGaokaoBatchCount(maxBatches);
    const delayMs = clampGaokaoBatchDelayMs(batchDelayMs);
    const results: GaokaoCnSyncResult[] = [];
    for (let batch = 1; batch <= batches; batch += 1) {
      const lastResult = await this.syncGaokaoCnBatch(key, options, rateLimitCooldownMinutes);
      results.push(lastResult);
      if (lastResult.requestBudgetExhausted) break;
      if (lastResult.nextOffset === 0 || lastResult.nextOffset <= lastResult.offset) break;
      if (batch < batches && delayMs > 0) await delay(delayMs);
    }
    if (results.length > 1) {
      const aggregate = aggregateGaokaoResults(results);
      this.setGaokaoLastResult(key, aggregate, true, results.length);
      return aggregate;
    }
    return results[0] ?? null;
  }

  private async syncGaokaoCnBatch(key: GaokaoJobKey, options: GaokaoCnSyncOptions, rateLimitCooldownMinutes = 720): Promise<GaokaoCnSyncResult> {
    const signature = gaokaoSignature(options);
    const offset = this.gaokaoCursor(key, signature);
    const result = await this.gaokaoCn.sync({ ...options, offset });
    if (result.errors.length) {
      this.setGaokaoLastResult(key, result, false);
      if (hasGaokaoRateLimitErrors(result)) {
        const cooldownUntil = this.setGaokaoRateLimitCooldownForAll(rateLimitCooldownMinutes);
        throw new Error(`掌上高考触发限流（1069/访问太过频繁），批次 offset=${offset}，已停止当前批次并保留游标，冷却至 ${cooldownUntil} 后再继续。`);
      }
      throw new Error(`掌上高考同步失败 ${result.errors.length} 所，批次 offset=${offset}，将保留当前游标等待重试。`);
    }
    this.clearGaokaoRateLimitCooldown(key);
    if (result.requestBudgetExhausted) {
      this.setGaokaoLastResult(key, result, true);
      return result;
    }
    this.setGaokaoCursor(key, signature, result.nextOffset);
    this.setGaokaoLastResult(key, result, true);
    return result;
  }

  private gaokaoPlanOptions(runtime: RuntimeSettings["sync"]): GaokaoCnSyncOptions {
    return {
      query: runtime.gaokaoCnQuery,
      limit: runtime.gaokaoCnLimit,
      provinces: splitList(runtime.gaokaoCnProvinces),
      subjectTypes: splitList(runtime.gaokaoCnSubjectTypes),
      eligibleOnly: runtime.gaokaoCnEligibleOnly,
      planYears: splitNumberList(runtime.gaokaoCnPlanYears),
      requestDelayMs: runtime.gaokaoCnRequestDelayMs,
      rateLimitCooldownMinutes: runtime.gaokaoCnRateLimitCooldownMinutes,
      maxSourceRequests: runtime.gaokaoCnMaxRequestsPerRun,
      skipExisting: runtime.gaokaoCnSkipExisting,
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false
    };
  }

  private gaokaoScoreOptions(runtime: RuntimeSettings["sync"]): GaokaoCnSyncOptions {
    return {
      query: runtime.gaokaoCnQuery,
      limit: runtime.gaokaoCnLimit,
      provinces: splitList(runtime.gaokaoCnProvinces),
      subjectTypes: splitList(runtime.gaokaoCnSubjectTypes),
      eligibleOnly: runtime.gaokaoCnEligibleOnly,
      scoreYears: splitNumberList(runtime.gaokaoCnScoreYears),
      requestDelayMs: runtime.gaokaoCnRequestDelayMs,
      rateLimitCooldownMinutes: runtime.gaokaoCnRateLimitCooldownMinutes,
      maxSourceRequests: runtime.gaokaoCnMaxRequestsPerRun,
      skipExisting: runtime.gaokaoCnSkipExisting,
      includePlans: false,
      includeScores: true,
      includeSpecialScores: true
    };
  }

  private async run(key: JobKey, task: () => Promise<unknown>, retryLimit = 0): Promise<void> {
    const state = this.states[key];
    if (state.running) return;

    const startedAt = new Date().toISOString();
    state.running = true;
    state.lastStartedAt = startedAt;
    state.lastError = null;
    this.settings.setInternal(this.lastAttemptKey(key), startedAt);

    try {
      if (isGaokaoCnJob(key)) {
        await this.runGaokaoCnTask(key, task, retryLimit);
        return;
      }
      for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
        try {
          await task();
          state.lastFinishedAt = new Date().toISOString();
          return;
        } catch (error) {
          state.lastError = error instanceof Error ? error.message : String(error);
          if (isGaokaoCnJob(key) && isGaokaoCnRateLimitError(error)) {
            state.lastFinishedAt = new Date().toISOString();
            console.warn(`[auto-sync] ${key} rate limited; waiting for the next scheduled run:`, error);
            return;
          }
          if (attempt >= retryLimit) {
            state.lastFinishedAt = new Date().toISOString();
            console.error(`[auto-sync] ${key} failed:`, error);
            return;
          }
          await delay(Math.min(60_000, 15_000 * (attempt + 1)));
        }
      }
    } finally {
      state.running = false;
    }
  }

  private async runGaokaoCnTask(key: GaokaoJobKey, task: () => Promise<unknown>, retryLimit: number): Promise<void> {
    const state = this.states[key];
    try {
      await task();
      this.clearGaokaoRetry(key);
      state.lastFinishedAt = new Date().toISOString();
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lastFinishedAt = new Date().toISOString();
      if (isGaokaoCnRateLimitError(error)) {
        this.clearGaokaoRetry(key);
        console.warn(`[auto-sync] ${key} rate limited; waiting for the next scheduled run:`, error);
        return;
      }
      const retryAt = this.setGaokaoRetry(key, retryLimit);
      if (retryAt) {
        console.warn(`[auto-sync] ${key} failed; delayed retry scheduled at ${retryAt}:`, error);
        return;
      }
      this.clearGaokaoRetry(key);
      console.error(`[auto-sync] ${key} failed:`, error);
    }
  }

  private isDue(key: JobKey, intervalHours: number): boolean {
    const state = this.states[key];
    if (state.running) return false;
    if (isGaokaoCnJob(key) && this.gaokaoEffectiveRateLimitCooldownDate(key)) return false;
    const retryAt = isGaokaoCnJob(key) ? this.gaokaoRetryDate(key) : null;
    if (retryAt) return retryAt.getTime() <= Date.now();

    const lastAttempt = this.lastAttemptAt(key);
    if (!lastAttempt) return true;
    return lastAttempt.getTime() + clampInterval(intervalHours) * 60 * 60 * 1000 <= Date.now();
  }

  private isAnyGaokaoCnRunning(): boolean {
    return this.states.gaokaoCnPlan.running || this.states.gaokaoCnScore.running;
  }

  private nextRunAt(key: JobKey, enabled: boolean, intervalHours: number): string | null {
    if (!enabled) return null;
    if (this.states[key].running) return null;

    const lastAttempt = this.lastAttemptAt(key);
    const cooldownUntil = isGaokaoCnJob(key) ? this.gaokaoEffectiveRateLimitCooldownDate(key) : null;
    const retryAt = isGaokaoCnJob(key) ? this.gaokaoRetryDate(key) : null;
    if (retryAt) return new Date(Math.max(retryAt.getTime(), cooldownUntil?.getTime() ?? 0, Date.now())).toISOString();
    if (!lastAttempt) return cooldownUntil?.toISOString() ?? "服务启动后约 10 秒";
    const next = lastAttempt.getTime() + clampInterval(intervalHours) * 60 * 60 * 1000;
    return new Date(Math.max(next, cooldownUntil?.getTime() ?? 0, Date.now())).toISOString();
  }

  private lastAttemptAt(key: JobKey): Date | null {
    const value = this.settings.getString(this.lastAttemptKey(key), "");
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private lastAttemptKey(key: JobKey): string {
    return `sync.internal.${key}.lastAttemptAt`;
  }

  private gaokaoCursor(key: GaokaoJobKey, signature: string): number {
    const storedSignature = this.settings.getString(this.gaokaoCursorSignatureKey(key), "");
    if (storedSignature !== signature) return 0;
    const offset = Number(this.settings.getString(this.gaokaoCursorOffsetKey(key), "0"));
    return Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  }

  private setGaokaoCursor(key: GaokaoJobKey, signature: string, offset: number): void {
    this.settings.setInternal(this.gaokaoCursorSignatureKey(key), signature);
    this.settings.setInternal(this.gaokaoCursorOffsetKey(key), String(Math.max(0, Math.floor(offset))));
  }

  private gaokaoCursorSignatureKey(key: GaokaoJobKey): string {
    return `sync.internal.${key}.cursorSignature`;
  }

  private gaokaoCursorOffsetKey(key: GaokaoJobKey): string {
    return `sync.internal.${key}.offset`;
  }

  private gaokaoLastResult(key: GaokaoJobKey): GaokaoSchedulerResult | null {
    const value = this.settings.getString(this.gaokaoLastResultKey(key), "");
    if (!value) return null;
    try {
      return JSON.parse(value) as GaokaoSchedulerResult;
    } catch {
      return null;
    }
  }

  private setGaokaoLastResult(key: GaokaoJobKey, result: GaokaoCnSyncResult, ok: boolean, batchCount?: number): void {
    this.settings.setInternal(this.gaokaoLastResultKey(key), JSON.stringify({
      ok,
      source: result.source,
      batchCount,
      total: result.total,
      candidateTotal: result.candidateTotal,
      offset: result.offset,
      nextOffset: result.nextOffset,
      mapped: result.mapped,
      planRows: result.planRows,
      schoolScoreRows: result.schoolScoreRows,
      majorScoreRows: result.majorScoreRows,
      sourceRows: result.sourceRows,
      sourceRequests: result.sourceRequests,
      sourceRequestBudget: result.sourceRequestBudget,
      requestBudgetExhausted: result.requestBudgetExhausted,
      skippedRequests: result.skippedRequests,
      skipped: result.skipped,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 8),
      savedAt: new Date().toISOString()
    } satisfies GaokaoSchedulerResult));
  }

  private gaokaoLastResultKey(key: GaokaoJobKey): string {
    return `sync.internal.${key}.lastResult`;
  }

  private gaokaoRateLimitCooldownUntil(key: GaokaoJobKey): string | null {
    return this.gaokaoEffectiveRateLimitCooldownDate(key)?.toISOString() ?? null;
  }

  private gaokaoRetryAt(key: GaokaoJobKey): string | null {
    return this.gaokaoRetryDate(key)?.toISOString() ?? null;
  }

  private gaokaoRetryDate(key: GaokaoJobKey): Date | null {
    const value = this.settings.getString(this.gaokaoRetryAtKey(key), "");
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.getTime() > Date.now() ? date : date;
  }

  private gaokaoRetryAttempt(key: GaokaoJobKey): number {
    const value = Number(this.settings.getString(this.gaokaoRetryAttemptKey(key), "0"));
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  private setGaokaoRetry(key: GaokaoJobKey, retryLimit: number): string | null {
    const limit = clampRetryLimit(retryLimit);
    const currentAttempt = this.gaokaoRetryAttempt(key);
    if (currentAttempt >= limit) return null;
    const nextAttempt = currentAttempt + 1;
    const retryAt = new Date(Date.now() + gaokaoRetryDelayMs(nextAttempt)).toISOString();
    this.settings.setInternal(this.gaokaoRetryAttemptKey(key), String(nextAttempt));
    this.settings.setInternal(this.gaokaoRetryAtKey(key), retryAt);
    return retryAt;
  }

  private clearGaokaoRetry(key: GaokaoJobKey): void {
    this.settings.setInternal(this.gaokaoRetryAttemptKey(key), "");
    this.settings.setInternal(this.gaokaoRetryAtKey(key), "");
  }

  private gaokaoEffectiveRateLimitCooldownDate(key: GaokaoJobKey): Date | null {
    const jobCooldown = this.gaokaoRateLimitCooldownDate(key);
    const adapterCooldown = this.gaokaoAdapterRateLimitCooldownDate();
    if (!jobCooldown) return adapterCooldown;
    if (!adapterCooldown) return jobCooldown;
    return new Date(Math.max(jobCooldown.getTime(), adapterCooldown.getTime()));
  }

  private gaokaoAdapterRateLimitCooldownDate(): Date | null {
    const rateLimitAware = this.gaokaoCn as GaokaoCnAdapter & { rateLimitStatus?: () => { until: string | null } };
    const value = rateLimitAware.rateLimitStatus?.().until;
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.getTime() > Date.now() ? date : null;
  }

  private gaokaoRateLimitCooldownDate(key: GaokaoJobKey): Date | null {
    const value = this.settings.getString(this.gaokaoRateLimitCooldownKey(key), "");
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.getTime() > Date.now() ? date : null;
  }

  private setGaokaoRateLimitCooldown(key: GaokaoJobKey, minutes: number): string {
    const cooldownMs = clampRateLimitCooldownMinutes(minutes) * 60 * 1000;
    const until = new Date(Date.now() + cooldownMs).toISOString();
    this.settings.setInternal(this.gaokaoRateLimitCooldownKey(key), until);
    return until;
  }

  private setGaokaoRateLimitCooldownForAll(minutes: number): string {
    const cooldownMs = clampRateLimitCooldownMinutes(minutes) * 60 * 1000;
    const until = new Date(Date.now() + cooldownMs).toISOString();
    const keys: GaokaoJobKey[] = ["gaokaoCnPlan", "gaokaoCnScore"];
    for (const key of keys) {
      this.settings.setInternal(this.gaokaoRateLimitCooldownKey(key), until);
      this.clearGaokaoRetry(key);
    }
    return until;
  }

  private clearGaokaoRateLimitCooldown(key: GaokaoJobKey): void {
    this.settings.setInternal(this.gaokaoRateLimitCooldownKey(key), "");
  }

  private clearGaokaoAdapterRateLimitCooldown(): void {
    const rateLimitAware = this.gaokaoCn as GaokaoCnAdapter & { clearRateLimitCooldown?: () => void };
    rateLimitAware.clearRateLimitCooldown?.();
  }

  private gaokaoRateLimitCooldownKey(key: GaokaoJobKey): string {
    return `sync.internal.${key}.rateLimitCooldownUntil`;
  }

  private gaokaoRetryAtKey(key: GaokaoJobKey): string {
    return `sync.internal.${key}.retryAt`;
  }

  private gaokaoRetryAttemptKey(key: GaokaoJobKey): string {
    return `sync.internal.${key}.retryAttempt`;
  }
}

function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return 24;
  return Math.max(MIN_INTERVAL_HOURS, Math.min(MAX_INTERVAL_HOURS, value));
}

function clampRetryLimit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.floor(value)));
}

function clampGaokaoBatchCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function clampGaokaoBatchDelayMs(value: number): number {
  if (!Number.isFinite(value)) return 900_000;
  return Math.max(0, Math.min(60 * 60 * 1000, Math.floor(value)));
}

function isGaokaoCnJob(key: JobKey): key is GaokaoJobKey {
  return key === "gaokaoCnPlan" || key === "gaokaoCnScore";
}

function clampRateLimitCooldownMinutes(value: number): number {
  if (!Number.isFinite(value)) return 720;
  return Math.max(1, Math.min(24 * 60, Math.floor(value)));
}

function gaokaoRetryDelayMs(attempt: number): number {
  const normalized = Math.max(1, Math.min(5, Math.floor(attempt)));
  return Math.min(6 * 60 * 60 * 1000, 30 * 60 * 1000 * 2 ** (normalized - 1));
}

function hasGaokaoRateLimitErrors(result: GaokaoCnSyncResult): boolean {
  return result.errors.some((error) => isGaokaoCnRateLimitError(error.message));
}

function aggregateGaokaoResults(results: GaokaoCnSyncResult[]): GaokaoCnSyncResult {
  const first = results[0];
  const last = results[results.length - 1] ?? first;
  return {
    source: first.source,
    total: sumGaokaoResults(results, "total"),
    candidateTotal: last.candidateTotal || first.candidateTotal,
    offset: first.offset,
    nextOffset: last.nextOffset,
    mapped: sumGaokaoResults(results, "mapped"),
    planRows: sumGaokaoResults(results, "planRows"),
    schoolScoreRows: sumGaokaoResults(results, "schoolScoreRows"),
    majorScoreRows: sumGaokaoResults(results, "majorScoreRows"),
    sourceRows: sumGaokaoResults(results, "sourceRows"),
    sourceRequests: sumGaokaoResults(results, "sourceRequests"),
    sourceRequestBudget: last.sourceRequestBudget,
    requestBudgetExhausted: results.some((result) => result.requestBudgetExhausted),
    skippedRequests: sumGaokaoResults(results, "skippedRequests"),
    skipped: sumGaokaoResults(results, "skipped"),
    errors: results.flatMap((result) => result.errors)
  };
}

function sumGaokaoResults(
  results: GaokaoCnSyncResult[],
  key: "total" | "mapped" | "planRows" | "schoolScoreRows" | "majorScoreRows" | "sourceRows" | "sourceRequests" | "skippedRequests" | "skipped"
): number {
  return results.reduce((sum, result) => sum + result[key], 0);
}

function splitList(value: string): string[] {
  return value
    .split(/[,，\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitNumberList(value: string): number[] {
  return splitList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function gaokaoSignature(options: GaokaoCnSyncOptions): string {
  return stableJson({
    query: options.query ?? "",
    limit: options.limit ?? "",
    provinces: options.provinces ?? [],
    subjectTypes: options.subjectTypes ?? [],
    eligibleOnly: options.eligibleOnly ?? true,
    scoreYears: options.scoreYears ?? [],
    planYears: options.planYears ?? [],
    includePlans: options.includePlans,
    includeScores: options.includeScores,
    includeSpecialScores: options.includeSpecialScores,
    maxSourceRequests: options.maxSourceRequests,
    rateLimitCooldownMinutes: options.rateLimitCooldownMinutes,
    skipExisting: options.skipExisting
  });
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    )
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
