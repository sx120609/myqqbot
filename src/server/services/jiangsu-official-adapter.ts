import { PDFParse } from "pdf-parse";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import * as XLSX from "xlsx";
import { AdmissionRepository } from "./admission-repository.js";
import type { UniversityRepository, UniversityRow } from "./university-repository.js";

export const JIANGSU_EEA_SOURCE = "jiangsu_eea";

export interface JiangsuOfficialScoreSource {
  year: number;
  subjectType: "物理类" | "历史类";
  batch?: string;
  title?: string;
  pageUrl?: string;
  pdfUrl?: string;
  excelUrl?: string;
  linkTextIncludes?: string;
  rank?: JiangsuOfficialRankSource | null;
  text?: string;
  records?: JiangsuScoreRecord[];
}

export interface JiangsuOfficialRankSource {
  pageUrl?: string;
  imageUrl?: string;
  imageUrls?: string[];
  linkTextIncludes?: string;
  text?: string;
}

export interface JiangsuOfficialSyncOptions {
  sources?: JiangsuOfficialScoreSource[];
  query?: string;
  limit?: number;
}

export interface JiangsuOfficialSyncResult {
  source: typeof JIANGSU_EEA_SOURCE;
  total: number;
  mapped: number;
  scoreRows: number;
  sourceRows: number;
  skipped: number;
  errors: Array<{ source: string; message: string }>;
}

export interface JiangsuScoreRecord {
  institutionCode: string;
  schoolName: string;
  planGroup: string;
  requirement: string | null;
  minScore: number;
  rawLine: string;
}

interface JiangsuRankRecord {
  score: number;
  sameCount: number;
  cumulative: number;
  rawLine: string;
}

interface ResolvedRankSource {
  rows: JiangsuRankRecord[];
  pageUrl?: string;
  imageUrl?: string;
  text: string;
}

const DEFAULT_RANK_TABLE_PAGE_URL = "https://www.jseea.cn/webfile/index/index_zkxx/2025-06-24/7343234265133355008.html";

export const DEFAULT_JIANGSU_OFFICIAL_SCORE_SOURCES: JiangsuOfficialScoreSource[] = [
  {
    year: 2025,
    subjectType: "物理类",
    batch: "本科批",
    title: "江苏省2025年普通高校招生普通类本科批次平行志愿投档线（物理等科目类）",
    pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2025-07-18/7351781448019349504.html",
    linkTextIncludes: "物理",
    rank: {
      pageUrl: DEFAULT_RANK_TABLE_PAGE_URL,
      linkTextIncludes: "普通类（物理"
    }
  },
  {
    year: 2025,
    subjectType: "历史类",
    batch: "本科批",
    title: "江苏省2025年普通高校招生普通类本科批次平行志愿投档线（历史等科目类）",
    pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2025-07-18/7351781284785426432.html",
    linkTextIncludes: "历史",
    rank: {
      pageUrl: DEFAULT_RANK_TABLE_PAGE_URL,
      linkTextIncludes: "普通类（历史"
    }
  },
  {
    year: 2024,
    subjectType: "物理类",
    batch: "本科批",
    title: "江苏省2024年普通类本科批次平行志愿投档线（物理等科目类）",
    pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2024-07-18/7219509116052443136.html",
    linkTextIncludes: "物理",
    rank: {
      pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2024-06-24/7210960924591525888.html",
      linkTextIncludes: "普通类（物理"
    }
  },
  {
    year: 2024,
    subjectType: "历史类",
    batch: "本科批",
    title: "江苏省2024年普通类本科批次平行志愿投档线（历史等科目类）",
    pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2024-07-18/7219509116052443136.html",
    linkTextIncludes: "历史",
    rank: {
      pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2024-06-24/7210960924591525888.html",
      linkTextIncludes: "普通类（历史"
    }
  },
  {
    year: 2023,
    subjectType: "物理类",
    batch: "本科批",
    title: "江苏省2023年普通类本科批次平行志愿投档线（物理等科目类）",
    pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2023-07-18/7086888854866628608.html",
    linkTextIncludes: "物理",
    rank: {
      pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2023-06-24/7078350479809318912.html",
      linkTextIncludes: "普通类（物理"
    }
  },
  {
    year: 2023,
    subjectType: "历史类",
    batch: "本科批",
    title: "江苏省2023年普通类本科批次平行志愿投档线（历史等科目类）",
    pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2023-07-18/7086888854866628608.html",
    linkTextIncludes: "历史",
    rank: {
      pageUrl: "https://www.jseea.cn/webfile/index/index_zkxx/2023-06-24/7078350479809318912.html",
      linkTextIncludes: "普通类（历史"
    }
  }
];

const DEFAULT_SCORE_SOURCES = DEFAULT_JIANGSU_OFFICIAL_SCORE_SOURCES;

export class JiangsuOfficialAdmissionAdapter {
  constructor(
    private readonly universities: UniversityRepository,
    private readonly admissions: AdmissionRepository,
    private readonly progress?: (message: string) => void
  ) {}

  async sync(options: JiangsuOfficialSyncOptions = {}): Promise<JiangsuOfficialSyncResult> {
    const sources = options.sources?.length ? options.sources : DEFAULT_SCORE_SOURCES;
    const targetJson = JSON.stringify({
      source: JIANGSU_EEA_SOURCE,
      sources: sources.map((source) => ({
        year: source.year,
        subjectType: source.subjectType,
        batch: source.batch ?? "本科批",
        title: source.title,
        pageUrl: source.pageUrl,
        pdfUrl: source.pdfUrl,
        excelUrl: source.excelUrl,
        linkTextIncludes: source.linkTextIncludes,
        rank: source.rank
      })),
      query: options.query,
      limit: options.limit
    });
    const jobId = this.admissions.startJob({
      source: JIANGSU_EEA_SOURCE,
      jobType: "sync-score",
      targetJson
    });
    const result: JiangsuOfficialSyncResult = {
      source: JIANGSU_EEA_SOURCE,
      total: 0,
      mapped: 0,
      scoreRows: 0,
      sourceRows: 0,
      skipped: 0,
      errors: []
    };

    try {
      for (const source of sources) {
        try {
          const resolved = await this.resolveScoreSource(source);
          const records = resolved.records ?? parseJiangsuEeaScoreText(resolved.text);
          result.total += records.length;
          const selected = filterRecords(records, options.query, options.limit);
          const rank = selected.length ? await this.resolveRankSource(source, result) : null;
          const rankByScore = new Map(rank?.rows.map((row) => [row.score, row]) ?? []);
          const rankSourceId = rank
            ? this.admissions.insertSource({
                source: JIANGSU_EEA_SOURCE,
                sourceKind: "jiangsu-eea-rank-image",
                sourceUrl: rank.imageUrl ?? rank.pageUrl ?? "official-rank-text",
                requestJson: JSON.stringify({
                  pageUrl: rank.pageUrl,
                  imageUrl: rank.imageUrl,
                  year: source.year,
                  province: "江苏",
                  subjectType: source.subjectType,
                  title: `江苏省${source.year}年普通高考普通类${source.subjectType}逐分段统计表`
                }),
                responseJson: JSON.stringify({
                  rowCount: rank.rows.length,
                  text: rank.text
                }),
                status: "success"
              })
            : null;
          if (rankSourceId) result.sourceRows += 1;
          const sourceId = this.admissions.insertSource({
            source: JIANGSU_EEA_SOURCE,
            sourceKind: scoreSourceKind(resolved),
            sourceUrl: resolved.pdfUrl ?? resolved.excelUrl ?? resolved.pageUrl ?? "official-text",
            requestJson: JSON.stringify({
              pageUrl: resolved.pageUrl,
              pdfUrl: resolved.pdfUrl,
              excelUrl: resolved.excelUrl,
              year: source.year,
              province: "江苏",
              subjectType: source.subjectType,
              batch: source.batch ?? "本科批",
              title: source.title
            }),
            responseJson: JSON.stringify({
              title: source.title,
              rowCount: records.length,
              rankRowCount: rank?.rows.length ?? 0,
              rankSourceId,
              rankSourceUrl: rank?.imageUrl ?? rank?.pageUrl ?? null,
              text: resolved.text
            }),
            status: "success"
          });
          result.sourceRows += 1;
          for (const record of selected) {
            const university = this.resolveUniversity(record.schoolName);
            if (!university) {
              result.skipped += 1;
                continue;
            }
            this.saveScore(university, record, source, resolved.pdfUrl ?? resolved.pageUrl ?? null, sourceId, rankByScore.get(record.minScore), rankSourceId);
            result.mapped += 1;
            result.scoreRows += 1;
          }
          this.report(`Synced ${selected.length}/${records.length} Jiangsu official score rows from ${source.title ?? resolved.pdfUrl ?? resolved.excelUrl ?? resolved.pageUrl ?? "source"}; rank rows ${rank?.rows.length ?? 0}.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push({ source: source.title ?? source.pdfUrl ?? source.pageUrl ?? "jiangsu-official", message });
          this.admissions.insertSource({
            source: JIANGSU_EEA_SOURCE,
            sourceKind: source.excelUrl ? "jiangsu-eea-score-excel" : "jiangsu-eea-score-pdf",
            sourceUrl: source.pdfUrl ?? source.excelUrl ?? source.pageUrl ?? "official-text",
            requestJson: JSON.stringify(source),
            status: "error",
            error: message
          });
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

  private async resolveScoreSource(source: JiangsuOfficialScoreSource): Promise<{ text: string; records?: JiangsuScoreRecord[]; pageUrl?: string; pdfUrl?: string; excelUrl?: string }> {
    if (source.records) return { text: renderScoreRecordsText(source.records), records: source.records, pageUrl: source.pageUrl, pdfUrl: source.pdfUrl, excelUrl: source.excelUrl };
    if (source.text) return { text: source.text, pageUrl: source.pageUrl, pdfUrl: source.pdfUrl, excelUrl: source.excelUrl };
    const resolvedUrl = source.pdfUrl ?? source.excelUrl ?? (source.pageUrl ? await resolveScoreFileUrlFromPage(source.pageUrl, source.linkTextIncludes) : null);
    if (!resolvedUrl) throw new Error("missing official score file url");
    if (/\.xlsx?(?:\?|$)/iu.test(resolvedUrl)) {
      const records = await extractScoreRecordsFromExcel(resolvedUrl);
      return { text: renderScoreRecordsText(records), records, pageUrl: source.pageUrl, excelUrl: resolvedUrl };
    }
    return { text: await extractPdfText(resolvedUrl), pageUrl: source.pageUrl, pdfUrl: resolvedUrl };
  }

  private async resolveRankSource(source: JiangsuOfficialScoreSource, result: JiangsuOfficialSyncResult): Promise<ResolvedRankSource | null> {
    if (source.rank === null) return null;
    const rankSource = source.rank;
    if (!rankSource) return null;
    try {
      const imageUrls = rankSource.imageUrls?.length
        ? rankSource.imageUrls
        : rankSource.imageUrl
          ? [rankSource.imageUrl]
          : rankSource.pageUrl
            ? await resolveImageUrlsFromPage(rankSource.pageUrl, rankSource.linkTextIncludes)
            : [];
      const text = rankSource.text ?? (imageUrls.length ? await extractRankTextFromImages(imageUrls) : null);
      if (!text) return null;
      const rows = parseJiangsuEeaRankText(text);
      return {
        rows,
        pageUrl: rankSource.pageUrl,
        imageUrl: imageUrls.join(","),
        text
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({ source: `${source.title ?? source.subjectType} rank`, message });
      this.admissions.insertSource({
        source: JIANGSU_EEA_SOURCE,
        sourceKind: "jiangsu-eea-rank-image",
        sourceUrl: rankSource.imageUrl ?? rankSource.pageUrl ?? "official-rank-text",
        requestJson: JSON.stringify({ ...rankSource, year: source.year, subjectType: source.subjectType }),
        status: "error",
        error: message
      });
      result.sourceRows += 1;
      return null;
    }
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

  private saveScore(
    university: UniversityRow,
    record: JiangsuScoreRecord,
    source: JiangsuOfficialScoreSource,
    sourceUrl: string | null,
    sourceId: number,
    rank?: JiangsuRankRecord,
    rankSourceId?: number | null
  ): void {
    this.admissions.upsertMapping({
      source: JIANGSU_EEA_SOURCE,
      universityId: university.id,
      sourceSchoolId: record.institutionCode,
      sourceSchoolName: record.schoolName,
      matchedName: record.schoolName,
      matchStatus: "matched",
      confidence: 1,
      sourceUrl,
      payloadJson: JSON.stringify({
        source: JIANGSU_EEA_SOURCE,
        institutionCode: record.institutionCode,
        schoolName: record.schoolName,
        year: source.year,
        province: "江苏"
      })
    });
    this.admissions.upsertScore({
      source: JIANGSU_EEA_SOURCE,
      scoreType: "school",
      universityId: university.id,
      sourceSchoolId: record.institutionCode,
      year: source.year,
      provinceName: "江苏",
      subjectType: source.subjectType,
      batch: source.batch ?? "本科批",
      planGroup: record.planGroup,
      minScore: record.minScore,
      minRank: rank?.cumulative ?? null,
      selectionRequirements: record.requirement,
      sourceUrl,
      sourceRecordId: String(sourceId),
      rawJson: JSON.stringify({
        ...record,
        rank: rank
          ? {
              sameCount: rank.sameCount,
              cumulative: rank.cumulative,
              sourceRecordId: rankSourceId ?? null
            }
          : null
      })
    });
  }

  private report(message: string): void {
    this.progress?.(message);
  }
}

export function parseJiangsuEeaRankText(text: string): JiangsuRankRecord[] {
  const rows = text
    .replace(/\u00a0/gu, " ")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .map((line) => {
      const match = line.match(/^(\d{3})\s+(\d{1,6})\s+(\d{1,6})(?:\s|$)/u);
      if (!match) return null;
      const score = Number(match[1]);
      const sameCount = Number(match[2]);
      const cumulative = Number(match[3]);
      if (!Number.isFinite(score) || !Number.isFinite(sameCount) || !Number.isFinite(cumulative)) return null;
      if (score < 100 || score > 750) return null;
      if (sameCount <= 0 || cumulative < sameCount) return null;
      return { score, sameCount, cumulative, rawLine: line };
    })
    .filter((row): row is JiangsuRankRecord => Boolean(row))
    .sort((left, right) => right.score - left.score);
  const byScore = new Map<number, JiangsuRankRecord>();
  for (const row of rows) {
    if (!byScore.has(row.score)) byScore.set(row.score, row);
  }
  return Array.from(byScore.values()).sort((left, right) => right.score - left.score);
}

export function parseJiangsuEeaScoreText(text: string): JiangsuScoreRecord[] {
  const records: JiangsuScoreRecord[] = [];
  const seen = new Set<string>();
  const lines = text
    .replace(/\u00a0/gu, " ")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\d{4})\s+(.+?)([A-Z]?\d{2,3})\s*专业组(?:[（(]([^）)]*)[）)])?\s+(\d{3})(?:\s|$)/u);
    if (!match) continue;
    const [, institutionCode, rawSchoolName, rawGroup, requirement, rawScore] = match;
    const schoolName = rawSchoolName.trim();
    const minScore = Number(rawScore);
    if (!schoolName || !Number.isFinite(minScore)) continue;
    const planGroup = formatPlanGroup(rawGroup);
    const key = [institutionCode, schoolName, planGroup, minScore].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      institutionCode,
      schoolName,
      planGroup,
      requirement: requirement?.trim() || null,
      minScore,
      rawLine: line
    });
  }
  return records;
}

export function parseJiangsuEeaScoreRows(rows: unknown[][]): JiangsuScoreRecord[] {
  const records: JiangsuScoreRecord[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const institutionCode = cleanCell(row[0]);
    const groupText = cleanCell(row[1]);
    const rawScore = cleanCell(row[2]);
    if (!institutionCode || !/^\d{4}$/u.test(institutionCode) || !groupText || !rawScore) continue;
    const minScore = Number(rawScore);
    if (!Number.isFinite(minScore)) continue;
    const parsed = parseSchoolGroupText(groupText);
    if (!parsed) continue;
    const key = [institutionCode, parsed.schoolName, parsed.planGroup, minScore].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      institutionCode,
      schoolName: parsed.schoolName,
      planGroup: parsed.planGroup,
      requirement: parsed.requirement,
      minScore,
      rawLine: row.map((cell) => cleanCell(cell) ?? "").join(" ")
    });
  }
  return records;
}

function filterRecords(records: JiangsuScoreRecord[], query?: string, limit?: number): JiangsuScoreRecord[] {
  const keyword = query?.trim();
  const filtered = keyword ? records.filter((record) => record.schoolName.includes(keyword)) : records;
  if (!limit || !Number.isFinite(limit)) return filtered;
  return filtered.slice(0, Math.max(1, Math.floor(limit)));
}

async function resolvePdfUrlFromPage(pageUrl: string, linkTextIncludes?: string): Promise<string | null> {
  return resolveScoreFileUrlFromPage(pageUrl, linkTextIncludes, "pdf");
}

async function resolveScoreFileUrlFromPage(pageUrl: string, linkTextIncludes?: string, extension?: "pdf" | "excel"): Promise<string | null> {
  const response = await fetch(pageUrl, { headers: officialHeaders(pageUrl) });
  if (!response.ok) throw new Error(`official page returned HTTP ${response.status}`);
  const html = await response.text();
  const pattern = extension === "pdf"
    ? /<a[^>]+href=["']([^"']+?\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/giu
    : extension === "excel"
      ? /<a[^>]+href=["']([^"']+?\.(?:xls|xlsx)(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/giu
      : /<a[^>]+href=["']([^"']+?\.(?:pdf|xls|xlsx)(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/giu;
  const links = Array.from(html.matchAll(pattern))
    .map((match) => ({
      url: new URL(match[1], pageUrl).toString(),
      text: `${stripHtml(match[2])} ${match[0].match(/title=["']([^"']+)["']/i)?.[1] ?? ""}`
    }));
  const target = linkTextIncludes
    ? links.find((link) => link.text.includes(linkTextIncludes)) ?? links.find((link) => decodeURIComponent(link.url).includes(linkTextIncludes))
    : links[0];
  return target?.url ?? null;
}

async function resolveImageUrlsFromPage(pageUrl: string, linkTextIncludes?: string): Promise<string[]> {
  const response = await fetch(pageUrl, { headers: officialHeaders(pageUrl) });
  if (!response.ok) throw new Error(`official rank page returned HTTP ${response.status}`);
  const html = await response.text();
  const links = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+?\.(?:jpg|jpeg|png)(?:\?[^"']*)?)["'][^>]*>/giu))
    .map((match) => ({
      url: new URL(match[1], pageUrl).toString().replace(/^http:\/\//u, "https://"),
      text: `${stripHtml(match[0])} ${match[0].match(/title=["']([^"']+)["']/i)?.[1] ?? ""}`
    }));
  const target = linkTextIncludes
    ? links.filter((link) => link.text.includes(linkTextIncludes) || decodeURIComponent(link.url).includes(linkTextIncludes))
    : links;
  return target.map((link) => link.url);
}

async function extractPdfText(pdfUrl: string): Promise<string> {
  const response = await fetch(pdfUrl, { headers: officialHeaders(pdfUrl) });
  if (!response.ok) throw new Error(`official PDF returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractScoreRecordsFromExcel(excelUrl: string): Promise<JiangsuScoreRecord[]> {
  const response = await fetch(excelUrl, { headers: officialHeaders(excelUrl) });
  if (!response.ok) throw new Error(`official score Excel returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const records: JiangsuScoreRecord[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, blankrows: false });
    records.push(...parseJiangsuEeaScoreRows(rows));
  }
  return records;
}

async function extractRankTextFromImages(imageUrls: string[]): Promise<string> {
  const worker = await createWorker("eng", undefined, {
    cachePath: process.env.TESSERACT_CACHE_PATH ?? "data/tesseract-cache"
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789\n ",
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1"
    });
    const texts: string[] = [];
    for (const imageUrl of imageUrls) {
      const response = await fetch(imageUrl, { headers: officialHeaders(imageUrl) });
      if (!response.ok) throw new Error(`official rank image returned HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (!width || !height) throw new Error("official rank image metadata is empty");
      for (const box of rankTableBoxes(width, height)) {
        const png = await sharp(bytes)
          .extract(box)
          .grayscale()
          .normalise()
          .threshold(150)
          .resize({ width: box.width * 3, height: box.height * 3, kernel: "nearest" })
          .png()
          .toBuffer();
        const result = await worker.recognize(png);
        texts.push(result.data.text);
      }
    }
    return texts.join("\n");
  } finally {
    await worker.terminate();
  }
}

function rankTableBoxes(width: number, height: number): Array<{ left: number; top: number; width: number; height: number }> {
  const scaleX = width / 1588;
  const pageCount = height / width > 2.2 ? 2 : 1;
  const baseHeight = pageCount === 2 ? 4488 : 2244;
  const scaleY = height / baseHeight;
  const pageHeight = height / pageCount;
  const groupXs = [
    [60, 495],
    [580, 1015],
    [1100, 1535]
  ];
  const boxes: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (let page = 0; page < pageCount; page += 1) {
    const top = Math.round(page * pageHeight + 165 * scaleY);
    const cropHeight = Math.min(Math.round(1990 * scaleY), height - top);
    if (cropHeight <= 0) continue;
    for (const [leftBase, rightBase] of groupXs) {
      const left = Math.round(leftBase * scaleX);
      const right = Math.min(width, Math.round(rightBase * scaleX));
      const cropWidth = right - left;
      if (cropWidth > 0) boxes.push({ left, top, width: cropWidth, height: cropHeight });
    }
  }
  return boxes;
}

function officialHeaders(url: string): Record<string, string> {
  return {
    accept: "text/html,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/avif,image/webp,image/apng,image/*,*/*",
    referer: url.includes("/webfile/") ? "https://www.jseea.cn/" : url,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/gu, "").replace(/\s+/gu, " ").trim();
}

function renderScoreRecordsText(records: JiangsuScoreRecord[]): string {
  return records.map((record) => record.rawLine).join("\n");
}

function scoreSourceKind(resolved: { excelUrl?: string; pdfUrl?: string }): string {
  if (resolved.excelUrl) return "jiangsu-eea-score-excel";
  if (resolved.pdfUrl) return "jiangsu-eea-score-pdf";
  return "jiangsu-eea-score-text";
}

function cleanCell(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/gu, "")
    .trim();
  return text || null;
}

function parseSchoolGroupText(value: string): { schoolName: string; planGroup: string; requirement: string | null } | null {
  const match = value.match(/^(.+?)([A-Z]?\d{2,3})专业组(?:[（(]([^）)]*)[）)])?/u);
  if (!match) return null;
  const [, rawSchoolName, rawGroup, requirement] = match;
  const schoolName = rawSchoolName.trim();
  if (!schoolName) return null;
  return {
    schoolName,
    planGroup: formatPlanGroup(rawGroup),
    requirement: requirement?.trim() || null
  };
}

function normalizeSchoolName(value: string): string {
  return value.replace(/\s+/gu, "").replace(/[（）()]/gu, "").toLowerCase();
}

function formatPlanGroup(value: string): string {
  const text = value.trim().toUpperCase();
  const match = text.match(/^([A-Z]?)(\d+)$/u);
  if (!match) return text;
  const [, prefix, digits] = match;
  return `${prefix}${digits.padStart(2, "0")}`;
}
