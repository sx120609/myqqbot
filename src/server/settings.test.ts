import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./db.js";
import { defaultAdmissionPlanIntervalHours, defaultAdmissionScoreIntervalHours } from "./services/admission-calendar.js";
import { SettingsStore } from "./settings.js";

describe("SettingsStore", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults Gaokao.cn province sync to all provinces", () => {
    const database = createDatabase(tempDirs);
    const settings = new SettingsStore(database);

    expect(settings.runtime().sync.gaokaoCnProvinces).toBe("");
    expect(settings.all(false)["sync.gaokaoCnProvinces"]).toBe("");
    expect(settings.runtime().sync.gaokaoCnLimit).toBe(1);
    expect(settings.all(false)["sync.gaokaoCnLimit"]).toBe("1");
    expect(settings.runtime().sync.gaokaoCnRequestDelayMs).toBe(180000);
    expect(settings.all(false)["sync.gaokaoCnRequestDelayMs"]).toBe("180000");
    expect(settings.runtime().sync.gaokaoCnMaxRequestsPerRun).toBe(1);
    expect(settings.all(false)["sync.gaokaoCnMaxRequestsPerRun"]).toBe("1");
    expect(settings.runtime().sync.gaokaoCnRealtimeRequestDelayMs).toBe(0);
    expect(settings.all(false)["sync.gaokaoCnRealtimeRequestDelayMs"]).toBe("0");
    expect(settings.runtime().sync.gaokaoCnRealtimeMaxRequestsPerRun).toBe(12);
    expect(settings.all(false)["sync.gaokaoCnRealtimeMaxRequestsPerRun"]).toBe("12");
    expect(settings.runtime().sync.gaokaoCnBatchesPerRun).toBe(1);
    expect(settings.all(false)["sync.gaokaoCnBatchesPerRun"]).toBe("1");
    expect(settings.runtime().sync.gaokaoCnBatchDelayMs).toBe(1800000);
    expect(settings.all(false)["sync.gaokaoCnBatchDelayMs"]).toBe("1800000");
    expect(settings.runtime().sync.gaokaoCnRateLimitCooldownMinutes).toBe(1440);
    expect(settings.all(false)["sync.gaokaoCnRateLimitCooldownMinutes"]).toBe("1440");
    expect(settings.runtime().sync.gaokaoCnRetryLimit).toBe(1);
    expect(settings.all(false)["sync.gaokaoCnRetryLimit"]).toBe("1");
    expect(settings.runtime().sync.gaokaoCnSkipExisting).toBe(true);
    expect(settings.all(false)["sync.gaokaoCnSkipExisting"]).toBe("true");
    expect(settings.runtime().sync.gaokaoCnIncludePlanDetails).toBe(false);
    expect(settings.all(false)["sync.gaokaoCnIncludePlanDetails"]).toBe("false");
    expect(settings.runtime().sync.gaokaoCnPlanIntervalHours).toBe(defaultAdmissionPlanIntervalHours());
    expect(settings.all(false)["sync.gaokaoCnPlanIntervalHours"]).toBe(String(defaultAdmissionPlanIntervalHours()));
    expect(settings.runtime().sync.gaokaoCnScoreIntervalHours).toBe(defaultAdmissionScoreIntervalHours());
    expect(settings.all(false)["sync.gaokaoCnScoreIntervalHours"]).toBe(String(defaultAdmissionScoreIntervalHours()));
    expect(settings.runtime().onebot.napcatRestartCommand).toBe("");
    expect(settings.all(false)["onebot.napcatRestartCommand"]).toBe("");
    expect(settings.runtime().onebot.napcatWebUrl).toBe("http://127.0.0.1:6099");
    expect(settings.all(false)["onebot.napcatWebUrl"]).toBe("http://127.0.0.1:6099");
    expect(settings.runtime().onebot.napcatWebKey).toBe("");
    expect(settings.all(false)["onebot.napcatWebKey"]).toBe("");
    expect(settings.runtime().naturalLanguage.admissionJiangsuOnlyEnabled).toBe(true);
    expect(settings.all(false)["nl.admissionJiangsuOnlyEnabled"]).toBe("true");

    database.close();
  });

  it("migrates only the legacy seven-province default to all provinces", () => {
    const legacyDatabase = createDatabase(tempDirs);
    legacyDatabase.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnProvinces", "江苏,浙江,安徽,河南,山东,四川,广东", new Date().toISOString());
    const legacySettings = new SettingsStore(legacyDatabase);

    expect(legacySettings.runtime().sync.gaokaoCnProvinces).toBe("");

    legacyDatabase.close();

    const customDatabase = createDatabase(tempDirs);
    customDatabase.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnProvinces", "四川,河南", new Date().toISOString());
    const customSettings = new SettingsStore(customDatabase);

    expect(customSettings.runtime().sync.gaokaoCnProvinces).toBe("四川,河南");

    customDatabase.close();
  });

  it("migrates old Gaokao.cn throttle defaults to safer values", () => {
    const database = createDatabase(tempDirs);
    const now = new Date().toISOString();
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnLimit", "10", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRetryLimit", "0", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRequestDelayMs", "5000", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnBatchDelayMs", "60000", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRateLimitCooldownMinutes", "180", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnMaxRequestsPerRun", "12", now);

    const settings = new SettingsStore(database);

    expect(settings.runtime().sync.gaokaoCnLimit).toBe(1);
    expect(settings.runtime().sync.gaokaoCnRetryLimit).toBe(1);
    expect(settings.runtime().sync.gaokaoCnRequestDelayMs).toBe(180000);
    expect(settings.runtime().sync.gaokaoCnMaxRequestsPerRun).toBe(1);
    expect(settings.runtime().sync.gaokaoCnBatchDelayMs).toBe(1800000);
    expect(settings.runtime().sync.gaokaoCnRateLimitCooldownMinutes).toBe(1440);

    const databaseWithNewerDefaults = createDatabase(tempDirs);
    const currentNow = new Date().toISOString();
    databaseWithNewerDefaults.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRequestDelayMs", "12000", currentNow);
    databaseWithNewerDefaults.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnBatchDelayMs", "300000", currentNow);
    databaseWithNewerDefaults.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRateLimitCooldownMinutes", "360", currentNow);
    databaseWithNewerDefaults.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnMaxRequestsPerRun", "12", currentNow);
    const migratedSettings = new SettingsStore(databaseWithNewerDefaults);

    expect(migratedSettings.runtime().sync.gaokaoCnRequestDelayMs).toBe(180000);
    expect(migratedSettings.runtime().sync.gaokaoCnMaxRequestsPerRun).toBe(1);
    expect(migratedSettings.runtime().sync.gaokaoCnBatchDelayMs).toBe(1800000);
    expect(migratedSettings.runtime().sync.gaokaoCnRateLimitCooldownMinutes).toBe(1440);

    databaseWithNewerDefaults.close();

    database.close();
  });

  it("normalizes unsafe Gaokao.cn throttle settings from stored and updated values", () => {
    const database = createDatabase(tempDirs);
    const now = new Date().toISOString();
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRequestDelayMs", "9000", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnMaxRequestsPerRun", "0", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRealtimeRequestDelayMs", "-20", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRealtimeMaxRequestsPerRun", "0", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnBatchDelayMs", "1000", now);
    database.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnRateLimitCooldownMinutes", "60", now);

    const settings = new SettingsStore(database);

    expect(settings.all(false)["sync.gaokaoCnRequestDelayMs"]).toBe("180000");
    expect(settings.all(false)["sync.gaokaoCnMaxRequestsPerRun"]).toBe("1");
    expect(settings.all(false)["sync.gaokaoCnRealtimeRequestDelayMs"]).toBe("0");
    expect(settings.all(false)["sync.gaokaoCnRealtimeMaxRequestsPerRun"]).toBe("1");
    expect(settings.all(false)["sync.gaokaoCnBatchDelayMs"]).toBe("1800000");
    expect(settings.all(false)["sync.gaokaoCnRateLimitCooldownMinutes"]).toBe("1440");

    settings.update({
      "sync.gaokaoCnRequestDelayMs": "12000",
      "sync.gaokaoCnMaxRequestsPerRun": "0",
      "sync.gaokaoCnRealtimeRequestDelayMs": "90000",
      "sync.gaokaoCnRealtimeMaxRequestsPerRun": "0",
      "sync.gaokaoCnBatchDelayMs": "300000",
      "sync.gaokaoCnRateLimitCooldownMinutes": "720"
    });

    expect(settings.all(false)["sync.gaokaoCnRequestDelayMs"]).toBe("180000");
    expect(settings.all(false)["sync.gaokaoCnMaxRequestsPerRun"]).toBe("1");
    expect(settings.all(false)["sync.gaokaoCnRealtimeRequestDelayMs"]).toBe("60000");
    expect(settings.all(false)["sync.gaokaoCnRealtimeMaxRequestsPerRun"]).toBe("1");
    expect(settings.all(false)["sync.gaokaoCnBatchDelayMs"]).toBe("1800000");
    expect(settings.all(false)["sync.gaokaoCnRateLimitCooldownMinutes"]).toBe("1440");

    database.close();
  });

  it("refreshes seasonal Gaokao.cn auto defaults without exposing internal markers", () => {
    const database = createDatabase(tempDirs);
    let now = new Date("2026-06-20T00:00:00+08:00");
    const settings = new SettingsStore(database, () => now);

    expect(settings.runtime().sync.gaokaoCnScoreYears).toBe("2025,2024,2023");
    expect(settings.runtime().sync.gaokaoCnScoreIntervalHours).toBe(720);

    now = new Date("2026-07-02T00:00:00+08:00");

    expect(settings.runtime().sync.gaokaoCnScoreYears).toBe("2026,2025,2024,2023");
    expect(settings.runtime().sync.gaokaoCnScoreIntervalHours).toBe(24);
    expect(Object.keys(settings.all(false)).some((key) => key.startsWith("sync.internal."))).toBe(false);

    database.close();
  });

  it("refreshes existing seasonal defaults without overwriting manual Gaokao.cn values", () => {
    const existingDatabase = createDatabase(tempDirs);
    const insertedAt = new Date("2026-06-20T00:00:00+08:00").toISOString();
    existingDatabase.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnScoreYears", "2025,2024,2023", insertedAt);
    existingDatabase.db
      .prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)")
      .run("sync.gaokaoCnScoreIntervalHours", "720", insertedAt);

    const migratedExistingSettings = new SettingsStore(existingDatabase, () => new Date("2026-07-02T00:00:00+08:00"));

    expect(migratedExistingSettings.runtime().sync.gaokaoCnScoreYears).toBe("2026,2025,2024,2023");
    expect(migratedExistingSettings.runtime().sync.gaokaoCnScoreIntervalHours).toBe(24);

    existingDatabase.close();

    const customDatabase = createDatabase(tempDirs);
    let now = new Date("2026-06-20T00:00:00+08:00");
    const customSettings = new SettingsStore(customDatabase, () => now);
    customSettings.update({
      "sync.gaokaoCnScoreYears": "2024,2023",
      "sync.gaokaoCnScoreIntervalHours": "48"
    });

    now = new Date("2026-07-02T00:00:00+08:00");

    expect(customSettings.runtime().sync.gaokaoCnScoreYears).toBe("2024,2023");
    expect(customSettings.runtime().sync.gaokaoCnScoreIntervalHours).toBe(48);

    customDatabase.close();
  });

  it("uses numeric defaults for blank values while preserving explicit zero", () => {
    const database = createDatabase(tempDirs);
    const settings = new SettingsStore(database);
    const now = new Date().toISOString();
    database.db
      .prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?")
      .run("", now, "sync.gaokaoCnMaxRequestsPerRun");
    database.db
      .prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?")
      .run("0", now, "nl.cooldownSeconds");

    expect(settings.runtime().sync.gaokaoCnMaxRequestsPerRun).toBe(1);
    expect(settings.runtime().naturalLanguage.cooldownSeconds).toBe(0);

    database.close();
  });
});

function createDatabase(tempDirs: string[]): AppDatabase {
  const dir = mkdtempSync(join(tmpdir(), "myqqbot-settings-test-"));
  tempDirs.push(dir);
  return new AppDatabase(join(dir, "test.sqlite"));
}
