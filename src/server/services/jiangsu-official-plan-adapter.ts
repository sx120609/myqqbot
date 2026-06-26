import { AdmissionRepository } from "./admission-repository.js";
import type { UniversityRepository, UniversityRow } from "./university-repository.js";

export const JIANGSU_SCHOOL_OFFICIAL_SOURCE = "jiangsu_school_official";

export interface JiangsuOfficialPlanSource {
  schoolName: string;
  sourceSchoolId?: string;
  year: number;
  provinceName?: string;
  url?: string;
  parser?: "html" | "njust-json";
  refererUrl?: string;
  requestParams?: Record<string, string | number | null | undefined>;
  records?: JiangsuOfficialPlanRecord[];
}

export interface JiangsuOfficialPlanRecord {
  category: string | null;
  subjectType: string | null;
  planGroup: string | null;
  selectionRequirements: string | null;
  majorName: string | null;
  duration: string | null;
  planCount: number | null;
  schoolPlanCount?: number | null;
  tuition?: string | null;
  batch: string | null;
  rawCells: string[];
}

export interface JiangsuOfficialPlanSyncOptions {
  sources?: JiangsuOfficialPlanSource[];
  query?: string;
  limit?: number;
}

export interface JiangsuOfficialPlanSyncResult {
  source: typeof JIANGSU_SCHOOL_OFFICIAL_SOURCE;
  total: number;
  mapped: number;
  planRows: number;
  sourceRows: number;
  skipped: number;
  errors: Array<{ source: string; message: string }>;
}

export const DEFAULT_JIANGSU_OFFICIAL_PLAN_SOURCES: JiangsuOfficialPlanSource[] = [
  {
    schoolName: "苏州大学",
    sourceSchoolId: "suda",
    year: 2026,
    provinceName: "江苏",
    url: "https://zsb.suda.edu.cn/search_plan.aspx?nf=2026&sf=%E6%B1%9F%E8%8B%8F&province=%E6%B1%9F%E8%8B%8F"
  },
  {
    schoolName: "江苏大学",
    sourceSchoolId: "ujs",
    year: 2026,
    provinceName: "江苏",
    url: "https://zb.ujs.edu.cn/info/1185/19248.htm"
  },
  {
    schoolName: "南京理工大学",
    sourceSchoolId: "njust",
    year: 2026,
    provinceName: "江苏",
    url: "https://zsb.njust.edu.cn/lqPain/initDateCon",
    parser: "njust-json",
    refererUrl: "https://zsb.njust.edu.cn/lqjh_fsx",
    requestParams: {
      pageSize: 1000,
      rowoffset: 0,
      val1: 2026,
      val2: "全部",
      val3: "江苏"
    }
  }
];

export class JiangsuOfficialPlanAdapter {
  constructor(
    private readonly universities: UniversityRepository,
    private readonly admissions: AdmissionRepository,
    private readonly progress?: (message: string) => void
  ) {}

  async sync(options: JiangsuOfficialPlanSyncOptions = {}): Promise<JiangsuOfficialPlanSyncResult> {
    const sources = filterSources(options.sources?.length ? options.sources : DEFAULT_JIANGSU_OFFICIAL_PLAN_SOURCES, options.query, options.limit);
    const targetJson = JSON.stringify({
      source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
      sources: sources.map((source) => ({
        schoolName: source.schoolName,
        sourceSchoolId: source.sourceSchoolId,
        year: source.year,
        provinceName: source.provinceName ?? "江苏",
        url: source.url,
        parser: source.parser,
        requestParams: source.requestParams
      })),
      query: options.query,
      limit: options.limit
    });
    const jobId = this.admissions.startJob({
      source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
      jobType: "sync-plan",
      targetJson
    });
    const result: JiangsuOfficialPlanSyncResult = {
      source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
      total: 0,
      mapped: 0,
      planRows: 0,
      sourceRows: 0,
      skipped: 0,
      errors: []
    };

    try {
      for (const source of sources) {
        try {
          const university = this.resolveUniversity(source.schoolName);
          if (!university) {
            result.skipped += 1;
            continue;
          }
          const resolved = await this.resolveSource(source);
          const records = aggregatePlanRecords(resolved.records);
          result.total += records.length;
          const sourceSchoolId = source.sourceSchoolId ?? university.slug ?? String(university.id);
          const sourceId = this.admissions.insertSource({
            source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
            sourceKind: officialPlanSourceKind(source),
            universityId: university.id,
            sourceSchoolId,
            sourceUrl: resolved.url,
            requestJson: JSON.stringify({
              schoolName: source.schoolName,
              sourceSchoolId,
              year: source.year,
              province: source.provinceName ?? "江苏",
              url: resolved.url,
              parser: source.parser ?? "html",
              requestParams: source.requestParams
            }),
            responseJson: JSON.stringify({
              rowCount: records.length,
              rawRowCount: resolved.records.length,
              records
            }),
            status: "success"
          });
          result.sourceRows += 1;
          this.admissions.upsertMapping({
            source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
            universityId: university.id,
            sourceSchoolId,
            sourceSchoolName: source.schoolName,
            matchedName: source.schoolName,
            matchStatus: "matched",
            confidence: 1,
            sourceUrl: resolved.url,
            payloadJson: JSON.stringify({
              source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
              schoolName: source.schoolName,
              year: source.year,
              province: source.provinceName ?? "江苏"
            })
          });
          this.admissions.deletePlansForSource({
            source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
            sourceSchoolId,
            year: source.year,
            provinceName: source.provinceName ?? "江苏"
          });

          for (const [index, record] of records.entries()) {
            if (!record.majorName && record.planCount === null && (record.schoolPlanCount ?? null) === null) continue;
            this.admissions.upsertPlan({
              source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
              universityId: university.id,
              sourceSchoolId,
              year: source.year,
              provinceName: source.provinceName ?? "江苏",
              subjectType: record.subjectType,
              batch: formatPlanBatch(record.batch, record.category),
              planGroup: record.planGroup,
              majorName: record.majorName,
              planCount: record.planCount,
              schoolPlanCount: record.schoolPlanCount ?? null,
              tuition: record.tuition ?? null,
              duration: record.duration,
              selectionRequirements: record.selectionRequirements,
              sourceUrl: resolved.url,
              sourceRecordId: `${sourceId}:${index + 1}`,
              rawJson: JSON.stringify(record)
            });
            result.planRows += 1;
          }
          result.mapped += 1;
          this.report(`Synced ${records.length}/${resolved.records.length} official Jiangsu plan rows from ${source.schoolName}.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push({ source: source.schoolName, message });
          this.admissions.insertSource({
            source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
            sourceKind: officialPlanSourceKind(source),
            sourceUrl: source.url ?? "official-plan-records",
            requestJson: JSON.stringify(source),
            status: "error",
            error: message
          });
          result.sourceRows += 1;
        }
      }
      this.admissions.finishJob(jobId, {
        status: result.errors.length ? "error" : "success",
        error: result.errors.length ? result.errors.map((error) => `${error.source}: ${error.message}`).join("; ") : null,
        resultJson: JSON.stringify(result)
      });
      return result;
    } catch (error) {
      this.admissions.finishJob(jobId, { status: "error", error: error instanceof Error ? error.message : String(error), resultJson: JSON.stringify(result) });
      throw error;
    }
  }

  private async resolveSource(source: JiangsuOfficialPlanSource): Promise<{ url: string; records: JiangsuOfficialPlanRecord[] }> {
    if (source.records) return { url: source.url ?? "official-plan-records", records: source.records };
    if (!source.url) throw new Error("missing official plan source url");
    const resolvedUrl = appendRequestParams(source.url, source.requestParams);
    const response = await fetch(resolvedUrl, { headers: officialHeaders(resolvedUrl, source.refererUrl) });
    if (!response.ok) throw new Error(`official plan page returned HTTP ${response.status}`);
    const text = await response.text();
    const records = source.parser === "njust-json"
      ? parseNjustOfficialPlanJson(text)
      : parseJiangsuOfficialPlanHtml(text);
    if (!records.length) throw new Error("no official plan rows parsed from page");
    return { url: resolvedUrl, records };
  }

  private resolveUniversity(schoolName: string): UniversityRow | null {
    const candidates = this.universities.listUniversities(schoolName, 10);
    const normalized = normalizeSchoolName(schoolName);
    return (
      candidates.find((candidate) => normalizeSchoolName(candidate.name) === normalized) ??
      candidates.find((candidate) => normalizeSchoolName(candidate.name).includes(normalized) || normalized.includes(normalizeSchoolName(candidate.name))) ??
      null
    );
  }

  private report(message: string): void {
    this.progress?.(message);
  }
}

export function parseJiangsuOfficialPlanHtml(html: string): JiangsuOfficialPlanRecord[] {
  const tableMatches = Array.from(html.matchAll(/<table\b[\s\S]*?<\/table>/giu));
  for (const match of tableMatches) {
    const rows = parseHtmlTable(match[0]);
    const parsed = parsePlanRows(rows);
    if (parsed.length) return parsed;
  }
  const groupedRecords = parseGroupedPlanHtml(html);
  if (groupedRecords.length) return groupedRecords;
  return [];
}

function parsePlanRows(rows: HtmlTableRow[]): JiangsuOfficialPlanRecord[] {
  const headerIndex = rows.findIndex((row) => {
    const text = row.cells.map((cell) => cell.text).join("|");
    return text.includes("计划数") && text.includes("专业") && (text.includes("科类") || text.includes("选科"));
  });
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].cells.map((cell) => normalizeHeader(cell.text));
  const index = {
    category: findHeader(headers, ["计划性质", "类别", "类型"]),
    subjectType: findHeader(headers, ["科类"]),
    planGroup: findHeader(headers, ["专业组", "选科"]),
    majorName: findHeader(headers, ["专业名称", "招生专业"]),
    duration: findHeader(headers, ["学制"]),
    planCount: findHeader(headers, ["计划数", "招生人数"]),
    batch: findHeader(headers, ["批次"])
  };
  if (index.majorName < 0 || index.planCount < 0) return [];
  return rows.slice(headerIndex + 1)
    .map((row): JiangsuOfficialPlanRecord | null => {
      const cells = row.cells;
      const majorCell = cells[index.majorName];
      const groupInfo = parsePlanGroup(cellText(cells, index.planGroup));
      const planCount = toInt(cellText(cells, index.planCount));
      const majorName = cleanText(majorCell?.anchorText ?? majorCell?.text ?? "");
      if (!majorName && planCount === null) return null;
      return {
        category: cellText(cells, index.category),
        subjectType: normalizeSubjectType(cellText(cells, index.subjectType)),
        planGroup: groupInfo.planGroup,
        selectionRequirements: groupInfo.selectionRequirements,
        majorName: majorName || null,
        duration: cellText(cells, index.duration),
        planCount,
        schoolPlanCount: null,
        tuition: null,
        batch: cellText(cells, index.batch),
        rawCells: cells.map((cell) => cell.text)
      };
    })
    .filter((row): row is JiangsuOfficialPlanRecord => Boolean(row));
}

function aggregatePlanRecords(records: JiangsuOfficialPlanRecord[]): JiangsuOfficialPlanRecord[] {
  const byKey = new Map<string, JiangsuOfficialPlanRecord>();
  for (const record of records) {
    const key = [
      record.category,
      record.subjectType,
      formatPlanBatch(record.batch, record.category),
      record.planGroup,
      record.selectionRequirements,
      record.majorName,
      record.duration,
      record.tuition
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...record, batch: formatPlanBatch(record.batch, record.category), rawCells: [...record.rawCells] });
      continue;
    }
    byKey.set(key, {
      ...existing,
      planCount: sumNullable(existing.planCount, record.planCount),
      schoolPlanCount: sumNullable(existing.schoolPlanCount ?? null, record.schoolPlanCount ?? null),
      rawCells: [...existing.rawCells, `合并计划数:${record.planCount ?? "-"}`]
    });
  }
  return Array.from(byKey.values());
}

interface GroupedPlanContext {
  category: string | null;
  subjectType: string | null;
  batch: string | null;
}

interface GroupedPlanState {
  records: JiangsuOfficialPlanRecord[];
  sawHeader: boolean;
  currentContext: GroupedPlanContext;
  currentGroup: Pick<JiangsuOfficialPlanRecord, "subjectType" | "planGroup" | "selectionRequirements" | "batch" | "category"> | null;
}

function parseGroupedPlanHtml(html: string): JiangsuOfficialPlanRecord[] {
  const state = createGroupedPlanState({ category: null, subjectType: null, batch: null });
  const tokenPattern = new RegExp(`<p\\b[\\s\\S]*?<\\/p>|${groupedContextPattern().source}|<tr\\b[\\s\\S]*?<\\/tr>`, "giu");
  for (const match of html.matchAll(tokenPattern)) {
    if (/^<p\b/iu.test(match[0])) {
      const context = groupedContextFromText(stripHtml(match[0]));
      if (context) applyGroupedContext(state, context);
      continue;
    }
    if (match[1]) {
      applyGroupedContext(state, groupedContextFromMatch(match));
      continue;
    }
    const row = parseHtmlTable(match[0])[0];
    if (row) consumeGroupedPlanRow(state, row);
  }
  return state.records;
}

function parseGroupedPlanRows(rows: HtmlTableRow[], context: GroupedPlanContext): JiangsuOfficialPlanRecord[] {
  const state = createGroupedPlanState(context);
  for (const row of rows) {
    const rowText = cleanText(row.cells.map((cell) => cell.text).join(" "));
    const rowContext = groupedContextFromText(rowText);
    if (rowContext) {
      applyGroupedContext(state, rowContext);
      continue;
    }
    consumeGroupedPlanRow(state, row);
  }
  return state.records;
}

function createGroupedPlanState(context: GroupedPlanContext): GroupedPlanState {
  return {
    records: [],
    sawHeader: false,
    currentContext: context,
    currentGroup: null
  };
}

function applyGroupedContext(state: GroupedPlanState, context: GroupedPlanContext): void {
  state.currentContext = context;
  state.currentGroup = null;
  state.sawHeader = false;
}

function consumeGroupedPlanRow(state: GroupedPlanState, row: HtmlTableRow): void {
  const cells = row.cells;
  const rowText = cleanText(cells.map((cell) => cell.text).join(" "));
  if (rowText.includes("代号") && rowText.includes("专业") && rowText.includes("计划")) {
    state.sawHeader = true;
    return;
  }
  if (!state.sawHeader) return;
  if (cells.length < 3) return;
  const code = cleanText(cells[0]?.text ?? "");
  const name = cleanText(cells[1]?.anchorText ?? cells[1]?.text ?? "");
  const planCount = toInt(cells[2]?.text ?? null);
  if (!code || !name) return;

  if (/^\d{6}$/u.test(code) && name.includes("专业组")) {
    const groupInfo = parsePlanGroup(name);
    const subjectType = inferSubjectType(state.currentContext.subjectType, groupInfo.selectionRequirements);
    state.currentGroup = {
      category: state.currentContext.category,
      subjectType,
      planGroup: groupInfo.planGroup,
      selectionRequirements: groupInfo.selectionRequirements,
      batch: state.currentContext.batch
    };
    state.records.push({
      ...state.currentGroup,
      majorName: null,
      duration: null,
      planCount: null,
        schoolPlanCount: planCount,
        tuition: null,
        rawCells: cells.map((cell) => cell.text)
      });
    return;
  }

  if (!state.currentGroup || !/^[A-Z]?\d{1,2}$/iu.test(code)) return;
  state.records.push({
    ...state.currentGroup,
    majorName: name || null,
    duration: null,
    planCount,
    schoolPlanCount: null,
    tuition: null,
    rawCells: cells.map((cell) => cell.text)
  });
}

export function parseNjustOfficialPlanJson(payload: string | unknown): JiangsuOfficialPlanRecord[] {
  const data = typeof payload === "string" ? JSON.parse(payload) as unknown : payload;
  const list = extractNjustPlanList(data);
  return list
    .map((item): JiangsuOfficialPlanRecord | null => {
      const row = item as Record<string, unknown>;
      const majorName = cleanText(String(row.professional_name ?? ""));
      const planCount = toInt(String(row.pain_num ?? ""));
      if (!majorName && planCount === null) return null;
      const rawSubject = cleanText(String(row.subject ?? ""));
      return {
        category: cleanText(String(row.class_name ?? "")) || null,
        subjectType: normalizeSubjectType(rawSubject),
        planGroup: null,
        selectionRequirements: rawSubject || null,
        majorName: majorName || null,
        duration: null,
        planCount,
        schoolPlanCount: null,
        tuition: cleanText(String(row.tuition ?? "")) || null,
        batch: cleanText(String(row.class_name ?? "")) || null,
        rawCells: [
          String(row.year ?? ""),
          String(row.class_name ?? ""),
          String(row.province ?? ""),
          String(row.professional_name ?? ""),
          String(row.subject ?? ""),
          String(row.pain_num ?? ""),
          String(row.tuition ?? "")
        ].map(cleanText)
      };
    })
    .filter((record): record is JiangsuOfficialPlanRecord => Boolean(record));
}

function extractNjustPlanList(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  const nested = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : null;
  const value = nested?.list ?? root.list ?? root.rows;
  return Array.isArray(value) ? value : [];
}

function groupedContextBefore(html: string, index: number): GroupedPlanContext {
  const prefix = stripHtml(html.slice(Math.max(0, index - 5000), index));
  const headings = Array.from(prefix.matchAll(groupedContextPattern()));
  const latest = headings.at(-1);
  if (!latest) return { category: null, subjectType: null, batch: null };
  return groupedContextFromMatch(latest);
}

function groupedContextFromText(text: string): GroupedPlanContext | null {
  const matches = Array.from(text.matchAll(groupedContextPattern()));
  const latest = matches.at(-1);
  return latest ? groupedContextFromMatch(latest) : null;
}

function groupedContextPattern(): RegExp {
  return /(历史类|物理类|艺术类)\s*[（(]\s*([^）)]+?)\s*[）)]/gu;
}

function groupedContextFromMatch(match: RegExpMatchArray): GroupedPlanContext {
  const rawSubject = match[1];
  return {
    category: rawSubject === "艺术类" ? "艺术类" : null,
    subjectType: rawSubject === "艺术类" ? null : normalizeSubjectType(rawSubject),
    batch: cleanText(match[2]) || null
  };
}

function sumNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function formatPlanBatch(batch: string | null, category: string | null): string | null {
  if (!batch) return category;
  if (!category || category === "普通类") return batch;
  if (batch.includes(category)) return batch;
  return `${batch}（${category}）`;
}

interface HtmlTableRow {
  cells: Array<{ html: string; text: string; anchorText: string | null }>;
}

function parseHtmlTable(tableHtml: string): HtmlTableRow[] {
  return Array.from(tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/giu))
    .map((rowMatch) => {
      const rowHtml = rowMatch[0];
      const cells = Array.from(rowHtml.matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/giu)).map((cellMatch) => {
        const html = cellMatch[0];
        return {
          html,
          text: stripHtml(html),
          anchorText: firstAnchorText(html)
        };
      });
      return { cells };
    })
    .filter((row) => row.cells.length > 0);
}

function firstAnchorText(html: string): string | null {
  const match = html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/iu);
  return match ? stripHtml(match[1]) : null;
}

function stripHtml(value: string): string {
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function normalizeHeader(value: string): string {
  return cleanText(value).replace(/[（）()\s]/gu, "");
}

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
}

function cellText(cells: HtmlTableRow["cells"], index: number): string | null {
  if (index < 0) return null;
  return cleanText(cells[index]?.text ?? "") || null;
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

function normalizeSubjectType(value: string | null): string | null {
  if (!value) return null;
  if (value.includes("物理")) return "物理类";
  if (value.includes("历史")) return "历史类";
  return cleanText(value);
}

function inferSubjectType(subjectType: string | null, selectionRequirements: string | null): string | null {
  if (subjectType) return subjectType;
  if (selectionRequirements?.includes("物理")) return "物理类";
  if (selectionRequirements?.includes("历史")) return "历史类";
  return null;
}

function parsePlanGroup(value: string | null): { planGroup: string | null; selectionRequirements: string | null } {
  if (!value) return { planGroup: null, selectionRequirements: null };
  const text = cleanText(value);
  const group = text.match(/([A-Z]?\d{1,3})\s*专业组/iu)?.[1] ?? null;
  const requirement = text.match(/[（(]([^）)]+)[）)]/u)?.[1] ?? null;
  return {
    planGroup: group ? formatPlanGroup(group) : null,
    selectionRequirements: requirement ?? (text || null)
  };
}

function formatPlanGroup(value: string): string {
  const text = value.trim().toUpperCase();
  const match = text.match(/^([A-Z]?)(\d+)$/u);
  if (!match) return text;
  const [, prefix, digits] = match;
  return `${prefix}${digits.padStart(2, "0")}`;
}

function toInt(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\d+/u);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSchoolName(value: string): string {
  return value.replace(/\s+/gu, "").replace(/[（）()]/gu, "").toLowerCase();
}

function filterSources(sources: JiangsuOfficialPlanSource[], query?: string, limit?: number): JiangsuOfficialPlanSource[] {
  const keyword = query?.trim();
  const filtered = keyword ? sources.filter((source) => source.schoolName.includes(keyword)) : sources;
  const safeLimit = limit && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : filtered.length;
  return filtered.slice(0, safeLimit);
}

function officialPlanSourceKind(source: JiangsuOfficialPlanSource): string {
  return source.parser === "njust-json" ? "jiangsu-school-plan-json" : "jiangsu-school-plan-html";
}

function appendRequestParams(url: string, params?: Record<string, string | number | null | undefined>): string {
  if (!params) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

function officialHeaders(url: string, referer?: string): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml,application/json,*/*",
    referer: referer ?? url,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
  };
}
