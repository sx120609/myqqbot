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
    schoolScoreRows: 0,
    majorScoreRows: 0,
    sourceRows: 20,
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
      gaokaoCnLimit: 10,
      gaokaoCnQuery: "大学",
      gaokaoCnProvinces: "四川,河南",
      gaokaoCnSubjectTypes: "理科, 文科",
      gaokaoCnEligibleOnly: true,
      gaokaoCnScoreYears: "2025,2024,2023",
      gaokaoCnPlanYears: "2026",
      gaokaoCnRetryLimit: 1
    }
  };
}
