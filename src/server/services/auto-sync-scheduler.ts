import type { RuntimeSettings, SettingsStore } from "../settings.js";
import type { DataSyncService } from "./data-sync.js";
import type { GaokaoCnAdapter, GaokaoCnSyncOptions, GaokaoCnSyncResult } from "./gaokao-cn-adapter.js";
import type { SrgaoxiaoSyncService } from "./srgaoxiao-sync.js";

type JobKey = "colleges" | "srgaoxiao" | "gaokaoCnPlan" | "gaokaoCnScore";

interface JobState {
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

interface GaokaoSchedulerResult {
  ok: boolean;
  source: string;
  total: number;
  candidateTotal: number;
  offset: number;
  nextOffset: number;
  mapped: number;
  planRows: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
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
          lastResult: this.gaokaoLastResult("gaokaoCnPlan")
        },
        gaokaoCnScore: {
          ...this.states.gaokaoCnScore,
          enabled: runtime.gaokaoCnAutoEnabled,
          intervalHours: clampInterval(runtime.gaokaoCnScoreIntervalHours),
          nextRunAt: this.nextRunAt("gaokaoCnScore", runtime.gaokaoCnAutoEnabled, runtime.gaokaoCnScoreIntervalHours),
          cursorOffset: this.gaokaoCursor("gaokaoCnScore", gaokaoSignature(scoreOptions)),
          lastResult: this.gaokaoLastResult("gaokaoCnScore")
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
    if (runtime.gaokaoCnAutoEnabled && this.isDue("gaokaoCnPlan", runtime.gaokaoCnPlanIntervalHours)) {
      void this.run(
        "gaokaoCnPlan",
        () => this.syncGaokaoCnBatch("gaokaoCnPlan", this.gaokaoPlanOptions(runtime)),
        clampRetryLimit(runtime.gaokaoCnRetryLimit)
      );
    }
    if (runtime.gaokaoCnAutoEnabled && this.isDue("gaokaoCnScore", runtime.gaokaoCnScoreIntervalHours)) {
      void this.run(
        "gaokaoCnScore",
        () => this.syncGaokaoCnBatch("gaokaoCnScore", this.gaokaoScoreOptions(runtime)),
        clampRetryLimit(runtime.gaokaoCnRetryLimit)
      );
    }
  }

  private async syncGaokaoCnBatch(key: "gaokaoCnPlan" | "gaokaoCnScore", options: GaokaoCnSyncOptions): Promise<GaokaoCnSyncResult> {
    const signature = gaokaoSignature(options);
    const offset = this.gaokaoCursor(key, signature);
    const result = await this.gaokaoCn.sync({ ...options, offset });
    if (result.errors.length) {
      this.setGaokaoLastResult(key, result, false);
      throw new Error(`掌上高考同步失败 ${result.errors.length} 所，批次 offset=${offset}，将保留当前游标等待重试。`);
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
      for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
        try {
          await task();
          state.lastFinishedAt = new Date().toISOString();
          return;
        } catch (error) {
          state.lastError = error instanceof Error ? error.message : String(error);
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

  private isDue(key: JobKey, intervalHours: number): boolean {
    const state = this.states[key];
    if (state.running) return false;

    const lastAttempt = this.lastAttemptAt(key);
    if (!lastAttempt) return true;
    return lastAttempt.getTime() + clampInterval(intervalHours) * 60 * 60 * 1000 <= Date.now();
  }

  private nextRunAt(key: JobKey, enabled: boolean, intervalHours: number): string | null {
    if (!enabled) return null;
    if (this.states[key].running) return null;

    const lastAttempt = this.lastAttemptAt(key);
    if (!lastAttempt) return "服务启动后约 10 秒";
    const next = lastAttempt.getTime() + clampInterval(intervalHours) * 60 * 60 * 1000;
    return new Date(Math.max(next, Date.now())).toISOString();
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

  private gaokaoCursor(key: "gaokaoCnPlan" | "gaokaoCnScore", signature: string): number {
    const storedSignature = this.settings.getString(this.gaokaoCursorSignatureKey(key), "");
    if (storedSignature !== signature) return 0;
    const offset = Number(this.settings.getString(this.gaokaoCursorOffsetKey(key), "0"));
    return Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  }

  private setGaokaoCursor(key: "gaokaoCnPlan" | "gaokaoCnScore", signature: string, offset: number): void {
    this.settings.setInternal(this.gaokaoCursorSignatureKey(key), signature);
    this.settings.setInternal(this.gaokaoCursorOffsetKey(key), String(Math.max(0, Math.floor(offset))));
  }

  private gaokaoCursorSignatureKey(key: "gaokaoCnPlan" | "gaokaoCnScore"): string {
    return `sync.internal.${key}.cursorSignature`;
  }

  private gaokaoCursorOffsetKey(key: "gaokaoCnPlan" | "gaokaoCnScore"): string {
    return `sync.internal.${key}.offset`;
  }

  private gaokaoLastResult(key: "gaokaoCnPlan" | "gaokaoCnScore"): GaokaoSchedulerResult | null {
    const value = this.settings.getString(this.gaokaoLastResultKey(key), "");
    if (!value) return null;
    try {
      return JSON.parse(value) as GaokaoSchedulerResult;
    } catch {
      return null;
    }
  }

  private setGaokaoLastResult(key: "gaokaoCnPlan" | "gaokaoCnScore", result: GaokaoCnSyncResult, ok: boolean): void {
    this.settings.setInternal(this.gaokaoLastResultKey(key), JSON.stringify({
      ok,
      source: result.source,
      total: result.total,
      candidateTotal: result.candidateTotal,
      offset: result.offset,
      nextOffset: result.nextOffset,
      mapped: result.mapped,
      planRows: result.planRows,
      schoolScoreRows: result.schoolScoreRows,
      majorScoreRows: result.majorScoreRows,
      sourceRows: result.sourceRows,
      skipped: result.skipped,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 8),
      savedAt: new Date().toISOString()
    } satisfies GaokaoSchedulerResult));
  }

  private gaokaoLastResultKey(key: "gaokaoCnPlan" | "gaokaoCnScore"): string {
    return `sync.internal.${key}.lastResult`;
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
    includeSpecialScores: options.includeSpecialScores
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
