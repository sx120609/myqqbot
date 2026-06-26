import type { AppDatabase } from "./db.js";
import {
  currentAdmissionYear,
  defaultAdmissionPlanIntervalHours,
  defaultAdmissionPlanYears,
  defaultAdmissionScoreIntervalHours,
  defaultAdmissionScoreYears
} from "./services/admission-calendar.js";

export interface RuntimeSettings {
  onebot: {
    accessToken: string;
    replyEnabled: boolean;
    replyAsImage: boolean;
    replyImageTitle: string;
    replyImageBadge: string;
  };
  site: {
    publicBaseUrl: string;
    filingNumber: string;
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
  };
  naturalLanguage: {
    groupNaturalEnabled: boolean;
    requireMentionInGroup: boolean;
    contextTtlMinutes: number;
    cooldownSeconds: number;
  };
  sync: {
    collegesAutoEnabled: boolean;
    collegesIntervalHours: number;
    srgaoxiaoAutoEnabled: boolean;
    srgaoxiaoIntervalHours: number;
    srgaoxiaoLimit: number;
    srgaoxiaoReviewMaxPages: number;
    gaokaoCnAutoEnabled: boolean;
    gaokaoCnIntervalHours: number;
    gaokaoCnPlanIntervalHours: number;
    gaokaoCnScoreIntervalHours: number;
    gaokaoCnLimit: number;
    gaokaoCnQuery: string;
    gaokaoCnProvinces: string;
    gaokaoCnSubjectTypes: string;
    gaokaoCnEligibleOnly: boolean;
    gaokaoCnScoreYears: string;
    gaokaoCnPlanYears: string;
    gaokaoCnRetryLimit: number;
    gaokaoCnRequestDelayMs: number;
    gaokaoCnMaxRequestsPerRun: number;
    gaokaoCnBatchesPerRun: number;
    gaokaoCnBatchDelayMs: number;
    gaokaoCnRateLimitCooldownMinutes: number;
    gaokaoCnSkipExisting: boolean;
    gaokaoCnIncludePlanDetails: boolean;
  };
}

const LEGACY_GAOKAO_PROVINCES_DEFAULT = "江苏,浙江,安徽,河南,山东,四川,广东";
const DEFAULT_GAOKAO_CN_LIMIT = "1";
const DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS = "180000";
const DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN = "1";
const DEFAULT_GAOKAO_CN_BATCH_DELAY_MS = "1800000";
const DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES = "1440";
const MIN_GAOKAO_CN_REQUEST_DELAY_MS = 180000;
const MIN_GAOKAO_CN_BATCH_DELAY_MS = 1800000;
const MIN_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES = 1440;
const SEASONAL_GAOKAO_AUTO_DEFAULT_MARKER_PREFIX = "sync.internal.autoDefault.";

const DEFAULTS: Record<string, string> = {
  "onebot.accessToken": process.env.ONEBOT_ACCESS_TOKEN ?? "",
  "onebot.replyEnabled": process.env.ONEBOT_REPLY_ENABLED ?? "true",
  "onebot.replyAsImage": process.env.ONEBOT_REPLY_AS_IMAGE ?? "true",
  "onebot.replyImageTitle": process.env.ONEBOT_REPLY_IMAGE_TITLE ?? "高校资料助手",
  "onebot.replyImageBadge": process.env.ONEBOT_REPLY_IMAGE_BADGE ?? "AI 生成回复",
  "site.publicBaseUrl": process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8787",
  "site.filingNumber": process.env.SITE_FILING_NUMBER ?? "",
  "llm.baseUrl": process.env.LLM_BASE_URL ?? "https://your-sub2api.example.com/v1",
  "llm.apiKey": process.env.LLM_API_KEY ?? "",
  "llm.model": process.env.LLM_MODEL ?? "gpt-5.5",
  "llm.temperature": process.env.LLM_TEMPERATURE ?? "0.2",
  "llm.maxTokens": process.env.LLM_MAX_TOKENS ?? "1600",
  "llm.timeoutMs": process.env.LLM_TIMEOUT_MS ?? "120000",
  "nl.groupNaturalEnabled": "true",
  "nl.requireMentionInGroup": "false",
  "nl.contextTtlMinutes": "10",
  "nl.cooldownSeconds": "5",
  "sync.collegesAutoEnabled": "false",
  "sync.collegesIntervalHours": "24",
  "sync.srgaoxiaoAutoEnabled": "false",
  "sync.srgaoxiaoIntervalHours": "24",
  "sync.srgaoxiaoLimit": "120",
  "sync.srgaoxiaoReviewMaxPages": "20",
  "sync.gaokaoCnAutoEnabled": "false",
  "sync.gaokaoCnIntervalHours": "24",
  "sync.gaokaoCnPlanIntervalHours": String(defaultAdmissionPlanIntervalHours()),
  "sync.gaokaoCnScoreIntervalHours": String(defaultAdmissionScoreIntervalHours()),
  "sync.gaokaoCnLimit": DEFAULT_GAOKAO_CN_LIMIT,
  "sync.gaokaoCnQuery": "",
  "sync.gaokaoCnProvinces": "",
  "sync.gaokaoCnSubjectTypes": "",
  "sync.gaokaoCnEligibleOnly": "true",
  "sync.gaokaoCnScoreYears": defaultAdmissionScoreYears().join(","),
  "sync.gaokaoCnPlanYears": defaultAdmissionPlanYears().join(","),
  "sync.gaokaoCnRetryLimit": "1",
  "sync.gaokaoCnRequestDelayMs": process.env.GAOKAO_CN_REQUEST_DELAY_MS ?? DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS,
  "sync.gaokaoCnMaxRequestsPerRun": process.env.GAOKAO_CN_MAX_REQUESTS_PER_RUN ?? DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN,
  "sync.gaokaoCnBatchesPerRun": process.env.GAOKAO_CN_BATCHES_PER_RUN ?? "1",
  "sync.gaokaoCnBatchDelayMs": process.env.GAOKAO_CN_BATCH_DELAY_MS ?? DEFAULT_GAOKAO_CN_BATCH_DELAY_MS,
  "sync.gaokaoCnRateLimitCooldownMinutes": process.env.GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES ?? DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES,
  "sync.gaokaoCnSkipExisting": process.env.GAOKAO_CN_SKIP_EXISTING ?? "true",
  "sync.gaokaoCnIncludePlanDetails": process.env.GAOKAO_CN_INCLUDE_PLAN_DETAILS ?? "false"
};

export class SettingsStore {
  constructor(
    private readonly database: AppDatabase,
    private readonly now: () => Date = () => new Date()
  ) {
    this.seedDefaults();
  }

  all(maskSecrets = true): Record<string, string | boolean> {
    this.refreshSeasonalAdmissionDefaults();
    const rows = this.database.db.prepare("SELECT key, value FROM settings ORDER BY key").all() as Array<{
      key: string;
      value: string;
    }>;
    const values: Record<string, string | boolean> = {};
    for (const row of rows) {
      if (row.key.startsWith("auth.")) continue;
      if (row.key.startsWith("sync.internal.")) continue;
      if (maskSecrets && row.key === "llm.apiKey") {
        values[row.key] = row.value ? "********" : "";
      } else {
        values[row.key] = row.value;
      }
    }
    values["llm.apiKeySet"] = this.getString("llm.apiKey", "") !== "";
    return values;
  }

  runtime(): RuntimeSettings {
    this.refreshSeasonalAdmissionDefaults();
    return {
      onebot: {
        accessToken: this.getString("onebot.accessToken", ""),
        replyEnabled: this.getBoolean("onebot.replyEnabled", true),
        replyAsImage: this.getBoolean("onebot.replyAsImage", true),
        replyImageTitle: this.getString("onebot.replyImageTitle", "高校资料助手"),
        replyImageBadge: this.getString("onebot.replyImageBadge", "AI 生成回复")
      },
      site: {
        publicBaseUrl: this.getString("site.publicBaseUrl", "http://127.0.0.1:8787"),
        filingNumber: this.getString("site.filingNumber", "")
      },
      llm: {
        baseUrl: this.getString("llm.baseUrl", "https://your-sub2api.example.com/v1"),
        apiKey: this.getString("llm.apiKey", ""),
        model: this.getString("llm.model", "gpt-5.5"),
        temperature: this.getNumber("llm.temperature", 0.2),
        maxTokens: this.getNumber("llm.maxTokens", 1600),
        timeoutMs: this.getNumber("llm.timeoutMs", 120000)
      },
      naturalLanguage: {
        groupNaturalEnabled: this.getBoolean("nl.groupNaturalEnabled", true),
        requireMentionInGroup: this.getBoolean("nl.requireMentionInGroup", false),
        contextTtlMinutes: this.getNumber("nl.contextTtlMinutes", 10),
        cooldownSeconds: this.getNumber("nl.cooldownSeconds", 5)
      },
      sync: {
        collegesAutoEnabled: this.getBoolean("sync.collegesAutoEnabled", false),
        collegesIntervalHours: this.getNumber("sync.collegesIntervalHours", 24),
        srgaoxiaoAutoEnabled: this.getBoolean("sync.srgaoxiaoAutoEnabled", false),
        srgaoxiaoIntervalHours: this.getNumber("sync.srgaoxiaoIntervalHours", 24),
        srgaoxiaoLimit: this.getNumber("sync.srgaoxiaoLimit", 120),
        srgaoxiaoReviewMaxPages: this.getNumber("sync.srgaoxiaoReviewMaxPages", 20),
        gaokaoCnAutoEnabled: this.getBoolean("sync.gaokaoCnAutoEnabled", false),
        gaokaoCnIntervalHours: this.getNumber("sync.gaokaoCnIntervalHours", 24),
        gaokaoCnPlanIntervalHours: this.getNumber(
          "sync.gaokaoCnPlanIntervalHours",
          this.getNumber("sync.gaokaoCnIntervalHours", defaultAdmissionPlanIntervalHours())
        ),
        gaokaoCnScoreIntervalHours: this.getNumber("sync.gaokaoCnScoreIntervalHours", defaultAdmissionScoreIntervalHours()),
        gaokaoCnLimit: this.getNumber("sync.gaokaoCnLimit", Number(DEFAULT_GAOKAO_CN_LIMIT)),
        gaokaoCnQuery: this.getString("sync.gaokaoCnQuery", ""),
        gaokaoCnProvinces: this.getString("sync.gaokaoCnProvinces", ""),
        gaokaoCnSubjectTypes: this.getString("sync.gaokaoCnSubjectTypes", ""),
        gaokaoCnEligibleOnly: this.getBoolean("sync.gaokaoCnEligibleOnly", true),
        gaokaoCnScoreYears: this.getString("sync.gaokaoCnScoreYears", defaultAdmissionScoreYears().join(",")),
        gaokaoCnPlanYears: this.getString("sync.gaokaoCnPlanYears", defaultAdmissionPlanYears().join(",")),
        gaokaoCnRetryLimit: this.getNumber("sync.gaokaoCnRetryLimit", 1),
        gaokaoCnRequestDelayMs: clampGaokaoRequestDelayMs(this.getNumber("sync.gaokaoCnRequestDelayMs", Number(DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS))),
        gaokaoCnMaxRequestsPerRun: clampGaokaoMaxRequestsPerRun(this.getNumber("sync.gaokaoCnMaxRequestsPerRun", Number(DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN))),
        gaokaoCnBatchesPerRun: this.getNumber("sync.gaokaoCnBatchesPerRun", 1),
        gaokaoCnBatchDelayMs: clampGaokaoBatchDelayMs(this.getNumber("sync.gaokaoCnBatchDelayMs", Number(DEFAULT_GAOKAO_CN_BATCH_DELAY_MS))),
        gaokaoCnRateLimitCooldownMinutes: clampGaokaoRateLimitCooldownMinutes(this.getNumber("sync.gaokaoCnRateLimitCooldownMinutes", Number(DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES))),
        gaokaoCnSkipExisting: this.getBoolean("sync.gaokaoCnSkipExisting", true),
        gaokaoCnIncludePlanDetails: this.getBoolean("sync.gaokaoCnIncludePlanDetails", false)
      }
    };
  }

  update(values: Record<string, unknown>): void {
    const stmt = this.database.db.prepare(`
      INSERT INTO settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        if (!(key in DEFAULTS)) continue;
        if (key === "llm.apiKey" && value === "********") continue;
        stmt.run(key, normalizeGaokaoSyncSetting(key, String(value ?? "")), now);
      }
    });
  }

  getString(key: string, fallback: string): string {
    const row = this.database.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? fallback;
  }

  setInternal(key: string, value: string): void {
    this.database.db
      .prepare(
        `
        INSERT INTO settings(key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `
      )
      .run(key, value, new Date().toISOString());
  }

  private getNumber(key: string, fallback: number): number {
    const value = this.getString(key, String(fallback));
    if (!value.trim()) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const value = this.getString(key, String(fallback));
    if (/^(true|1|yes|on)$/i.test(value)) return true;
    if (/^(false|0|no|off)$/i.test(value)) return false;
    return fallback;
  }

  private seedDefaults(): void {
    const stmt = this.database.db.prepare(`
      INSERT OR IGNORE INTO settings(key, value, updated_at)
      VALUES (?, ?, ?)
    `);
    const upgradeStmt = this.database.db.prepare(`
      UPDATE settings
      SET value = ?, updated_at = ?
      WHERE key = ? AND value = ?
    `);
    const seedNow = this.now();
    const now = seedNow.toISOString();
    this.database.transaction(() => {
      for (const [key, value] of Object.entries(DEFAULTS)) {
        stmt.run(key, value, now);
      }
      upgradeStmt.run("1600", now, "llm.maxTokens", "900");
      upgradeStmt.run("120000", now, "llm.timeoutMs", "45000");
      upgradeStmt.run("", now, "sync.gaokaoCnProvinces", LEGACY_GAOKAO_PROVINCES_DEFAULT);
      upgradeStmt.run(DEFAULT_GAOKAO_CN_LIMIT, now, "sync.gaokaoCnLimit", "10");
      upgradeStmt.run("1", now, "sync.gaokaoCnRetryLimit", "0");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS, now, "sync.gaokaoCnRequestDelayMs", "5000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS, now, "sync.gaokaoCnRequestDelayMs", "12000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS, now, "sync.gaokaoCnRequestDelayMs", "30000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS, now, "sync.gaokaoCnRequestDelayMs", "60000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN, now, "sync.gaokaoCnMaxRequestsPerRun", "12");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN, now, "sync.gaokaoCnMaxRequestsPerRun", "4");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_BATCH_DELAY_MS, now, "sync.gaokaoCnBatchDelayMs", "60000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_BATCH_DELAY_MS, now, "sync.gaokaoCnBatchDelayMs", "300000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_BATCH_DELAY_MS, now, "sync.gaokaoCnBatchDelayMs", "900000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES, now, "sync.gaokaoCnRateLimitCooldownMinutes", "180");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES, now, "sync.gaokaoCnRateLimitCooldownMinutes", "360");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES, now, "sync.gaokaoCnRateLimitCooldownMinutes", "720");
    });
    this.normalizeGaokaoSyncSettings(now);
    this.refreshSeasonalAdmissionDefaults(seedNow);
  }

  private normalizeGaokaoSyncSettings(now: string): void {
    const rows = this.database.db.prepare(`
      SELECT key, value FROM settings
      WHERE key IN (
        'sync.gaokaoCnRequestDelayMs',
        'sync.gaokaoCnMaxRequestsPerRun',
        'sync.gaokaoCnBatchDelayMs',
        'sync.gaokaoCnRateLimitCooldownMinutes'
      )
    `).all() as Array<{ key: string; value: string }>;
    const stmt = this.database.db.prepare(`
      UPDATE settings
      SET value = ?, updated_at = ?
      WHERE key = ?
    `);
    this.database.transaction(() => {
      for (const row of rows) {
        const normalized = normalizeGaokaoSyncSetting(row.key, row.value);
        if (normalized !== row.value) stmt.run(normalized, now, row.key);
      }
    });
  }

  private refreshSeasonalAdmissionDefaults(now = this.now()): void {
    for (const entry of seasonalAdmissionDefaults(now)) {
      this.refreshAutoDefaultSetting(entry.key, entry.value, entry.recognizedValues);
    }
  }

  private refreshAutoDefaultSetting(key: string, currentDefault: string, recognizedValues: string[]): void {
    const markerKey = `${SEASONAL_GAOKAO_AUTO_DEFAULT_MARKER_PREFIX}${key}`;
    const value = this.getString(key, "");
    const marker = this.getString(markerKey, "");
    const recognized = new Set([...recognizedValues, currentDefault].filter(Boolean));

    if (marker) {
      if (value === marker && value !== currentDefault) {
        this.setInternal(key, currentDefault);
        this.setInternal(markerKey, currentDefault);
      }
      return;
    }

    if (recognized.has(value)) {
      if (value !== currentDefault) {
        this.setInternal(key, currentDefault);
      }
      this.setInternal(markerKey, currentDefault);
    }
  }
}

function normalizeGaokaoSyncSetting(key: string, value: string): string {
  if (key === "sync.gaokaoCnRequestDelayMs") return String(clampGaokaoRequestDelayMs(Number(value)));
  if (key === "sync.gaokaoCnMaxRequestsPerRun") return String(clampGaokaoMaxRequestsPerRun(Number(value)));
  if (key === "sync.gaokaoCnBatchDelayMs") return String(clampGaokaoBatchDelayMs(Number(value)));
  if (key === "sync.gaokaoCnRateLimitCooldownMinutes") return String(clampGaokaoRateLimitCooldownMinutes(Number(value)));
  return value;
}

function clampGaokaoRequestDelayMs(value: number): number {
  if (!Number.isFinite(value)) return Number(DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS);
  return Math.max(MIN_GAOKAO_CN_REQUEST_DELAY_MS, Math.min(60 * 60 * 1000, Math.floor(value)));
}

function clampGaokaoMaxRequestsPerRun(value: number): number {
  if (!Number.isFinite(value)) return Number(DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN);
  return Math.max(1, Math.min(500, Math.floor(value)));
}

function clampGaokaoBatchDelayMs(value: number): number {
  if (!Number.isFinite(value)) return Number(DEFAULT_GAOKAO_CN_BATCH_DELAY_MS);
  return Math.max(MIN_GAOKAO_CN_BATCH_DELAY_MS, Math.min(24 * 60 * 60 * 1000, Math.floor(value)));
}

function clampGaokaoRateLimitCooldownMinutes(value: number): number {
  if (!Number.isFinite(value)) return Number(DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES);
  return Math.max(MIN_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES, Math.min(7 * 24 * 60, Math.floor(value)));
}

function seasonalAdmissionDefaults(now: Date): Array<{ key: string; value: string; recognizedValues: string[] }> {
  return [
    {
      key: "sync.gaokaoCnPlanYears",
      value: defaultAdmissionPlanYears(now).join(","),
      recognizedValues: admissionPlanYearDefaultCandidates(now)
    },
    {
      key: "sync.gaokaoCnScoreYears",
      value: defaultAdmissionScoreYears(now).join(","),
      recognizedValues: admissionScoreYearDefaultCandidates(now)
    },
    {
      key: "sync.gaokaoCnPlanIntervalHours",
      value: String(defaultAdmissionPlanIntervalHours(now)),
      recognizedValues: ["24", "168"]
    },
    {
      key: "sync.gaokaoCnScoreIntervalHours",
      value: String(defaultAdmissionScoreIntervalHours(now)),
      recognizedValues: ["24", "720"]
    }
  ];
}

function admissionPlanYearDefaultCandidates(now: Date): string[] {
  const year = currentAdmissionYear(now);
  return uniqueStrings([String(year), String(year - 1)]);
}

function admissionScoreYearDefaultCandidates(now: Date): string[] {
  const year = currentAdmissionYear(now);
  return uniqueStrings([
    [year, year - 1, year - 2, year - 3].join(","),
    [year - 1, year - 2, year - 3].join(","),
    [year - 1, year - 2, year - 3, year - 4].join(","),
    [year - 2, year - 3, year - 4].join(",")
  ]);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
