import { createGunzip } from "node:zlib";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import type { AppDatabase } from "../db.js";
import {
  AdmissionRepository,
  normalizeBatchName,
  normalizeMajorName,
  normalizePlanGroup,
  normalizeProvinceName,
  normalizeSubjectType
} from "./admission-repository.js";
import type { UniversityRepository, UniversityRow } from "./university-repository.js";

export const XUEFENG_AGENT_SOURCE = "xuefeng_agent";
export const XUEFENG_AGENT_SOURCE_URL = "https://github.com/ziqihe10-droid/xuefeng-agent";

const DEFAULT_DB_GZ_URLS = [
  "https://gh.lizmt.cn/https://github.com/ziqihe10-droid/xuefeng-agent/raw/master/admission_clean.db.gz",
  "https://gh.lizmt.cn/https://raw.githubusercontent.com/ziqihe10-droid/xuefeng-agent/master/admission_clean.db.gz",
  "https://raw.githubusercontent.com/ziqihe10-droid/xuefeng-agent/master/admission_clean.db.gz",
  "https://github.com/ziqihe10-droid/xuefeng-agent/raw/master/admission_clean.db.gz"
];

export interface XuefengAgentSyncOptions {
  dbPath?: string;
  gzPath?: string;
  url?: string;
  query?: string;
  provinces?: string[];
  years?: number[];
  limit?: number;
  offset?: number;
}

export interface XuefengAgentSyncResult {
  source: typeof XUEFENG_AGENT_SOURCE;
  total: number;
  candidateTotal: number;
  offset: number;
  nextOffset: number;
  mapped: number;
  scoreRows: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
  skipped: number;
  unmapped: number;
  dbPath: string;
  downloaded: boolean;
  errors: Array<{ school: string; message: string }>;
}

interface XuefengAdmissionRow {
  id: number;
  province: string;
  year: number;
  category: string | null;
  batch: string | null;
  school_name: string;
  major_name: string | null;
  score: number | null;
  rank: number | null;
  quota: number | null;
  source_file: string | null;
}

interface PreparedXuefengRow {
  sourceSchoolId: string;
  sourceSchoolName: string;
  planGroup: string | null;
  majorName: string | null;
  selectionRequirements: string | null;
  scoreType: "school" | "major";
}

export type XuefengAgentProgressReporter = (message: string) => void;

export class XuefengAgentAdapter {
  constructor(
    private readonly dataDir: string,
    private readonly database: AppDatabase,
    private readonly universities: UniversityRepository,
    private readonly admissions: AdmissionRepository,
    private readonly progress?: XuefengAgentProgressReporter
  ) {}

  async sync(options: XuefengAgentSyncOptions = {}): Promise<XuefengAgentSyncResult> {
    const offset = normalizeOffset(options.offset);
    const limit = normalizeLimit(options.limit);
    const result: XuefengAgentSyncResult = {
      source: XUEFENG_AGENT_SOURCE,
      total: 0,
      candidateTotal: 0,
      offset,
      nextOffset: 0,
      mapped: 0,
      scoreRows: 0,
      schoolScoreRows: 0,
      majorScoreRows: 0,
      sourceRows: 0,
      skipped: 0,
      unmapped: 0,
      dbPath: options.dbPath ? resolve(options.dbPath) : "",
      downloaded: false,
      errors: []
    };
    const jobId = this.admissions.startJob({
      source: XUEFENG_AGENT_SOURCE,
      jobType: "sync-score",
      targetJson: JSON.stringify(options)
    });
    let sourceDb: DatabaseSync | null = null;

    try {
      const db = await this.resolveSourceDb(options);
      result.dbPath = db.path;
      result.downloaded = db.downloaded;
      sourceDb = new DatabaseSync(db.path, { readOnly: true });
      const query = buildSourceQuery(options);
      result.candidateTotal = Number((sourceDb.prepare(`SELECT COUNT(*) AS count FROM admission ${query.where}`).get(...query.params) as { count: number }).count);
      result.total = Math.min(limit, Math.max(0, result.candidateTotal - offset));
      result.nextOffset = offset + result.total < result.candidateTotal ? offset + result.total : 0;
      const sourceRecordId = this.admissions.insertSource({
        source: XUEFENG_AGENT_SOURCE,
        sourceKind: "xuefeng-agent-sqlite",
        sourceUrl: XUEFENG_AGENT_SOURCE_URL,
        requestJson: JSON.stringify({
          source: XUEFENG_AGENT_SOURCE_URL,
          dbPath: db.path,
          query: options.query ?? null,
          provinces: options.provinces ?? null,
          years: options.years ?? null,
          limit,
          offset
        }),
        responseJson: JSON.stringify({ candidateTotal: result.candidateTotal, total: result.total }),
        status: "success"
      });
      result.sourceRows = 1;
      this.report(`Importing ${result.total}/${result.candidateTotal} Xuefeng Agent rows...`);

      const allUniversities = this.universities.listAllUniversities();
      const mappingCache = new Map<string, UniversityRow | null>();
      const rows = sourceDb
        .prepare(
          `
          SELECT id, province, year, category, batch, school_name, major_name, score, rank, quota, source_file
          FROM admission
          ${query.where}
          ORDER BY id
          LIMIT ?
          OFFSET ?
        `
        )
        .all(...query.params, limit, offset) as unknown as XuefengAdmissionRow[];

      this.database.transaction(() => {
        for (const row of rows) {
          const prepared = prepareXuefengRow(row);
          const university = resolveUniversityForSourceSchool(prepared.sourceSchoolName, allUniversities, mappingCache);
          if (!university) {
            result.unmapped += 1;
            if (result.errors.length < 20) {
              result.errors.push({ school: prepared.sourceSchoolName, message: "未能匹配到本地学校" });
            }
            continue;
          }
          if (!row.score && !row.rank) {
            result.skipped += 1;
            continue;
          }

          this.admissions.upsertMapping({
            source: XUEFENG_AGENT_SOURCE,
            universityId: university.id,
            sourceSchoolId: prepared.sourceSchoolId,
            sourceSchoolName: prepared.sourceSchoolName,
            matchedName: university.name,
            matchStatus: "matched",
            confidence: prepared.sourceSchoolName === university.name ? 1 : 0.82,
            sourceUrl: XUEFENG_AGENT_SOURCE_URL,
            payloadJson: JSON.stringify({ sourceSchoolName: row.school_name })
          });

          this.admissions.upsertScore({
            source: XUEFENG_AGENT_SOURCE,
            scoreType: prepared.scoreType,
            universityId: university.id,
            sourceSchoolId: prepared.sourceSchoolId,
            year: Number(row.year),
            provinceName: normalizeProvinceName(row.province),
            subjectType: normalizeSubjectType(row.category),
            batch: normalizeBatchName(row.batch),
            planGroup: prepared.planGroup,
            majorName: prepared.majorName,
            minScore: toPositiveNumber(row.score),
            minRank: toPositiveInteger(row.rank),
            planCount: toPositiveInteger(row.quota),
            selectionRequirements: prepared.selectionRequirements,
            sourceUrl: XUEFENG_AGENT_SOURCE_URL,
            sourceRecordId: String(sourceRecordId),
            rawJson: JSON.stringify(row)
          });
          result.mapped += 1;
          result.scoreRows += 1;
          if (prepared.scoreType === "major") result.majorScoreRows += 1;
          else result.schoolScoreRows += 1;
        }
      });

      this.admissions.finishJob(jobId, { status: "success", resultJson: JSON.stringify(result) });
      this.report(`Xuefeng Agent import complete: ${result.scoreRows} score rows, ${result.unmapped} unmapped.`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.admissions.finishJob(jobId, { status: "error", error: message, resultJson: JSON.stringify(result) });
      throw error;
    } finally {
      sourceDb?.close();
    }
  }

  private async resolveSourceDb(options: XuefengAgentSyncOptions): Promise<{ path: string; downloaded: boolean }> {
    if (options.dbPath) return { path: resolve(options.dbPath), downloaded: false };

    const cacheDir = join(this.dataDir, "xuefeng-agent");
    mkdirSync(cacheDir, { recursive: true });
    const dbPath = join(cacheDir, "admission_clean.db");
    if (existsSync(dbPath)) return { path: dbPath, downloaded: false };

    const gzPath = options.gzPath ? resolve(options.gzPath) : join(cacheDir, "admission_clean.db.gz");
    if (!existsSync(gzPath)) {
      await this.downloadGzip(gzPath, options.url);
    }
    await gunzipFile(gzPath, dbPath);
    return { path: dbPath, downloaded: true };
  }

  private async downloadGzip(targetPath: string, preferredUrl?: string): Promise<void> {
    const urls = normalizedUnique(
      [preferredUrl, process.env.XUEFENG_AGENT_DB_URL, ...DEFAULT_DB_GZ_URLS]
        .map((url) => url?.trim())
        .filter((url): url is string => Boolean(url))
    );
    let lastError: unknown = null;
    for (const url of urls) {
      try {
        this.report(`Downloading Xuefeng Agent DB from ${url}...`);
        await downloadFile(url, targetPath);
        return;
      } catch (error) {
        lastError = error;
        safeUnlink(targetPath);
      }
    }
    throw new Error(`无法下载 Xuefeng Agent 数据库：${lastError instanceof Error ? cleanDownloadError(lastError.message) : String(lastError)}`);
  }

  private report(message: string): void {
    this.progress?.(message);
  }
}

export function prepareXuefengRow(row: Pick<XuefengAdmissionRow, "school_name" | "major_name">): PreparedXuefengRow {
  const schoolInfo = extractSourceSchool(row.school_name);
  const majorText = row.major_name?.trim() || "";
  const majorGroup = extractMajorGroup(majorText);
  const planGroup = normalizePlanGroup(schoolInfo.planGroup ?? majorGroup?.planGroup ?? null);
  const majorName = majorText && !majorGroup && !isSelectionRequirementOnly(majorText)
    ? normalizeMajorName(majorText)
    : null;
  const selectionRequirements = majorName ? null : normalizeSelectionRequirement(majorText);
  return {
    sourceSchoolId: schoolInfo.name,
    sourceSchoolName: schoolInfo.name,
    planGroup,
    majorName,
    selectionRequirements,
    scoreType: majorName ? "major" : "school"
  };
}

function extractSourceSchool(value: string): { name: string; planGroup: string | null } {
  let text = value.trim().replace(/[［\[][^\]］]*[］\]]/gu, "");
  const groupMatch = text.match(/([A-Za-z]?\d{1,5})\s*专业组/u);
  const planGroup = groupMatch?.[1] ?? null;
  text = text
    .replace(/第?\s*[A-Za-z]?\d{1,5}\s*专业组.*$/u, "")
    .replace(/\s+/gu, "")
    .trim();
  return { name: text || value.trim(), planGroup };
}

function extractMajorGroup(value: string): { planGroup: string } | null {
  const match = value.match(/第?\s*([A-Za-z]?\d{1,5})\s*组/u);
  return match ? { planGroup: match[1] } : null;
}

function isSelectionRequirementOnly(value: string): boolean {
  const compact = value
    .replace(/[()（）\s]/gu, "")
    .replace(/首选/u, "")
    .replace(/再选/u, "");
  if (!compact) return true;
  if (/^(不限|无要求|物理|历史|化学|生物|政治|思想政治|地理|技术|物理或历史|化学或生物|化学和生物|化学或地理|政治或地理)$/u.test(compact)) return true;
  return /^[物理历史化学生物政治思想地理技术不限或和、+]+$/u.test(compact) && compact.length <= 12;
}

function normalizeSelectionRequirement(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (extractMajorGroup(text)) return text.replace(/^第?\s*[A-Za-z]?\d{1,5}\s*组/u, "").replace(/[()（）]/gu, "").trim() || null;
  return text.replace(/^[（(]/u, "").replace(/[）)]$/u, "").trim() || null;
}

function resolveUniversityForSourceSchool(
  sourceSchoolName: string,
  universities: UniversityRow[],
  cache: Map<string, UniversityRow | null>
): UniversityRow | null {
  const cached = cache.get(sourceSchoolName);
  if (cached !== undefined) return cached;
  const normalizedSource = normalizeSchoolKey(sourceSchoolName);
  const exact = universities.find((school) => normalizeSchoolKey(school.name) === normalizedSource) ?? null;
  if (exact) {
    cache.set(sourceSchoolName, exact);
    return exact;
  }
  const containing = universities
    .filter((school) => {
      const key = normalizeSchoolKey(school.name);
      return normalizedSource.includes(key) || key.includes(normalizedSource);
    })
    .sort((left, right) => right.name.length - left.name.length)[0] ?? null;
  cache.set(sourceSchoolName, containing);
  return containing;
}

function normalizeSchoolKey(value: string): string {
  return value
    .replace(/[［\[][^\]］]*[］\]]/gu, "")
    .replace(/[()（）\s]/gu, "")
    .toLowerCase();
}

function buildSourceQuery(options: XuefengAgentSyncOptions): { where: string; params: Array<string | number> } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  const query = options.query?.trim();
  if (query) {
    where.push("(school_name LIKE ? OR major_name LIKE ?)");
    params.push(`%${query}%`, `%${query}%`);
  }
  const provinces = normalizedUnique(options.provinces?.map((item) => normalizeProvinceName(item)).filter(Boolean));
  if (provinces.length) {
    where.push(`province IN (${provinces.map(() => "?").join(",")})`);
    params.push(...provinces);
  }
  const years = normalizedUnique((options.years ?? []).filter((year) => Number.isFinite(year)).map((year) => Math.floor(year)));
  if (years.length) {
    where.push(`year IN (${years.map(() => "?").join(",")})`);
    params.push(...years);
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

function normalizedUnique<T>(values: T[] | undefined): T[] {
  return Array.from(new Set(values ?? []));
}

function normalizeOffset(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 0;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return 1_000_000;
  return Math.max(1, Math.floor(value));
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(await formatDownloadHttpError(response));
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!isGzip(bytes)) {
    throw new Error("下载地址返回的不是 gzip 数据，请检查 URL 是否指向 admission_clean.db.gz。");
  }
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, targetPath);
}

async function formatDownloadHttpError(response: Response): Promise<string> {
  const body = cleanDownloadError(await response.text().catch(() => ""));
  const status = `${response.status} ${response.statusText || "HTTP Error"}`.trim();
  return body ? `${status}：${body}` : status;
}

function cleanDownloadError(message: string): string {
  return message
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function isGzip(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzipFile(gzPath: string, dbPath: string): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const tempPath = `${dbPath}.tmp`;
  await pipeline(
    createReadStream(gzPath),
    createGunzip(),
    createWriteStream(tempPath)
  );
  renameSync(tempPath, dbPath);
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // ignore stale partial downloads
  }
}
