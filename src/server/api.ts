import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import type { OneBotGateway } from "./onebot.js";
import type { SettingsStore } from "./settings.js";
import { ADMISSION_SOURCE } from "./services/admission-repository.js";
import type { AdmissionRepository } from "./services/admission-repository.js";
import type { AutoSyncScheduler } from "./services/auto-sync-scheduler.js";
import type { AnswerSourceRecord, AnswerSourceStore } from "./services/answer-source-store.js";
import type { DataSyncService } from "./services/data-sync.js";
import { renderGaokaoSchoolProfile, type GaokaoCnAdapter, type GaokaoSchool } from "./services/gaokao-cn-adapter.js";
import { DEFAULT_JIANGSU_OFFICIAL_SCORE_SOURCES, JiangsuOfficialAdmissionAdapter, type JiangsuOfficialSyncOptions } from "./services/jiangsu-official-adapter.js";
import { JiangsuOfficialPlanAdapter, type JiangsuOfficialPlanSyncOptions } from "./services/jiangsu-official-plan-adapter.js";
import type { LlmClient } from "./services/llm-client.js";
import type { LogStore } from "./services/log-store.js";
import type { MessageProcessor } from "./services/message-processor.js";
import type { SrgaoxiaoSyncService } from "./services/srgaoxiao-sync.js";
import type { UniversityRepository } from "./services/university-repository.js";
import { XuefengAgentAdapter, type XuefengAgentSyncOptions } from "./services/xuefeng-agent-adapter.js";

const execShell = promisify(exec);
const NAPCAT_RESTART_TIMEOUT_MS = 30_000;
const COMMAND_OUTPUT_LIMIT = 8000;

export interface ApiDeps {
  config: AppConfig;
  database: AppDatabase;
  settings: SettingsStore;
  universities: UniversityRepository;
  admissions: AdmissionRepository;
  sync: DataSyncService;
  answerSources: AnswerSourceStore;
  srgaoxiaoSync: SrgaoxiaoSyncService;
  gaokaoCn: GaokaoCnAdapter;
  autoSync: AutoSyncScheduler;
  llm: LlmClient;
  logs: LogStore;
  processor: MessageProcessor;
  onebot: OneBotGateway;
}

export async function registerApi(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/sources/:token", async (request, reply) => {
    const params = request.params as { token: string };
    const record = deps.answerSources.get(params.token);
    if (!record) return reply.code(404).type("text/html; charset=utf-8").send(renderNotFoundPage(deps.settings.runtime().site.filingNumber));
    return reply.type("text/html; charset=utf-8").send(renderAnswerSourcePage(record, deps.settings.runtime().site.filingNumber));
  });

  app.get("/api/dashboard", async () => {
    const messageCount = deps.database.db.prepare("SELECT COUNT(*) AS count FROM message_logs").get() as { count: number };
    const llmCount = deps.database.db.prepare("SELECT COUNT(*) AS count FROM llm_logs").get() as { count: number };
    const publicBaseUrl = normalizeBaseUrl(deps.settings.runtime().site.publicBaseUrl) || deps.config.server.publicBaseUrl;
    return {
      onebot: deps.onebot.status(),
      totals: {
        universities: deps.universities.countUniversities(),
        srgaoxiaoProfiles: deps.universities.countSchoolProfiles("srgaoxiao"),
        admissionMappings: deps.admissions.countMappings(),
        messages: messageCount.count,
        llmCalls: llmCount.count
      },
      sync: deps.sync.latestSync(),
      publicBaseUrl,
      onebotWsUrl: `${publicBaseUrl.replace(/^http/, "ws")}/onebot/v11/ws`
    };
  });

  app.get("/api/settings", async () => deps.settings.all(true));

  app.put("/api/settings", async (request) => {
    deps.settings.update(request.body as Record<string, unknown>);
    deps.autoSync.refresh();
    return { ok: true, settings: deps.settings.all(true) };
  });

  app.get("/api/sync-scheduler", async () => deps.autoSync.status());

  app.post("/api/sync-scheduler/gaokao-cn/reset", async (request) => {
    const body = request.body as { target?: "plan" | "score" | "all" };
    const target = body.target === "plan" || body.target === "score" || body.target === "all" ? body.target : "all";
    deps.autoSync.resetGaokaoCnProgress(target);
    return { ok: true, status: deps.autoSync.status() };
  });

  app.post("/api/settings/test-llm", async () => {
    const text = await deps.llm.testConnection();
    return { ok: true, text };
  });

  app.post("/api/data/sync", async () => {
    const result = await deps.sync.sync();
    return { ok: true, ...result };
  });

  app.post("/api/data/sync-srgaoxiao", async (request) => {
    const body = request.body as {
      query?: string;
      limit?: number;
      full?: boolean;
      pageSize?: number;
      refreshReviews?: "none" | "changed" | "always";
      reviewMaxPages?: number;
    };
    const result = await deps.srgaoxiaoSync.sync({
      query: body.query,
      limit: body.limit,
      full: body.full,
      pageSize: body.pageSize,
      refreshReviews: body.refreshReviews,
      reviewMaxPages: body.reviewMaxPages
    });
    return { ok: true, ...result };
  });

  app.post("/api/data/sync-gaokao-cn", async (request, reply) => {
    const body = request.body as {
      query?: string;
      limit?: number;
      offset?: number;
      universityId?: number;
      provinces?: string[] | string;
      subjectTypes?: string[] | string;
      scoreYears?: number[] | string;
      planYears?: number[] | string;
      includePlans?: boolean;
      includeScores?: boolean;
      includeSpecialScores?: boolean;
      includePlanDetails?: boolean;
      eligibleOnly?: boolean;
      requestDelayMs?: number;
      maxSourceRequests?: number;
      skipExisting?: boolean;
    };
    const syncSettings = deps.settings.runtime().sync;
    const rateLimitStatus = deps.gaokaoCn.rateLimitStatus?.();
    if (rateLimitStatus?.active) {
      const message = `掌上高考当前处于限流冷却中，预计 ${rateLimitStatus.until ?? "稍后"} 后再恢复同步；本次没有请求源站。`;
      return reply.code(429).send({
        ok: false,
        code: "GAOKAO_CN_RATE_LIMIT_COOLDOWN",
        cooldownUntil: rateLimitStatus.until,
        message
      });
    }
    const result = await deps.gaokaoCn.sync({
      query: body.query,
      limit: body.limit,
      offset: body.offset,
      universityId: body.universityId,
      provinces: parseStringList(body.provinces),
      subjectTypes: parseStringList(body.subjectTypes),
      scoreYears: parseNumberList(body.scoreYears),
      planYears: parseNumberList(body.planYears),
      includePlans: body.includePlans,
      includeScores: body.includeScores,
      includeSpecialScores: body.includeSpecialScores,
      includePlanDetails: body.includePlanDetails ?? syncSettings.gaokaoCnIncludePlanDetails,
      eligibleOnly: body.eligibleOnly,
      requestDelayMs: body.requestDelayMs,
      rateLimitCooldownMinutes: syncSettings.gaokaoCnRateLimitCooldownMinutes,
      maxSourceRequests: body.maxSourceRequests ?? syncSettings.gaokaoCnMaxRequestsPerRun,
      skipExisting: body.skipExisting
    });
    return { ok: true, ...result };
  });

  app.post("/api/data/sync-xuefeng-agent", async (request) => {
    const body = request.body as {
      dbPath?: string;
      gzPath?: string;
      url?: string;
      query?: string;
      provinces?: string[] | string;
      years?: number[] | string;
      limit?: number;
      offset?: number;
      background?: boolean;
    };
    const options: XuefengAgentSyncOptions = {
      dbPath: body.dbPath,
      gzPath: body.gzPath,
      url: body.url,
      query: body.query,
      provinces: parseStringList(body.provinces),
      years: parseNumberList(body.years),
      limit: toOptionalNumber(body.limit),
      offset: toOptionalNumber(body.offset)
    };
    const adapter = new XuefengAgentAdapter(deps.config.dataDir, deps.database, deps.universities, deps.admissions);
    if (body.background) {
      void adapter.sync(options).catch((error) => {
        console.error("[api] Background Xuefeng Agent sync failed:", error);
      });
      return {
        ok: true,
        queued: true,
        message: "雪峰 Agent 导入已在后台启动，请稍后刷新同步任务查看进度。"
      };
    }
    const result = await adapter.sync(options);
    return { ok: true, ...result };
  });

  app.post("/api/data/sync-jiangsu-official", async (request, reply) => {
    const body = request.body as {
      query?: string;
      limit?: number;
      year?: number;
      subjectType?: string;
      pageUrl?: string;
      pdfUrl?: string;
      batch?: string;
      title?: string;
    };
    const options = buildJiangsuOfficialSyncOptions(body);
    if (options === null) {
      return reply.code(400).send({
        ok: false,
        message: "自定义江苏官方来源时，请同时提供科类：物理类或历史类。"
      });
    }
    const adapter = new JiangsuOfficialAdmissionAdapter(deps.universities, deps.admissions);
    const result = await adapter.sync(options);
    return { ok: true, ...result };
  });

  app.post("/api/data/sync-jiangsu-official-plans", async (request) => {
    const body = request.body as {
      query?: string;
      limit?: number;
    };
    const options: JiangsuOfficialPlanSyncOptions = {
      query: body.query,
      limit: toOptionalNumber(body.limit)
    };
    const adapter = new JiangsuOfficialPlanAdapter(deps.universities, deps.admissions);
    const result = await adapter.sync(options);
    return { ok: true, ...result };
  });

  app.get("/api/admissions/mappings", async (request) => {
    const query = request.query as { query?: string; limit?: string };
    return deps.admissions.listMappings(query.query ?? "", Number(query.limit ?? 80));
  });

  app.get("/api/admissions/coverage", async () => deps.admissions.coverageStats());

  app.get("/api/admissions/coverage-gaps", async (request) => {
    const query = request.query as { planYears?: string; scoreYears?: string; provinces?: string; subjectTypes?: string; limit?: string };
    return deps.admissions.coverageGaps({
      planYears: parseNumberList(query.planYears),
      scoreYears: parseNumberList(query.scoreYears),
      provinces: parseStringList(query.provinces),
      subjectTypes: parseStringList(query.subjectTypes),
      limit: Number(query.limit ?? 24)
    });
  });

  app.get("/api/admissions/coverage-gaps/missing", async (request) => {
    const query = request.query as { kind?: string; year?: string; province?: string; subjectType?: string; limit?: string };
    const kind = query.kind === "plan" || query.kind === "major_plan" || query.kind === "school_score" || query.kind === "major_score" ? query.kind : null;
    if (!kind) throw new Error("kind must be plan, major_plan, school_score or major_score");
    if (!query.year) throw new Error("year is required");
    if (!query.province?.trim()) throw new Error("province is required");
    return deps.admissions.coverageMissingUniversities({
      kind,
      year: Number(query.year),
      provinceName: query.province,
      subjectType: query.subjectType,
      limit: Number(query.limit ?? 80)
    });
  });

  app.get("/api/admissions/unmapped", async (request) => {
    const query = request.query as { query?: string; limit?: string };
    return deps.admissions.listUnmappedUniversities(query.query ?? "", Number(query.limit ?? 50));
  });

  app.get("/api/admissions/mapping-issues", async (request) => {
    const query = request.query as { query?: string; limit?: string };
    return deps.admissions.listMappingIssues(query.query ?? "", Number(query.limit ?? 50));
  });

  app.get("/api/admissions/source-schools", async (request) => {
    const query = request.query as { query?: string; universityId?: string; limit?: string };
    const keyword = query.query?.trim();
    if (!keyword) return [];
    const rows = await deps.gaokaoCn.searchSchools(keyword, query.universityId ? Number(query.universityId) : undefined);
    return rows.slice(0, Math.max(1, Math.min(30, Number(query.limit ?? 10))));
  });

  app.put("/api/admissions/mappings/:universityId", async (request) => {
    const params = request.params as { universityId: string };
    const body = request.body as { sourceSchoolId?: string; sourceSchoolName?: string; sourceUrl?: string; sourceSchool?: Partial<GaokaoSchool> };
    const university = deps.universities.getUniversity(Number(params.universityId));
    if (!university) throw new Error("university not found");
    if (!body.sourceSchoolId) throw new Error("sourceSchoolId is required");
    const sourceSchoolId = String(body.sourceSchoolId).trim();
    const sourceSchoolName = body.sourceSchoolName?.trim() || university.name;
    const sourceUrl = body.sourceUrl || `https://www.gaokao.cn/school/${encodeURIComponent(sourceSchoolId)}`;
    const sourceSchool = normalizeManualGaokaoSchoolCandidate(body.sourceSchool, sourceSchoolId, sourceSchoolName);
    const payloadJson = JSON.stringify(sourceSchool ?? { manual: true, sourceSchoolId, sourceSchoolName });
    deps.admissions.upsertMapping({
      universityId: university.id,
      sourceSchoolId,
      sourceSchoolName,
      matchedName: sourceSchoolName,
      matchStatus: "manual",
      confidence: 1,
      sourceUrl,
      payloadJson
    });
    if (sourceSchool) {
      deps.universities.upsertSchoolProfile({
        universityId: university.id,
        source: ADMISSION_SOURCE,
        sourceSchoolId,
        sourceUrl,
        payloadJson,
        profileText: renderGaokaoSchoolProfile(sourceSchool, sourceSchoolId, sourceUrl)
      });
      deps.admissions.insertSource({
        sourceKind: "school-profile",
        universityId: university.id,
        sourceSchoolId,
        sourceUrl,
        requestJson: JSON.stringify({ school_id: sourceSchoolId, source: "manual-mapping" }),
        responseJson: JSON.stringify({ code: "0000", data: { item: [sourceSchool] } }),
        status: "success"
      });
    }
    return { ok: true };
  });

  app.get("/api/admissions/query", async (request) => {
    const query = request.query as {
      universityId?: string;
      university?: string;
      province?: string;
      subject?: string;
      years?: string;
      batch?: string;
      planGroup?: string;
      scoreType?: string;
      major?: string;
      limit?: string;
    };
    const scoreType: "school" | "major" | undefined =
      query.scoreType === "school" || query.scoreType === "major" ? query.scoreType : undefined;
    const universityQuery = !query.universityId ? query.university?.trim() : "";
    const universityIds = universityQuery
      ? deps.universities.listUniversities(universityQuery, 20).map((row) => row.id)
      : undefined;
    if (universityQuery && !universityIds?.length) return { plans: [], scores: [] };
    const input = {
      universityId: query.universityId ? Number(query.universityId) : undefined,
      universityIds,
      provinceName: query.province,
      subjectType: query.subject,
      subjectTypes: parseStringList(query.subject),
      years: parseNumberList(query.years),
      batch: query.batch,
      planGroup: query.planGroup,
      scoreType,
      majorName: query.major,
      limit: Number(query.limit ?? 80)
    };
    return {
      plans: deps.admissions.queryPlans(input),
      scores: deps.admissions.queryScores(input)
    };
  });

  app.get("/api/admissions/jobs", async (request) => {
    const query = request.query as { limit?: string; status?: string; jobType?: string };
    return deps.admissions.recentJobs({
      limit: Number(query.limit ?? 30),
      status: query.status,
      jobType: query.jobType
    });
  });

  app.get("/api/admissions/jobs/failed", async (request) => {
    const query = request.query as { limit?: string };
    return deps.admissions.recentFailedJobs(Number(query.limit ?? 10));
  });

  app.get("/api/admissions/sources", async (request) => {
    const query = request.query as {
      universityId?: string;
      sourceSchoolId?: string;
      sourceKind?: string;
      status?: string;
      year?: string;
      province?: string;
      subject?: string;
      limit?: string;
    };
    return deps.admissions.listSources({
      universityId: query.universityId ? Number(query.universityId) : undefined,
      sourceSchoolId: query.sourceSchoolId?.trim() || undefined,
      sourceKind: query.sourceKind,
      status: query.status,
      year: query.year ? Number(query.year) : undefined,
      provinceName: query.province,
      subjectType: query.subject,
      limit: Number(query.limit ?? 20)
    });
  });

  app.get("/api/admissions/sources/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const source = deps.admissions.getSource(Number(params.id));
    if (!source) return reply.code(404).send({ error: "source not found" });
    return source;
  });

  app.get("/api/universities", async (request) => {
    const query = request.query as { query?: string; limit?: string };
    return deps.universities.listUniversities(query.query ?? "", Number(query.limit ?? 80));
  });

  app.get("/api/universities/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const university = deps.universities.getUniversity(Number(params.id));
    if (!university) return reply.code(404).send({ error: "not_found" });
    return {
      ...university,
      aliases: deps.universities.getAliases(university.id),
      srgaoxiaoProfile: deps.universities.getSchoolProfile(university.id, "srgaoxiao") ?? null
    };
  });

  app.get("/api/aliases", async () => deps.universities.getAliases());

  app.post("/api/aliases", async (request) => {
    const body = request.body as { alias?: string; universityId?: number; priority?: number };
    if (!body.alias || !body.universityId) throw new Error("alias and universityId are required");
    deps.universities.addAlias(body.alias, body.universityId, body.priority ?? 80);
    return { ok: true };
  });

  app.delete("/api/aliases/:id", async (request) => {
    const params = request.params as { id: string };
    deps.universities.deleteAlias(Number(params.id));
    return { ok: true };
  });

  app.post("/api/debug/message", async (request) => {
    const body = request.body as {
      text?: string;
      imageUrls?: string[];
      messageType?: "private" | "group";
      userId?: string;
      groupId?: string;
    };
    if (!body.text && !body.imageUrls?.length) throw new Error("text or imageUrls is required");
    return deps.processor.process({
      platform: "debug",
      text: body.text ?? "",
      images: body.imageUrls?.map((url) => ({ url })),
      messageType: body.messageType ?? "private",
      userId: body.userId ?? "debug-user",
      groupId: body.groupId,
      conversationKey: body.messageType === "group" ? `debug-group:${body.groupId ?? "1"}:${body.userId ?? "debug-user"}` : "debug-private",
      mentionedBot: true
    });
  });

  app.get("/api/logs/messages", async (request) => {
    const query = request.query as { limit?: string };
    return deps.logs.recentMessages(Number(query.limit ?? 80));
  });

  app.get("/api/logs/llm", async (request) => {
    const query = request.query as { limit?: string };
    return deps.logs.recentLlm(Number(query.limit ?? 80));
  });

  app.get("/api/onebot/status", async () => deps.onebot.status());

  app.get("/api/onebot/napcat/status", async () => getNapcatLauncherStatus(deps.settings.runtime().onebot));

  app.get("/api/onebot/napcat/open", async (_request, reply) => {
    const settings = deps.settings.runtime().onebot;
    const url = buildNapcatWebPanelUrl(settings.napcatWebUrl, settings.napcatWebKey);
    if (!url) {
      return reply.code(400).send({
        ok: false,
        message: "请先填写 NapCat 启动器地址。"
      });
    }
    return reply.redirect(url);
  });

  app.post("/api/onebot/napcat/restart", async (_request, reply) => {
    const settings = deps.settings.runtime().onebot;
    if (settings.napcatWebKey.trim()) {
      try {
        const result = await callNapcatLauncherApi<{ message?: string }>(settings, "/QQLogin/RestartNapCat");
        return {
          ok: true,
          mode: "launcher",
          message: result.message || "已向 NapCat 启动器发送重启请求。"
        };
      } catch (error) {
        return reply.code(500).send({
          ok: false,
          mode: "launcher",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const command = settings.napcatRestartCommand.trim();
    if (!command) {
      return reply.code(400).send({
        ok: false,
        message: "请先填写 NapCat 启动器地址和 WebUI Key；如果不用启动器，再填写 NapCat 重启命令。"
      });
    }

    const startedAt = new Date().toISOString();
    try {
      const { stdout, stderr } = await execShell(command, {
        timeout: NAPCAT_RESTART_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      return {
        ok: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout: truncateCommandOutput(stdout),
        stderr: truncateCommandOutput(stderr)
      };
    } catch (error) {
      const failed = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: string | number;
        signal?: string;
      };
      return reply.code(500).send({
        ok: false,
        message: failed.message || "NapCat 重启命令执行失败。",
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: failed.code,
        signal: failed.signal,
        stdout: truncateCommandOutput(failed.stdout),
        stderr: truncateCommandOutput(failed.stderr)
      });
    }
  });
}

function truncateCommandOutput(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (text.length <= COMMAND_OUTPUT_LIMIT) return text;
  return `${text.slice(0, COMMAND_OUTPUT_LIMIT)}\n...（输出已截断）`;
}

type NapcatLauncherSettings = ReturnType<SettingsStore["runtime"]>["onebot"];

interface NapcatApiResponse<T> {
  code: number;
  message?: string;
  data?: T;
}

interface NapcatLoginResponse {
  Credential?: string;
  require2FA?: boolean;
  message?: string;
}

interface NapcatLoginStatus {
  isLogin?: boolean;
  isOffline?: boolean;
  qrcodeurl?: string;
  loginError?: string;
}

async function getNapcatLauncherStatus(settings: NapcatLauncherSettings): Promise<Record<string, unknown>> {
  const baseUrl = normalizeNapcatWebBaseUrl(settings.napcatWebUrl);
  if (!baseUrl) {
    return {
      configured: false,
      reachable: false,
      message: "请先填写 NapCat 启动器地址。"
    };
  }
  if (!settings.napcatWebKey.trim()) {
    return {
      configured: false,
      reachable: false,
      baseUrl,
      panelUrl: buildNapcatWebPanelUrl(settings.napcatWebUrl, settings.napcatWebKey),
      message: "请填写 NapCat WebUI Key 后再检查登录状态。"
    };
  }

  try {
    const data = await callNapcatLauncherApi<NapcatLoginStatus>(settings, "/QQLogin/CheckLoginStatus");
    return {
      configured: true,
      reachable: true,
      baseUrl,
      panelUrl: buildNapcatWebPanelUrl(settings.napcatWebUrl, settings.napcatWebKey),
      isLogin: Boolean(data.isLogin),
      isOffline: Boolean(data.isOffline),
      qrcodeUrl: data.qrcodeurl || "",
      loginError: data.loginError || ""
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      baseUrl,
      panelUrl: buildNapcatWebPanelUrl(settings.napcatWebUrl, settings.napcatWebKey),
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function callNapcatLauncherApi<T>(settings: NapcatLauncherSettings, path: string): Promise<T> {
  const baseUrl = normalizeNapcatWebBaseUrl(settings.napcatWebUrl);
  if (!baseUrl) throw new Error("NapCat 启动器地址无效。");
  const credential = await loginNapcatWebUi(baseUrl, settings.napcatWebKey);
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credential}`
    },
    body: "{}"
  });
  return parseNapcatApiResponse<T>(response, path);
}

async function loginNapcatWebUi(baseUrl: string, key: string): Promise<string> {
  const trimmedKey = key.trim();
  if (!trimmedKey) throw new Error("请填写 NapCat WebUI Key。");
  const hash = createHash("sha256").update(`${trimmedKey}.napcat`).digest("hex");
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hash })
  });
  const data = await parseNapcatApiResponse<NapcatLoginResponse>(response, "/auth/login");
  if (data.require2FA) throw new Error("NapCat WebUI 已开启 2FA，请先手动打开 NapCat 管理台登录。");
  if (!data.Credential) throw new Error(data.message || "NapCat WebUI 没有返回登录凭证。");
  return data.Credential;
}

async function parseNapcatApiResponse<T>(response: Response, path: string): Promise<T> {
  const text = await response.text();
  let parsed: NapcatApiResponse<T>;
  try {
    parsed = JSON.parse(text) as NapcatApiResponse<T>;
  } catch {
    throw new Error(`NapCat WebUI ${path} 返回了无法解析的响应：${text.slice(0, 180)}`);
  }
  if (!response.ok || parsed.code !== 0) {
    throw new Error(`NapCat WebUI ${path} 调用失败：${parsed.message || response.statusText || response.status}`);
  }
  return (parsed.data ?? {}) as T;
}

function normalizeNapcatWebBaseUrl(value: string): string {
  const text = value.trim() || "http://127.0.0.1:6099";
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function buildNapcatWebPanelUrl(baseUrl: string, key: string): string {
  const normalized = normalizeNapcatWebBaseUrl(baseUrl);
  if (!normalized) return "";
  const url = new URL("/webui", normalized);
  if (key.trim()) url.searchParams.set("token", key.trim());
  return url.toString();
}

export function renderAnswerSourcePage(record: AnswerSourceRecord, filingNumber: string): string {
  const title = record.universityName ? `${record.universityName} 资料来源` : "回答资料来源";
  const isAdmission = record.topic === "招生数据";
  const sections = isAdmission
    ? renderAdmissionSourceSections(record.contextText)
    : [
        renderSection("CollegesChat 问卷资料", record.contextText),
        renderSection("外部院校画像补充资料", record.schoolProfileText || "本回答未使用外部院校画像补充资料。"),
        renderSection("神人高校评论资料", record.srgaoxiaoReviewsText || "本回答未使用神人高校评论资料。")
      ].join("");
  const sourceLink = record.sourceUrl
    ? `<a href="${escapeAttribute(record.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.sourceUrl)}</a>`
    : "-";

  return renderPublicHtml({
    title,
    filingNumber,
    body: `
      <main class="page">
        <header class="hero">
          <p class="eyebrow">高校资料 QQBot</p>
          <h1>${escapeHtml(title)}</h1>
          <dl class="meta">
            <div><dt>用户问题</dt><dd>${escapeHtml(record.question)}</dd></div>
            <div><dt>主题</dt><dd>${escapeHtml(record.topic || "-")}</dd></div>
            <div><dt>生成时间</dt><dd>${escapeHtml(formatDateTime(record.createdAt))}</dd></div>
            <div><dt>原始资料链接</dt><dd>${sourceLink}</dd></div>
          </dl>
        </header>
        ${record.answerText ? renderSection("本次回答", record.answerText) : ""}
        ${sections}
      </main>`
  });
}

function renderAdmissionSourceSections(contextText: string): string {
  const sections = splitAdmissionContext(contextText);
  if (!sections.length) return renderSection("掌上高考招生数据", contextText);
  return sections.map((section) => renderAdmissionSection(section.title, section.content)).join("");
}

function splitAdmissionContext(contextText: string): Array<{ title: string; content: string }> {
  const markers = [
    { pattern: /^掌上高考院校基础信息：\s*$/u, title: "掌上高考院校基础信息" },
    { pattern: /^报考参考表：\s*$/u, title: "报考参考表" },
    { pattern: /^招生计划：\s*$/u, title: "招生计划" },
    { pattern: /^分数趋势摘要：\s*$/u, title: "分数趋势摘要" },
    { pattern: /^录取分数\/位次：\s*$/u, title: "录取分数与最低位次" },
    { pattern: /^资料页追溯：\s*$/u, title: "资料页追溯" },
    { pattern: /^来源：掌上高考公开聚合数据/u, title: "来源提醒" }
  ];
  const sections: Array<{ title: string; lines: string[] }> = [{ title: "查询条件与同步状态", lines: [] }];
  let schoolSectionTitle: string | null = null;
  for (const line of contextText.split(/\r?\n/u)) {
    const schoolDivider = /^=+\s*(.+?)\s*=+$/u.exec(line.trim());
    if (schoolDivider?.[1]) {
      schoolSectionTitle = schoolDivider[1];
      sections.push({ title: `学校：${schoolSectionTitle}`, lines: [] });
      continue;
    }
    const marker = markers.find((item) => item.pattern.test(line.trim()));
    if (marker) {
      sections.push({
        title: schoolSectionTitle ? `${schoolSectionTitle} - ${marker.title}` : marker.title,
        lines: marker.title === "来源提醒" ? [line] : []
      });
      continue;
    }
    sections[sections.length - 1].lines.push(line);
  }
  return sections
    .map((section) => ({ title: section.title, content: section.lines.join("\n").trim() }))
    .filter((section) => section.content);
}

function renderNotFoundPage(filingNumber: string): string {
  return renderPublicHtml({
    title: "资料页不存在",
    filingNumber,
    body: `
      <main class="page compact">
        <header class="hero">
          <p class="eyebrow">高校资料 QQBot</p>
          <h1>资料页不存在</h1>
          <p class="muted">这个资料页可能已经被清理，或者链接不完整。</p>
        </header>
      </main>`
  });
}

function renderSection(title: string, content: string): string {
  return `
    <section class="source-section">
      <h2>${escapeHtml(title)}</h2>
      <pre>${escapeHtml(content)}</pre>
    </section>
  `;
}

function renderAdmissionSection(title: string, content: string): string {
  if (title === "资料页追溯") return renderAdmissionTraceSection(title, content);
  return `
    <section class="source-section">
      <h2>${escapeHtml(title)}</h2>
      ${renderContentBlocks(content)}
    </section>
  `;
}

function renderAdmissionTraceSection(title: string, content: string): string {
  const lines = content.split(/\r?\n/u);
  const snapshotLines = lines.filter((line) => /^#\d+；/u.test(line.trim()));
  const remaining = lines.filter((line) => !/^#\d+；/u.test(line.trim()) && line.trim() !== "掌上高考来源快照：");
  const cards = snapshotLines.map(renderAdmissionSourceCard).join("");
  return `
    <section class="source-section">
      <h2>${escapeHtml(title)}</h2>
      ${renderContentBlocks(remaining.join("\n").trim())}
      ${cards ? `<div class="source-cards">${cards}</div>` : ""}
    </section>
  `;
}

function renderContentBlocks(content: string): string {
  const lines = content.split(/\r?\n/u);
  const blocks: string[] = [];
  let textLines: string[] = [];
  let tableLines: string[] = [];
  const flushText = () => {
    const text = textLines.join("\n").trim();
    if (text) blocks.push(`<pre>${escapeHtml(text)}</pre>`);
    textLines = [];
  };
  const flushTable = () => {
    if (tableLines.length >= 2) blocks.push(renderPipeTable(tableLines));
    else textLines.push(...tableLines);
    tableLines = [];
  };

  for (const line of lines) {
    if (isPipeTableLine(line)) {
      flushText();
      tableLines.push(line);
      continue;
    }
    flushTable();
    textLines.push(line);
  }
  flushTable();
  flushText();
  return blocks.join("");
}

function renderPipeTable(lines: string[]): string {
  const rows = lines.map(parsePipeRow).filter((row) => row.length > 1);
  if (rows.length < 2) return `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
  const [header, ...bodyRows] = rows;
  return `
    <div class="table-scroll">
      <table class="source-table">
        <thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>
        <tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderAdmissionSourceCard(line: string): string {
  const parts = line.split("；").map((part) => part.trim()).filter(Boolean);
  const id = parts[0] ?? "#-";
  const kind = parts[1] ?? "unknown";
  const status = parts[2] ?? "-";
  const details = new Map<string, string>();
  for (const part of parts.slice(3)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    details.set(part.slice(0, index), part.slice(index + 1));
  }
  const rows = [
    ["抓取时间", details.get("抓取")],
    ["来源 URL", details.get("URL")],
    ["请求参数", details.get("请求")],
    ["响应摘要", details.get("响应")]
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return `
    <article class="source-card">
      <div class="source-card-head">
        <strong>${escapeHtml(id)}</strong>
        <span>${escapeHtml(kind)}</span>
        <em class="${status === "success" ? "source-status success" : "source-status"}">${escapeHtml(status)}</em>
      </div>
      <dl>${rows.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    </article>
  `;
}

function isPipeTableLine(line: string): boolean {
  return line.includes("|") && line.split("|").length >= 4;
}

function parsePipeRow(line: string): string[] {
  return line
    .replace(/^\s*\|/u, "")
    .replace(/\|\s*$/u, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function renderPublicHtml(input: { title: string; body: string; filingNumber: string }): string {
  const filing = input.filingNumber.trim();
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root{color:#1f2937;background:#f4f1ea;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
    *{box-sizing:border-box}
    body{margin:0}
    a{color:#256f6b;text-decoration:none;overflow-wrap:anywhere}
    a:hover{text-decoration:underline}
    .page{width:min(980px,100%);margin:0 auto;padding:28px 18px 38px}
    .compact{min-height:70vh;display:grid;place-items:center}
    .hero,.source-section{background:#fffdf9;border:1px solid #e5ded3;border-radius:8px;padding:20px;margin-bottom:14px}
    .eyebrow{margin:0 0 8px;color:#256f6b;font-weight:700}
    h1{margin:0;font-size:28px;letter-spacing:0;color:#172033}
    h2{margin:0 0 12px;font-size:18px;letter-spacing:0;color:#172033}
    .meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;margin:18px 0 0}
    .meta div{min-width:0}
    dt{color:#687385;font-size:13px;margin-bottom:4px}
    dd{margin:0;line-height:1.65;overflow-wrap:anywhere}
    pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;font:inherit;color:#243044}
    pre+pre,.table-scroll+pre,pre+.table-scroll{margin-top:12px}
    .table-scroll{overflow-x:auto;margin:10px 0 0;border:1px solid #e5ded3;border-radius:8px;background:#fff}
    .source-table{width:100%;border-collapse:collapse;min-width:680px;font-size:14px}
    .source-table th,.source-table td{padding:9px 10px;border-bottom:1px solid #eee6da;text-align:left;vertical-align:top;line-height:1.55}
    .source-table th{background:#f7f2e9;color:#172033;font-weight:700;white-space:nowrap}
    .source-table tr:last-child td{border-bottom:0}
    .source-cards{display:grid;gap:10px;margin-top:14px}
    .source-card{border:1px solid #e5ded3;border-radius:8px;background:#fff;padding:12px}
    .source-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;color:#172033}
    .source-card-head span{color:#687385}
    .source-status{font-style:normal;font-size:12px;border-radius:999px;padding:2px 8px;background:#fff1f1;color:#a33a3a}
    .source-status.success{background:#eaf7f2;color:#256f6b}
    .source-card dl{display:grid;gap:8px;margin:0}
    .source-card dl div{display:grid;grid-template-columns:88px minmax(0,1fr);gap:8px}
    .source-card dt{margin:0;color:#687385}
    .source-card dd{margin:0;overflow-wrap:anywhere}
    .muted{color:#687385;line-height:1.7}
    footer{padding:18px;text-align:center;color:#7a6f65;font-size:13px}
    @media (max-width:720px){.meta{grid-template-columns:1fr}.page{padding:14px}.hero,.source-section{padding:16px}}
  </style>
</head>
<body>
  ${input.body}
  ${filing ? `<footer>${escapeHtml(filing)}</footer>` : ""}
</body>
</html>`;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

function normalizeManualGaokaoSchoolCandidate(
  input: Partial<GaokaoSchool> | undefined,
  sourceSchoolId: string,
  fallbackName: string
): GaokaoSchool | null {
  const schoolId = cleanApiString(input?.school_id) ?? sourceSchoolId;
  const name = cleanApiString(input?.name) ?? fallbackName;
  if (!schoolId || !name) return null;
  return {
    school_id: schoolId,
    name,
    province_name: cleanApiString(input?.province_name),
    city_name: cleanApiString(input?.city_name),
    level_name: cleanApiString(input?.level_name),
    type_name: cleanApiString(input?.type_name),
    nature_name: cleanApiString(input?.nature_name),
    f211: input?.f211 ?? null,
    f985: input?.f985 ?? null,
    dual_class_name: cleanApiString(input?.dual_class_name)
  };
}

function cleanApiString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function buildJiangsuOfficialSyncOptions(body: {
  query?: string;
  limit?: number;
  year?: number;
  subjectType?: string;
  pageUrl?: string;
  pdfUrl?: string;
  excelUrl?: string;
  batch?: string;
  title?: string;
}): JiangsuOfficialSyncOptions | null {
  const query = cleanApiString(body.query) ?? undefined;
  const limit = toOptionalNumber(body.limit);
  const year = toOptionalNumber(body.year);
  const subjectType = normalizeJiangsuOfficialSubject(body.subjectType);
  const pageUrl = cleanApiString(body.pageUrl) ?? undefined;
  const pdfUrl = cleanApiString(body.pdfUrl) ?? undefined;
  const excelUrl = cleanApiString(body.excelUrl) ?? undefined;
  const batch = cleanApiString(body.batch) ?? undefined;
  const title = cleanApiString(body.title) ?? undefined;
  const hasCustomSource = Boolean(year || subjectType || pageUrl || pdfUrl || excelUrl || batch || title);
  const options: JiangsuOfficialSyncOptions = { query, limit };
  if (!hasCustomSource) return options;
  if (!subjectType) return null;

  const defaultSource = DEFAULT_JIANGSU_OFFICIAL_SCORE_SOURCES.find(
    (source) => source.subjectType === subjectType && (!year || source.year === year)
  );
  if (!pageUrl && !pdfUrl && !excelUrl && !defaultSource) return null;
  options.sources = [
    {
      ...(defaultSource ?? {
        year: year ?? 2025,
        subjectType,
        batch: "本科批",
        linkTextIncludes: subjectType.includes("物理") ? "物理" : "历史"
      }),
      year: year ?? defaultSource?.year ?? 2025,
      subjectType,
      batch: batch ?? defaultSource?.batch ?? "本科批",
      title: title ?? defaultSource?.title,
      pageUrl: pageUrl ?? defaultSource?.pageUrl,
      pdfUrl: pdfUrl ?? defaultSource?.pdfUrl,
      excelUrl: excelUrl ?? defaultSource?.excelUrl,
      linkTextIncludes: subjectType.includes("物理") ? "物理" : "历史"
    }
  ];
  return options;
}

function normalizeJiangsuOfficialSubject(value: unknown): "物理类" | "历史类" | undefined {
  const text = cleanApiString(value);
  if (!text) return undefined;
  if (text.includes("物理")) return "物理类";
  if (text.includes("历史")) return "历史类";
  return undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStringList(value: string[] | string | undefined): string[] | undefined {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (!value) return undefined;
  return value
    .split(/[,，\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberList(value: number[] | string | undefined): number[] | undefined {
  if (Array.isArray(value)) return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (!value) return undefined;
  return parseStringList(value)
    ?.map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
