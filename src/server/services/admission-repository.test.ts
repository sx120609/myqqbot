import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db.js";
import type { ParsedUniversity } from "../domain/parser.js";
import { UniversityRepository } from "./university-repository.js";
import {
  AdmissionRepository,
  normalizeBatchName,
  normalizeMajorName,
  normalizePlanGroup,
  normalizeProvinceName,
  normalizeSubjectType
} from "./admission-repository.js";

describe("admission normalization", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes common batch names", () => {
    expect(normalizeBatchName("普通类本科批")).toBe("本科批");
    expect(normalizeBatchName("普通本科批")).toBe("本科批");
    expect(normalizeBatchName("本科普通批")).toBe("本科批");
    expect(normalizeBatchName("本科第一批")).toBe("本科一批");
    expect(normalizeBatchName("第一批本科")).toBe("本科一批");
    expect(normalizeBatchName("本科一批A段")).toBe("本科一批");
    expect(normalizeBatchName("本科第二批")).toBe("本科二批");
    expect(normalizeBatchName("第二批本科")).toBe("本科二批");
    expect(normalizeBatchName("高职(专科)批")).toBe("专科批");
    expect(normalizeBatchName("国家专项计划本科批")).toBe("国家专项计划本科批");
    expect(normalizeBatchName("普通类平行录取一段")).toBe("普通类一段");
    expect(normalizeBatchName("普通类常规批第1段")).toBe("普通类一段");
    expect(normalizeBatchName("普通类常规批第2段")).toBe("普通类二段");
    expect(normalizeBatchName("本科提前批A段")).toBe("本科提前批");
    expect(normalizeBatchName("高职专科提前批")).toBe("专科提前批");
    expect(normalizeBatchName("高校专项计划")).toBe("高校专项计划本科批");
  });

  it("normalizes province and subject aliases", () => {
    expect(normalizeProvinceName("北京市")).toBe("北京");
    expect(normalizeProvinceName("广西壮族自治区")).toBe("广西");
    expect(normalizeProvinceName("宁夏回族自治区")).toBe("宁夏");
    expect(normalizeProvinceName("新疆维吾尔自治区")).toBe("新疆");
    expect(normalizeProvinceName("内蒙古自治区")).toBe("内蒙古");
    expect(normalizeSubjectType("不限科目")).toBe("综合改革");
    expect(normalizeSubjectType("不分文理")).toBe("综合改革");
    expect(normalizeSubjectType("首选物理")).toBe("物理类");
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

  it("writes normalized province and subject fields back to existing rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("北京大学", "bei-jing-da-xue")]);
    const university = universities.listUniversities("北京大学", 1)[0];
    database.db.prepare(`
      INSERT INTO admission_scores(
        unique_key, source, score_type, university_id, source_school_id, year,
        province_name, subject_type, batch, min_score, min_rank, raw_json, fetched_at
      )
      VALUES ('old-score-key', 'gaokao_cn', 'school', ?, '31', 2025, '北京市', '不限科目', '普通类本科批', 690, 120, '{}', ?)
    `).run(university.id, "2026-06-25T00:00:00.000Z");

    const admissions = new AdmissionRepository(database);

    const stored = database.db.prepare("SELECT province_name AS provinceName, subject_type AS subjectType, batch FROM admission_scores").get() as {
      provinceName: string;
      subjectType: string;
      batch: string;
    };
    expect(stored).toEqual({ provinceName: "北京", subjectType: "综合改革", batch: "本科批" });
    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "北京",
      subjectType: "综合改革",
      years: [2025]
    })).toEqual([
      expect.objectContaining({
        provinceName: "北京",
        subjectType: "综合改革",
        minScore: 690,
        minRank: 120
      })
    ]);
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
    const gaps = admissions.coverageGaps({
      planYears: [2026],
      scoreYears: [2024],
      provinces: ["安徽", "北京"],
      limit: 10
    });
    expect(gaps.find((gap) => gap.kind === "plan" && gap.year === 2026 && gap.provinceName === "安徽" && gap.subjectType === "历史类")).toMatchObject({
      totalMappedUniversities: 1,
      coveredUniversities: 1,
      missingUniversities: 0,
      rowCount: 1,
      coverageRatio: 1
    });
    expect(gaps.find((gap) => gap.kind === "plan" && gap.year === 2026 && gap.provinceName === "安徽" && gap.subjectType === "物理类")).toMatchObject({
      totalMappedUniversities: 1,
      coveredUniversities: 0,
      missingUniversities: 1,
      rowCount: 0
    });
    expect(gaps.find((gap) => gap.kind === "plan" && gap.year === 2026 && gap.provinceName === "北京" && gap.subjectType === "综合改革")).toMatchObject({
      totalMappedUniversities: 1,
      coveredUniversities: 0,
      missingUniversities: 1,
      rowCount: 0
    });
    expect(gaps.find((gap) => gap.kind === "school_score" && gap.year === 2024 && gap.provinceName === "安徽" && gap.subjectType === "历史类")).toMatchObject({
      coveredUniversities: 1,
      missingUniversities: 0,
      rowCount: 1
    });
    expect(gaps.find((gap) => gap.kind === "school_score" && gap.year === 2024 && gap.provinceName === "安徽" && gap.subjectType === "物理类")).toMatchObject({
      coveredUniversities: 0,
      missingUniversities: 1,
      rowCount: 0
    });
    expect(gaps.find((gap) => gap.kind === "major_score" && gap.year === 2024 && gap.provinceName === "安徽" && gap.subjectType === "历史类")).toMatchObject({
      coveredUniversities: 0,
      missingUniversities: 1,
      rowCount: 0
    });
    expect(admissions.listUnmappedUniversities()).toEqual([]);
    expect(admissions.listMappingIssues().map((row) => row.universityName)).toEqual(["北京大学"]);
    database.close();
  });

  it("checks existing plan and score coverage with normalized filters", () => {
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
      batch: "普通类一段",
      majorName: null,
      planCount: 12,
      rawJson: "{}"
    });
    admissions.upsertPlan({
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2026,
      provinceName: "浙江",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "计算机类",
      planCount: 8,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "school",
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2025,
      provinceName: "浙江",
      subjectType: "不限科目",
      minScore: 630,
      minRank: 18000,
      rawJson: "{}"
    });

    expect(admissions.hasPlanCoverage({
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2026,
      provinceName: "浙江省",
      subjectType: "综合改革"
    })).toBe(true);
    expect(admissions.hasPlanCoverage({
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2026,
      provinceName: "浙江",
      subjectType: "综合改革",
      majorOnly: true
    })).toBe(true);
    expect(admissions.hasScoreCoverage({
      scoreType: "school",
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2025,
      provinceName: "浙江省",
      subjectType: "综合改革"
    })).toBe(true);
    expect(admissions.hasScoreCoverage({
      scoreType: "major",
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2025,
      provinceName: "浙江",
      subjectType: "综合改革"
    })).toBe(false);
    database.close();
  });

  it("lists mapped universities missing a selected coverage gap", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      fixtureUniversity("安徽大学", "an-hui-da-xue"),
      fixtureUniversity("合肥工业大学", "he-fei-gong-ye-da-xue")
    ]);
    const [anhui] = universities.listUniversities("安徽大学", 1);
    const [hfut] = universities.listUniversities("合肥工业大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: anhui.id,
      sourceSchoolId: "67",
      sourceSchoolName: "安徽大学",
      payloadJson: "{}"
    });
    admissions.upsertMapping({
      universityId: hfut.id,
      sourceSchoolId: "72",
      sourceSchoolName: "合肥工业大学",
      payloadJson: "{}"
    });
    admissions.upsertPlan({
      universityId: anhui.id,
      sourceSchoolId: "67",
      year: 2026,
      provinceName: "安徽",
      subjectType: "物理类",
      planCount: 120,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "school",
      universityId: hfut.id,
      sourceSchoolId: "72",
      year: 2025,
      provinceName: "安徽",
      subjectType: "理科",
      minScore: 610,
      minRank: 12000,
      rawJson: "{}"
    });

    expect(admissions.coverageMissingUniversities({
      kind: "plan",
      year: 2026,
      provinceName: "安徽",
      subjectType: "物理类"
    }).map((row) => row.universityName)).toEqual(["合肥工业大学"]);
    expect(admissions.coverageMissingUniversities({
      kind: "plan",
      year: 2026,
      provinceName: "安徽",
      subjectType: "历史类"
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ universityName: "安徽大学" }),
      expect.objectContaining({ universityName: "合肥工业大学" })
    ]));
    expect(admissions.coverageMissingUniversities({
      kind: "school_score",
      year: 2025,
      provinceName: "安徽",
      subjectType: "理科"
    }).map((row) => row.universityName)).toEqual(["安徽大学"]);
    expect(admissions.coverageMissingUniversities({
      kind: "school_score",
      year: 2025,
      provinceName: "安徽",
      subjectType: "物理类"
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ universityName: "安徽大学" }),
      expect.objectContaining({ universityName: "合肥工业大学" })
    ]));
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
      planGroup: "（003）",
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
      planGroup: "04组",
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
      planGroup: "第 03 专业组",
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
      planGroup: "03组",
      majorName: "计算机类",
      minScore: 640,
      minRank: 12000,
      rawJson: "{}"
    });

    expect(admissions.queryPlans({ universityId: anhui.id, batch: "平行录取一段" }).map((row) => row.majorName)).toEqual(["计算机类"]);
    expect(admissions.queryPlans({ universityId: anhui.id, planGroup: "第3专业组" }).map((row) => row.majorName)).toEqual(["计算机类"]);
    expect(admissions.queryScores({ universityId: anhui.id, batch: "普通类平行录取一段", scoreType: "school" })).toHaveLength(1);
    expect(admissions.queryScores({ universityId: anhui.id, planGroup: "003", scoreType: "school" })).toHaveLength(1);
    expect(admissions.queryScores({ universityId: anhui.id, batch: "普通类一段", scoreType: "major" }).map((row) => row.majorName)).toEqual(["计算机类"]);
    expect(admissions.queryScores({ universityId: anhui.id, planGroup: "03组", scoreType: "major" }).map((row) => row.majorName)).toEqual(["计算机类"]);
    database.close();
  });

  it("updates identical admission unique keys while keeping distinct groups and score types", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("北京邮电大学", "bei-jing-you-dian-da-xue")]);
    const [university] = universities.listUniversities("北京邮电大学", 1);
    const admissions = new AdmissionRepository(database);

    admissions.upsertPlan({
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2026,
      provinceName: "山东省",
      subjectType: "综合改革",
      batch: "普通类一段",
      planGroup: "第 03 专业组",
      majorName: "通信工程",
      planCount: 18,
      rawJson: "{\"version\":1}"
    });
    admissions.upsertPlan({
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2026,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类平行录取一段",
      planGroup: "03组",
      majorName: "通信工程",
      planCount: 22,
      rawJson: "{\"version\":2}"
    });
    admissions.upsertPlan({
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2026,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      planGroup: "04组",
      majorName: "通信工程",
      planCount: 9,
      rawJson: "{\"version\":3}"
    });

    admissions.upsertScore({
      scoreType: "school",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      minScore: 640,
      minRank: 2000,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      minScore: 650,
      minRank: 1000,
      rawJson: "{}"
    });

    expect(admissions.queryPlans({ universityId: university.id, provinceName: "山东", subjectType: "综合改革" }).map((row) => ({
      group: row.planGroup,
      count: row.planCount,
      raw: row.rawJson
    }))).toEqual([
      { group: "03", count: 22, raw: "{\"version\":2}" },
      { group: "04", count: 9, raw: "{\"version\":3}" }
    ]);
    expect(admissions.queryScores({ universityId: university.id, provinceName: "山东", subjectType: "综合改革" }).map((row) => ({
      type: row.scoreType,
      score: row.minScore
    }))).toEqual([
      { type: "school", score: 640 },
      { type: "major", score: 650 }
    ]);
    database.close();
  });

  it("expands common major aliases without overbroad exact aliases", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-admission-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("北京邮电大学", "bei-jing-you-dian-da-xue")]);
    const [university] = universities.listUniversities("北京邮电大学", 1);
    const admissions = new AdmissionRepository(database);

    admissions.upsertScore({
      scoreType: "major",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "软件工程",
      minScore: 650,
      minRank: 1200,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "计算机类",
      minScore: 652,
      minRank: 900,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "电子信息类",
      minScore: 651,
      minRank: 1000,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "通信工程",
      minScore: 649,
      minRank: 1100,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "网络空间安全",
      minScore: 648,
      minRank: 1800,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "经济学类",
      minScore: 630,
      minRank: 5000,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2025,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      majorName: "中药学类",
      minScore: 625,
      minRank: 6100,
      rawJson: "{}"
    });

    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "山东",
      subjectType: "综合改革",
      scoreType: "major",
      majorName: "计算机"
    }).map((row) => row.majorName)).toEqual(["计算机类", "软件工程", "网络空间安全"]);
    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "山东",
      subjectType: "综合改革",
      scoreType: "major",
      majorName: "计算机科学与技术"
    }).map((row) => row.majorName)).toEqual(["计算机类"]);
    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "山东",
      subjectType: "综合改革",
      scoreType: "major",
      majorName: "软工"
    }).map((row) => row.majorName)).toEqual(["软件工程"]);
    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "山东",
      subjectType: "综合改革",
      scoreType: "major",
      majorName: "电信"
    }).map((row) => row.majorName)).toEqual(["电子信息类", "通信工程"]);
    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "山东",
      subjectType: "综合改革",
      scoreType: "major",
      majorName: "中药"
    }).map((row) => row.majorName)).toEqual(["中药学类"]);
    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "山东",
      subjectType: "综合改革",
      scoreType: "major",
      majorName: "人工智能专业"
    }).map((row) => row.majorName)).toEqual(["计算机类"]);
    expect(admissions.queryScores({
      universityId: university.id,
      provinceName: "山东",
      subjectType: "综合改革",
      scoreType: "major",
      majorName: "大数据方向"
    }).map((row) => row.majorName)).toEqual(["计算机类"]);
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
