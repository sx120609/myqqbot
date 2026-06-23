import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqlValue = string | number | bigint | null | Buffer;

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS universities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        file_path TEXT NOT NULL,
        source_url TEXT NOT NULL,
        raw_markdown TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        topic TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        respondent TEXT,
        answered_at TEXT,
        text TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alias TEXT NOT NULL UNIQUE,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 50,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL,
        platform TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        user_id TEXT,
        group_id TEXT,
        text TEXT NOT NULL,
        response_text TEXT,
        handled INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS llm_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purpose TEXT NOT NULL,
        model TEXT NOT NULL,
        request_json TEXT NOT NULL,
        response_text TEXT,
        error TEXT,
        latency_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        commit_sha TEXT,
        total_files INTEGER NOT NULL DEFAULT 0,
        total_universities INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS school_profiles (
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_school_id TEXT,
        source_url TEXT,
        payload_json TEXT NOT NULL,
        profile_text TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (university_id, source)
      );

      CREATE INDEX IF NOT EXISTS idx_questions_university_topic ON questions(university_id, topic);
      CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
      CREATE INDEX IF NOT EXISTS idx_message_logs_created ON message_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_llm_logs_created ON llm_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_school_profiles_source ON school_profiles(source);
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS university_fts USING fts5(
        name,
        slug,
        aliases,
        content,
        content='',
        tokenize='unicode61'
      );
    `);
  }
}
