import type { AppDatabase } from "../db.js";
import { DEFAULT_ALIASES } from "../domain/default-aliases.js";
import type { ParsedUniversity } from "../domain/parser.js";

export interface UniversityRow {
  id: number;
  name: string;
  slug: string;
  file_path: string;
  source_url: string;
  raw_markdown?: string;
  updated_at: string;
}

export interface QuestionWithAnswers {
  id: number;
  question: string;
  topic: string;
  position: number;
  answers: Array<{
    sourceId: string;
    respondent: string | null;
    answeredAt: string | null;
    text: string;
  }>;
}

export interface SchoolProfileRow {
  universityId: number;
  source: string;
  sourceSchoolId: string | null;
  sourceUrl: string | null;
  payloadJson: string;
  profileText: string;
  updatedAt: string;
}

export interface SchoolReviewRow {
  universityId: number;
  source: string;
  sourceSchoolId: string;
  sourceReviewId: string;
  sourceUrl: string | null;
  authorLabel: string | null;
  campusName: string | null;
  isVerified: number;
  content: string;
  ratingJson: string | null;
  likeCount: number;
  replyCount: number;
  reviewedAt: string | null;
  payloadJson: string;
  cachedAt: string;
}

export interface SchoolReviewInput {
  sourceReviewId: string;
  sourceUrl?: string | null;
  authorLabel?: string | null;
  campusName?: string | null;
  isVerified?: boolean;
  content: string;
  ratingJson?: string | null;
  likeCount?: number;
  replyCount?: number;
  reviewedAt?: string | null;
  payloadJson: string;
}

export class UniversityRepository {
  constructor(private readonly database: AppDatabase) {}

  countUniversities(): number {
    const row = this.database.db.prepare("SELECT COUNT(*) AS count FROM universities").get() as { count: number };
    return row.count;
  }

  importAll(universities: ParsedUniversity[]): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.db.exec(`
        DELETE FROM aliases;
        DELETE FROM answers;
        DELETE FROM questions;
        DELETE FROM universities;
      `);

      const insertUniversity = this.database.db.prepare(`
        INSERT INTO universities(name, slug, file_path, source_url, raw_markdown, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertQuestion = this.database.db.prepare(`
        INSERT INTO questions(university_id, question, topic, position)
        VALUES (?, ?, ?, ?)
      `);
      const insertAnswer = this.database.db.prepare(`
        INSERT INTO answers(question_id, source_id, respondent, answered_at, text)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const university of universities) {
        const info = insertUniversity.run(
          university.name,
          university.slug,
          university.filePath,
          university.sourceUrl,
          university.rawMarkdown,
          now
        );
        const universityId = Number(info.lastInsertRowid);

        for (const question of university.questions) {
          const qInfo = insertQuestion.run(universityId, question.question, question.topic, question.position);
          const questionId = Number(qInfo.lastInsertRowid);
          for (const answer of question.answers) {
            insertAnswer.run(questionId, answer.sourceId, answer.respondent, answer.answeredAt, answer.text);
          }
        }
      }

      this.seedDefaultAliases();
      this.rebuildFts();
    });
  }

  listUniversities(query = "", limit = 50): UniversityRow[] {
    const normalized = `%${query.trim()}%`;
    if (query.trim()) {
      return this.database.db
        .prepare(
          `
          SELECT DISTINCT u.id, u.name, u.slug, u.file_path, u.source_url, u.updated_at
          FROM universities u
          LEFT JOIN aliases a ON a.university_id = u.id
          WHERE u.name LIKE ? OR u.slug LIKE ? OR a.alias LIKE ?
          ORDER BY u.name
          LIMIT ?
        `
        )
        .all(normalized, normalized, normalized, limit) as unknown as UniversityRow[];
    }
    return this.database.db
      .prepare(
        `
        SELECT id, name, slug, file_path, source_url, updated_at
        FROM universities
        ORDER BY name
        LIMIT ?
      `
      )
      .all(limit) as unknown as UniversityRow[];
  }

  listAllUniversities(): UniversityRow[] {
    return this.database.db
      .prepare(
        `
        SELECT id, name, slug, file_path, source_url, updated_at
        FROM universities
        ORDER BY name
      `
      )
      .all() as unknown as UniversityRow[];
  }

  listUniversitiesForProfileSync(source: string, query = "", limit = 50): UniversityRow[] {
    const trimmed = query.trim();
    const normalized = `%${trimmed}%`;
    const where = trimmed ? "WHERE u.name LIKE ? OR u.slug LIKE ? OR a.alias LIKE ?" : "";
    const params = trimmed ? [source, normalized, normalized, normalized, limit] : [source, limit];

    return this.database.db
      .prepare(
        `
        SELECT DISTINCT u.id, u.name, u.slug, u.file_path, u.source_url, u.updated_at,
          p.updated_at AS profileUpdatedAt
        FROM universities u
        LEFT JOIN aliases a ON a.university_id = u.id
        LEFT JOIN school_profiles p ON p.university_id = u.id AND p.source = ?
        ${where}
        ORDER BY CASE WHEN p.updated_at IS NULL THEN 0 ELSE 1 END,
          COALESCE(p.updated_at, ''),
          u.name
        LIMIT ?
      `
      )
      .all(...params) as unknown as UniversityRow[];
  }

  countSchoolProfiles(source?: string): number {
    const row = source
      ? (this.database.db.prepare("SELECT COUNT(*) AS count FROM school_profiles WHERE source = ?").get(source) as { count: number })
      : (this.database.db.prepare("SELECT COUNT(*) AS count FROM school_profiles").get() as { count: number });
    return row.count;
  }

  countSchoolReviews(universityId: number, source = "srgaoxiao"): number {
    const row = this.database.db
      .prepare("SELECT COUNT(*) AS count FROM school_reviews WHERE university_id = ? AND source = ?")
      .get(universityId, source) as { count: number };
    return row.count;
  }

  getUniversity(id: number): UniversityRow | undefined {
    return this.database.db
      .prepare(
        `
        SELECT id, name, slug, file_path, source_url, raw_markdown, updated_at
        FROM universities WHERE id = ?
      `
      )
      .get(id) as UniversityRow | undefined;
  }

  getSchoolProfile(universityId: number, source = "srgaoxiao"): SchoolProfileRow | undefined {
    return this.database.db
      .prepare(
        `
        SELECT university_id AS universityId, source, source_school_id AS sourceSchoolId,
          source_url AS sourceUrl, payload_json AS payloadJson, profile_text AS profileText,
          updated_at AS updatedAt
        FROM school_profiles
        WHERE university_id = ? AND source = ?
      `
      )
      .get(universityId, source) as SchoolProfileRow | undefined;
  }

  upsertSchoolProfile(input: {
    universityId: number;
    source: string;
    sourceSchoolId?: string | null;
    sourceUrl?: string | null;
    payloadJson: string;
    profileText: string;
  }): void {
    this.database.db
      .prepare(
        `
        INSERT INTO school_profiles(university_id, source, source_school_id, source_url, payload_json, profile_text, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(university_id, source) DO UPDATE SET
          source_school_id = excluded.source_school_id,
          source_url = excluded.source_url,
          payload_json = excluded.payload_json,
          profile_text = excluded.profile_text,
          updated_at = excluded.updated_at
      `
      )
      .run(
        input.universityId,
        input.source,
        input.sourceSchoolId ?? null,
        input.sourceUrl ?? null,
        input.payloadJson,
        input.profileText,
        new Date().toISOString()
      );
  }

  getSchoolReviews(universityId: number, source = "srgaoxiao", limit = 8): SchoolReviewRow[] {
    return this.database.db
      .prepare(
        `
        SELECT university_id AS universityId, source, source_school_id AS sourceSchoolId,
          source_review_id AS sourceReviewId, source_url AS sourceUrl, author_label AS authorLabel,
          campus_name AS campusName, is_verified AS isVerified, content, rating_json AS ratingJson,
          like_count AS likeCount, reply_count AS replyCount, reviewed_at AS reviewedAt,
          payload_json AS payloadJson, cached_at AS cachedAt
        FROM school_reviews
        WHERE university_id = ? AND source = ?
        ORDER BY COALESCE(reviewed_at, '') DESC, source_review_id DESC
        LIMIT ?
      `
      )
      .all(universityId, source, limit) as unknown as SchoolReviewRow[];
  }

  replaceSchoolReviews(input: {
    universityId: number;
    source: string;
    sourceSchoolId: string;
    reviews: SchoolReviewInput[];
  }): void {
    this.database.transaction(() => {
      this.database.db
        .prepare("DELETE FROM school_reviews WHERE university_id = ? AND source = ? AND source_school_id = ?")
        .run(input.universityId, input.source, input.sourceSchoolId);
      this.upsertSchoolReviews(input);
    });
  }

  upsertSchoolReviews(input: {
    universityId: number;
    source: string;
    sourceSchoolId: string;
    reviews: SchoolReviewInput[];
  }): void {
    const stmt = this.database.db.prepare(`
      INSERT INTO school_reviews(
        university_id, source, source_school_id, source_review_id, source_url,
        author_label, campus_name, is_verified, content, rating_json,
        like_count, reply_count, reviewed_at, payload_json, cached_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_review_id) DO UPDATE SET
        university_id = excluded.university_id,
        source_school_id = excluded.source_school_id,
        source_url = excluded.source_url,
        author_label = excluded.author_label,
        campus_name = excluded.campus_name,
        is_verified = excluded.is_verified,
        content = excluded.content,
        rating_json = excluded.rating_json,
        like_count = excluded.like_count,
        reply_count = excluded.reply_count,
        reviewed_at = excluded.reviewed_at,
        payload_json = excluded.payload_json,
        cached_at = excluded.cached_at
    `);
    const cachedAt = new Date().toISOString();
    for (const review of input.reviews) {
      stmt.run(
        input.universityId,
        input.source,
        input.sourceSchoolId,
        review.sourceReviewId,
        review.sourceUrl ?? null,
        review.authorLabel ?? null,
        review.campusName ?? null,
        review.isVerified ? 1 : 0,
        review.content,
        review.ratingJson ?? null,
        review.likeCount ?? 0,
        review.replyCount ?? 0,
        review.reviewedAt ?? null,
        review.payloadJson,
        cachedAt
      );
    }
  }

  getAliases(universityId?: number): Array<{ id: number; alias: string; universityId: number; universityName: string; priority: number }> {
    const sql = `
      SELECT a.id, a.alias, a.university_id AS universityId, u.name AS universityName, a.priority
      FROM aliases a
      JOIN universities u ON u.id = a.university_id
      ${universityId ? "WHERE a.university_id = ?" : ""}
      ORDER BY a.priority DESC, a.alias
    `;
    return (universityId
      ? this.database.db.prepare(sql).all(universityId)
      : this.database.db.prepare(sql).all()) as Array<{
      id: number;
      alias: string;
      universityId: number;
      universityName: string;
      priority: number;
    }>;
  }

  addAlias(alias: string, universityId: number, priority = 80): void {
    this.database.db
      .prepare(
        `
        INSERT INTO aliases(alias, university_id, priority, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(alias) DO UPDATE SET university_id = excluded.university_id, priority = excluded.priority
      `
      )
      .run(alias.trim(), universityId, priority, new Date().toISOString());
    this.rebuildFts();
  }

  deleteAlias(id: number): void {
    this.database.db.prepare("DELETE FROM aliases WHERE id = ?").run(id);
    this.rebuildFts();
  }

  findSchoolCandidates(text: string, limit = 8): Array<UniversityRow & { matchedBy: string; score: number }> {
    const schools = this.database.db
      .prepare(
        `
        SELECT u.id, u.name, u.slug, u.file_path, u.source_url, u.updated_at,
          COALESCE(group_concat(a.alias, '|'), '') AS aliases
        FROM universities u
        LEFT JOIN aliases a ON a.university_id = u.id
        GROUP BY u.id
      `
      )
      .all() as unknown as Array<UniversityRow & { aliases: string }>;

    const candidates: Array<UniversityRow & { matchedBy: string; score: number }> = [];
    const normalizedText = text.toLowerCase();

    for (const school of schools) {
      const names = [school.name, ...school.aliases.split("|").filter(Boolean), school.slug];
      let best: { matchedBy: string; score: number } | null = null;
      for (const name of names) {
        if (!name) continue;
        const normalizedName = name.toLowerCase();
        if (normalizedText.includes(normalizedName)) {
          const score = Math.min(1, 0.5 + normalizedName.length / 16);
          if (!best || score > best.score) best = { matchedBy: name, score };
        }
      }
      if (best) candidates.push({ ...school, matchedBy: best.matchedBy, score: best.score });
    }

    return candidates.sort((a, b) => b.score - a.score || b.matchedBy.length - a.matchedBy.length).slice(0, limit);
  }

  getTopicQuestions(universityId: number, topic: string | null, searchText: string, limit = 6): QuestionWithAnswers[] {
    let rows: Array<{ id: number; question: string; topic: string; position: number }>;
    if (topic && topic !== "general") {
      rows = this.database.db
        .prepare(
          `
          SELECT id, question, topic, position
          FROM questions
          WHERE university_id = ? AND topic = ?
          ORDER BY position
          LIMIT ?
        `
        )
        .all(universityId, topic, limit) as Array<{ id: number; question: string; topic: string; position: number }>;
    } else {
      rows = this.database.db
        .prepare(
          `
          SELECT id, question, topic, position
          FROM questions
          WHERE university_id = ?
          ORDER BY CASE WHEN question LIKE ? THEN 0 ELSE 1 END, position
          LIMIT ?
        `
        )
        .all(universityId, `%${searchText}%`, limit) as Array<{ id: number; question: string; topic: string; position: number }>;
    }

    const answerStmt = this.database.db.prepare(`
      SELECT source_id AS sourceId, respondent, answered_at AS answeredAt, text
      FROM answers
      WHERE question_id = ?
      ORDER BY COALESCE(answered_at, '') DESC, source_id DESC
      LIMIT 10
    `);

    return rows.map((row) => ({
      ...row,
      answers: answerStmt.all(row.id) as QuestionWithAnswers["answers"]
    }));
  }

  private seedDefaultAliases(): void {
    const find = this.database.db.prepare("SELECT id FROM universities WHERE name = ?");
    const insert = this.database.db.prepare(`
      INSERT OR IGNORE INTO aliases(alias, university_id, priority, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const [name, aliases] of Object.entries(DEFAULT_ALIASES)) {
      const row = find.get(name) as { id: number } | undefined;
      if (!row) continue;
      for (const alias of aliases) insert.run(alias, row.id, 90, now);
    }
  }

  private rebuildFts(): void {
    this.database.db.exec(`
      DROP TABLE IF EXISTS university_fts;
      CREATE VIRTUAL TABLE university_fts USING fts5(
        name,
        slug,
        aliases,
        content,
        tokenize='unicode61'
      );
    `);
    const rows = this.database.db
      .prepare(
        `
        SELECT u.id, u.name, u.slug,
          COALESCE(group_concat(DISTINCT a.alias), '') AS aliases,
          COALESCE(group_concat(DISTINCT q.question), '') || ' ' || COALESCE(group_concat(DISTINCT ans.text), '') AS content
        FROM universities u
        LEFT JOIN aliases a ON a.university_id = u.id
        LEFT JOIN questions q ON q.university_id = u.id
        LEFT JOIN answers ans ON ans.question_id = q.id
        GROUP BY u.id
      `
      )
      .all() as Array<{ id: number; name: string; slug: string; aliases: string; content: string }>;
    const insert = this.database.db.prepare(
      "INSERT INTO university_fts(rowid, name, slug, aliases, content) VALUES (?, ?, ?, ?, ?)"
    );
    for (const row of rows) {
      insert.run(row.id, row.name, row.slug, row.aliases, row.content.slice(0, 12000));
    }
  }
}
