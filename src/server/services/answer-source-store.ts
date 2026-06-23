import { randomBytes } from "node:crypto";
import type { AppDatabase } from "../db.js";

export interface AnswerSourceInput {
  question: string;
  universityId?: number | null;
  universityName?: string | null;
  topic?: string | null;
  sourceUrl?: string | null;
  contextText: string;
  schoolProfileText?: string | null;
  srgaoxiaoReviewsText?: string | null;
  answerText?: string | null;
}

export interface AnswerSourceRecord extends AnswerSourceInput {
  token: string;
  createdAt: string;
}

export class AnswerSourceStore {
  constructor(private readonly database: AppDatabase) {}

  create(input: AnswerSourceInput): string {
    const token = randomBytes(12).toString("base64url");
    this.database.db
      .prepare(
        `
        INSERT INTO answer_sources(
          token, question, university_id, university_name, topic, source_url,
          context_text, school_profile_text, srgaoxiao_reviews_text, answer_text, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        token,
        input.question,
        input.universityId ?? null,
        input.universityName ?? null,
        input.topic ?? null,
        input.sourceUrl ?? null,
        input.contextText,
        input.schoolProfileText ?? null,
        input.srgaoxiaoReviewsText ?? null,
        input.answerText ?? null,
        new Date().toISOString()
      );
    return token;
  }

  get(token: string): AnswerSourceRecord | null {
    const row = this.database.db
      .prepare(
        `
        SELECT token, question, university_id AS universityId, university_name AS universityName,
          topic, source_url AS sourceUrl, context_text AS contextText,
          school_profile_text AS schoolProfileText, srgaoxiao_reviews_text AS srgaoxiaoReviewsText,
          answer_text AS answerText, created_at AS createdAt
        FROM answer_sources
        WHERE token = ?
      `
      )
      .get(token) as AnswerSourceRecord | undefined;
    return row ?? null;
  }
}
