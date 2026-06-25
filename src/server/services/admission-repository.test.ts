import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db.js";
import type { ParsedUniversity } from "../domain/parser.js";
import { UniversityRepository } from "./university-repository.js";
import { AdmissionRepository, normalizeBatchName, normalizeMajorName, normalizePlanGroup } from "./admission-repository.js";

describe("admission normalization", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes common batch names", () => {
    expect(normalizeBatchName("普通类本科批")).toBe("本科批");
    expect(normalizeBatchName("本科第一批")).toBe("本科一批");
    expect(normalizeBatchName("本科第二批")).toBe("本科二批");
    expect(normalizeBatchName("高职(专科)批")).toBe("专科批");
    expect(normalizeBatchName("国家专项计划本科批")).toBe("国家专项计划本科批");
    expect(normalizeBatchName("普通类平行录取一段")).toBe("普通类一段");
    expect(normalizeBatchName("普通类常规批第1段")).toBe("普通类一段");
    expect(normalizeBatchName("普通类常规批第2段")).toBe("普通类二段");
    expect(normalizeBatchName("本科提前批A段")).toBe("本科提前批");
    expect(normalizeBatchName("高职专科提前批")).toBe("专科提前批");
    expect(normalizeBatchName("高校专项计划")).toBe("高校专项计划本科批");
  });

  it("normalizes plan group codes", () => {
    expect(normalizePlanGroup("（005）")).toBe("005");
    expect(normalizePlanGroup("9001（L005）")).toBe("9001-L005");
    expect(normalizePlanGroup("第 03 专业组")).toBe("03");
    expect(normalizePlanGroup("专业组1")).toBe("01");
    expect(normalizePlanGroup("01组")).toBe("01");
    expect(normalizePlanGroup("专业组代码a1")).toBe("A01");
  });

  it("keeps useful major qualifiers while removing verbose admission notes", () => {
    expect(normalizeMajorName("法学类（含法学、知识产权）")).toBe("法学类（含法学、知识产权）");
    expect(normalizeMajorName("哲学（培养“哲学+经济学”双学士学位复合型人才，颁发哲学和经济学双学士学位，具体详见学校招生章程）")).toBe("哲学");
    expect(normalizeMajorName("计算机科学与技术（认同并执行四川省少数民族加分项目和分值。将军路校区就读）（一、二年级在常州市天目湖校区就读，三、四年级在南京市将军路校区就读）")).toBe("计算机科学与技术");
    expect(normalizeMajorName("航空航天类（包含专业:飞行器设计与工程、飞行器动力工程）（认同并执行四川省少数民族加分项目和分值。将军路校区就读）")).toBe("航空航天类（包含专业:飞行器设计与工程、飞行器动力工程）");
    expect(normalizeMajorName("软件工程（中外合作办学）")).toBe("软件工程（中外合作办学）");
  });

  it("deduplicates previously stored rows after normalization", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("安徽大学", "an-hui-da-xue")]);
    const university = universities.listUniversities("安徽大学", 1)[0];
    const insert = database.db.prepare(`
      INSERT INTO admission_plans(
        unique_key, source, university_id, source_school_id, year, province_name,
        subject_type, batch, plan_group, major_name, plan_count, raw_json, fetched_at
      )
      VALUES (?, 'gaokao_cn', ?, '67', 2026, '安徽', '历史类', '普通类本科批', ?, ?, ?, '{}', ?)
    `);
    insert.run("old-key", university.id, "（005）", "哲学（培养“哲学+经济学”双学士学位复合型人才，颁发哲学和经济学双学士学位，具体详见学校招生章程）", 20, "2026-06-24T00:00:00.000Z");
    insert.run("new-key", university.id, "005", "哲学", 26, "2026-06-25T00:00:00.000Z");

    new AdmissionRepository(database);

    const rows = database.db
      .prepare("SELECT batch, plan_group AS planGroup, major_name AS majorName, plan_count AS planCount FROM admission_plans")
      .all() as Array<{ batch: string; planGroup: string; majorName: string; planCount: number }>;
    expect(rows).toEqual([{ batch: "本科批", planGroup: "005", majorName: "哲学", planCount: 26 }]);
    database.close();
  });

  it("reports admission coverage and unmapped universities", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      fixtureUniversity("安徽大学", "an-hui-da-xue"),
      fixtureUniversity("北京大学", "bei-jing-da-xue")
    ]);
    const [anhui] = universities.listUniversities("安徽大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: anhui.id,
      sourceSchoolId: "67",
      sourceSchoolName: "安徽大学",
      payloadJson: "{}"
    });
    const [peking] = universities.listUniversities("北京大学", 1);
    admissions.upsertMapping({
      universityId: peking.id,
      sourceSchoolId: "unmatched:2",
      sourceSchoolName: "北京大学",
      matchStatus: "unmatched",
      confidence: 0,
      payloadJson: "{}"
    });
    admissions.upsertPlan({
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2026,
      provinceName: "安徽",
      subjectType: "历史类",
      batch: "普通类本科批",
      planGroup: "（005）",
      majorName: "哲学",
      planCount: 26,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "school",
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2024,
      provinceName: "安徽",
      subjectType: "历史类",
      batch: "本科批",
      minScore: 586,
      minRank: 5388,
      rawJson: "{}"
    });

    const stats = admissions.coverageStats();
    expect(stats.totalUniversities).toBe(2);
    expect(stats.attemptedUniversities).toBe(2);
    expect(stats.mappedUniversities).toBe(1);
    expect(stats.unmappedUniversities).toBe(1);
    expect(stats.pendingUniversities).toBe(0);
    expect(stats.unmatchedUniversities).toBe(1);
    expect(stats.mappingIssueUniversities).toBe(1);
    expect(stats.planUniversities).toBe(1);
    expect(stats.scoreUniversities).toBe(1);
    expect(stats.planYears[0]).toMatchObject({ year: 2026, rowCount: 1, universityCount: 1, provinceCount: 1 });
    expect(admissions.listUnmappedUniversities()).toEqual([]);
    expect(admissions.listMappingIssues().map((row) => row.universityName)).toEqual(["北京大学"]);
    database.close();
  });

  it("filters plans and scores by normalized batch and score type", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("安徽大学", "an-hui-da-xue")]);
    const [anhui] = universities.listUniversities("安徽大学", 1);
    const admissions = new AdmissionRepository(database);

    admissions.upsertPlan({
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2026,
      provinceName: "浙江省",
      subjectType: "综合改革",
      batch: "普通类平行录取一段",
      majorName: "计算机类",
      planCount: 12,
      rawJson: "{}"
    });
    admissions.upsertPlan({
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2026,
      provinceName: "浙江",
      subjectType: "综合改革",
      batch: "普通类平行录取二段",
      majorName: "新闻传播学类",
      planCount: 8,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "school",
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2025,
      provinceName: "浙江",
      subjectType: "综合改革",
      batch: "普通类一段",
      minScore: 630,
      minRank: 18000,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2025,
      provinceName: "浙江",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "计算机类",
      minScore: 640,
      minRank: 12000,
      rawJson: "{}"
    });

    expect(admissions.queryPlans({ universityId: anhui.id, batch: "平行录取一段" }).map((row) => row.majorName)).toEqual(["计算机类"]);
    expect(admissions.queryScores({ universityId: anhui.id, batch: "普通类平行录取一段", scoreType: "school" })).toHaveLength(1);
    expect(admissions.queryScores({ universityId: anhui.id, batch: "普通类一段", scoreType: "major" }).map((row) => row.majorName)).toEqual(["计算机类"]);
    database.close();
  });

  it("filters admission rows by compatible subject type groups", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const [university] = universities.listUniversities("南京航空航天大学", 1);
    const admissions = new AdmissionRepository(database);

    admissions.upsertScore({
      scoreType: "school",
      universityId: university.id,
      sourceSchoolId: "452",
      year: 2025,
      provinceName: "四川",
      subjectType: "物理类",
      batch: "本科批",
      minScore: 622,
      minRank: 14500,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "school",
      universityId: university.id,
      sourceSchoolId: "452",
      year: 2024,
      provinceName: "四川",
      subjectType: "理科",
      batch: "本科一批",
      minScore: 615,
      minRank: 16000,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "school",
      universityId: university.id,
      sourceSchoolId: "452",
      year: 2024,
      provinceName: "四川",
      subjectType: "文科",
      batch: "本科一批",
      minScore: 590,
      minRank: 4800,
      rawJson: "{}"
    });

    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "四川",
      subjectTypes: ["物理类", "理科"],
      years: [2025, 2024]
    }).map((row) => `${row.year}-${row.subjectType}`)).toEqual(["2025-物理类", "2024-理科"]);
    database.close();
  });

  it("returns saved raw source snapshots with university metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("安徽大学", "an-hui-da-xue")]);
    const [university] = universities.listUniversities("安徽大学", 1);
    const admissions = new AdmissionRepository(database);

    const id = admissions.insertSource({
      sourceKind: "score-school",
      universityId: university.id,
      sourceSchoolId: "67",
      sourceUrl: "https://api.zjzw.cn/web/api/?uri=apidata/api/gk/score/province",
      requestJson: JSON.stringify({ year: 2024, school_id: "67" }),
      responseJson: JSON.stringify({ code: "0000", data: { item: [] } }),
      status: "success"
    });

    expect(admissions.getSource(id)).toMatchObject({
      id,
      universityId: university.id,
      universityName: "安徽大学",
      sourceKind: "score-school",
      sourceSchoolId: "67",
      status: "success",
      requestJson: expect.stringContaining("2024"),
      responseJson: expect.stringContaining("0000")
    });
    database.close();
  });

  it("lists source snapshots with filters for admin traceability", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      fixtureUniversity("安徽大学", "an-hui-da-xue"),
      fixtureUniversity("北京大学", "bei-jing-da-xue")
    ]);
    const [anhui] = universities.listUniversities("安徽大学", 1);
    const [peking] = universities.listUniversities("北京大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.insertSource({
      sourceKind: "plan-major",
      universityId: anhui.id,
      sourceSchoolId: "67",
      sourceUrl: "https://api.example/plan",
      requestJson: "{}",
      responseJson: "{\"code\":\"0000\"}",
      status: "success"
    });
    admissions.insertSource({
      sourceKind: "score-school",
      universityId: anhui.id,
      sourceSchoolId: "67",
      sourceUrl: "https://api.example/score",
      requestJson: "{}",
      responseJson: "{\"code\":\"5001\"}",
      status: "error",
      error: "upstream error"
    });
    admissions.insertSource({
      sourceKind: "score-school",
      universityId: peking.id,
      sourceSchoolId: "31",
      sourceUrl: "https://api.example/pku-score",
      requestJson: "{}",
      responseJson: "{\"code\":\"0000\"}",
      status: "success"
    });

    expect(admissions.listSources({ universityId: anhui.id }).map((row) => row.sourceKind)).toEqual(["score-school", "plan-major"]);
    expect(admissions.listSources({ universityId: anhui.id, status: "error" })).toEqual([
      expect.objectContaining({
        universityName: "安徽大学",
        sourceKind: "score-school",
        error: "upstream error"
      })
    ]);
    database.close();
  });

  it("filters admission sync jobs for operational logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const admissions = new AdmissionRepository(database);
    const planJob = admissions.startJob({ jobType: "sync-plan", targetJson: JSON.stringify({ limit: 10, offset: 0 }) });
    const scoreJob = admissions.startJob({ jobType: "sync-score", targetJson: JSON.stringify({ limit: 10, offset: 0 }) });

    admissions.finishJob(planJob, {
      status: "error",
      error: "四川 2026 plan failed",
      resultJson: JSON.stringify({ total: 10, mapped: 9, offset: 0, nextOffset: 10, errors: [{ university: "测试大学", message: "timeout" }] })
    });
    admissions.finishJob(scoreJob, {
      status: "success",
      resultJson: JSON.stringify({ total: 10, mapped: 10, offset: 0, nextOffset: 10 })
    });

    expect(admissions.recentJobs({ status: "error", jobType: "sync-plan", limit: 5 })).toEqual([
      expect.objectContaining({
        id: planJob,
        jobType: "sync-plan",
        status: "error",
        error: "四川 2026 plan failed"
      })
    ]);
    expect(admissions.recentFailedJobs(5).map((job) => job.id)).toEqual([planJob]);
    expect(admissions.recentJobs({ status: "success", limit: 5 }).map((job) => job.id)).toEqual([scoreJob]);
    database.close();
  });
});

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
