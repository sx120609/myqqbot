import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./db.js";
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
    expect(settings.runtime().sync.gaokaoCnRequestDelayMs).toBe(60000);
    expect(settings.all(false)["sync.gaokaoCnRequestDelayMs"]).toBe("60000");
    expect(settings.runtime().sync.gaokaoCnMaxRequestsPerRun).toBe(4);
    expect(settings.all(false)["sync.gaokaoCnMaxRequestsPerRun"]).toBe("4");
    expect(settings.runtime().sync.gaokaoCnBatchesPerRun).toBe(1);
    expect(settings.all(false)["sync.gaokaoCnBatchesPerRun"]).toBe("1");
    expect(settings.runtime().sync.gaokaoCnBatchDelayMs).toBe(900000);
    expect(settings.all(false)["sync.gaokaoCnBatchDelayMs"]).toBe("900000");
    expect(settings.runtime().sync.gaokaoCnRateLimitCooldownMinutes).toBe(720);
    expect(settings.all(false)["sync.gaokaoCnRateLimitCooldownMinutes"]).toBe("720");
    expect(settings.runtime().sync.gaokaoCnRetryLimit).toBe(1);
    expect(settings.all(false)["sync.gaokaoCnRetryLimit"]).toBe("1");
    expect(settings.runtime().sync.gaokaoCnSkipExisting).toBe(true);
    expect(settings.all(false)["sync.gaokaoCnSkipExisting"]).toBe("true");

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
    expect(settings.runtime().sync.gaokaoCnRequestDelayMs).toBe(60000);
    expect(settings.runtime().sync.gaokaoCnMaxRequestsPerRun).toBe(4);
    expect(settings.runtime().sync.gaokaoCnBatchDelayMs).toBe(900000);
    expect(settings.runtime().sync.gaokaoCnRateLimitCooldownMinutes).toBe(720);

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

    expect(migratedSettings.runtime().sync.gaokaoCnRequestDelayMs).toBe(60000);
    expect(migratedSettings.runtime().sync.gaokaoCnMaxRequestsPerRun).toBe(4);
    expect(migratedSettings.runtime().sync.gaokaoCnBatchDelayMs).toBe(900000);
    expect(migratedSettings.runtime().sync.gaokaoCnRateLimitCooldownMinutes).toBe(720);

    databaseWithNewerDefaults.close();

    database.close();
  });
});

function createDatabase(tempDirs: string[]): AppDatabase {
  const dir = mkdtempSync(join(tmpdir(), "myqqbot-settings-test-"));
  tempDirs.push(dir);
  return new AppDatabase(join(dir, "test.sqlite"));
}
