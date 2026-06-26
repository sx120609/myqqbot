import type { AppDatabase } from "./db.js";
import {
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
  };
}

const LEGACY_GAOKAO_PROVINCES_DEFAULT = "江苏,浙江,安徽,河南,山东,四川,广东";
const DEFAULT_GAOKAO_CN_LIMIT = "1";
const DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS = "60000";
const DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN = "4";
const DEFAULT_GAOKAO_CN_BATCH_DELAY_MS = "900000";
const DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES = "720";

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
  "sync.gaokaoCnSkipExisting": process.env.GAOKAO_CN_SKIP_EXISTING ?? "true"
};

export class SettingsStore {
  constructor(private readonly database: AppDatabase) {
    this.seedDefaults();
  }

  all(maskSecrets = true): Record<string, string | boolean> {
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
        gaokaoCnRequestDelayMs: this.getNumber("sync.gaokaoCnRequestDelayMs", Number(DEFAULT_GAOKAO_CN_REQUEST_DELAY_MS)),
        gaokaoCnMaxRequestsPerRun: this.getNumber("sync.gaokaoCnMaxRequestsPerRun", Number(DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN)),
        gaokaoCnBatchesPerRun: this.getNumber("sync.gaokaoCnBatchesPerRun", 1),
        gaokaoCnBatchDelayMs: this.getNumber("sync.gaokaoCnBatchDelayMs", Number(DEFAULT_GAOKAO_CN_BATCH_DELAY_MS)),
        gaokaoCnRateLimitCooldownMinutes: this.getNumber("sync.gaokaoCnRateLimitCooldownMinutes", Number(DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES)),
        gaokaoCnSkipExisting: this.getBoolean("sync.gaokaoCnSkipExisting", true)
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
        stmt.run(key, String(value ?? ""), now);
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
    const now = new Date().toISOString();
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
      upgradeStmt.run(DEFAULT_GAOKAO_CN_MAX_REQUESTS_PER_RUN, now, "sync.gaokaoCnMaxRequestsPerRun", "12");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_BATCH_DELAY_MS, now, "sync.gaokaoCnBatchDelayMs", "60000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_BATCH_DELAY_MS, now, "sync.gaokaoCnBatchDelayMs", "300000");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES, now, "sync.gaokaoCnRateLimitCooldownMinutes", "180");
      upgradeStmt.run(DEFAULT_GAOKAO_CN_RATE_LIMIT_COOLDOWN_MINUTES, now, "sync.gaokaoCnRateLimitCooldownMinutes", "360");
    });
  }
}
