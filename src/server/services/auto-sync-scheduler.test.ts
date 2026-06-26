import { describe, expect, it, vi } from "vitest";
import type { RuntimeSettings, SettingsStore } from "../settings.js";
import type { GaokaoCnAdapter, GaokaoCnSyncOptions, GaokaoCnSyncResult } from "./gaokao-cn-adapter.js";
import { AutoSyncScheduler } from "./auto-sync-scheduler.js";

describe("AutoSyncScheduler", () => {
  it("passes configured Gaokao.cn subject types to scheduled plan and score syncs", () => {
    const runtime = fixtureRuntime();
    const scheduler = new AutoSyncScheduler(
      {
        runtime: () => runtime,
        getString: () => "",
        setInternal: () => undefined
      } as unknown as SettingsStore,
      {} as never,
      {} as never,
      {} as never
    ) as unknown as {
      gaokaoPlanOptions: (sync: RuntimeSettings["sync"]) => { subjectTypes?: string[] };
      gaokaoScoreOptions: (sync: RuntimeSettings["sync"]) => { subjectTypes?: string[] };
    };

    expect(scheduler.gaokaoPlanOptions(runtime.sync).subjectTypes).toEqual(["理科", "文科"]);
    expect(scheduler.gaokaoScoreOptions(runtime.sync).subjectTypes).toEqual(["理科", "文科"]);
    expect(scheduler.gaokaoPlanOptions(runtime.sync).eligibleOnly).toBe(true);
    expect(scheduler.gaokaoScoreOptions(runtime.sync).eligibleOnly).toBe(true);
    expect(scheduler.gaokaoPlanOptions(runtime.sync).requestDelayMs).toBe(180000);
    expect(scheduler.gaokaoScoreOptions(runtime.sync).requestDelayMs).toBe(180000);
    expect(scheduler.gaokaoPlanOptions(runtime.sync).rateLimitCooldownMinutes).toBe(1440);
    expect(scheduler.gaokaoScoreOptions(runtime.sync).rateLimitCooldownMinutes).toBe(1440);
    expect(scheduler.gaokaoPlanOptions(runtime.sync).maxSourceRequests).toBe(1);
    expect(scheduler.gaokaoScoreOptions(runtime.sync).maxSourceRequests).toBe(1);
    expect(scheduler.gaokaoPlanOptions(runtime.sync).skipExisting).toBe(true);
    expect(scheduler.gaokaoScoreOptions(runtime.sync).skipExisting).toBe(true);
    expect(scheduler.gaokaoPlanOptions(runtime.sync).includePlanDetails).toBe(false);
  });

  it("persists Gaokao.cn batch summaries and only advances cursors on success", async () => {
    const runtime = fixtureRuntime();
    const stored = new Map<string, string>();
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    const successfulResult = fixtureGaokaoResult({ nextOffset: 10, planRows: 24, errors: [] });
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue(successfulResult)
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      gaokaoPlanOptions: (sync: RuntimeSettings["sync"]) => GaokaoCnSyncOptions;
      syncGaokaoCnBatch: (key: "gaokaoCnPlan" | "gaokaoCnScore", options: GaokaoCnSyncOptions) => Promise<GaokaoCnSyncResult>;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };
    const planOptions = scheduler.gaokaoPlanOptions(runtime.sync);

    await scheduler.syncGaokaoCnBatch("gaokaoCnPlan", planOptions);

    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
    const successStatus = scheduler.status().jobs.gaokaoCnPlan;
    expect(successStatus.cursorOffset).toBe(10);
    expect(successStatus.lastResult).toMatchObject({
      ok: true,
      total: 10,
      nextOffset: 10,
      planRows: 24,
      skippedRequests: 0,
      errorCount: 0
    });

    const failedResult = fixtureGaokaoResult({
      offset: 10,
      nextOffset: 20,
      errors: [{ university: "测试大学", message: "network error" }]
    });
    vi.mocked(gaokaoCn.sync).mockResolvedValueOnce(failedResult);
    await expect(scheduler.syncGaokaoCnBatch("gaokaoCnPlan", planOptions))
      .rejects.toThrow("掌上高考同步失败 1 所");

    const failedStatus = scheduler.status().jobs.gaokaoCnPlan;
    expect(failedStatus.cursorOffset).toBe(10);
    expect(failedStatus.lastResult).toMatchObject({
      ok: false,
      offset: 10,
      nextOffset: 20,
      errorCount: 1
    });
  });

  it("keeps Gaokao.cn cursor in place when source request budget is exhausted", async () => {
    const runtime = fixtureRuntime();
    const stored = new Map<string, string>();
    stored.set("sync.internal.gaokaoCnPlan.cursorSignature", "");
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue(fixtureGaokaoResult({
        nextOffset: 10,
        sourceRequests: 12,
        sourceRequestBudget: 12,
        requestBudgetExhausted: true
      }))
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      gaokaoPlanOptions: (sync: RuntimeSettings["sync"]) => GaokaoCnSyncOptions;
      syncGaokaoCnBatch: (key: "gaokaoCnPlan", options: GaokaoCnSyncOptions) => Promise<GaokaoCnSyncResult>;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };

    await scheduler.syncGaokaoCnBatch("gaokaoCnPlan", scheduler.gaokaoPlanOptions(runtime.sync));

    const status = scheduler.status().jobs.gaokaoCnPlan;
    expect(status.cursorOffset).toBe(0);
    expect(status.lastResult).toMatchObject({
      ok: true,
      requestBudgetExhausted: true,
      sourceRequests: 12,
      sourceRequestBudget: 12,
      nextOffset: 10
    });
  });

  it("does not immediately retry Gaokao.cn batches after rate limits", async () => {
    const runtime = fixtureRuntime();
    const stored = new Map<string, string>();
    stored.set("sync.internal.gaokaoCnScore.lastAttemptAt", new Date().toISOString());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue(fixtureGaokaoResult({
        errors: [{ university: "一号大学", message: "Gaokao.cn plan-school-summary returned 1069: 访问太过频繁，请稍后再试" }]
      }))
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      run: (key: "gaokaoCnPlan", task: () => Promise<unknown>, retryLimit?: number) => Promise<void>;
      gaokaoPlanOptions: (sync: RuntimeSettings["sync"]) => GaokaoCnSyncOptions;
      syncGaokaoCnBatch: (key: "gaokaoCnPlan", options: GaokaoCnSyncOptions) => Promise<GaokaoCnSyncResult>;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };

    const planOptions = scheduler.gaokaoPlanOptions(runtime.sync);
    await scheduler.run("gaokaoCnPlan", () => scheduler.syncGaokaoCnBatch("gaokaoCnPlan", planOptions), 2);

    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    const status = scheduler.status().jobs.gaokaoCnPlan;
    expect(status.lastError).toContain("限流");
    expect(status.lastFinishedAt).toEqual(expect.any(String));
    expect(status.cursorOffset).toBe(0);
    expect(status.cooldownUntil).toEqual(expect.any(String));
    expect(scheduler.status().jobs.gaokaoCnScore.cooldownUntil).toBe(status.cooldownUntil);
    warn.mockRestore();
  });

  it("schedules delayed Gaokao.cn retries for non-rate-limit failures", async () => {
    const runtime = fixtureRuntime();
    runtime.sync.gaokaoCnBatchesPerRun = 1;
    const stored = new Map<string, string>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    const gaokaoCn = {
      sync: vi.fn()
        .mockResolvedValueOnce(fixtureGaokaoResult({
          errors: [{ university: "一号大学", message: "ECONNRESET" }]
        }))
        .mockResolvedValueOnce(fixtureGaokaoResult({ nextOffset: 10, planRows: 6 }))
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      run: (key: "gaokaoCnPlan", task: () => Promise<unknown>, retryLimit?: number) => Promise<void>;
      tick: () => Promise<void>;
      gaokaoPlanOptions: (sync: RuntimeSettings["sync"]) => GaokaoCnSyncOptions;
      syncGaokaoCnBatch: (key: "gaokaoCnPlan", options: GaokaoCnSyncOptions) => Promise<GaokaoCnSyncResult>;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };

    const planOptions = scheduler.gaokaoPlanOptions(runtime.sync);
    await scheduler.run("gaokaoCnPlan", () => scheduler.syncGaokaoCnBatch("gaokaoCnPlan", planOptions), runtime.sync.gaokaoCnRetryLimit);

    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    const failedStatus = scheduler.status().jobs.gaokaoCnPlan;
    expect(failedStatus.retryAt).toEqual(expect.any(String));
    expect(failedStatus.nextRunAt).toBe(failedStatus.retryAt);
    expect(failedStatus.cursorOffset).toBe(0);

    stored.set("sync.internal.gaokaoCnPlan.retryAt", new Date(Date.now() - 1000).toISOString());
    await scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(gaokaoCn.sync).toHaveBeenCalledTimes(2);
    const recoveredStatus = scheduler.status().jobs.gaokaoCnPlan;
    expect(recoveredStatus.retryAt).toBeNull();
    expect(recoveredStatus.cursorOffset).toBe(10);
    expect(recoveredStatus.lastResult).toMatchObject({ ok: true, planRows: 6 });
    warn.mockRestore();
  });

  it("skips scheduled Gaokao.cn sync while rate-limit cooldown is active", async () => {
    const runtime = fixtureRuntime();
    const stored = new Map<string, string>();
    const cooldownUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    stored.set("sync.internal.gaokaoCnPlan.rateLimitCooldownUntil", cooldownUntil);
    stored.set("sync.internal.gaokaoCnScore.lastAttemptAt", new Date().toISOString());
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    const gaokaoCn = {
      sync: vi.fn()
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      tick: () => Promise<void>;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };

    await scheduler.tick();

    expect(gaokaoCn.sync).not.toHaveBeenCalled();
    expect(scheduler.status().jobs.gaokaoCnPlan.cooldownUntil).toBe(cooldownUntil);
    expect(scheduler.status().jobs.gaokaoCnPlan.nextRunAt).toBe(cooldownUntil);
  });

  it("skips scheduled Gaokao.cn sync while adapter-wide cooldown is active", async () => {
    const runtime = fixtureRuntime();
    const stored = new Map<string, string>();
    const cooldownUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    const gaokaoCn = {
      sync: vi.fn(),
      rateLimitStatus: vi.fn(() => ({ active: true, until: cooldownUntil }))
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      tick: () => Promise<void>;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };

    await scheduler.tick();

    expect(gaokaoCn.sync).not.toHaveBeenCalled();
    expect(scheduler.status().jobs.gaokaoCnPlan.cooldownUntil).toBe(cooldownUntil);
    expect(scheduler.status().jobs.gaokaoCnPlan.nextRunAt).toBe(cooldownUntil);
  });

  it("can advance multiple Gaokao.cn batches in one scheduled run", async () => {
    const runtime = fixtureRuntime();
    const stored = new Map<string, string>();
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    const gaokaoCn = {
      sync: vi.fn()
        .mockResolvedValueOnce(fixtureGaokaoResult({ offset: 0, nextOffset: 10, planRows: 8 }))
        .mockResolvedValueOnce(fixtureGaokaoResult({ offset: 10, nextOffset: 20, planRows: 9 }))
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      gaokaoPlanOptions: (sync: RuntimeSettings["sync"]) => GaokaoCnSyncOptions;
      syncGaokaoCnBatches: (
        key: "gaokaoCnPlan",
        options: GaokaoCnSyncOptions,
        maxBatches: number,
        batchDelayMs: number
      ) => Promise<GaokaoCnSyncResult | null>;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };

    const planOptions = scheduler.gaokaoPlanOptions(runtime.sync);
    await scheduler.syncGaokaoCnBatches("gaokaoCnPlan", planOptions, 2, 0);

    expect(gaokaoCn.sync).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0 }));
    expect(gaokaoCn.sync).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 10 }));
    const status = scheduler.status().jobs.gaokaoCnPlan;
    expect(status.cursorOffset).toBe(20);
    expect(status.lastResult).toMatchObject({
      ok: true,
      batchCount: 2,
      total: 20,
      offset: 0,
      nextOffset: 20,
      mapped: 20,
      planRows: 17,
      sourceRows: 40
    });
  });

  it("can reset Gaokao.cn plan or score progress independently", async () => {
    const runtime = fixtureRuntime();
    const stored = new Map<string, string>();
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    const gaokaoCn = {
      sync: vi.fn()
        .mockResolvedValueOnce(fixtureGaokaoResult({ nextOffset: 10, planRows: 6 }))
        .mockResolvedValueOnce(fixtureGaokaoResult({ nextOffset: 10, schoolScoreRows: 3 }))
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      gaokaoPlanOptions: (sync: RuntimeSettings["sync"]) => GaokaoCnSyncOptions;
      gaokaoScoreOptions: (sync: RuntimeSettings["sync"]) => GaokaoCnSyncOptions;
      syncGaokaoCnBatch: (key: "gaokaoCnPlan" | "gaokaoCnScore", options: GaokaoCnSyncOptions) => Promise<GaokaoCnSyncResult>;
      resetGaokaoCnProgress: (target: "plan" | "score" | "all") => void;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };

    await scheduler.syncGaokaoCnBatch("gaokaoCnPlan", scheduler.gaokaoPlanOptions(runtime.sync));
    await scheduler.syncGaokaoCnBatch("gaokaoCnScore", scheduler.gaokaoScoreOptions(runtime.sync));

    expect(scheduler.status().jobs.gaokaoCnPlan.cursorOffset).toBe(10);
    expect(scheduler.status().jobs.gaokaoCnScore.cursorOffset).toBe(10);
    stored.set("sync.internal.gaokaoCnPlan.rateLimitCooldownUntil", new Date(Date.now() + 60 * 60 * 1000).toISOString());

    scheduler.resetGaokaoCnProgress("plan");

    expect(scheduler.status().jobs.gaokaoCnPlan.cursorOffset).toBe(0);
    expect(scheduler.status().jobs.gaokaoCnPlan.lastResult).toBeNull();
    expect(scheduler.status().jobs.gaokaoCnPlan.cooldownUntil).toBeNull();
    expect(scheduler.status().jobs.gaokaoCnScore.cursorOffset).toBe(10);
    expect(scheduler.status().jobs.gaokaoCnScore.lastResult).toMatchObject({ ok: true, schoolScoreRows: 3 });
  });

  it("does not start scheduled Gaokao.cn plan and score syncs concurrently", async () => {
    const runtime = fixtureRuntime();
    const stored = new Map<string, string>();
    const settings = {
      runtime: () => runtime,
      getString: (key: string, fallback: string) => stored.get(key) ?? fallback,
      setInternal: (key: string, value: string) => stored.set(key, value)
    } as unknown as SettingsStore;
    let resolveSync!: (result: GaokaoCnSyncResult) => void;
    const pendingSync = new Promise<GaokaoCnSyncResult>((resolve) => {
      resolveSync = resolve;
    });
    const gaokaoCn = {
      sync: vi.fn(() => pendingSync)
    } as unknown as GaokaoCnAdapter;
    const scheduler = new AutoSyncScheduler(settings, {} as never, {} as never, gaokaoCn) as unknown as {
      tick: () => Promise<void>;
      status: () => ReturnType<AutoSyncScheduler["status"]>;
    };

    await scheduler.tick();

    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      includePlans: true,
      includeScores: false
    }));
    expect(scheduler.status().jobs.gaokaoCnPlan.running).toBe(true);
    expect(scheduler.status().jobs.gaokaoCnScore.running).toBe(false);

    resolveSync(fixtureGaokaoResult({ nextOffset: 0 }));
    await Promise.resolve();
  });
});

function fixtureGaokaoResult(overrides: Partial<GaokaoCnSyncResult> = {}): GaokaoCnSyncResult {
  return {
    source: "gaokao_cn",
    total: 10,
    candidateTotal: 100,
    offset: 0,
    nextOffset: 10,
    mapped: 10,
    planRows: 0,
    planSummaryRows: 0,
    majorPlanRows: 0,
    schoolScoreRows: 0,
    majorScoreRows: 0,
    sourceRows: 20,
    sourceRequests: 20,
    sourceRequestBudget: null,
    requestBudgetExhausted: false,
    skippedRequests: 0,
    skipped: 0,
    errors: [],
    ...overrides
  };
}

function fixtureRuntime(): RuntimeSettings {
  return {
    onebot: {
      accessToken: "",
      replyEnabled: true,
      replyAsImage: true,
      replyImageTitle: "高校资料助手",
      replyImageBadge: "AI 生成回复"
    },
    site: {
      publicBaseUrl: "https://bot.example.com",
      filingNumber: ""
    },
    llm: {
      baseUrl: "https://llm.example/v1",
      apiKey: "",
      model: "gpt-5.5",
      temperature: 0.2,
      maxTokens: 1600,
      timeoutMs: 120000
    },
    naturalLanguage: {
      groupNaturalEnabled: true,
      requireMentionInGroup: false,
      contextTtlMinutes: 10,
      cooldownSeconds: 5
    },
    sync: {
      collegesAutoEnabled: false,
      collegesIntervalHours: 24,
      srgaoxiaoAutoEnabled: false,
      srgaoxiaoIntervalHours: 24,
      srgaoxiaoLimit: 120,
      srgaoxiaoReviewMaxPages: 20,
      gaokaoCnAutoEnabled: true,
      gaokaoCnIntervalHours: 24,
      gaokaoCnPlanIntervalHours: 24,
      gaokaoCnScoreIntervalHours: 720,
      gaokaoCnLimit: 1,
      gaokaoCnQuery: "大学",
      gaokaoCnProvinces: "四川,河南",
      gaokaoCnSubjectTypes: "理科, 文科",
      gaokaoCnEligibleOnly: true,
      gaokaoCnScoreYears: "2025,2024,2023",
      gaokaoCnPlanYears: "2026",
      gaokaoCnRetryLimit: 1,
      gaokaoCnRequestDelayMs: 180000,
      gaokaoCnMaxRequestsPerRun: 1,
      gaokaoCnBatchesPerRun: 2,
      gaokaoCnBatchDelayMs: 0,
      gaokaoCnRateLimitCooldownMinutes: 1440,
      gaokaoCnSkipExisting: true,
      gaokaoCnIncludePlanDetails: false
    }
  };
}
