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

      CREATE TABLE IF NOT EXISTS school_reviews (
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_school_id TEXT NOT NULL,
        source_review_id TEXT NOT NULL,
        source_url TEXT,
        author_label TEXT,
        campus_name TEXT,
        is_verified INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        rating_json TEXT,
        like_count INTEGER NOT NULL DEFAULT 0,
        reply_count INTEGER NOT NULL DEFAULT 0,
        reviewed_at TEXT,
        payload_json TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        PRIMARY KEY (source, source_review_id)
      );

      CREATE TABLE IF NOT EXISTS answer_sources (
        token TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        university_id INTEGER,
        university_name TEXT,
        topic TEXT,
        source_url TEXT,
        context_text TEXT NOT NULL,
        school_profile_text TEXT,
        srgaoxiao_reviews_text TEXT,
        answer_text TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admission_school_mappings (
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_school_id TEXT NOT NULL,
        source_school_name TEXT NOT NULL,
        matched_name TEXT,
        match_status TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0,
        source_url TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (university_id, source)
      );

      CREATE TABLE IF NOT EXISTS admission_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unique_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        source_school_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        province_id TEXT,
        province_name TEXT NOT NULL,
        subject_type_id TEXT,
        subject_type TEXT,
        batch TEXT,
        plan_group TEXT,
        major_name TEXT,
        plan_count INTEGER,
        school_plan_count INTEGER,
        major_count INTEGER,
        tuition TEXT,
        duration TEXT,
        campus TEXT,
        selection_requirements TEXT,
        source_url TEXT,
        source_record_id TEXT,
        raw_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admission_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unique_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        score_type TEXT NOT NULL,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        source_school_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        province_id TEXT,
        province_name TEXT NOT NULL,
        subject_type_id TEXT,
        subject_type TEXT,
        batch TEXT,
        plan_group TEXT,
        major_name TEXT,
        min_score REAL,
        min_rank INTEGER,
        avg_score REAL,
        avg_rank INTEGER,
        max_score REAL,
        plan_count INTEGER,
        control_score REAL,
        diff_score REAL,
        selection_requirements TEXT,
        source_url TEXT,
        source_record_id TEXT,
        raw_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admission_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        university_id INTEGER,
        source_school_id TEXT,
        source_url TEXT NOT NULL,
        request_json TEXT NOT NULL,
        response_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admission_sync_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        target_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_questions_university_topic ON questions(university_id, topic);
      CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
      CREATE INDEX IF NOT EXISTS idx_message_logs_created ON message_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_llm_logs_created ON llm_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_school_profiles_source ON school_profiles(source);
      CREATE INDEX IF NOT EXISTS idx_school_reviews_university_source ON school_reviews(university_id, source);
      CREATE INDEX IF NOT EXISTS idx_school_reviews_school_source ON school_reviews(source_school_id, source);
      CREATE INDEX IF NOT EXISTS idx_answer_sources_created ON answer_sources(created_at);
      CREATE INDEX IF NOT EXISTS idx_admission_mappings_source_school ON admission_school_mappings(source, source_school_id);
      CREATE INDEX IF NOT EXISTS idx_admission_plans_lookup ON admission_plans(university_id, year, province_name, subject_type);
      CREATE INDEX IF NOT EXISTS idx_admission_scores_lookup ON admission_scores(university_id, year, province_name, subject_type, score_type);
      CREATE INDEX IF NOT EXISTS idx_admission_sources_lookup ON admission_sources(source, source_school_id, fetched_at);
      CREATE INDEX IF NOT EXISTS idx_admission_sync_jobs_started ON admission_sync_jobs(started_at);
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
