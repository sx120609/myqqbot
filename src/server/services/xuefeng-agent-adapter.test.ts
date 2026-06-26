import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db.js";
import type { ParsedUniversity } from "../domain/parser.js";
import { AdmissionRepository } from "./admission-repository.js";
import { UniversityRepository } from "./university-repository.js";
import { prepareXuefengRow, XUEFENG_AGENT_SOURCE, XuefengAgentAdapter } from "./xuefeng-agent-adapter.js";

describe("XuefengAgentAdapter", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses school groups without treating selection requirements as majors", () => {
    expect(prepareXuefengRow({ school_name: "南京大学03专业组", major_name: "(不限)" })).toEqual({
      sourceSchoolId: "南京大学",
      sourceSchoolName: "南京大学",
      planGroup: "03",
      majorName: null,
      selectionRequirements: "不限",
      scoreType: "school"
    });
    expect(prepareXuefengRow({ school_name: "北京大学", major_name: "第A51组(其他院校)" })).toMatchObject({
      sourceSchoolName: "北京大学",
      planGroup: "A51",
      majorName: null,
      scoreType: "school"
    });
    expect(prepareXuefengRow({ school_name: "浙江大学", major_name: "计算机科学与技术" })).toMatchObject({
      sourceSchoolName: "浙江大学",
      planGroup: null,
      majorName: "计算机科学与技术",
      scoreType: "major"
    });
  });

  it("imports Xuefeng Agent SQLite rows into admission scores", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-xuefeng-test-"));
    tempDirs.push(dir);
    const sourceDbPath = join(dir, "admission_clean.db");
    createSourceDb(sourceDbPath);

    const database = new AppDatabase(join(dir, "bot.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      fixtureUniversity("南京大学", "nan-jing-da-xue"),
      fixtureUniversity("浙江大学", "zhe-jiang-da-xue")
    ]);
    const admissions = new AdmissionRepository(database);
    const adapter = new XuefengAgentAdapter(dir, database, universities, admissions);

    const result = await adapter.sync({ dbPath: sourceDbPath });

    expect(result).toMatchObject({
      source: XUEFENG_AGENT_SOURCE,
      total: 3,
      mapped: 2,
      scoreRows: 2,
      schoolScoreRows: 1,
      majorScoreRows: 1,
      unmapped: 1
    });

    const nanjing = universities.listUniversities("南京大学", 1)[0];
    const zhejiang = universities.listUniversities("浙江大学", 1)[0];
    expect(admissions.queryScores({ universityId: nanjing.id, provinceName: "江苏", subjectType: "历史类", years: [2024] })).toEqual([
      expect.objectContaining({
        source: XUEFENG_AGENT_SOURCE,
        scoreType: "school",
        planGroup: "03",
        majorName: null,
        selectionRequirements: "不限",
        minScore: 638,
        minRank: null
      })
    ]);
    expect(admissions.queryScores({ universityId: zhejiang.id, provinceName: "浙江", subjectType: "综合改革", years: [2024] })).toEqual([
      expect.objectContaining({
        source: XUEFENG_AGENT_SOURCE,
        scoreType: "major",
        majorName: "计算机科学与技术",
        minScore: 690,
        minRank: 900,
        planCount: 12
      })
    ]);
    expect(admissions.coverageStats(XUEFENG_AGENT_SOURCE)).toMatchObject({
      mappedUniversities: 2,
      scoreRows: 2,
      schoolScoreRows: 1,
      majorScoreRows: 1,
      sourceRows: 1
    });
    database.close();
  });

  it("can prepare the cached SQLite without creating an admission sync job", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-xuefeng-cache-test-"));
    tempDirs.push(dir);
    const cacheDir = join(dir, "xuefeng-agent");
    mkdirSync(cacheDir, { recursive: true });
    const sourceDbPath = join(cacheDir, "admission_clean.db");
    createSourceDb(sourceDbPath);

    const database = new AppDatabase(join(dir, "bot.sqlite"));
    const universities = new UniversityRepository(database);
    const admissions = new AdmissionRepository(database);
    const adapter = new XuefengAgentAdapter(dir, database, universities, admissions);

    const result = await adapter.ensureSourceDb();
    const jobs = database.db.prepare("SELECT COUNT(*) AS count FROM admission_sync_jobs").get() as { count: number };

    expect(result).toMatchObject({
      dbPath: sourceDbPath,
      dbExists: true,
      downloaded: false
    });
    expect(jobs.count).toBe(0);
    database.close();
  });
});

function createSourceDb(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE admission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      province TEXT NOT NULL,
      year INTEGER NOT NULL,
      category TEXT,
      batch TEXT,
      school_name TEXT NOT NULL,
      major_name TEXT,
      score INTEGER,
      rank INTEGER,
      quota INTEGER,
      source_file TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO admission(province, year, category, batch, school_name, major_name, score, rank, quota, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run("江苏", 2024, "历史类", "本科批", "南京大学03专业组", "(不限)", 638, null, null, "jiangsu.xlsx");
  insert.run("浙江", 2024, "综合", "普通类第一段", "浙江大学", "计算机科学与技术", 690, 900, 12, "zhejiang.xlsx");
  insert.run("浙江", 2024, "综合", "普通类第一段", "不存在大学", "测试专业", 500, 10000, 1, "zhejiang.xlsx");
  db.close();
}

function fixtureUniversity(name: string, slug: string): ParsedUniversity {
  return {
    name,
    slug,
    filePath: `docs/universities/${slug}.md`,
    sourceUrl: `https://example.test/${slug}.md`,
    rawMarkdown: "# fixture",
    questions: []
  };
}
