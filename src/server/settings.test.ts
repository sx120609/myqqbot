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
});

function createDatabase(tempDirs: string[]): AppDatabase {
  const dir = mkdtempSync(join(tmpdir(), "myqqbot-settings-test-"));
  tempDirs.push(dir);
  return new AppDatabase(join(dir, "test.sqlite"));
}
