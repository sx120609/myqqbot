import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import type { OneBotGateway } from "./onebot.js";
import type { SettingsStore } from "./settings.js";
import type { AdmissionRepository } from "./services/admission-repository.js";
import type { AutoSyncScheduler } from "./services/auto-sync-scheduler.js";
import type { AnswerSourceRecord, AnswerSourceStore } from "./services/answer-source-store.js";
import type { DataSyncService } from "./services/data-sync.js";
import type { GaokaoCnAdapter } from "./services/gaokao-cn-adapter.js";
import type { LlmClient } from "./services/llm-client.js";
import type { LogStore } from "./services/log-store.js";
import type { MessageProcessor } from "./services/message-processor.js";
import type { SrgaoxiaoSyncService } from "./services/srgaoxiao-sync.js";
import type { UniversityRepository } from "./services/university-repository.js";

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

  app.post("/api/data/sync-gaokao-cn", async (request) => {
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
      eligibleOnly?: boolean;
    };
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
      eligibleOnly: body.eligibleOnly
    });
    return { ok: true, ...result };
  });

  app.get("/api/admissions/mappings", async (request) => {
    const query = request.query as { query?: string; limit?: string };
    return deps.admissions.listMappings(query.query ?? "", Number(query.limit ?? 80));
  });

  app.get("/api/admissions/coverage", async () => deps.admissions.coverageStats());

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
    const body = request.body as { sourceSchoolId?: string; sourceSchoolName?: string; sourceUrl?: string };
    const university = deps.universities.getUniversity(Number(params.universityId));
    if (!university) throw new Error("university not found");
    if (!body.sourceSchoolId) throw new Error("sourceSchoolId is required");
    deps.admissions.upsertMapping({
      universityId: university.id,
      sourceSchoolId: body.sourceSchoolId,
      sourceSchoolName: body.sourceSchoolName || university.name,
      matchedName: body.sourceSchoolName || university.name,
      matchStatus: "manual",
      confidence: 1,
      sourceUrl: body.sourceUrl || `https://www.gaokao.cn/school/${encodeURIComponent(body.sourceSchoolId)}`,
      payloadJson: JSON.stringify({ manual: true, sourceSchoolId: body.sourceSchoolId, sourceSchoolName: body.sourceSchoolName || university.name })
    });
    return { ok: true };
  });

  app.get("/api/admissions/query", async (request) => {
    const query = request.query as {
      universityId?: string;
      province?: string;
      subject?: string;
      years?: string;
      batch?: string;
      scoreType?: string;
      major?: string;
      limit?: string;
    };
    const scoreType: "school" | "major" | undefined =
      query.scoreType === "school" || query.scoreType === "major" ? query.scoreType : undefined;
    const input = {
      universityId: query.universityId ? Number(query.universityId) : undefined,
      provinceName: query.province,
      subjectType: query.subject,
      subjectTypes: parseStringList(query.subject),
      years: parseNumberList(query.years),
      batch: query.batch,
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
      sourceKind?: string;
      status?: string;
      limit?: string;
    };
    return deps.admissions.listSources({
      universityId: query.universityId ? Number(query.universityId) : undefined,
      sourceKind: query.sourceKind,
      status: query.status,
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
  return sections.map((section) => renderSection(section.title, section.content)).join("");
}

function splitAdmissionContext(contextText: string): Array<{ title: string; content: string }> {
  const markers = [
    { pattern: /^招生计划：\s*$/u, title: "招生计划" },
    { pattern: /^分数趋势摘要：\s*$/u, title: "分数趋势摘要" },
    { pattern: /^录取分数\/位次：\s*$/u, title: "录取分数与最低位次" },
    { pattern: /^资料页追溯：\s*$/u, title: "资料页追溯" },
    { pattern: /^来源：/u, title: "来源提醒" }
  ];
  const sections: Array<{ title: string; lines: string[] }> = [{ title: "查询条件与同步状态", lines: [] }];
  for (const line of contextText.split(/\r?\n/u)) {
    const marker = markers.find((item) => item.pattern.test(line.trim()));
    if (marker) {
      sections.push({
        title: marker.title,
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
