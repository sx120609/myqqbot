import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerApi, renderAnswerSourcePage } from "./api.js";
import { AppDatabase } from "./db.js";
import type { ParsedUniversity } from "./domain/parser.js";
import { ADMISSION_SOURCE, AdmissionRepository } from "./services/admission-repository.js";
import type { AnswerSourceRecord } from "./services/answer-source-store.js";
import { UniversityRepository } from "./services/university-repository.js";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("renderAnswerSourcePage", () => {
  it("renders admission source pages as traceable sections", () => {
    const html = renderAnswerSourcePage(
      sourceRecord({
        topic: "招生数据",
        contextText: [
          "查询条件：中国药科大学；省份：河南；科类：理科；专业：未指定",
          "当前日期：2026-06-25。历史分数默认使用 2023-2025。",
          "实时同步节流：本批已用 12/12 次源站请求预算，已主动暂停继续补数；后续定时同步会从当前 offset 继续。",
          "掌上高考院校基础信息：",
          "来源：掌上高考（https://www.gaokao.cn/school/114）",
          "学校：中国药科大学",
          "掌上高考 school_id：114",
          "地区：江苏 南京",
          "层次/类型：本科 / 医药类 / 公办",
          "标签：211；双一流",
          "",
          "报考参考表：",
          "年份 | 数据类型 | 科类 | 批次/专业组 | 专业/口径 | 最低分 | 最低位次 | 平均分 | 平均位次 | 最高分 | 省控线 | 线差 | 计划数",
          "2025 | 院校线 | 理科 | 本科一批 | 院校线 | 610 | 12000 | 620 | 10000 | 640 | 509 | 101 | 20",
          "",
          "招生计划：",
          "年份 | 科类 | 批次/专业组 | 专业 | 计划数",
          "2026 | 理科 | 本科一批 | 药学类 | 20",
          "",
          "分数趋势摘要：",
          "最低位次区间：12000-16000",
          "",
          "录取分数/位次：",
          "年份 | 类型 | 科类 | 批次/专业组 | 专业 | 最低分 | 最低位次 | 平均分 | 平均位次 | 最高分 | 省控线 | 线差",
          "2025 | 院校线 | 理科 | 本科一批 | - | 610 | 12000 | 620 | 10000 | 640 | 509 | 101",
          "",
          "资料页追溯：",
          "使用的数据表：admission_plans、admission_scores、admission_sources。",
          "掌上高考来源记录：101、102",
          "掌上高考来源快照：",
          "#101；score-school；success；抓取=2026/6/25 10:00:00；URL=https://api.zjzw.cn/web/api/?uri=apidata/api/gk/score/province；请求=uri=apidata/api/gk/score/province, school_id=114, local_province_id=41, local_type_id=1, year=2025；响应=code=0000, message=成功-success, item_count=1",
          "原始数据行摘要：year=2025, min=610, min_section=12000",
          "",
          "来源：掌上高考公开聚合数据；最终请以省考试院和学校招生网为准。"
        ].join("\n")
      }),
      "ICP备案号"
    );

    expect(html).toContain("<h2>查询条件与同步状态</h2>");
    expect(html).toContain("实时同步节流");
    expect(html).toContain("<h2>掌上高考院校基础信息</h2>");
    expect(html).toContain("掌上高考 school_id：114");
    expect(html).toContain("地区：江苏 南京");
    expect(html).toContain("<h2>报考参考表</h2>");
    expect(html).toContain("<h2>招生计划</h2>");
    expect(html).toContain("<h2>分数趋势摘要</h2>");
    expect(html).toContain("<h2>录取分数与最低位次</h2>");
    expect(html).toContain("<h2>资料页追溯</h2>");
    expect(html).toContain("<h2>来源提醒</h2>");
    expect(html).toContain("source-table");
    expect(html).toContain("<th>年份</th>");
    expect(html).toContain("<th>平均分</th>");
    expect(html).toContain("<th>省控线</th>");
    expect(html).toContain("<td>101</td>");
    expect(html).toContain("source-card");
    expect(html).toContain("#101");
    expect(html).toContain("score-school");
    expect(html).toContain("item_count=1");
    expect(html).toContain("admission_plans、admission_scores、admission_sources");
    expect(html).toContain("year=2025, min=610, min_section=12000");
    expect(html).toContain("ICP备案号");
    const profileIndex = html.indexOf("<h2>掌上高考院校基础信息</h2>");
    const profileSourceIndex = html.indexOf("来源：掌上高考（https://www.gaokao.cn/school/114）");
    const referenceIndex = html.indexOf("<h2>报考参考表</h2>");
    expect(profileIndex).toBeGreaterThan(-1);
    expect(profileSourceIndex).toBeGreaterThan(profileIndex);
    expect(profileSourceIndex).toBeLessThan(referenceIndex);
  });

  it("keeps multi-school admission source sections separated by school", () => {
    const html = renderAnswerSourcePage(
      sourceRecord({
        topic: "招生数据",
        universityName: "北京邮电大学 / 西安电子科技大学",
        sourceUrl: null,
        contextText: [
          "多校招生对比查询：北京邮电大学 / 西安电子科技大学",
          "用户问题：北邮和西电计算机山东多少位次，怎么选",
          "省份：山东；科类：综合改革；专业组：未指定；专业：计算机",
          "使用的数据表：admission_plans、admission_scores、admission_sources。",
          "",
          "===== 北京邮电大学 =====",
          "查询条件：北京邮电大学；省份：山东；科类：综合改革；专业组：未指定；专业：计算机",
          "掌上高考院校基础信息：",
          "掌上高考 school_id：42",
          "地区：北京",
          "报考参考表：",
          "年份 | 数据类型 | 科类 | 专业/口径 | 最低分 | 最低位次 | 计划数",
          "2025 | 专业线 | 综合改革 | 计算机类 | 650 | 4200 | 18",
          "资料页追溯：",
          "掌上高考来源记录：201",
          "",
          "来源：掌上高考公开聚合数据；最终请以省考试院和学校招生网为准。",
          "",
          "===== 西安电子科技大学 =====",
          "查询条件：西安电子科技大学；省份：山东；科类：综合改革；专业组：未指定；专业：计算机",
          "掌上高考院校基础信息：",
          "掌上高考 school_id：37",
          "地区：陕西 西安",
          "报考参考表：",
          "年份 | 数据类型 | 科类 | 专业/口径 | 最低分 | 最低位次 | 计划数",
          "2025 | 专业线 | 综合改革 | 计算机类 | 638 | 6800 | 28",
          "资料页追溯：",
          "掌上高考来源记录：301",
          "",
          "来源：掌上高考公开聚合数据；最终请以省考试院和学校招生网为准。",
          "",
          "多校对比说明：以上每所学校均单独同步、查询和保留来源快照；掌上高考为第三方聚合数据，最终请以省考试院和学校招生网为准。"
        ].join("\n")
      }),
      ""
    );

    expect(html).toContain("<h2>学校：北京邮电大学</h2>");
    expect(html).toContain("<h2>北京邮电大学 - 掌上高考院校基础信息</h2>");
    expect(html).toContain("<h2>北京邮电大学 - 来源提醒</h2>");
    expect(html).toContain("<h2>学校：西安电子科技大学</h2>");
    expect(html).toContain("<h2>西安电子科技大学 - 掌上高考院校基础信息</h2>");
    expect(html).toContain("<h2>西安电子科技大学 - 来源提醒</h2>");
    const firstSourceIndex = html.indexOf("<h2>北京邮电大学 - 来源提醒</h2>");
    const secondSchoolIndex = html.indexOf("<h2>学校：西安电子科技大学</h2>");
    const secondProfileIndex = html.indexOf("<h2>西安电子科技大学 - 掌上高考院校基础信息</h2>");
    expect(firstSourceIndex).toBeGreaterThan(-1);
    expect(secondSchoolIndex).toBeGreaterThan(firstSourceIndex);
    expect(secondProfileIndex).toBeGreaterThan(secondSchoolIndex);
  });
});

describe("OneBot operation API", () => {
  it("rejects NapCat restart when neither launcher key nor restart command is configured", async () => {
    const app = Fastify();
    try {
      await registerApi(app, {
        config: { server: { publicBaseUrl: "http://localhost:8787" } },
        database: {},
        settings: {
          runtime: () => ({
            onebot: {
              napcatRestartCommand: "",
              napcatWebUrl: "http://127.0.0.1:6099",
              napcatWebKey: ""
            }
          })
        },
        universities: {},
        admissions: {},
        sync: {},
        answerSources: {},
        srgaoxiaoSync: {},
        gaokaoCn: {},
        autoSync: {},
        llm: {},
        logs: {},
        processor: {},
        onebot: {
          status: () => ({ connected: false })
        }
      } as never);

      const response = await app.inject({
        method: "POST",
        url: "/api/onebot/napcat/restart",
        payload: {}
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        ok: false,
        message: "请先填写 NapCat 启动器地址和 WebUI Key；如果不用启动器，再填写 NapCat 重启命令。"
      });
    } finally {
      await app.close();
    }
  });

  it("restarts NapCat through the launcher WebUI API when a key is configured", async () => {
    const app = Fastify();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/auth/login")) {
        expect(JSON.parse(String(init?.body))).toHaveProperty("hash");
        return jsonResponse({ code: 0, data: { Credential: "credential" }, message: "success" });
      }
      if (url.endsWith("/api/QQLogin/RestartNapCat")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer credential" });
        return jsonResponse({ code: 0, data: { message: "Restart initiated" }, message: "success" });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await registerApi(app, {
        config: { server: { publicBaseUrl: "http://localhost:8787" } },
        database: {},
        settings: {
          runtime: () => ({
            onebot: {
              napcatRestartCommand: "",
              napcatWebUrl: "http://127.0.0.1:6099",
              napcatWebKey: "secret"
            }
          })
        },
        universities: {},
        admissions: {},
        sync: {},
        answerSources: {},
        srgaoxiaoSync: {},
        gaokaoCn: {},
        autoSync: {},
        llm: {},
        logs: {},
        processor: {},
        onebot: {
          status: () => ({ connected: false })
        }
      } as never);

      const response = await app.inject({
        method: "POST",
        url: "/api/onebot/napcat/restart",
        payload: {}
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        mode: "launcher",
        message: "Restart initiated"
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });

  it("renders NapCat login QR code through the MyQQBot backend", async () => {
    const app = Fastify();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/auth/login")) {
        expect(JSON.parse(String(init?.body))).toHaveProperty("hash");
        return jsonResponse({ code: 0, data: { Credential: "credential" }, message: "success" });
      }
      if (url.endsWith("/api/QQLogin/CheckLoginStatus")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer credential" });
        return jsonResponse({
          code: 0,
          data: { isLogin: false, isOffline: false, qrcodeurl: "https://example.com/qq-login-token" },
          message: "success"
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await registerApi(app, {
        config: { server: { publicBaseUrl: "http://localhost:8787" } },
        database: {},
        settings: {
          runtime: () => ({
            onebot: {
              napcatRestartCommand: "",
              napcatWebUrl: "http://127.0.0.1:6099",
              napcatWebKey: "secret"
            }
          })
        },
        universities: {},
        admissions: {},
        sync: {},
        answerSources: {},
        srgaoxiaoSync: {},
        gaokaoCn: {},
        autoSync: {},
        llm: {},
        logs: {},
        processor: {},
        onebot: {
          status: () => ({ connected: false })
        }
      } as never);

      const response = await app.inject({
        method: "GET",
        url: "/api/onebot/napcat/qrcode.png"
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^image\/png/u);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });
});

describe("admission API", () => {
  it("uses configured Gaokao.cn plan detail setting for manual sync by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-api-admission-test-"));
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    const admissions = new AdmissionRepository(database);
    const app = Fastify();
    const sync = vi.fn().mockResolvedValue({
      source: "gaokao_cn",
      total: 0,
      candidateTotal: 0,
      offset: 0,
      nextOffset: 0,
      mapped: 0,
      planRows: 0,
      planSummaryRows: 0,
      majorPlanRows: 0,
      schoolScoreRows: 0,
      majorScoreRows: 0,
      sourceRows: 0,
      sourceRequests: 0,
      sourceRequestBudget: 1,
      requestBudgetExhausted: false,
      skippedRequests: 0,
      skipped: 0,
      errors: []
    });
    try {
      await registerApi(app, {
        config: { server: { publicBaseUrl: "http://localhost:8787" } },
        database,
        settings: {
          runtime: () => ({
            sync: {
              gaokaoCnRateLimitCooldownMinutes: 1440,
              gaokaoCnMaxRequestsPerRun: 1,
              gaokaoCnIncludePlanDetails: false
            }
          })
        },
        universities,
        admissions,
        sync: {},
        answerSources: {},
        srgaoxiaoSync: {},
        gaokaoCn: {
          rateLimitStatus: () => ({ active: false, until: null }),
          sync
        },
        autoSync: {},
        llm: {},
        logs: {},
        processor: {},
        onebot: {}
      } as never);

      const first = await app.inject({
        method: "POST",
        url: "/api/data/sync-gaokao-cn",
        payload: { includePlans: true, limit: 1 }
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/data/sync-gaokao-cn",
        payload: { includePlans: true, includePlanDetails: true, limit: 1 }
      });

      expect(first.statusCode).toBe(410);
      expect(second.statusCode).toBe(410);
      expect(first.json()).toMatchObject({ ok: false, code: "GAOKAO_CN_SYNC_REMOVED" });
      expect(sync).not.toHaveBeenCalled();
    } finally {
      await app.close();
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips manual Gaokao.cn sync while the source cooldown is active", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-api-admission-test-"));
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    const admissions = new AdmissionRepository(database);
    const app = Fastify();
    const sync = vi.fn();
    const cooldownUntil = "2026-06-26T12:00:00.000Z";
    try {
      await registerApi(app, {
        config: { server: { publicBaseUrl: "http://localhost:8787" } },
        database,
        settings: {
          runtime: () => ({
            sync: {
              gaokaoCnRateLimitCooldownMinutes: 1440,
              gaokaoCnMaxRequestsPerRun: 1,
              gaokaoCnIncludePlanDetails: false
            }
          })
        },
        universities,
        admissions,
        sync: {},
        answerSources: {},
        srgaoxiaoSync: {},
        gaokaoCn: {
          rateLimitStatus: () => ({ active: true, until: cooldownUntil }),
          sync
        },
        autoSync: {},
        llm: {},
        logs: {},
        processor: {},
        onebot: {}
      } as never);

      const response = await app.inject({
        method: "POST",
        url: "/api/data/sync-gaokao-cn",
        payload: { limit: 1 }
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        ok: false,
        code: "GAOKAO_CN_SYNC_REMOVED"
      });
      expect(sync).not.toHaveBeenCalled();
    } finally {
      await app.close();
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queries admission plans and scores with normalized filters and complete score fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-api-admission-test-"));
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("北京邮电大学", "bei-jing-you-dian-da-xue")]);
    const [university] = universities.listUniversities("北京邮电大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertPlan({
      universityId: university.id,
      sourceSchoolId: "30",
      year: 2026,
      provinceName: "山东",
      subjectType: "综合改革",
      batch: "普通类一段",
      planGroup: "01组",
      majorName: "通信工程",
      planCount: 18,
      tuition: "5500",
      duration: "四年",
      selectionRequirements: "物理,化学",
      sourceRecordId: "501",
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
      planGroup: "01",
      majorName: "电子信息类",
      minScore: 651,
      minRank: 1000,
      avgScore: 660,
      avgRank: 780,
      maxScore: 671,
      planCount: 20,
      controlScore: 444,
      diffScore: 207,
      selectionRequirements: "物理,化学",
      sourceRecordId: "502",
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
    const matchingSourceId = admissions.insertSource({
      sourceKind: "plan-school-summary",
      universityId: university.id,
      sourceSchoolId: "30",
      sourceUrl: "https://api.zjzw.cn/web/api/",
      requestJson: JSON.stringify({
        uri: "apidata/api/gkv3/plan/schoollists",
        school_id: "30",
        local_province_id: "37",
        local_type_id: "3",
        year: 2026,
        page: 1,
        size: 80
      }),
      responseJson: JSON.stringify({ code: "0000", data: { item: [] } }),
      status: "success"
    });
    admissions.insertSource({
      sourceKind: "score-school",
      universityId: university.id,
      sourceSchoolId: "30",
      sourceUrl: "https://api.zjzw.cn/web/api/",
      requestJson: JSON.stringify({
        uri: "apidata/api/gk/score/province",
        school_id: "30",
        local_province_id: "51",
        local_type_id: "1",
        year: 2025,
        page: 1,
        size: 20
      }),
      responseJson: JSON.stringify({ code: "0000", data: { item: [] } }),
      status: "success"
    });

    const app = Fastify();
    try {
      await registerApi(app, {
        config: { server: { publicBaseUrl: "http://localhost:8787" } },
        database,
        settings: {},
        universities,
        admissions,
        sync: {},
        answerSources: {},
        srgaoxiaoSync: {},
        gaokaoCn: {},
        autoSync: {},
        llm: {},
        logs: {},
        processor: {},
        onebot: {}
      } as never);

      const response = await app.inject({
        method: "GET",
        url: `/api/admissions/query?universityId=${university.id}&province=山东&subject=综合改革&years=2026,2025&planGroup=第1专业组&scoreType=major&major=电信`
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { plans: Array<Record<string, unknown>>; scores: Array<Record<string, unknown>> };
      expect(payload.plans).toEqual([
        expect.objectContaining({
          universityName: "北京邮电大学",
          year: 2026,
          provinceName: "山东",
          subjectType: "综合改革",
          planGroup: "01",
          majorName: "通信工程",
          planCount: 18,
          tuition: "5500",
          duration: "四年",
          selectionRequirements: "物理,化学",
          sourceRecordId: "501"
        })
      ]);
      expect(payload.scores).toEqual([
        expect.objectContaining({
          universityName: "北京邮电大学",
          scoreType: "major",
          year: 2025,
          provinceName: "山东",
          subjectType: "综合改革",
          planGroup: "01",
          majorName: "电子信息类",
          minScore: 651,
          minRank: 1000,
          avgScore: 660,
          avgRank: 780,
          maxScore: 671,
          planCount: 20,
          controlScore: 444,
          diffScore: 207,
          selectionRequirements: "物理,化学",
          sourceRecordId: "502"
        })
      ]);

      const nameQueryResponse = await app.inject({
        method: "GET",
        url: "/api/admissions/query?university=北京邮电&province=山东&subject=综合改革&years=2026,2025&major=通信"
      });
      expect(nameQueryResponse.statusCode).toBe(200);
      const nameQueryPayload = nameQueryResponse.json() as { plans: Array<Record<string, unknown>>; scores: Array<Record<string, unknown>> };
      expect(nameQueryPayload.plans).toEqual([
        expect.objectContaining({
          universityName: "北京邮电大学",
          majorName: "通信工程",
          planCount: 18
        })
      ]);
      expect(nameQueryPayload.scores).toEqual([
        expect.objectContaining({
          universityName: "北京邮电大学",
          majorName: "电子信息类",
          minRank: 1000
        })
      ]);

      const unmatchedResponse = await app.inject({
        method: "GET",
        url: "/api/admissions/query?university=不存在大学&province=山东&years=2026,2025"
      });
      expect(unmatchedResponse.statusCode).toBe(200);
      expect(unmatchedResponse.json()).toEqual({ plans: [], scores: [] });

      const sourceResponse = await app.inject({
        method: "GET",
        url: `/api/admissions/sources?universityId=${university.id}&year=2026&province=山东&subject=综合改革`
      });
      expect(sourceResponse.statusCode).toBe(200);
      const sourcePayload = sourceResponse.json() as Array<Record<string, unknown>>;
      expect(sourcePayload).toEqual([
        expect.objectContaining({
          id: matchingSourceId,
          sourceKind: "plan-school-summary",
          universityName: "北京邮电大学",
          status: "success"
        })
      ]);
    } finally {
      await app.close();
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves Gaokao.cn school profile data when saving a manual admission mapping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-api-admission-test-"));
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([fixtureUniversity("南京航空航天大学", "nan-jing-hang-kong-hang-tian-da-xue")]);
    const [university] = universities.listUniversities("南京航空航天大学", 1);
    const admissions = new AdmissionRepository(database);
    const app = Fastify();
    try {
      await registerApi(app, {
        config: { server: { publicBaseUrl: "http://localhost:8787" } },
        database,
        settings: {},
        universities,
        admissions,
        sync: {},
        answerSources: {},
        srgaoxiaoSync: {},
        gaokaoCn: {},
        autoSync: {},
        llm: {},
        logs: {},
        processor: {},
        onebot: {}
      } as never);

      const response = await app.inject({
        method: "PUT",
        url: `/api/admissions/mappings/${university.id}`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          sourceSchoolId: "452",
          sourceSchoolName: "南京航空航天大学",
          sourceSchool: {
            school_id: 452,
            name: "南京航空航天大学",
            province_name: "江苏",
            city_name: "南京",
            level_name: "本科",
            type_name: "理工类",
            nature_name: "公办",
            f211: 1,
            f985: 0,
            dual_class_name: "双一流"
          }
        })
      });

      expect(response.statusCode).toBe(200);
      expect(admissions.getMapping(university.id)).toMatchObject({
        sourceSchoolId: "452",
        sourceSchoolName: "南京航空航天大学",
        matchStatus: "manual"
      });
      expect(admissions.getMapping(university.id)?.payloadJson).toContain("\"province_name\":\"江苏\"");
      const profile = universities.getSchoolProfile(university.id, ADMISSION_SOURCE);
      expect(profile?.profileText).toContain("地区：江苏 南京");
      expect(profile?.profileText).toContain("标签：211；双一流");
      const [source] = admissions.listSources({ universityId: university.id, sourceKind: "school-profile" });
      expect(source).toMatchObject({
        sourceKind: "school-profile",
        sourceSchoolId: "452",
        status: "success"
      });
      expect(source.responseJson).toContain("\"school_id\":\"452\"");
    } finally {
      await app.close();
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists missing universities for a selected admission coverage gap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-api-admission-test-"));
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
      planCount: 100,
      rawJson: "{}"
    });

    const app = Fastify();
    try {
      await registerApi(app, {
        config: { server: { publicBaseUrl: "http://localhost:8787" } },
        database,
        settings: {},
        universities,
        admissions,
        sync: {},
        answerSources: {},
        srgaoxiaoSync: {},
        gaokaoCn: {},
        autoSync: {},
        llm: {},
        logs: {},
        processor: {},
        onebot: {}
      } as never);

      const response = await app.inject({
        method: "GET",
        url: "/api/admissions/coverage-gaps/missing?kind=plan&year=2026&province=安徽"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({
          universityId: hfut.id,
          universityName: "合肥工业大学",
          sourceSchoolId: "72",
          sourceSchoolName: "合肥工业大学"
        })
      ]);
    } finally {
      await app.close();
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function sourceRecord(overrides: Partial<AnswerSourceRecord>): AnswerSourceRecord {
  return {
    token: "source-token",
    question: "中国药科大学河南近三年分数线",
    universityId: 1,
    universityName: "中国药科大学",
    topic: "招生数据",
    sourceUrl: "https://www.gaokao.cn/school/114",
    contextText: "",
    schoolProfileText: null,
    srgaoxiaoReviewsText: null,
    answerText: "可以参考近三年位次。",
    createdAt: "2026-06-25T00:00:00.000Z",
    ...overrides
  };
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
