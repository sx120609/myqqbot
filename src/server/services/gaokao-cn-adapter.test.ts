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
