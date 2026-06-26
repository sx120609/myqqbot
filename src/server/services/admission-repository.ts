import type { AppDatabase, SqlValue } from "../db.js";
import { defaultAdmissionPlanYears, defaultAdmissionScoreYears } from "./admission-calendar.js";
import { defaultAdmissionSubjectTypeNamesForProvinceYear, gaokaoProvinceNames } from "./admission-regions.js";

export const ADMISSION_SOURCE = "gaokao_cn";

export interface AdmissionSchoolMapping {
  universityId: number;
  universityName?: string;
  source: string;
  sourceSchoolId: string;
  sourceSchoolName: string;
  matchedName: string | null;
  matchStatus: "matched" | "manual" | "unmatched" | "ambiguous";
  confidence: number;
  sourceUrl: string | null;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionPlanInput {
  source?: string;
  universityId: number;
  sourceSchoolId: string;
  year: number;
  provinceId?: string | null;
  provinceName: string;
  subjectTypeId?: string | null;
  subjectType?: string | null;
  batch?: string | null;
  planGroup?: string | null;
  majorName?: string | null;
  planCount?: number | null;
  schoolPlanCount?: number | null;
  majorCount?: number | null;
  tuition?: string | null;
  duration?: string | null;
  campus?: string | null;
  selectionRequirements?: string | null;
  sourceUrl?: string | null;
  sourceRecordId?: string | null;
  rawJson: string;
  fetchedAt?: string;
}

export interface AdmissionScoreInput {
  source?: string;
  scoreType: "school" | "major";
  universityId: number;
  sourceSchoolId: string;
  year: number;
  provinceId?: string | null;
  provinceName: string;
  subjectTypeId?: string | null;
  subjectType?: string | null;
  batch?: string | null;
  planGroup?: string | null;
  majorName?: string | null;
  minScore?: number | null;
  minRank?: number | null;
  avgScore?: number | null;
  avgRank?: number | null;
  maxScore?: number | null;
  planCount?: number | null;
  controlScore?: number | null;
  diffScore?: number | null;
  selectionRequirements?: string | null;
  sourceUrl?: string | null;
  sourceRecordId?: string | null;
  rawJson: string;
  fetchedAt?: string;
}

export interface AdmissionSourceInput {
  source?: string;
  sourceKind: string;
  universityId?: number | null;
  sourceSchoolId?: string | null;
  sourceUrl: string;
  requestJson: string;
  responseJson?: string | null;
  status: "success" | "error";
  error?: string | null;
  fetchedAt?: string;
}

export interface AdmissionSourceRow {
  id: number;
  source: string;
  sourceKind: string;
  universityId: number | null;
  universityName: string | null;
  sourceSchoolId: string | null;
  sourceUrl: string;
  requestJson: string;
  responseJson: string | null;
  status: string;
  error: string | null;
  fetchedAt: string;
}

export interface AdmissionSourceQuery {
  universityId?: number;
  sourceKind?: string | null;
  status?: string | null;
  limit?: number;
}

export interface AdmissionSyncJobInput {
  source?: string;
  jobType: string;
  targetJson: string;
}

export interface AdmissionSyncJobQuery {
  jobType?: string | null;
  status?: string | null;
  limit?: number;
}

export interface AdmissionSyncJobRow {
  id: number;
  source: string;
  jobType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  targetJson: string;
  resultJson: string | null;
  error: string | null;
}

export interface AdmissionQuery {
  universityId?: number;
  provinceName?: string | null;
  subjectType?: string | null;
  subjectTypes?: string[] | null;
  years?: number[];
  batch?: string | null;
  planGroup?: string | null;
  scoreType?: "school" | "major" | null;
  majorName?: string | null;
  limit?: number;
}

export interface AdmissionCoverageCheck {
  source?: string;
  universityId: number;
  sourceSchoolId?: string | null;
  year: number;
  provinceName: string;
  subjectType?: string | null;
}

export interface AdmissionPlanCoverageCheck extends AdmissionCoverageCheck {
  majorOnly?: boolean;
}

export interface AdmissionScoreCoverageCheck extends AdmissionCoverageCheck {
  scoreType: "school" | "major";
}

export interface AdmissionSourceCoverageCheck {
  source?: string;
  sourceKind: string;
  universityId: number;
  sourceSchoolId?: string | null;
  request: Record<string, unknown>;
}

export interface AdmissionScoreRow {
  id: number;
  scoreType: "school" | "major";
  universityId: number;
  universityName: string;
  sourceSchoolId: string;
  year: number;
  provinceName: string;
  subjectType: string | null;
  batch: string | null;
  planGroup: string | null;
  majorName: string | null;
  minScore: number | null;
  minRank: number | null;
  avgScore: number | null;
  avgRank: number | null;
  maxScore: number | null;
  planCount: number | null;
  controlScore: number | null;
  diffScore: number | null;
  selectionRequirements: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  rawJson: string;
  fetchedAt: string;
}

export interface AdmissionPlanRow {
  id: number;
  universityId: number;
  universityName: string;
  sourceSchoolId: string;
  year: number;
  provinceName: string;
  subjectType: string | null;
  batch: string | null;
  planGroup: string | null;
  majorName: string | null;
  planCount: number | null;
  schoolPlanCount: number | null;
  majorCount: number | null;
  tuition: string | null;
  duration: string | null;
  campus: string | null;
  selectionRequirements: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  rawJson: string;
  fetchedAt: string;
}

export interface AdmissionCoverageYear {
  year: number;
  rowCount: number;
  universityCount: number;
  provinceCount: number;
}

export interface AdmissionCoverageStats {
  totalUniversities: number;
  attemptedUniversities: number;
  mappedUniversities: number;
  unmappedUniversities: number;
  pendingUniversities: number;
  unmatchedUniversities: number;
  ambiguousUniversities: number;
  mappingIssueUniversities: number;
  planUniversities: number;
  scoreUniversities: number;
  planRows: number;
  scoreRows: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
  failedJobs: number;
  latestPlanFetchedAt: string | null;
  latestScoreFetchedAt: string | null;
  latestSourceFetchedAt: string | null;
  planYears: AdmissionCoverageYear[];
  scoreYears: AdmissionCoverageYear[];
}

export type AdmissionCoverageGapKind = "plan" | "school_score" | "major_score";

export interface AdmissionCoverageGap {
  kind: AdmissionCoverageGapKind;
  year: number;
  provinceName: string;
  subjectType: string | null;
  totalMappedUniversities: number;
  coveredUniversities: number;
  missingUniversities: number;
  rowCount: number;
  coverageRatio: number;
}

export interface AdmissionCoverageMissingUniversity {
  universityId: number;
  universityName: string;
  sourceSchoolId: string;
  sourceSchoolName: string;
  matchStatus: AdmissionSchoolMapping["matchStatus"];
  updatedAt: string;
}

export interface AdmissionCoverageGapQuery {
  planYears?: number[];
  scoreYears?: number[];
  provinces?: string[];
  subjectTypes?: string[];
  limit?: number;
  source?: string;
}

export interface AdmissionUnmappedUniversity {
  id: number;
  name: string;
  slug: string;
  updatedAt: string;
}

export interface AdmissionMappingIssue {
  universityId: number;
  universityName: string;
  slug: string;
  matchStatus: "unmatched" | "ambiguous";
  sourceSchoolId: string;
  sourceSchoolName: string;
  payloadJson: string;
  updatedAt: string;
}

const NORMALIZATION_VERSION = "2026-06-26-v5";

export class AdmissionRepository {
  constructor(private readonly database: AppDatabase) {
    this.normalizeStoredRowsOnce();
  }

  upsertMapping(input: {
    universityId: number;
    sourceSchoolId: string;
    sourceSchoolName: string;
    matchedName?: string | null;
    matchStatus?: AdmissionSchoolMapping["matchStatus"];
    confidence?: number;
    sourceUrl?: string | null;
    payloadJson: string;
    source?: string;
  }): void {
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        `
        INSERT INTO admission_school_mappings(
          university_id, source, source_school_id, source_school_name, matched_name,
          match_status, confidence, source_url, payload_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(university_id, source) DO UPDATE SET
          source_school_id = excluded.source_school_id,
          source_school_name = excluded.source_school_name,
          matched_name = excluded.matched_name,
          match_status = excluded.match_status,
          confidence = excluded.confidence,
          source_url = excluded.source_url,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `
      )
      .run(
        input.universityId,
        input.source ?? ADMISSION_SOURCE,
        input.sourceSchoolId,
        input.sourceSchoolName,
        input.matchedName ?? null,
        input.matchStatus ?? "matched",
        input.confidence ?? 1,
        input.sourceUrl ?? null,
        input.payloadJson,
        now,
        now
      );
  }

  getMapping(universityId: number, source = ADMISSION_SOURCE): AdmissionSchoolMapping | null {
    const row = this.database.db
      .prepare(
        `
        SELECT m.university_id AS universityId, u.name AS universityName, m.source,
          m.source_school_id AS sourceSchoolId, m.source_school_name AS sourceSchoolName,
          m.matched_name AS matchedName, m.match_status AS matchStatus, m.confidence,
          m.source_url AS sourceUrl, m.payload_json AS payloadJson,
          m.created_at AS createdAt, m.updated_at AS updatedAt
        FROM admission_school_mappings m
        JOIN universities u ON u.id = m.university_id
        WHERE m.university_id = ? AND m.source = ?
      `
      )
      .get(universityId, source) as AdmissionSchoolMapping | undefined;
    return row ?? null;
  }

  listMappings(query = "", limit = 80): AdmissionSchoolMapping[] {
    const pattern = `%${query.trim()}%`;
    const params = query.trim() ? [pattern, pattern, pattern, limit] : [limit];
    const where = query.trim()
      ? "WHERE u.name LIKE ? OR m.source_school_name LIKE ? OR m.source_school_id LIKE ?"
      : "";
    return this.database.db
      .prepare(
        `
        SELECT m.university_id AS universityId, u.name AS universityName, m.source,
          m.source_school_id AS sourceSchoolId, m.source_school_name AS sourceSchoolName,
          m.matched_name AS matchedName, m.match_status AS matchStatus, m.confidence,
          m.source_url AS sourceUrl, m.payload_json AS payloadJson,
          m.created_at AS createdAt, m.updated_at AS updatedAt
        FROM admission_school_mappings m
        JOIN universities u ON u.id = m.university_id
        ${where}
        ORDER BY m.updated_at DESC, u.name
        LIMIT ?
      `
      )
      .all(...params) as unknown as AdmissionSchoolMapping[];
  }

  countMappings(source = ADMISSION_SOURCE): number {
    const row = this.database.db
      .prepare("SELECT COUNT(*) AS count FROM admission_school_mappings WHERE source = ? AND match_status IN ('matched', 'manual')")
      .get(source) as { count: number };
    return row.count;
  }

  hasPlanCoverage(input: AdmissionPlanCoverageCheck): boolean {
    const where = [
      "source = ?",
      "university_id = ?",
      "year = ?",
      "province_name = ?"
    ];
    const params: SqlValue[] = [
      input.source ?? ADMISSION_SOURCE,
      input.universityId,
      input.year,
      normalizeProvinceName(input.provinceName)
    ];
    if (input.sourceSchoolId) {
      where.push("source_school_id = ?");
      params.push(input.sourceSchoolId);
    }
    const subjectType = normalizeSubjectType(input.subjectType);
    if (subjectType) {
      where.push("subject_type = ?");
      params.push(subjectType);
    }
    if (input.majorOnly) {
      where.push("major_name IS NOT NULL AND major_name <> ''");
    }
    return this.hasRows("admission_plans", where, params);
  }

  hasScoreCoverage(input: AdmissionScoreCoverageCheck): boolean {
    const where = [
      "source = ?",
      "score_type = ?",
      "university_id = ?",
      "year = ?",
      "province_name = ?"
    ];
    const params: SqlValue[] = [
      input.source ?? ADMISSION_SOURCE,
      input.scoreType,
      input.universityId,
      input.year,
      normalizeProvinceName(input.provinceName)
    ];
    if (input.sourceSchoolId) {
      where.push("source_school_id = ?");
      params.push(input.sourceSchoolId);
    }
    const subjectType = normalizeSubjectType(input.subjectType);
    if (subjectType) {
      where.push("subject_type = ?");
      params.push(subjectType);
    }
    return this.hasRows("admission_scores", where, params);
  }

  hasSourceCoverage(input: AdmissionSourceCoverageCheck): boolean {
    const where = [
      "source = ?",
      "source_kind = ?",
      "university_id = ?",
      "status = 'success'"
    ];
    const params: SqlValue[] = [
      input.source ?? ADMISSION_SOURCE,
      input.sourceKind,
      input.universityId
    ];
    if (input.sourceSchoolId) {
      where.push("source_school_id = ?");
      params.push(input.sourceSchoolId);
    }
    const rows = this.database.db
      .prepare(
        `
        SELECT request_json AS requestJson, response_json AS responseJson
        FROM admission_sources
        WHERE ${where.join(" AND ")}
        ORDER BY fetched_at DESC, id DESC
        LIMIT 80
      `
      )
      .all(...params) as Array<{ requestJson: string; responseJson: string | null }>;
    return hasCompleteSourceCoverage(rows, input.request);
  }

  coverageStats(source = ADMISSION_SOURCE): AdmissionCoverageStats {
    const scalar = (sql: string, params: SqlValue[] = []): number => {
      const row = this.database.db.prepare(sql).get(...params) as { count: number } | undefined;
      return Number(row?.count ?? 0);
    };
    const latest = (sql: string, params: SqlValue[] = []): string | null => {
      const row = this.database.db.prepare(sql).get(...params) as { value: string | null } | undefined;
      return row?.value ?? null;
    };

    const totalUniversities = scalar("SELECT COUNT(*) AS count FROM universities");
    const attemptedUniversities = scalar("SELECT COUNT(*) AS count FROM admission_school_mappings WHERE source = ?", [source]);
    const mappedUniversities = scalar(
      "SELECT COUNT(*) AS count FROM admission_school_mappings WHERE source = ? AND match_status IN ('matched', 'manual')",
      [source]
    );
    const unmatchedUniversities = scalar("SELECT COUNT(*) AS count FROM admission_school_mappings WHERE source = ? AND match_status = 'unmatched'", [source]);
    const ambiguousUniversities = scalar("SELECT COUNT(*) AS count FROM admission_school_mappings WHERE source = ? AND match_status = 'ambiguous'", [source]);
    return {
      totalUniversities,
      attemptedUniversities,
      mappedUniversities,
      unmappedUniversities: Math.max(0, totalUniversities - mappedUniversities),
      pendingUniversities: Math.max(0, totalUniversities - attemptedUniversities),
      unmatchedUniversities,
      ambiguousUniversities,
      mappingIssueUniversities: unmatchedUniversities + ambiguousUniversities,
      planUniversities: scalar("SELECT COUNT(DISTINCT university_id) AS count FROM admission_plans WHERE source = ?", [source]),
      scoreUniversities: scalar("SELECT COUNT(DISTINCT university_id) AS count FROM admission_scores WHERE source = ?", [source]),
      planRows: scalar("SELECT COUNT(*) AS count FROM admission_plans WHERE source = ?", [source]),
      scoreRows: scalar("SELECT COUNT(*) AS count FROM admission_scores WHERE source = ?", [source]),
      schoolScoreRows: scalar("SELECT COUNT(*) AS count FROM admission_scores WHERE source = ? AND score_type = 'school'", [source]),
      majorScoreRows: scalar("SELECT COUNT(*) AS count FROM admission_scores WHERE source = ? AND score_type = 'major'", [source]),
      sourceRows: scalar("SELECT COUNT(*) AS count FROM admission_sources WHERE source = ?", [source]),
      failedJobs: scalar("SELECT COUNT(*) AS count FROM admission_sync_jobs WHERE source = ? AND status = 'error'", [source]),
      latestPlanFetchedAt: latest("SELECT MAX(fetched_at) AS value FROM admission_plans WHERE source = ?", [source]),
      latestScoreFetchedAt: latest("SELECT MAX(fetched_at) AS value FROM admission_scores WHERE source = ?", [source]),
      latestSourceFetchedAt: latest("SELECT MAX(fetched_at) AS value FROM admission_sources WHERE source = ?", [source]),
      planYears: this.coverageYears("admission_plans", source),
      scoreYears: this.coverageYears("admission_scores", source)
    };
  }

  coverageGaps(query: AdmissionCoverageGapQuery = {}): AdmissionCoverageGap[] {
    const source = query.source ?? ADMISSION_SOURCE;
    const totalMappedUniversities = this.countMappings(source);
    const provinces = normalizeCoverageGapProvinces(query.provinces);
    const planYears = normalizeCoverageGapYears(query.planYears, defaultAdmissionPlanYears());
    const scoreYears = normalizeCoverageGapYears(query.scoreYears, defaultAdmissionScoreYears());
    const explicitSubjectTypes = normalizeCoverageGapSubjectTypes(query.subjectTypes);
    const gaps: AdmissionCoverageGap[] = [];

    for (const year of planYears) {
      for (const provinceName of provinces) {
        for (const subjectType of coverageSubjectTypesForProvinceYear(provinceName, year, explicitSubjectTypes)) {
          gaps.push(this.coverageGapFor({
            kind: "plan",
            source,
            totalMappedUniversities,
            table: "admission_plans",
            year,
            provinceName,
            subjectType
          }));
        }
      }
    }
    for (const year of scoreYears) {
      for (const provinceName of provinces) {
        for (const subjectType of coverageSubjectTypesForProvinceYear(provinceName, year, explicitSubjectTypes)) {
          gaps.push(this.coverageGapFor({
            kind: "school_score",
            source,
            totalMappedUniversities,
            table: "admission_scores",
            scoreType: "school",
            year,
            provinceName,
            subjectType
          }));
          gaps.push(this.coverageGapFor({
            kind: "major_score",
            source,
            totalMappedUniversities,
            table: "admission_scores",
            scoreType: "major",
            year,
            provinceName,
            subjectType
          }));
        }
      }
    }

    return gaps
      .sort((left, right) =>
        right.missingUniversities - left.missingUniversities ||
        left.coverageRatio - right.coverageRatio ||
        right.year - left.year ||
        left.provinceName.localeCompare(right.provinceName) ||
        String(left.subjectType ?? "").localeCompare(String(right.subjectType ?? ""))
      )
      .slice(0, clampLimit(query.limit ?? 24));
  }

  coverageMissingUniversities(input: {
    kind: AdmissionCoverageGapKind;
    year: number;
    provinceName: string;
    subjectType?: string | null;
    source?: string;
    limit?: number;
  }): AdmissionCoverageMissingUniversity[] {
    const source = input.source ?? ADMISSION_SOURCE;
    const provinceName = normalizeProvinceName(input.provinceName);
    const table = input.kind === "plan" ? "admission_plans" : "admission_scores";
    const scoreType = input.kind === "school_score" ? "school" : input.kind === "major_score" ? "major" : null;
    const coverageWhere = [
      `${table}.source = m.source`,
      `${table}.university_id = m.university_id`,
      `${table}.source_school_id = m.source_school_id`,
      `${table}.year = ?`,
      `${table}.province_name = ?`
    ];
    const coverageParams: SqlValue[] = [input.year, provinceName];
    const subjectType = normalizeSubjectType(input.subjectType);
    if (subjectType) {
      coverageWhere.push(`${table}.subject_type = ?`);
      coverageParams.push(subjectType);
    }
    if (scoreType) {
      coverageWhere.push(`${table}.score_type = ?`);
      coverageParams.push(scoreType);
    }
    return this.database.db
      .prepare(
        `
        SELECT m.university_id AS universityId, u.name AS universityName,
          m.source_school_id AS sourceSchoolId, m.source_school_name AS sourceSchoolName,
          m.match_status AS matchStatus, m.updated_at AS updatedAt
        FROM admission_school_mappings m
        JOIN universities u ON u.id = m.university_id
        WHERE m.source = ?
          AND m.match_status IN ('matched', 'manual')
          AND NOT EXISTS (
            SELECT 1 FROM ${table}
            WHERE ${coverageWhere.join(" AND ")}
          )
        ORDER BY u.name
        LIMIT ?
      `
      )
      .all(source, ...coverageParams, clampLimit(input.limit ?? 80)) as unknown as AdmissionCoverageMissingUniversity[];
  }

  listUnmappedUniversities(query = "", limit = 50): AdmissionUnmappedUniversity[] {
    const trimmed = query.trim();
    const pattern = `%${trimmed}%`;
    const where = trimmed
      ? "AND (u.name LIKE ? OR u.slug LIKE ? OR a.alias LIKE ?)"
      : "";
    const params = trimmed ? [ADMISSION_SOURCE, pattern, pattern, pattern, limit] : [ADMISSION_SOURCE, limit];
    return this.database.db
      .prepare(
        `
        SELECT DISTINCT u.id, u.name, u.slug, u.updated_at AS updatedAt
        FROM universities u
        LEFT JOIN aliases a ON a.university_id = u.id
        LEFT JOIN admission_school_mappings m ON m.university_id = u.id AND m.source = ?
        WHERE m.university_id IS NULL
        ${where}
        ORDER BY u.name
        LIMIT ?
      `
      )
      .all(...params) as unknown as AdmissionUnmappedUniversity[];
  }

  listMappingIssues(query = "", limit = 50): AdmissionMappingIssue[] {
    const trimmed = query.trim();
    const pattern = `%${trimmed}%`;
    const where = trimmed
      ? "AND (u.name LIKE ? OR u.slug LIKE ? OR a.alias LIKE ? OR m.source_school_name LIKE ?)"
      : "";
    const params = trimmed
      ? [ADMISSION_SOURCE, pattern, pattern, pattern, pattern, limit]
      : [ADMISSION_SOURCE, limit];
    return this.database.db
      .prepare(
        `
        SELECT m.university_id AS universityId, u.name AS universityName, u.slug,
          m.match_status AS matchStatus, m.source_school_id AS sourceSchoolId,
          m.source_school_name AS sourceSchoolName, m.payload_json AS payloadJson,
          m.updated_at AS updatedAt
        FROM admission_school_mappings m
        JOIN universities u ON u.id = m.university_id
        LEFT JOIN aliases a ON a.university_id = u.id
        WHERE m.source = ? AND m.match_status IN ('unmatched', 'ambiguous')
        ${where}
        GROUP BY m.university_id
        ORDER BY m.updated_at DESC, u.name
        LIMIT ?
      `
      )
      .all(...params) as unknown as AdmissionMappingIssue[];
  }

  upsertPlan(input: AdmissionPlanInput): void {
    const fetchedAt = input.fetchedAt ?? new Date().toISOString();
    const source = input.source ?? ADMISSION_SOURCE;
    const provinceName = normalizeProvinceName(input.provinceName);
    const subjectType = normalizeSubjectType(input.subjectType);
    const batch = normalizeBatchName(input.batch);
    const planGroup = normalizePlanGroup(input.planGroup);
    const majorName = normalizeMajorName(input.majorName);
    const uniqueKey = makeUniqueKey([
      "plan",
      source,
      input.sourceSchoolId,
      input.year,
      provinceName,
      subjectType,
      batch,
      majorName,
      planGroup
    ]);

    this.database.db
      .prepare(
        `
        INSERT INTO admission_plans(
          unique_key, source, university_id, source_school_id, year, province_id, province_name,
          subject_type_id, subject_type, batch, plan_group, major_name, plan_count,
          school_plan_count, major_count, tuition, duration, campus, selection_requirements,
          source_url, source_record_id, raw_json, fetched_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(unique_key) DO UPDATE SET
          university_id = excluded.university_id,
          province_id = excluded.province_id,
          province_name = excluded.province_name,
          subject_type_id = excluded.subject_type_id,
          subject_type = excluded.subject_type,
          batch = excluded.batch,
          plan_group = excluded.plan_group,
          major_name = excluded.major_name,
          plan_count = excluded.plan_count,
          school_plan_count = excluded.school_plan_count,
          major_count = excluded.major_count,
          tuition = excluded.tuition,
          duration = excluded.duration,
          campus = excluded.campus,
          selection_requirements = excluded.selection_requirements,
          source_url = excluded.source_url,
          source_record_id = excluded.source_record_id,
          raw_json = excluded.raw_json,
          fetched_at = excluded.fetched_at
      `
      )
      .run(
        uniqueKey,
        source,
        input.universityId,
        input.sourceSchoolId,
        input.year,
        input.provinceId ?? null,
        provinceName,
        input.subjectTypeId ?? null,
        subjectType,
        batch,
        planGroup,
        majorName,
        input.planCount ?? null,
        input.schoolPlanCount ?? null,
        input.majorCount ?? null,
        clean(input.tuition),
        clean(input.duration),
        clean(input.campus),
        clean(input.selectionRequirements),
        input.sourceUrl ?? null,
        input.sourceRecordId ?? null,
        input.rawJson,
        fetchedAt
      );
  }

  upsertScore(input: AdmissionScoreInput): void {
    const fetchedAt = input.fetchedAt ?? new Date().toISOString();
    const source = input.source ?? ADMISSION_SOURCE;
    const provinceName = normalizeProvinceName(input.provinceName);
    const subjectType = normalizeSubjectType(input.subjectType);
    const batch = normalizeBatchName(input.batch);
    const planGroup = normalizePlanGroup(input.planGroup);
    const majorName = normalizeMajorName(input.majorName);
    const uniqueKey = makeUniqueKey([
      "score",
      input.scoreType,
      source,
      input.sourceSchoolId,
      input.year,
      provinceName,
      subjectType,
      batch,
      majorName,
      planGroup
    ]);

    this.database.db
      .prepare(
        `
        INSERT INTO admission_scores(
          unique_key, source, score_type, university_id, source_school_id, year,
          province_id, province_name, subject_type_id, subject_type, batch, plan_group,
          major_name, min_score, min_rank, avg_score, avg_rank, max_score, plan_count,
          control_score, diff_score, selection_requirements, source_url, source_record_id,
          raw_json, fetched_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(unique_key) DO UPDATE SET
          university_id = excluded.university_id,
          province_id = excluded.province_id,
          province_name = excluded.province_name,
          subject_type_id = excluded.subject_type_id,
          subject_type = excluded.subject_type,
          batch = excluded.batch,
          plan_group = excluded.plan_group,
          major_name = excluded.major_name,
          min_score = excluded.min_score,
          min_rank = excluded.min_rank,
          avg_score = excluded.avg_score,
          avg_rank = excluded.avg_rank,
          max_score = excluded.max_score,
          plan_count = excluded.plan_count,
          control_score = excluded.control_score,
          diff_score = excluded.diff_score,
          selection_requirements = excluded.selection_requirements,
          source_url = excluded.source_url,
          source_record_id = excluded.source_record_id,
          raw_json = excluded.raw_json,
          fetched_at = excluded.fetched_at
      `
      )
      .run(
        uniqueKey,
        source,
        input.scoreType,
        input.universityId,
        input.sourceSchoolId,
        input.year,
        input.provinceId ?? null,
        provinceName,
        input.subjectTypeId ?? null,
        subjectType,
        batch,
        planGroup,
        majorName,
        input.minScore ?? null,
        input.minRank ?? null,
        input.avgScore ?? null,
        input.avgRank ?? null,
        input.maxScore ?? null,
        input.planCount ?? null,
        input.controlScore ?? null,
        input.diffScore ?? null,
        clean(input.selectionRequirements),
        input.sourceUrl ?? null,
        input.sourceRecordId ?? null,
        input.rawJson,
        fetchedAt
      );
  }

  insertSource(input: AdmissionSourceInput): number {
    const result = this.database.db
      .prepare(
        `
        INSERT INTO admission_sources(
          source, source_kind, university_id, source_school_id, source_url,
          request_json, response_json, status, error, fetched_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.source ?? ADMISSION_SOURCE,
        input.sourceKind,
        input.universityId ?? null,
        input.sourceSchoolId ?? null,
        input.sourceUrl,
        input.requestJson,
        input.responseJson ?? null,
        input.status,
        input.error ?? null,
        input.fetchedAt ?? new Date().toISOString()
      );
    return Number(result.lastInsertRowid);
  }

  getSource(id: number): AdmissionSourceRow | null {
    return (
      (this.database.db
        .prepare(
          `
          SELECT s.id, s.source, s.source_kind AS sourceKind,
            s.university_id AS universityId, u.name AS universityName,
            s.source_school_id AS sourceSchoolId, s.source_url AS sourceUrl,
            s.request_json AS requestJson, s.response_json AS responseJson,
            s.status, s.error, s.fetched_at AS fetchedAt
          FROM admission_sources s
          LEFT JOIN universities u ON u.id = s.university_id
          WHERE s.id = ?
        `
        )
        .get(id) as AdmissionSourceRow | undefined) ?? null
    );
  }

  listSources(query: AdmissionSourceQuery = {}): AdmissionSourceRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.universityId) {
      where.push("s.university_id = ?");
      params.push(query.universityId);
    }
    if (query.sourceKind) {
      where.push("s.source_kind = ?");
      params.push(query.sourceKind);
    }
    if (query.status) {
      where.push("s.status = ?");
      params.push(query.status);
    }
    return this.database.db
      .prepare(
        `
        SELECT s.id, s.source, s.source_kind AS sourceKind,
          s.university_id AS universityId, u.name AS universityName,
          s.source_school_id AS sourceSchoolId, s.source_url AS sourceUrl,
          s.request_json AS requestJson, s.response_json AS responseJson,
          s.status, s.error, s.fetched_at AS fetchedAt
        FROM admission_sources s
        LEFT JOIN universities u ON u.id = s.university_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY s.id DESC
        LIMIT ?
      `
      )
      .all(...params, clampLimit(query.limit)) as unknown as AdmissionSourceRow[];
  }

  startJob(input: AdmissionSyncJobInput): number {
    const result = this.database.db
      .prepare(
        `
        INSERT INTO admission_sync_jobs(source, job_type, status, started_at, target_json)
        VALUES (?, ?, 'running', ?, ?)
      `
      )
      .run(input.source ?? ADMISSION_SOURCE, input.jobType, new Date().toISOString(), input.targetJson);
    return Number(result.lastInsertRowid);
  }

  finishJob(id: number, input: { status: "success" | "error"; resultJson?: string | null; error?: string | null }): void {
    this.database.db
      .prepare(
        `
        UPDATE admission_sync_jobs
        SET status = ?, finished_at = ?, result_json = ?, error = ?
        WHERE id = ?
      `
      )
      .run(input.status, new Date().toISOString(), input.resultJson ?? null, input.error ?? null, id);
  }

  recentJobs(query: number | AdmissionSyncJobQuery = 30): AdmissionSyncJobRow[] {
    const input = typeof query === "number" ? { limit: query } : query;
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (input.jobType) {
      where.push("job_type = ?");
      params.push(input.jobType);
    }
    if (input.status) {
      where.push("status = ?");
      params.push(input.status);
    }
    return this.database.db
      .prepare(
        `
        SELECT id, source, job_type AS jobType, status, started_at AS startedAt,
          finished_at AS finishedAt, target_json AS targetJson, result_json AS resultJson, error
        FROM admission_sync_jobs
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY id DESC
        LIMIT ?
      `
      )
      .all(...params, clampLimit(input.limit)) as unknown as AdmissionSyncJobRow[];
  }

  recentFailedJobs(limit = 10): AdmissionSyncJobRow[] {
    return this.recentJobs({ status: "error", limit });
  }

  queryScores(query: AdmissionQuery): AdmissionScoreRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    appendCommonWhere(where, params, query, "s");
    const sql = `
      SELECT s.id, s.score_type AS scoreType, s.university_id AS universityId, u.name AS universityName,
        s.source_school_id AS sourceSchoolId, s.year, s.province_name AS provinceName,
        s.subject_type AS subjectType, s.batch, s.plan_group AS planGroup, s.major_name AS majorName,
        s.min_score AS minScore, s.min_rank AS minRank, s.avg_score AS avgScore, s.avg_rank AS avgRank,
        s.max_score AS maxScore, s.plan_count AS planCount, s.control_score AS controlScore,
        s.diff_score AS diffScore, s.selection_requirements AS selectionRequirements,
        s.source_url AS sourceUrl, s.source_record_id AS sourceRecordId, s.raw_json AS rawJson,
        s.fetched_at AS fetchedAt
      FROM admission_scores s
      JOIN universities u ON u.id = s.university_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY s.year DESC,
        CASE WHEN s.score_type = 'school' THEN 0 ELSE 1 END,
        s.subject_type,
        s.batch,
        CASE WHEN s.min_rank IS NULL THEN 1 ELSE 0 END,
        s.min_rank,
        s.min_score DESC,
        s.major_name
      LIMIT ?
    `;
    return this.database.db.prepare(sql).all(...params, clampLimit(query.limit)) as unknown as AdmissionScoreRow[];
  }

  queryPlans(query: AdmissionQuery): AdmissionPlanRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    appendCommonWhere(where, params, query, "p");
    const sql = `
      SELECT p.id, p.university_id AS universityId, u.name AS universityName,
        p.source_school_id AS sourceSchoolId, p.year, p.province_name AS provinceName,
        p.subject_type AS subjectType, p.batch, p.plan_group AS planGroup, p.major_name AS majorName,
        p.plan_count AS planCount, p.school_plan_count AS schoolPlanCount, p.major_count AS majorCount,
        p.tuition, p.duration, p.campus, p.selection_requirements AS selectionRequirements,
        p.source_url AS sourceUrl, p.source_record_id AS sourceRecordId, p.raw_json AS rawJson,
        p.fetched_at AS fetchedAt
      FROM admission_plans p
      JOIN universities u ON u.id = p.university_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.year DESC,
        p.subject_type,
        p.batch,
        CASE WHEN p.major_name IS NULL THEN 0 ELSE 1 END,
        p.major_name,
        p.plan_group
      LIMIT ?
    `;
    return this.database.db.prepare(sql).all(...params, clampLimit(query.limit)) as unknown as AdmissionPlanRow[];
  }

  private normalizeStoredRowsOnce(): void {
    const markerKey = "sync.internal.admissions.normalizationVersion";
    const marker = this.database.db.prepare("SELECT value FROM settings WHERE key = ?").get(markerKey) as
      | { value: string }
      | undefined;
    if (marker?.value === NORMALIZATION_VERSION) return;

    this.database.transaction(() => {
      this.normalizeStoredPlans();
      this.normalizeStoredScores();
      this.database.db
        .prepare(
          `
          INSERT INTO settings(key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `
        )
        .run(markerKey, NORMALIZATION_VERSION, new Date().toISOString());
    });
  }

  private normalizeStoredPlans(): void {
    const rows = this.database.db
      .prepare(
        `
        SELECT id, unique_key AS uniqueKey, source, source_school_id AS sourceSchoolId,
          year, province_name AS provinceName, subject_type AS subjectType,
          batch, plan_group AS planGroup, major_name AS majorName
        FROM admission_plans
        ORDER BY fetched_at DESC, id DESC
      `
      )
      .all() as Array<{
      id: number;
      uniqueKey: string;
      source: string;
      sourceSchoolId: string;
      year: number;
      provinceName: string;
      subjectType: string | null;
      batch: string | null;
      planGroup: string | null;
      majorName: string | null;
    }>;
    const seen = new Set<string>();
    const deleteStmt = this.database.db.prepare("DELETE FROM admission_plans WHERE id = ?");
    const updateStmt = this.database.db.prepare(
      "UPDATE admission_plans SET unique_key = ?, province_name = ?, subject_type = ?, batch = ?, plan_group = ?, major_name = ? WHERE id = ?"
    );

    for (const row of rows) {
      const provinceName = normalizeProvinceName(row.provinceName);
      const subjectType = normalizeSubjectType(row.subjectType);
      const batch = normalizeBatchName(row.batch);
      const planGroup = normalizePlanGroup(row.planGroup);
      const majorName = normalizeMajorName(row.majorName);
      const uniqueKey = makeUniqueKey([
        "plan",
        row.source,
        row.sourceSchoolId,
        row.year,
        provinceName,
        subjectType,
        batch,
        majorName,
        planGroup
      ]);
      if (seen.has(uniqueKey)) {
        deleteStmt.run(row.id);
        continue;
      }
      seen.add(uniqueKey);
      if (
        uniqueKey !== row.uniqueKey ||
        provinceName !== row.provinceName ||
        subjectType !== row.subjectType ||
        batch !== row.batch ||
        planGroup !== row.planGroup ||
        majorName !== row.majorName
      ) {
        updateStmt.run(uniqueKey, provinceName, subjectType, batch, planGroup, majorName, row.id);
      }
    }
  }

  private normalizeStoredScores(): void {
    const rows = this.database.db
      .prepare(
        `
        SELECT id, unique_key AS uniqueKey, source, score_type AS scoreType,
          source_school_id AS sourceSchoolId, year, province_name AS provinceName,
          subject_type AS subjectType, batch, plan_group AS planGroup, major_name AS majorName
        FROM admission_scores
        ORDER BY fetched_at DESC, id DESC
      `
      )
      .all() as Array<{
      id: number;
      uniqueKey: string;
      source: string;
      scoreType: "school" | "major";
      sourceSchoolId: string;
      year: number;
      provinceName: string;
      subjectType: string | null;
      batch: string | null;
      planGroup: string | null;
      majorName: string | null;
    }>;
    const seen = new Set<string>();
    const deleteStmt = this.database.db.prepare("DELETE FROM admission_scores WHERE id = ?");
    const updateStmt = this.database.db.prepare(
      "UPDATE admission_scores SET unique_key = ?, province_name = ?, subject_type = ?, batch = ?, plan_group = ?, major_name = ? WHERE id = ?"
    );

    for (const row of rows) {
      const provinceName = normalizeProvinceName(row.provinceName);
      const subjectType = normalizeSubjectType(row.subjectType);
      const batch = normalizeBatchName(row.batch);
      const planGroup = normalizePlanGroup(row.planGroup);
      const majorName = normalizeMajorName(row.majorName);
      const uniqueKey = makeUniqueKey([
        "score",
        row.scoreType,
        row.source,
        row.sourceSchoolId,
        row.year,
        provinceName,
        subjectType,
        batch,
        majorName,
        planGroup
      ]);
      if (seen.has(uniqueKey)) {
        deleteStmt.run(row.id);
        continue;
      }
      seen.add(uniqueKey);
      if (
        uniqueKey !== row.uniqueKey ||
        provinceName !== row.provinceName ||
        subjectType !== row.subjectType ||
        batch !== row.batch ||
        planGroup !== row.planGroup ||
        majorName !== row.majorName
      ) {
        updateStmt.run(uniqueKey, provinceName, subjectType, batch, planGroup, majorName, row.id);
      }
    }
  }

  private coverageYears(table: "admission_plans" | "admission_scores", source: string): AdmissionCoverageYear[] {
    return this.database.db
      .prepare(
        `
        SELECT year,
          COUNT(*) AS rowCount,
          COUNT(DISTINCT university_id) AS universityCount,
          COUNT(DISTINCT province_name) AS provinceCount
        FROM ${table}
        WHERE source = ?
        GROUP BY year
        ORDER BY year DESC
      `
      )
      .all(source) as unknown as AdmissionCoverageYear[];
  }

  private coverageGapFor(input: {
    kind: AdmissionCoverageGapKind;
    source: string;
    totalMappedUniversities: number;
    table: "admission_plans" | "admission_scores";
    scoreType?: "school" | "major";
    year: number;
    provinceName: string;
    subjectType?: string | null;
  }): AdmissionCoverageGap {
    const provinceName = normalizeProvinceName(input.provinceName);
    const where = ["source = ?", "year = ?", "province_name = ?"];
    const params: SqlValue[] = [input.source, input.year, provinceName];
    const subjectType = normalizeSubjectType(input.subjectType);
    if (subjectType) {
      where.push("subject_type = ?");
      params.push(subjectType);
    }
    if (input.scoreType) {
      where.push("score_type = ?");
      params.push(input.scoreType);
    }
    const row = this.database.db
      .prepare(`
        SELECT COUNT(*) AS rowCount,
          COUNT(DISTINCT university_id) AS coveredUniversities
        FROM ${input.table}
        WHERE ${where.join(" AND ")}
      `)
      .get(...params) as { rowCount: number; coveredUniversities: number } | undefined;
    const coveredUniversities = Number(row?.coveredUniversities ?? 0);
    const totalMappedUniversities = input.totalMappedUniversities;
    return {
      kind: input.kind,
      year: input.year,
      provinceName,
      subjectType,
      totalMappedUniversities,
      coveredUniversities,
      missingUniversities: Math.max(0, totalMappedUniversities - coveredUniversities),
      rowCount: Number(row?.rowCount ?? 0),
      coverageRatio: totalMappedUniversities ? coveredUniversities / totalMappedUniversities : 0
    };
  }

  private hasRows(table: "admission_plans" | "admission_scores", where: string[], params: SqlValue[]): boolean {
    const row = this.database.db
      .prepare(`SELECT 1 AS found FROM ${table} WHERE ${where.join(" AND ")} LIMIT 1`)
      .get(...params) as { found: number } | undefined;
    return Boolean(row);
  }
}

function hasCompleteSourceCoverage(
  rows: Array<{ requestJson: string; responseJson: string | null }>,
  expectedRequest: Record<string, unknown>
): boolean {
  for (const row of rows) {
    const request = parseJsonObject(row.requestJson);
    const response = parseJsonObject(row.responseJson);
    if (!request || !response || !sourceRequestMatches(request, expectedRequest)) continue;
    if (isCompleteSourceSnapshot(request, response)) return true;
  }
  return false;
}

function sourceRequestMatches(request: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (value === undefined || value === null || value === "") continue;
    if (String(request[key] ?? "") !== String(value)) return false;
  }
  return true;
}

function isCompleteSourceSnapshot(request: Record<string, unknown>, response: Record<string, unknown>): boolean {
  const page = toPositiveNumber(request.page);
  const size = toPositiveNumber(request.size);
  if (!page || !size) return true;

  const itemCount = sourceItemCount(response);
  const total = sourceTotalCount(response);
  if (total !== null) return page * size >= total;
  return itemCount === 0 || itemCount < size;
}

function sourceItemCount(response: Record<string, unknown>): number {
  const data = response.data;
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object" && Array.isArray((data as { item?: unknown[] }).item)) {
    return (data as { item: unknown[] }).item.length;
  }
  return 0;
}

function sourceTotalCount(response: Record<string, unknown>): number | null {
  const data = response.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const parsed = Number((data as { numFound?: unknown }).numFound);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCoverageGapProvinces(values: string[] | undefined): string[] {
  const normalized = (values?.length ? values : gaokaoProvinceNames())
    .map((value) => normalizeProvinceName(value))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeCoverageGapYears(values: number[] | undefined, fallback: number[]): number[] {
  const normalized = (values?.length ? values : fallback)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.floor(value));
  return Array.from(new Set(normalized));
}

function normalizeCoverageGapSubjectTypes(values: string[] | undefined): string[] | null {
  const normalized = values
    ?.map((value) => normalizeSubjectType(value))
    .filter((value): value is string => Boolean(value));
  const unique = Array.from(new Set(normalized));
  return unique.length ? unique : null;
}

function coverageSubjectTypesForProvinceYear(provinceName: string, year: number, explicitSubjectTypes: string[] | null): string[] {
  return explicitSubjectTypes ?? defaultAdmissionSubjectTypeNamesForProvinceYear(provinceName, year);
}

function appendCommonWhere(where: string[], params: Array<string | number>, query: AdmissionQuery, alias: string): void {
  if (query.universityId) {
    where.push(`${alias}.university_id = ?`);
    params.push(query.universityId);
  }
  if (query.provinceName) {
    where.push(`${alias}.province_name = ?`);
    params.push(normalizeProvinceName(query.provinceName));
  }
  const subjectTypes = Array.from(
    new Set(
      (query.subjectTypes?.length ? query.subjectTypes : query.subjectType ? [query.subjectType] : [])
        .map((value) => normalizeSubjectType(value))
        .filter((value): value is string => Boolean(value))
    )
  );
  if (subjectTypes.length > 1) {
    where.push(`${alias}.subject_type IN (${subjectTypes.map(() => "?").join(",")})`);
    params.push(...subjectTypes);
  } else if (subjectTypes.length === 1) {
    where.push(`${alias}.subject_type LIKE ?`);
    params.push(`%${subjectTypes[0]}%`);
  }
  if (query.years?.length) {
    where.push(`${alias}.year IN (${query.years.map(() => "?").join(",")})`);
    params.push(...query.years);
  }
  if (query.batch) {
    where.push(`${alias}.batch = ?`);
    params.push(normalizeBatchName(query.batch) ?? query.batch.trim());
  }
  if (query.planGroup) {
    const planGroups = expandPlanGroupQueryTerms(query.planGroup);
    if (planGroups.length > 1) {
      where.push(`${alias}.plan_group IN (${planGroups.map(() => "?").join(",")})`);
      params.push(...planGroups);
    } else if (planGroups.length === 1) {
      where.push(`${alias}.plan_group = ?`);
      params.push(planGroups[0]);
    }
  }
  if (query.scoreType && alias === "s") {
    where.push(`${alias}.score_type = ?`);
    params.push(query.scoreType);
  }
  if (query.majorName) {
    const terms = expandMajorQueryTerms(query.majorName);
    if (terms.length) {
      where.push(`(${terms.map(() => `${alias}.major_name LIKE ?`).join(" OR ")})`);
      params.push(...terms.map((term) => `%${term}%`));
    }
  }
}

export function normalizeProvinceName(value: string | null | undefined): string {
  const cleanValue = clean(value) ?? "";
  return cleanValue
    .replace(/省$/u, "")
    .replace(/市$/u, "")
    .replace(/壮族自治区$/u, "")
    .replace(/回族自治区$/u, "")
    .replace(/维吾尔自治区$/u, "")
    .replace(/自治区$/u, "");
}

export function normalizeSubjectType(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  if (/物理/u.test(text)) return "物理类";
  if (/历史/u.test(text)) return "历史类";
  if (/理科/u.test(text)) return "理科";
  if (/文科/u.test(text)) return "文科";
  if (/综合|不限科|不分文理/u.test(text)) return "综合改革";
  return text;
}

export function normalizeBatchName(value: string | null | undefined): string | null {
  let text = clean(value);
  if (!text) return null;
  text = text
    .replace(/[()]/gu, (match) => (match === "(" ? "（" : "）"))
    .replace(/[：:]/gu, "")
    .replace(/\s+/gu, "");
  if (/国家专项/u.test(text)) return "国家专项计划本科批";
  if (/地方专项/u.test(text)) return "地方专项计划本科批";
  if (/高校专项/u.test(text)) return "高校专项计划本科批";
  if (/提前/u.test(text) && /本科/u.test(text)) return "本科提前批";
  if (/提前/u.test(text) && /(高职|专科)/u.test(text)) return "专科提前批";
  if (/本科(?:第?一|Ⅰ|I)批|第?一批本科|本一批|一本/u.test(text)) return "本科一批";
  if (/本科(?:第?二|Ⅱ|II)批|第?二批本科|本二批|二本/u.test(text)) return "本科二批";
  if (/本科(?:普通|普通类)?批|普通(?:类)?本科批|本科批次|本科普通(?:类)?批|普通本科/u.test(text)) return "本科批";
  if (/平行录取第?[一1]段|普通类?一段|一段|常规批第?[一1]段/u.test(text)) return "普通类一段";
  if (/平行录取第?[二2]段|普通类?二段|二段|常规批第?[二2]段/u.test(text)) return "普通类二段";
  if (/普通类?常规批|常规批|普通批/u.test(text)) return "普通类常规批";
  if (/高职|专科/u.test(text)) return "专科批";
  return text;
}

export function normalizePlanGroup(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  const normalized = text
    .replace(/[（〔【［(]/gu, "(")
    .replace(/[）〕】］)]/gu, ")")
    .replace(/专业组代码|院校专业组|专业组|第/g, "")
    .replace(/\s+/gu, "");
  const codes = normalized.match(/[A-Za-z]?\d{1,5}/gu);
  if (codes?.length) return Array.from(new Set(codes.map(formatPlanGroupCode))).join("-");
  return normalized.replace(/[()]/gu, "") || null;
}

export function normalizeMajorName(value: string | null | undefined): string | null {
  let text = clean(value);
  if (!text) return null;
  text = text
    .replace(/[()]/gu, (match) => (match === "(" ? "（" : "）"))
    .replace(/\s+/gu, "");
  text = text.replace(/（[^）]*(?:培养|颁发|具体详见|详见学校招生章程|详见招生章程)[^）]*）/gu, "");
  text = text.replace(/（[^）]*(?:认同并执行|加分项目|少数民族加分|校区就读|办学地点|色盲|色弱|外语语种|英语语种|入学后)[^）]*）/gu, "");
  text = text.replace(/，?具体详见学校招生章程$/u, "");
  return clean(text);
}

function expandPlanGroupQueryTerms(value: string): string[] {
  const normalized = normalizePlanGroup(value);
  if (!normalized) return [];
  const terms = new Set<string>([normalized]);
  const match = normalized.match(/^([A-Z]?)(0*)(\d+)$/u);
  if (match) {
    const [, prefix, , digits] = match;
    const parsed = Number(digits);
    if (Number.isFinite(parsed)) {
      const number = String(parsed);
      terms.add(`${prefix}${number}`);
      terms.add(`${prefix}${number.padStart(2, "0")}`);
      terms.add(`${prefix}${number.padStart(3, "0")}`);
    }
  }
  return Array.from(terms);
}

function expandMajorQueryTerms(value: string): string[] {
  const normalized = normalizeMajorName(value) ?? clean(value);
  if (!normalized) return [];
  const compact = normalized
    .replace(/[（）()\s、,，/|]/gu, "")
    .toLowerCase();
  const terms = new Set<string>([normalized]);
  const add = (...items: Array<string | null | undefined>) => {
    for (const item of items) {
      const cleaned = normalizeMajorName(item);
      if (cleaned) terms.add(cleaned);
    }
  };

  const aliasKeys = expandMajorAliasKeys(compact);
  for (const group of MAJOR_ALIAS_GROUPS) {
    if (aliasKeys.some((key) => group.pattern.test(key))) add(...group.terms);
  }

  return Array.from(terms).slice(0, 24);
}

function expandMajorAliasKeys(compact: string): string[] {
  const keys = new Set<string>([compact]);
  const suffixes = ["相关专业", "相关方向", "相关", "专业方向", "专业类", "专业", "方向", "类"];
  for (const suffix of suffixes) {
    if (compact.endsWith(suffix) && compact.length > suffix.length) {
      keys.add(compact.slice(0, -suffix.length));
    }
  }
  return Array.from(keys).filter(Boolean);
}

const MAJOR_ALIAS_GROUPS: Array<{ pattern: RegExp; terms: string[] }> = [
  {
    pattern: /^(计科|计算机|计算机类|计算机专业|计算机相关|计算机相关专业|cs)$/iu,
    terms: [
      "计算机类",
      "计算机科学与技术",
      "软件工程",
      "网络工程",
      "信息安全",
      "网络空间安全",
      "数据科学与大数据技术",
      "人工智能",
      "智能科学与技术",
      "电子与计算机工程"
    ]
  },
  { pattern: /^计算机科学与技术$/u, terms: ["计算机科学与技术", "计算机类"] },
  { pattern: /^(软工|软件|软件工程)$/u, terms: ["软件工程"] },
  { pattern: /^(网安|网络安全|网络空间|网络空间安全|信息安全)$/u, terms: ["网络空间安全", "信息安全"] },
  { pattern: /^(大数据|数据科学|数据科学与大数据技术)$/u, terms: ["数据科学与大数据技术", "计算机类"] },
  { pattern: /^(ai|人工智能|智能科学与技术)$/iu, terms: ["人工智能", "智能科学与技术", "计算机类"] },
  {
    pattern: /^(电子信息|电子信息类|电信|通信|通信工程)$/u,
    terms: [
      "电子信息类",
      "电子信息工程",
      "通信工程",
      "信息工程",
      "电子科学与技术",
      "微电子科学与工程",
      "集成电路设计与集成系统",
      "光电信息科学与工程",
      "电磁场与无线技术"
    ]
  },
  { pattern: /^(电气|电气工程|电气工程及其自动化)$/u, terms: ["电气工程及其自动化", "智能电网信息工程"] },
  { pattern: /^(自动化|控制|控制科学|机器人工程)$/u, terms: ["自动化", "机器人工程", "智能装备与系统"] },
  {
    pattern: /^(机械|机械类|机械工程|机械设计|机电)$/u,
    terms: ["机械类", "机械工程", "机械设计制造及其自动化", "机械电子工程", "车辆工程", "智能制造工程"]
  },
  { pattern: /^(土木|土木工程|土建)$/u, terms: ["土木类", "土木工程", "智能建造", "建筑环境与能源应用工程"] },
  { pattern: /^(建筑|建筑学)$/u, terms: ["建筑类", "建筑学", "城乡规划", "风景园林"] },
  { pattern: /^(临床|临床医学)$/u, terms: ["临床医学"] },
  { pattern: /^(口腔|口腔医学)$/u, terms: ["口腔医学"] },
  { pattern: /^(医学影像|影像医学|医学影像学)$/u, terms: ["医学影像学", "医学影像技术"] },
  { pattern: /^(护理|护理学)$/u, terms: ["护理学"] },
  { pattern: /^(药学|药学类)$/u, terms: ["药学", "药学类", "临床药学", "药物制剂"] },
  { pattern: /^(中药|中药学|中药学类)$/u, terms: ["中药学", "中药学类"] },
  { pattern: /^(制药|制药工程)$/u, terms: ["制药工程", "药物制剂"] },
  { pattern: /^(法学|法律)$/u, terms: ["法学", "法学类"] },
  { pattern: /^(金融|金融学|金融工程)$/u, terms: ["金融学", "金融工程", "金融科技"] },
  { pattern: /^(经济|经济学|经济学类)$/u, terms: ["经济学", "经济学类", "经济统计学"] },
  { pattern: /^(会计|会计学)$/u, terms: ["会计学", "财务管理", "审计学"] },
  { pattern: /^(工商管理|工商|管理学)$/u, terms: ["工商管理", "工商管理类", "市场营销", "人力资源管理"] },
  { pattern: /^(汉语言|中文|汉语言文学)$/u, terms: ["汉语言文学", "中国语言文学类", "汉语言"] },
  { pattern: /^(英语|英语语言文学)$/u, terms: ["英语", "英语语言文学", "商务英语"] },
  { pattern: /^(数学|数学类|数学与应用数学)$/u, terms: ["数学类", "数学与应用数学", "信息与计算科学"] },
  { pattern: /^(物理|物理学|物理学类)$/u, terms: ["物理学", "物理学类", "应用物理学"] },
  { pattern: /^(化学|化学类|应用化学)$/u, terms: ["化学", "化学类", "应用化学"] },
  { pattern: /^(生物|生物科学|生物技术)$/u, terms: ["生物科学", "生物技术", "生物科学类"] },
  { pattern: /^(材料|材料类|材料科学)$/u, terms: ["材料类", "材料科学与工程", "高分子材料与工程", "新能源材料与器件"] }
];

function formatPlanGroupCode(code: string): string {
  const upper = code.toUpperCase();
  const match = upper.match(/^([A-Z]?)(\d+)$/u);
  if (!match) return upper;
  const [, prefix, digits] = match;
  const width = digits.length === 1 ? 2 : digits.length;
  return `${prefix}${digits.padStart(width, "0")}`;
}

function makeUniqueKey(values: Array<unknown>): string {
  return values.map((value) => clean(value)?.toLowerCase() ?? "-").join("|");
}

function clean(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "-") return null;
  return text;
}

function clampLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 80;
  return Math.max(1, Math.min(500, Math.floor(value)));
}
