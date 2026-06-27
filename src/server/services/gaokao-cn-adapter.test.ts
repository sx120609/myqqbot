import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../db.js";
import type { ParsedUniversity } from "../domain/parser.js";
import { AdmissionRepository } from "./admission-repository.js";
import { GaokaoCnAdapter } from "./gaokao-cn-adapter.js";
import { UniversityRepository } from "./university-repository.js";

describe("GaokaoCnAdapter", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks sync jobs as failed when a source endpoint returns an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const admissions = new AdmissionRepository(database);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        code: "0000",
        message: "成功-success",
        data: {
          item: [
            {
              school_id: 452,
              name: "南京航空航天大学",
              province_name: "江苏",
              city_name: "南京",
              level_name: "本科",
              type_name: "理工"
            }
          ],
          numFound: 1
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: "5001",
        message: "temporary upstream error",
        data: { item: [], numFound: 0 }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.sync({
      query: "南京航空航天大学",
      limit: 1,
      provinces: ["四川"],
      subjectTypes: ["理科"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("plan-school-summary returned 5001");
    expect(result.errors[0].message).toContain("local_province_id=51");
    expect(result.errors[0].message).toContain("local_type_id=1");
    expect(result.errors[0].message).toContain("year=2026");
    expect(result.nextOffset).toBe(0);
    expect(admissions.recentFailedJobs(1)[0]).toMatchObject({
      jobType: "sync-plan",
      status: "error",
      error: expect.stringContaining("temporary upstream error")
    });
    expect(
      database.db
        .prepare("SELECT COUNT(*) AS count FROM admission_sources WHERE status = 'error'")
        .get()
    ).toMatchObject({ count: 1 });
    database.close();
  });

  it("stops the current batch when Gaokao.cn returns a rate limit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      fixtureUniversity("一号大学", "yi-hao-da-xue"),
      fixtureUniversity("二号大学", "er-hao-da-xue")
    ]);
    const admissions = new AdmissionRepository(database);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const decoded = decodeURIComponent(url);
      expect(decoded).not.toContain("二号大学");
      if (url.includes("school/lists")) {
        expect(decoded).toContain("一号大学");
        return jsonResponse({
          code: "0000",
          message: "成功-success",
          data: {
            item: [
              {
                school_id: 1001,
                name: "一号大学",
                province_name: "北京",
                city_name: "北京",
                level_name: "本科",
                type_name: "综合"
              }
            ],
            numFound: 1
          }
        });
      }
      return jsonResponse({
        code: "1069",
        message: "访问太过频繁，请稍后再试",
        data: { item: [], numFound: 0 }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.sync({
      query: "大学",
      limit: 2,
      provinces: ["北京"],
      subjectTypes: ["综合改革"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false
    });

    expect(result.total).toBe(2);
    expect(result.mapped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("1069");
    expect(result.errors[0].message).toContain("访问太过频繁");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(admissions.recentFailedJobs(1)[0]).toMatchObject({
      jobType: "sync-plan",
      status: "error",
      error: expect.stringContaining("1069")
    });
    database.close();
  });

  it("uses shared cooldown after a Gaokao.cn rate limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("一号大学", "yi-hao-da-xue")]);
    const admissions = new AdmissionRepository(database);
    const cooldownStore = memoryCooldownStore();
    const adapter = new GaokaoCnAdapter(universities, admissions, undefined, cooldownStore);

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("school/lists")) {
        return jsonResponse({
          code: "0000",
          message: "成功-success",
          data: {
            item: [
              {
                school_id: 1001,
                name: "一号大学",
                province_name: "北京",
                city_name: "北京",
                level_name: "本科",
                type_name: "综合"
              }
            ],
            numFound: 1
          }
        });
      }
      return jsonResponse({
        code: "1069",
        message: "访问太过频繁，请稍后再试",
        data: { item: [], numFound: 0 }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await adapter.sync({
      query: "一号大学",
      limit: 1,
      provinces: ["北京"],
      subjectTypes: ["综合改革"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false,
      rateLimitCooldownMinutes: 10
    });
    const callsAfterRateLimit = fetchMock.mock.calls.length;

    const restartedAdapter = new GaokaoCnAdapter(universities, admissions, undefined, cooldownStore);
    const second = await restartedAdapter.sync({
      query: "一号大学",
      limit: 1,
      provinces: ["北京"],
      subjectTypes: ["综合改革"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false
    });

    expect(first.errors[0].message).toContain("1069");
    expect(adapter.rateLimitStatus()).toMatchObject({ active: true, until: expect.any(String) });
    expect(restartedAdapter.rateLimitStatus()).toMatchObject({ active: true, until: expect.any(String) });
    expect(second.errors).toHaveLength(1);
    expect(second.errors[0].message).toContain("限流冷却中");
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterRateLimit);
    database.close();
  });

  it("counts every paginated source snapshot in sync results", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const admissions = new AdmissionRepository(database);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        code: "0000",
        message: "成功-success",
        data: {
          item: [
            {
              school_id: 452,
              name: "南京航空航天大学",
              province_name: "江苏",
              city_name: "南京",
              level_name: "本科",
              type_name: "理工"
            }
          ],
          numFound: 1
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: "0000",
        message: "成功-success",
        data: {
          item: scoreItems(20, 0),
          numFound: 25
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: "0000",
        message: "成功-success",
        data: {
          item: scoreItems(5, 20),
          numFound: 25
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: "0000",
        message: "成功-success",
        data: {
          item: [],
          numFound: 0
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.sync({
      query: "南京航空航天大学",
      limit: 1,
      provinces: ["四川"],
      subjectTypes: ["理科"],
      scoreYears: [2025],
      includePlans: false,
      includeScores: true,
      includeSpecialScores: true
    });

    expect(result.errors).toEqual([]);
    expect(result.schoolScoreRows).toBe(25);
    expect(result.majorScoreRows).toBe(0);
    expect(result.sourceRows).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      database.db
        .prepare("SELECT COUNT(*) AS count FROM admission_sources WHERE source_kind IN ('score-school', 'score-major')")
        .get()
    ).toMatchObject({ count: 3 });
    database.close();
  });

  it("skips covered plan and score endpoints when skipExisting is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const [nuaa] = universities.listUniversities("南京航空航天大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: nuaa.id,
      sourceSchoolId: "452",
      sourceSchoolName: "南京航空航天大学",
      payloadJson: JSON.stringify({
        school_id: 452,
        name: "南京航空航天大学",
        province_name: "江苏",
        city_name: "南京",
        level_name: "本科",
        type_name: "理工"
      })
    });
    admissions.upsertPlan({
      universityId: nuaa.id,
      sourceSchoolId: "452",
      year: 2026,
      provinceName: "四川",
      subjectType: "物理类",
      planCount: 20,
      rawJson: "{}"
    });
    admissions.upsertPlan({
      universityId: nuaa.id,
      sourceSchoolId: "452",
      year: 2026,
      provinceName: "四川",
      subjectType: "物理类",
      majorName: "航空航天类",
      planCount: 8,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "school",
      universityId: nuaa.id,
      sourceSchoolId: "452",
      year: 2025,
      provinceName: "四川",
      subjectType: "物理类",
      minScore: 620,
      minRank: 15000,
      rawJson: "{}"
    });
    admissions.upsertScore({
      scoreType: "major",
      universityId: nuaa.id,
      sourceSchoolId: "452",
      year: 2025,
      provinceName: "四川",
      subjectType: "物理类",
      majorName: "航空航天类",
      minScore: 630,
      minRank: 12000,
      rawJson: "{}"
    });
    insertSuccessfulSource(admissions, "plan-school-summary", nuaa.id, "452", {
      uri: "apidata/api/gkv3/plan/schoollists",
      school_id: "452",
      local_province_id: "51",
      local_type_id: "2073",
      year: 2026,
      page: 1,
      size: 80
    }, [{ school_id: 452, name: "南京航空航天大学", year: 2026, sc_num: 20 }], 1);
    insertSuccessfulSource(admissions, "plan-major", nuaa.id, "452", {
      uri: "apidata/api/gkv3/plan/school",
      school_id: "452",
      local_province_id: "51",
      local_type_id: "2073",
      year: 2026,
      page: 1,
      size: 10
    }, [{ school_id: 452, name: "南京航空航天大学", year: 2026, spname: "航空航天类", num: 8 }], 1);
    insertSuccessfulSource(admissions, "score-school", nuaa.id, "452", {
      uri: "apidata/api/gk/score/province",
      school_id: "452",
      local_province_id: "51",
      local_type_id: "2073",
      year: 2025,
      zslx: 0,
      page: 1,
      size: 20
    }, [{ school_id: 452, name: "南京航空航天大学", year: 2025, min: 620, min_section: 15000 }], 1);
    insertSuccessfulSource(admissions, "score-major", nuaa.id, "452", {
      uri: "apidata/api/gk/score/special",
      school_id: "452",
      local_province_id: "51",
      local_type_id: "2073",
      year: 2025,
      zslx: 0,
      page: 1,
      size: 20
    }, [{ school_id: 452, name: "南京航空航天大学", year: 2025, spname: "航空航天类", min: 630, min_section: 12000 }], 1);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const result = await adapter.sync({
      query: "南京航空航天大学",
      limit: 1,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      scoreYears: [2025],
      includePlans: true,
      includeScores: true,
      includeSpecialScores: true,
      skipExisting: true
    });

    expect(result.errors).toEqual([]);
    expect(result.mapped).toBe(1);
    expect(result.planRows).toBe(0);
    expect(result.planSummaryRows).toBe(0);
    expect(result.majorPlanRows).toBe(0);
    expect(result.schoolScoreRows).toBe(0);
    expect(result.majorScoreRows).toBe(0);
    expect(result.skippedRequests).toBe(4);
    expect(fetchMock).not.toHaveBeenCalled();
    database.close();
  });

  it("can skip plan detail endpoints when only plan summaries are needed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const [nuaa] = universities.listUniversities("南京航空航天大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: nuaa.id,
      sourceSchoolId: "452",
      sourceSchoolName: "南京航空航天大学",
      payloadJson: JSON.stringify({
        school_id: 452,
        name: "南京航空航天大学",
        province_name: "江苏",
        city_name: "南京",
        level_name: "本科",
        type_name: "理工"
      })
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: "0000",
      message: "成功-success",
      data: {
        item: [{ school_id: 452, name: "南京航空航天大学", year: 2026, sc_num: 86, sc_special_num: 42 }],
        numFound: 1
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const result = await adapter.sync({
      universityId: nuaa.id,
      limit: 1,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false,
      includePlanDetails: false
    });

    const uris = fetchMock.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).searchParams.get("uri"));
    expect(result.errors).toEqual([]);
    expect(result.planRows).toBe(1);
    expect(result.planSummaryRows).toBe(1);
    expect(result.majorPlanRows).toBe(0);
    expect(result.sourceRows).toBe(1);
    expect(uris).toEqual(["apidata/api/gkv3/plan/schoollists"]);
    database.close();
  });

  it("uses Mnzy recommendMajorList for realtime major-group plan details when enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京大学", "nan-jing-da-xue")]);
    const [nanjing] = universities.listUniversities("南京大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: nanjing.id,
      sourceSchoolId: "111",
      sourceSchoolName: "南京大学",
      payloadJson: JSON.stringify({
        school_id: 111,
        name: "南京大学",
        province_name: "江苏",
        city_name: "南京",
        level_name: "本科",
        type_name: "综合"
      })
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url.includes("/v3/v1/query/recommendPage")) {
        expect(body).toMatchObject({
          province: "江苏",
          classify: "物理",
          batch: "本科批",
          type: null,
          universityName: "南京大学"
        });
        return jsonResponse({
          code: 200,
          msg: "OK",
          body: {
            total: 1,
            pageNum: 1,
            pageSize: 20,
            list: [
              {
                universityName: "南京大学",
                zsgkId: 111,
                recruitCode: "110108",
                universityMajorGroup: "08",
                year: 2026,
                planNum: 1,
                majorNum: 1,
                claim: "化",
                historyScore: "[{\"2025\":\"680,165,1\"}]"
              }
            ]
          }
        });
      }
      if (url.includes("/v4/v1/query/recommendMajorList")) {
        expect(body).toMatchObject({
          province: "江苏",
          classify: "物理",
          batch: "本科批",
          recruitCode: "110108",
          universityMajorGroup: "08"
        });
        return jsonResponse({
          code: 200,
          msg: "OK",
          body: {
            intentionList: [
              {
                universityName: "南京大学",
                recruitCode: "110108",
                universityMajorGroup: "08",
                majorName: "人工智能",
                majorRemarks: "（至诚班）",
                year: 2026,
                planNum: 1,
                claim: "化",
                studyCost: "6380",
                studyYear: "四年"
              }
            ],
            notIntentionList: []
          }
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const result = await adapter.sync({
      universityId: nanjing.id,
      limit: 1,
      provinces: ["江苏"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false,
      includePlanDetails: true,
      useMnzyPlanDetails: true,
      maxSourceRequests: 4
    });

    const urls = fetchMock.mock.calls.map(([input]) => input instanceof Request ? input.url : String(input));
    expect(result.errors).toEqual([]);
    expect(result.planSummaryRows).toBe(1);
    expect(result.majorPlanRows).toBe(1);
    expect(result.sourceRequests).toBe(2);
    expect(urls).toEqual([
      "https://mnzy.gaokao.cn/api/v3/v1/query/recommendPage",
      "https://mnzy.gaokao.cn/api/v4/v1/query/recommendMajorList"
    ]);
    expect(admissions.queryPlans({
      universityId: nanjing.id,
      provinceName: "江苏",
      subjectType: "物理类",
      years: [2026],
      planGroup: "08"
    }).map((row) => ({
      majorName: row.majorName,
      planCount: row.planCount,
      tuition: row.tuition,
      duration: row.duration,
      selectionRequirements: row.selectionRequirements
    }))).toEqual([
      {
        majorName: null,
        planCount: 1,
        tuition: null,
        duration: null,
        selectionRequirements: "化"
      },
      {
        majorName: "人工智能（至诚班）",
        planCount: 1,
        tuition: "6380",
        duration: "四年",
        selectionRequirements: "化"
      }
    ]);
    database.close();
  });

  it("pauses a batch before starting another endpoint when source request budget is exhausted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const [nuaa] = universities.listUniversities("南京航空航天大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: nuaa.id,
      sourceSchoolId: "452",
      sourceSchoolName: "南京航空航天大学",
      payloadJson: JSON.stringify({
        school_id: 452,
        name: "南京航空航天大学",
        province_name: "江苏",
        city_name: "南京",
        level_name: "本科",
        type_name: "理工"
      })
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: "0000",
      message: "成功-success",
      data: {
        item: [{ school_id: 452, name: "南京航空航天大学", year: 2026, sc_num: 86, sc_special_num: 42 }],
        numFound: 1
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const result = await adapter.sync({
      universityId: nuaa.id,
      limit: 1,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      scoreYears: [2025],
      includePlans: true,
      includeScores: true,
      includeSpecialScores: true,
      maxSourceRequests: 1
    });

    const uris = fetchMock.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).searchParams.get("uri"));
    expect(result.errors).toEqual([]);
    expect(result.requestBudgetExhausted).toBe(true);
    expect(result.nextOffset).toBe(result.offset);
    expect(result.sourceRequests).toBe(1);
    expect(result.sourceRequestBudget).toBe(1);
    expect(result.planRows).toBe(1);
    expect(result.planSummaryRows).toBe(1);
    expect(result.majorPlanRows).toBe(0);
    expect(result.sourceRows).toBe(1);
    expect(uris).toEqual(["apidata/api/gkv3/plan/schoollists"]);
    database.close();
  });

  it("pauses paged endpoints before requesting another page when source request budget is exhausted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const [nuaa] = universities.listUniversities("南京航空航天大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: nuaa.id,
      sourceSchoolId: "452",
      sourceSchoolName: "南京航空航天大学",
      payloadJson: JSON.stringify({
        school_id: 452,
        name: "南京航空航天大学",
        province_name: "江苏",
        city_name: "南京",
        level_name: "本科",
        type_name: "理工"
      })
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const params = new URL(url).searchParams;
      return jsonResponse({
        code: "0000",
        message: "成功-success",
        data: {
          item: [
            {
              year: 2025,
              local_province_name: "四川",
              local_type_name: "物理类",
              local_batch_name: "本科批",
              min: "620",
              min_section: "13000"
            }
          ],
          numFound: params.get("page") === "1" ? 30 : 0
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const result = await adapter.sync({
      universityId: nuaa.id,
      limit: 1,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      scoreYears: [2025],
      includePlans: false,
      includeScores: true,
      includeSpecialScores: false,
      maxSourceRequests: 1
    });

    const pages = fetchMock.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).searchParams.get("page"));
    expect(result.errors).toEqual([]);
    expect(result.requestBudgetExhausted).toBe(true);
    expect(result.nextOffset).toBe(result.offset);
    expect(result.sourceRequests).toBe(1);
    expect(result.sourceRequestBudget).toBe(1);
    expect(result.schoolScoreRows).toBe(1);
    expect(result.sourceRows).toBe(1);
    expect(pages).toEqual(["1"]);
    database.close();
  });

  it("does not treat partial paged source snapshots as covered when skipExisting is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const [nuaa] = universities.listUniversities("南京航空航天大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: nuaa.id,
      sourceSchoolId: "452",
      sourceSchoolName: "南京航空航天大学",
      payloadJson: JSON.stringify({
        school_id: 452,
        name: "南京航空航天大学",
        province_name: "江苏",
        city_name: "南京",
        level_name: "本科",
        type_name: "理工"
      })
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const params = new URL(url).searchParams;
      const page = params.get("page");
      return jsonResponse({
        code: "0000",
        message: "成功-success",
        data: {
          item: [
            {
              year: 2025,
              local_province_name: "四川",
              local_type_name: "物理类",
              local_batch_name: "本科批",
              min: page === "1" ? "620" : "621",
              min_section: page === "1" ? "13000" : "12900"
            }
          ],
          numFound: 30
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GaokaoCnAdapter(universities, admissions);
    const options = {
      universityId: nuaa.id,
      limit: 1,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      scoreYears: [2025],
      includePlans: false,
      includeScores: true,
      includeSpecialScores: false,
      skipExisting: true
    };

    const first = await adapter.sync({ ...options, maxSourceRequests: 1 });
    const firstPages = fetchMock.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).searchParams.get("page"));
    expect(first.requestBudgetExhausted).toBe(true);
    expect(firstPages).toEqual(["1"]);

    fetchMock.mockClear();
    const second = await adapter.sync({ ...options, maxSourceRequests: 3 });
    const secondPages = fetchMock.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).searchParams.get("page"));
    expect(second.requestBudgetExhausted).toBe(false);
    expect(second.schoolScoreRows).toBe(2);
    expect(secondPages).toEqual(["1", "2"]);
    database.close();
  });

  it("uses province-aware default subject types when no subject filter is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const admissions = new AdmissionRepository(database);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("school/lists")) {
        return jsonResponse({
          code: "0000",
          message: "成功-success",
          data: {
            item: [
              {
                school_id: 452,
                name: "南京航空航天大学",
                province_name: "江苏",
                city_name: "南京",
                level_name: "本科",
                type_name: "理工"
              }
            ],
            numFound: 1
          }
        });
      }
      return jsonResponse({
        code: "0000",
        message: "成功-success",
        data: { item: [], numFound: 0 }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.sync({
      query: "南京航空航天大学",
      limit: 1,
      provinces: ["北京", "江苏", "四川", "新疆"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false
    });

    const subjectIdsByProvince = new Map<string, Set<string>>();
    for (const [input] of fetchMock.mock.calls.slice(1)) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const provinceId = url.searchParams.get("local_province_id");
      const subjectId = url.searchParams.get("local_type_id");
      if (!provinceId || !subjectId) continue;
      const subjectIds = subjectIdsByProvince.get(provinceId) ?? new Set<string>();
      subjectIds.add(subjectId);
      subjectIdsByProvince.set(provinceId, subjectIds);
    }

    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect([...subjectIdsByProvince.get("11")!]).toEqual(["3"]);
    expect([...subjectIdsByProvince.get("32")!].sort()).toEqual(["2073", "2074"]);
    expect([...subjectIdsByProvince.get("51")!].sort()).toEqual(["2073", "2074"]);
    expect([...subjectIdsByProvince.get("65")!].sort()).toEqual(["1", "2"]);
    database.close();
  });

  it("skips obvious non-gaokao joke schools during eligible syncs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      fixtureUniversity("三亚皇家帝国学院", "san-ya-huang-jia-di-guo-xue-yuan"),
      fixtureUniversity("三亚学院", "san-ya-xue-yuan")
    ]);
    const admissions = new AdmissionRepository(database);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("school/lists")) {
        expect(decodeURIComponent(url)).toContain("三亚学院");
        return jsonResponse({
          code: "0000",
          message: "成功-success",
          data: {
            item: [
              {
                school_id: 1329,
                name: "三亚学院",
                province_name: "海南",
                city_name: "三亚",
                level_name: "本科",
                type_name: "综合"
              }
            ],
            numFound: 1
          }
        });
      }
      return jsonResponse({
        code: "0000",
        message: "成功-success",
        data: { item: [], numFound: 0 }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.sync({
      query: "三亚",
      limit: 10,
      provinces: ["江苏"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includeSpecialScores: false
    });

    expect(result.total).toBe(1);
    expect(result.mapped).toBe(1);
    expect(fetchMock.mock.calls.some(([input]) => decodeURIComponent(input instanceof Request ? input.url : String(input)).includes("皇家帝国"))).toBe(false);
    database.close();
  });

  it("uses year-aware subject types for provinces that changed to 3+1+2 recently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const admissions = new AdmissionRepository(database);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("school/lists")) {
        return jsonResponse({
          code: "0000",
          message: "成功-success",
          data: {
            item: [
              {
                school_id: 452,
                name: "南京航空航天大学",
                province_name: "江苏",
                city_name: "南京",
                level_name: "本科",
                type_name: "理工"
              }
            ],
            numFound: 1
          }
        });
      }
      return jsonResponse({
        code: "0000",
        message: "成功-success",
        data: { item: [], numFound: 0 }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.sync({
      query: "南京航空航天大学",
      limit: 1,
      provinces: ["四川"],
      scoreYears: [2025, 2024],
      includePlans: false,
      includeScores: true,
      includeSpecialScores: false
    });

    const subjectIdsByYear = new Map<string, Set<string>>();
    for (const [input] of fetchMock.mock.calls.slice(1)) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const year = url.searchParams.get("year");
      const subjectId = url.searchParams.get("local_type_id");
      if (!year || !subjectId) continue;
      const subjectIds = subjectIdsByYear.get(year) ?? new Set<string>();
      subjectIds.add(subjectId);
      subjectIdsByYear.set(year, subjectIds);
    }

    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect([...subjectIdsByYear.get("2025")!].sort()).toEqual(["2073", "2074"]);
    expect([...subjectIdsByYear.get("2024")!].sort()).toEqual(["1", "2"]);
    database.close();
  });

  it("skips obvious non-Gaokao school names in batch sync by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      fixtureUniversity("Asia Pacific University of Technology & Innovation APU", "apu"),
      fixtureUniversity("三峡大学", "san-xia-da-xue")
    ]);
    const admissions = new AdmissionRepository(database);
    const adapter = new GaokaoCnAdapter(universities, admissions);

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: "0000",
      message: "成功-success",
      data: {
        item: [{
          school_id: 459,
          name: "三峡大学",
          province_name: "湖北",
          city_name: "宜昌",
          level_name: "本科",
          type_name: "综合",
          nature_name: "公办",
          f211: 0,
          f985: 0,
          dual_class_name: "省属重点"
        }],
        numFound: 1
      }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.sync({
      limit: 10,
      includePlans: false,
      includeScores: false,
      includeSpecialScores: false
    });

    expect(result.candidateTotal).toBe(1);
    expect(result.total).toBe(1);
    expect(result.mapped).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admissions.listMappings().map((row) => row.universityName)).toEqual(["三峡大学"]);
    const [university] = universities.listUniversities("三峡大学", 1);
    const profile = universities.getSchoolProfile(university.id, "gaokao_cn");
    expect(profile).toMatchObject({
      source: "gaokao_cn",
      sourceSchoolId: "459",
      sourceUrl: "https://www.gaokao.cn/school/459"
    });
    expect(profile?.profileText).toContain("来源：掌上高考");
    expect(profile?.profileText).toContain("地区：湖北 宜昌");
    expect(profile?.profileText).toContain("层次/类型：本科 / 综合 / 公办");
    expect(profile?.profileText).toContain("标签：省属重点");
    database.close();
  });

  it("serializes concurrent sync requests to avoid hammering Gaokao.cn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-gaokao-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const admissions = new AdmissionRepository(database);
    const adapter = new GaokaoCnAdapter(universities, admissions);
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight -= 1;
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("school/lists")) {
        return jsonResponse({
          code: "0000",
          message: "成功-success",
          data: {
            item: [
              {
                school_id: 452,
                name: "南京航空航天大学",
                province_name: "江苏",
                city_name: "南京",
                level_name: "本科",
                type_name: "理工"
              }
            ],
            numFound: 1
          }
        });
      }
      return jsonResponse({
        code: "0000",
        message: "成功-success",
        data: { item: [], numFound: 0 }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      adapter.sync({
        query: "南京航空航天大学",
        limit: 1,
        provinces: ["四川"],
        subjectTypes: ["理科"],
        planYears: [2026],
        includePlans: true,
        includeScores: false,
        includeSpecialScores: false
      }),
      adapter.sync({
        query: "南京航空航天大学",
        limit: 1,
        provinces: ["四川"],
        subjectTypes: ["理科"],
        planYears: [2026],
        includePlans: true,
        includeScores: false,
        includeSpecialScores: false
      })
    ]);

    expect(maxInFlight).toBe(1);
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

function scoreItems(count: number, offset: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `score-${offset + index}`,
    school_id: 452,
    name: "南京航空航天大学",
    year: 2025,
    local_province_name: "四川",
    local_type_name: "理科",
    local_batch_name: "本科一批",
    min: 620 - index,
    min_section: 14000 + offset + index,
    num: 120
  }));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function insertSuccessfulSource(
  admissions: AdmissionRepository,
  sourceKind: string,
  universityId: number,
  sourceSchoolId: string,
  request: Record<string, unknown>,
  items: unknown[],
  numFound: number
): void {
  admissions.insertSource({
    sourceKind,
    universityId,
    sourceSchoolId,
    sourceUrl: "https://api.zjzw.cn/web/api/",
    requestJson: JSON.stringify(request),
    responseJson: JSON.stringify({
      code: "0000",
      message: "成功-success",
      data: { item: items, numFound }
    }),
    status: "success"
  });
}

function memoryCooldownStore() {
  const values = new Map<string, string>();
  return {
    getString: (key: string, fallback: string) => values.get(key) ?? fallback,
    setInternal: (key: string, value: string) => {
      values.set(key, value);
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
