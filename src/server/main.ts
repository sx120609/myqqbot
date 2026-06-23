import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { OneBotGateway } from "./onebot.js";
import { registerApi } from "./api.js";
import { SettingsStore } from "./settings.js";
import { DataSyncService } from "./services/data-sync.js";
import { LlmClient } from "./services/llm-client.js";
import { LogStore } from "./services/log-store.js";
import { MessageProcessor } from "./services/message-processor.js";
import { NaturalLanguageService } from "./services/nlu.js";
import { UniversityRepository } from "./services/university-repository.js";
import { registerAdminAuth } from "./services/admin-auth.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new AppDatabase(config.dbPath);
  const settings = new SettingsStore(database);
  const logs = new LogStore(database);
  const universities = new UniversityRepository(database);
  const sync = new DataSyncService(config, database, universities);
  const llm = new LlmClient(settings, logs);
  const nlu = new NaturalLanguageService(universities);
  const processor = new MessageProcessor(settings, universities, nlu, llm, logs);
  const onebot = new OneBotGateway(settings, processor);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await registerAdminAuth(app, config, settings);
  await onebot.register(app);
  await registerApi(app, { config, database, settings, universities, sync, llm, logs, processor, onebot });

  const webRoot = resolve(config.cwd, "dist/web");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/"
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api") || request.raw.url?.startsWith("/onebot")) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  const address = await app.listen({ host: config.server.host, port: config.server.port });
  app.log.info(`WebUI: ${address}`);
  app.log.info(`NapCat reverse WS: ${address.replace(/^http/, "ws")}/onebot/v11/ws`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
