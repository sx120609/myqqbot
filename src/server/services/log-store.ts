import type { AppDatabase } from "../db.js";

export class LogStore {
  constructor(private readonly database: AppDatabase) {}

  message(input: {
    direction: "in" | "out";
    platform: string;
    conversationKey: string;
    userId?: string | number | null;
    groupId?: string | number | null;
    text: string;
    responseText?: string | null;
    handled?: boolean;
    reason?: string | null;
  }): void {
    this.database.db
      .prepare(
        `
        INSERT INTO message_logs(direction, platform, conversation_key, user_id, group_id, text, response_text, handled, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.direction,
        input.platform,
        input.conversationKey,
        input.userId == null ? null : String(input.userId),
        input.groupId == null ? null : String(input.groupId),
        input.text,
        input.responseText ?? null,
        input.handled ? 1 : 0,
        input.reason ?? null,
        new Date().toISOString()
      );
  }

  llm(input: {
    purpose: string;
    model: string;
    requestJson: unknown;
    responseText?: string | null;
    error?: string | null;
    latencyMs: number;
  }): void {
    this.database.db
      .prepare(
        `
        INSERT INTO llm_logs(purpose, model, request_json, response_text, error, latency_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.purpose,
        input.model,
        JSON.stringify(input.requestJson),
        input.responseText ?? null,
        input.error ?? null,
        input.latencyMs,
        new Date().toISOString()
      );
  }

  recentMessages(limit = 80): unknown[] {
    return this.database.db
      .prepare(
        `
        SELECT id, direction, platform, conversation_key AS conversationKey, user_id AS userId, group_id AS groupId,
          text, response_text AS responseText, handled, reason, created_at AS createdAt
        FROM message_logs
        ORDER BY id DESC
        LIMIT ?
      `
      )
      .all(limit);
  }

  recentLlm(limit = 80): unknown[] {
    return this.database.db
      .prepare(
        `
        SELECT id, purpose, model, response_text AS responseText, error, latency_ms AS latencyMs, created_at AS createdAt
        FROM llm_logs
        ORDER BY id DESC
        LIMIT ?
      `
      )
      .all(limit);
  }
}

