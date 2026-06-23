import type { AppDatabase } from "./db.js";

export interface RuntimeSettings {
  onebot: {
    accessToken: string;
    replyEnabled: boolean;
    replyAsImage: boolean;
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
    confidenceThreshold: number;
    contextTtlMinutes: number;
    cooldownSeconds: number;
  };
  sync: {
    collegesAutoEnabled: boolean;
    collegesIntervalHours: number;
    srgaoxiaoAutoEnabled: boolean;
    srgaoxiaoIntervalHours: number;
    srgaoxiaoLimit: number;
  };
}

const DEFAULTS: Record<string, string> = {
  "onebot.accessToken": process.env.ONEBOT_ACCESS_TOKEN ?? "",
  "onebot.replyEnabled": process.env.ONEBOT_REPLY_ENABLED ?? "true",
  "onebot.replyAsImage": process.env.ONEBOT_REPLY_AS_IMAGE ?? "true",
  "llm.baseUrl": process.env.LLM_BASE_URL ?? "https://your-sub2api.example.com/v1",
  "llm.apiKey": process.env.LLM_API_KEY ?? "",
  "llm.model": process.env.LLM_MODEL ?? "gpt-5.5",
  "llm.temperature": process.env.LLM_TEMPERATURE ?? "0.2",
  "llm.maxTokens": process.env.LLM_MAX_TOKENS ?? "1600",
  "llm.timeoutMs": process.env.LLM_TIMEOUT_MS ?? "45000",
  "nl.groupNaturalEnabled": "true",
  "nl.requireMentionInGroup": "false",
  "nl.confidenceThreshold": "0.55",
  "nl.contextTtlMinutes": "10",
  "nl.cooldownSeconds": "5",
  "sync.collegesAutoEnabled": "false",
  "sync.collegesIntervalHours": "24",
  "sync.srgaoxiaoAutoEnabled": "false",
  "sync.srgaoxiaoIntervalHours": "24",
  "sync.srgaoxiaoLimit": "120"
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
        replyAsImage: this.getBoolean("onebot.replyAsImage", true)
      },
      llm: {
        baseUrl: this.getString("llm.baseUrl", "https://your-sub2api.example.com/v1"),
        apiKey: this.getString("llm.apiKey", ""),
        model: this.getString("llm.model", "gpt-5.5"),
        temperature: this.getNumber("llm.temperature", 0.2),
        maxTokens: this.getNumber("llm.maxTokens", 1600),
        timeoutMs: this.getNumber("llm.timeoutMs", 45000)
      },
      naturalLanguage: {
        groupNaturalEnabled: this.getBoolean("nl.groupNaturalEnabled", true),
        requireMentionInGroup: this.getBoolean("nl.requireMentionInGroup", false),
        confidenceThreshold: this.getNumber("nl.confidenceThreshold", 0.55),
        contextTtlMinutes: this.getNumber("nl.contextTtlMinutes", 10),
        cooldownSeconds: this.getNumber("nl.cooldownSeconds", 5)
      },
      sync: {
        collegesAutoEnabled: this.getBoolean("sync.collegesAutoEnabled", false),
        collegesIntervalHours: this.getNumber("sync.collegesIntervalHours", 24),
        srgaoxiaoAutoEnabled: this.getBoolean("sync.srgaoxiaoAutoEnabled", false),
        srgaoxiaoIntervalHours: this.getNumber("sync.srgaoxiaoIntervalHours", 24),
        srgaoxiaoLimit: this.getNumber("sync.srgaoxiaoLimit", 120)
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
    });
  }
}
