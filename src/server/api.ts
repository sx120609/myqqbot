import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import type { OneBotGateway } from "./onebot.js";
import type { SettingsStore } from "./settings.js";
import type { DataSyncService } from "./services/data-sync.js";
import type { LlmClient } from "./services/llm-client.js";
import type { LogStore } from "./services/log-store.js";
import type { MessageProcessor } from "./services/message-processor.js";
import type { UniversityRepository } from "./services/university-repository.js";

export interface ApiDeps {
  config: AppConfig;
  database: AppDatabase;
  settings: SettingsStore;
  universities: UniversityRepository;
  sync: DataSyncService;
  llm: LlmClient;
  logs: LogStore;
  processor: MessageProcessor;
  onebot: OneBotGateway;
}

export async function registerApi(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/dashboard", async () => {
    const messageCount = deps.database.db.prepare("SELECT COUNT(*) AS count FROM message_logs").get() as { count: number };
    const llmCount = deps.database.db.prepare("SELECT COUNT(*) AS count FROM llm_logs").get() as { count: number };
    return {
      onebot: deps.onebot.status(),
      totals: {
        universities: deps.universities.countUniversities(),
        messages: messageCount.count,
        llmCalls: llmCount.count
      },
      sync: deps.sync.latestSync(),
      publicBaseUrl: deps.config.server.publicBaseUrl,
      onebotWsUrl: `${deps.config.server.publicBaseUrl.replace(/^http/, "ws")}/onebot/v11/ws`
    };
  });

  app.get("/api/settings", async () => deps.settings.all(true));

  app.put("/api/settings", async (request) => {
    deps.settings.update(request.body as Record<string, unknown>);
    return { ok: true, settings: deps.settings.all(true) };
  });

  app.post("/api/settings/test-llm", async () => {
    const text = await deps.llm.testConnection();
    return { ok: true, text };
  });

  app.post("/api/data/sync", async () => {
    const result = await deps.sync.sync();
    return { ok: true, ...result };
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
      aliases: deps.universities.getAliases(university.id)
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
