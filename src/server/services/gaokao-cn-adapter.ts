import {
  ADMISSION_SOURCE,
  AdmissionRepository,
  normalizeProvinceName,
  normalizeSubjectType
} from "./admission-repository.js";
import { defaultAdmissionPlanYears, defaultAdmissionScoreYears } from "./admission-calendar.js";
import type { UniversityRepository, UniversityRow } from "./university-repository.js";

const API_BASE = "https://api.zjzw.cn/web/api/";
const SITE_BASE = "https://www.gaokao.cn";
const DEFAULT_LIMIT = 10;
const DEFAULT_PAGE_SIZE = 80;
const MAX_PAGES = 8;

export type GaokaoCnProgressReporter = (message: string) => void;

export interface GaokaoCnSyncOptions {
  query?: string;
  limit?: number;
  offset?: number;
  universityId?: number;
  provinces?: string[];
  subjectTypes?: string[];
  scoreYears?: number[];
  planYears?: number[];
  includePlans?: boolean;
  includeScores?: boolean;
  includeSpecialScores?: boolean;
  eligibleOnly?: boolean;
}

export interface GaokaoCnSyncResult {
  source: typeof ADMISSION_SOURCE;
  total: number;
  candidateTotal: number;
  offset: number;
  nextOffset: number;
  mapped: number;
  planRows: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
  skipped: number;
  errors: Array<{ university: string; message: string }>;
}

interface GaokaoApiResponse<T> {
  code?: string;
  message?: string;
  data?:
    | {
        item?: T[];
        numFound?: number;
      }
    | T[]
    | string;
}

export interface GaokaoSchool {
  school_id: number | string;
  name: string;
  province_name?: string | null;
  city_name?: string | null;
  level_name?: string | null;
  type_name?: string | null;
  nature_name?: string | null;
  f211?: number | string | null;
  f985?: number | string | null;
  dual_class_name?: string | null;
}

interface GaokaoSchoolScore {
  id?: string | number;
  school_id?: number | string;
  name?: string;
  year?: number | string;
  local_province_name?: string;
  local_type_name?: string;
  local_batch_name?: string;
  local_batch_id?: string | number;
  sg_name?: string | number;
  sg_info?: string;
  min?: string | number;
  min_section?: string | number;
  average?: string | number;
  avg_section?: string | number;
  max?: string | number;
  num?: string | number;
  proscore?: string | number;
  diff?: string | number;
}

interface GaokaoMajorScore extends GaokaoSchoolScore {
  spname?: string;
  sp_name?: string;
  info?: string;
  sp_info?: string;
  sp_scode?: string | number;
  special_group?: string | number;
}

interface GaokaoPlanSummary {
  id?: string | number;
  school_id?: number | string;
  name?: string;
  year?: number | string;
  sc_num?: string | number;
  sc_special_num?: string | number;
  sc_extend_num?: string | number;
}

interface GaokaoPlanDetail {
  school_id?: number | string;
  year?: number | string;
  name?: string;
  local_province_name?: string;
  local_type_name?: string;
  local_batch_name?: string;
  sg_name?: string | number;
  sg_info?: string;
  special_group?: string | number;
  spname?: string;
  sp_name?: string;
  info?: string;
  sp_info?: string;
  sp_xuanke?: string;
  spcode?: string | number;
  num?: string | number;
  tuition?: string | number;
  tuition_unit?: string;
  length?: string;
  campus?: string | null;
  campus_name?: string | null;
  school_area?: string | null;
  address?: string | null;
  remark?: string;
}

interface FetchCount {
  rows: number;
  sourceRows: number;
}

export const GAOKAO_PROVINCES = [
  ["11", "北京"],
  ["12", "天津"],
  ["13", "河北"],
  ["14", "山西"],
  ["15", "内蒙古"],
  ["21", "辽宁"],
  ["22", "吉林"],
  ["23", "黑龙江"],
  ["31", "上海"],
  ["32", "江苏"],
  ["33", "浙江"],
  ["34", "安徽"],
  ["35", "福建"],
  ["36", "江西"],
  ["37", "山东"],
  ["41", "河南"],
  ["42", "湖北"],
  ["43", "湖南"],
  ["44", "广东"],
  ["45", "广西"],
  ["46", "海南"],
  ["50", "重庆"],
  ["51", "四川"],
  ["52", "贵州"],
  ["53", "云南"],
  ["54", "西藏"],
  ["61", "陕西"],
  ["62", "甘肃"],
  ["63", "青海"],
  ["64", "宁夏"],
  ["65", "新疆"]
] as const;

const SUBJECT_TYPES = [
  { id: "2073", name: "物理类" },
  { id: "2074", name: "历史类" },
  { id: "1", name: "理科" },
  { id: "2", name: "文科" },
  { id: "3", name: "综合改革" }
] as const;

const COMPREHENSIVE_REFORM_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const TRADITIONAL_PROVINCES = new Set(["西藏", "新疆"]);
const THIRD_BATCH_3_1_2_PROVINCES = new Set(["河北", "辽宁", "江苏", "福建", "湖北", "湖南", "广东", "重庆"]);
const FOURTH_BATCH_3_1_2_PROVINCES = new Set(["吉林", "黑龙江", "安徽", "江西", "广西", "贵州", "甘肃"]);
const FIFTH_BATCH_3_1_2_PROVINCES = new Set(["山西", "内蒙古", "河南", "四川", "云南", "陕西", "青海", "宁夏"]);

export class GaokaoCnAdapter {
  constructor(
    private readonly universities: UniversityRepository,
    private readonly admissions: AdmissionRepository,
    private readonly progress?: GaokaoCnProgressReporter
  ) {}

  async sync(options: GaokaoCnSyncOptions = {}): Promise<GaokaoCnSyncResult> {
    const jobId = this.admissions.startJob({
      jobType: gaokaoJobType(options),
      targetJson: JSON.stringify(options)
    });
    const result: GaokaoCnSyncResult = {
      source: ADMISSION_SOURCE,
      total: 0,
      candidateTotal: 0,
      offset: normalizeOffset(options.offset),
      nextOffset: 0,
      mapped: 0,
      planRows: 0,
      schoolScoreRows: 0,
      majorScoreRows: 0,
      sourceRows: 0,
      skipped: 0,
      errors: []
    };

    try {
      const candidates = this.candidateUniversities(options);
      const rows = candidates.slice(result.offset, result.offset + clampLimit(options.limit));
      result.candidateTotal = candidates.length;
      result.total = rows.length;
      result.nextOffset = computeNextOffset(result.offset, rows.length, result.candidateTotal);
      this.report(`Preparing Gaokao.cn admission sync for ${rows.length} schools...`);

      for (const [index, university] of rows.entries()) {
        if (index > 0) await delay(700);
        try {
          const mapped = await this.ensureMapping(university);
          if (!mapped) {
            result.skipped += 1;
            continue;
          }
          result.mapped += 1;
          const partial = await this.syncMappedUniversity(university, mapped.sourceSchoolId, options);
          result.planRows += partial.planRows;
          result.schoolScoreRows += partial.schoolScoreRows;
          result.majorScoreRows += partial.majorScoreRows;
          result.sourceRows += partial.sourceRows;
          this.report(
            `Saved admission data for ${university.name}: plans ${partial.planRows}, school scores ${partial.schoolScoreRows}, major scores ${partial.majorScoreRows}.`
          );
        } catch (error) {
          result.errors.push({ university: university.name, message: getErrorMessage(error) });
          this.report(`Gaokao.cn sync failed for ${university.name}: ${getErrorMessage(error)}`);
        }
      }

      this.admissions.finishJob(jobId, {
        status: result.errors.length ? "error" : "success",
        error: result.errors.length ? summarizeErrors(result.errors) : null,
        resultJson: JSON.stringify(result)
      });
      return result;
    } catch (error) {
      this.admissions.finishJob(jobId, { status: "error", error: getErrorMessage(error), resultJson: JSON.stringify(result) });
      throw error;
    }
  }

  async ensureMapping(university: UniversityRow): Promise<{ sourceSchoolId: string; sourceSchoolName: string } | null> {
    const existing = this.admissions.getMapping(university.id);
    if (existing?.matchStatus === "unmatched" || existing?.matchStatus === "ambiguous") {
      return null;
    }
    if (existing?.sourceSchoolId) {
      const snapshot = parseSchoolSnapshot(existing.payloadJson);
      if (snapshot) this.recordSchoolProfileSnapshot(university, existing.sourceSchoolId, snapshot);
      return { sourceSchoolId: existing.sourceSchoolId, sourceSchoolName: existing.sourceSchoolName };
    }

    const { schools, sourceOk } = await this.searchSchoolCandidates(university.name, university.id);
    const match = pickBestSchool(university.name, schools);
    if (!match) {
      if (sourceOk) {
        const hasCandidates = schools.length > 0;
        this.admissions.upsertMapping({
          universityId: university.id,
          sourceSchoolId: `${hasCandidates ? "ambiguous" : "unmatched"}:${university.id}`,
          sourceSchoolName: university.name,
          matchedName: null,
          matchStatus: hasCandidates ? "ambiguous" : "unmatched",
          confidence: 0,
          sourceUrl: null,
          payloadJson: JSON.stringify({ candidates: schools.slice(0, 10) })
        });
      }
      this.report(`No Gaokao.cn school match for ${university.name}.`);
      return null;
    }

    const sourceSchoolId = String(match.school_id);
    this.admissions.upsertMapping({
      universityId: university.id,
      sourceSchoolId,
      sourceSchoolName: match.name,
      matchedName: match.name,
      matchStatus: "matched",
      confidence: normalizeName(match.name) === normalizeName(university.name) ? 1 : 0.72,
      sourceUrl: schoolUrl(sourceSchoolId),
      payloadJson: JSON.stringify(match)
    });
    this.recordSchoolProfileSnapshot(university, sourceSchoolId, match);
    return { sourceSchoolId, sourceSchoolName: match.name };
  }

  async searchSchools(keyword: string, universityId?: number): Promise<GaokaoSchool[]> {
    return (await this.searchSchoolCandidates(keyword, universityId)).schools;
  }

  private async searchSchoolCandidates(keyword: string, universityId?: number): Promise<{ schools: GaokaoSchool[]; sourceOk: boolean }> {
    const request = { keyword, uri: "apidata/api/gk/school/lists" };
    const { payload, sourceId } = await this.fetchAndRecord<GaokaoSchool>("school-search", request, universityId, null);
    const schools = responseItems(payload);
    return { schools, sourceOk: Boolean(sourceId && payload.code === "0000") };
  }

  private candidateUniversities(options: GaokaoCnSyncOptions): UniversityRow[] {
    if (options.universityId) {
      const university = this.universities.getUniversity(options.universityId);
      return university ? [university] : [];
    }
    const rows = this.universities.listUniversities(options.query ?? "", 100_000, 0);
    return options.eligibleOnly === false ? rows : rows.filter(isLikelyGaokaoCandidate);
  }

  private async syncMappedUniversity(
    university: UniversityRow,
    sourceSchoolId: string,
    options: GaokaoCnSyncOptions
  ): Promise<Pick<GaokaoCnSyncResult, "planRows" | "schoolScoreRows" | "majorScoreRows" | "sourceRows">> {
    const provinces = normalizeProvinceFilter(options.provinces);
    const scoreYears = normalizeYears(options.scoreYears, defaultAdmissionScoreYears());
    const planYears = normalizeYears(options.planYears, defaultAdmissionPlanYears());
    const explicitSubjectTypes = normalizeSubjectFilter(options.subjectTypes);
    const result = { planRows: 0, schoolScoreRows: 0, majorScoreRows: 0, sourceRows: 0 };
    const includePlans = options.includePlans !== false;
    const includeScores = options.includeScores !== false;

    for (const province of provinces) {
      if (includePlans) {
        for (const year of planYears) {
          const subjectTypes = explicitSubjectTypes ?? defaultSubjectTypesForProvinceYear(province.name, year);
          for (const subject of subjectTypes) {
            const summary = await this.fetchPlanSummary(university, sourceSchoolId, year, province.id, subject.id);
            result.planRows += summary.rows;
            result.sourceRows += summary.sourceRows;
            const detail = await this.fetchPlanDetails(university, sourceSchoolId, year, province.id, subject.id);
            result.planRows += detail.rows;
            result.sourceRows += detail.sourceRows;
            if (summary.rows + detail.rows > 0) await delay(180);
          }
        }
      }

      if (includeScores) {
        for (const year of scoreYears) {
          const subjectTypes = explicitSubjectTypes ?? defaultSubjectTypesForProvinceYear(province.name, year);
          for (const subject of subjectTypes) {
            const schoolScores = await this.fetchSchoolScores(university, sourceSchoolId, year, province.id, subject.id);
            result.schoolScoreRows += schoolScores.rows;
            result.sourceRows += schoolScores.sourceRows;
            if (options.includeSpecialScores !== false) {
              const majorScores = await this.fetchMajorScores(university, sourceSchoolId, year, province.id, subject.id);
              result.majorScoreRows += majorScores.rows;
              result.sourceRows += majorScores.sourceRows;
            }
            if (schoolScores.rows > 0) await delay(180);
          }
        }
      }
    }

    return result;
  }

  private async fetchPlanSummary(
    university: UniversityRow,
    sourceSchoolId: string,
    year: number,
    provinceId: string,
    subjectTypeId: string
  ): Promise<FetchCount> {
    const request = {
      uri: "apidata/api/gkv3/plan/schoollists",
      school_id: sourceSchoolId,
      local_province_id: provinceId,
      local_type_id: subjectTypeId,
      year,
      page: 1,
      size: DEFAULT_PAGE_SIZE
    };
    const { payload, sourceId } = await this.fetchAndRecord<GaokaoPlanSummary>(
      "plan-school-summary",
      request,
      university.id,
      sourceSchoolId
    );
    const items = responseItems(payload);
    for (const item of items) {
      this.admissions.upsertPlan({
        universityId: university.id,
        sourceSchoolId,
        year,
        provinceId,
        provinceName: provinceNameById(provinceId),
        subjectTypeId,
        subjectType: subjectNameById(subjectTypeId),
        planCount: toInt(item.sc_num),
        schoolPlanCount: toInt(item.sc_num),
        majorCount: toInt(item.sc_special_num),
        sourceUrl: `${SITE_BASE}/school/${encodeURIComponent(sourceSchoolId)}/plan`,
        sourceRecordId: String(sourceId),
        rawJson: JSON.stringify(item)
      });
    }
    return { rows: items.length, sourceRows: sourceId ? 1 : 0 };
  }

  private recordSchoolProfileSnapshot(university: UniversityRow, sourceSchoolId: string, match: GaokaoSchool): void {
    const sourceUrl = schoolUrl(sourceSchoolId);
    this.admissions.insertSource({
      sourceKind: "school-profile",
      universityId: university.id,
      sourceSchoolId,
      sourceUrl,
      requestJson: JSON.stringify({ school_id: sourceSchoolId, source: "school-search-match" }),
      responseJson: JSON.stringify({ code: "0000", data: { item: [match] } }),
      status: "success"
    });
    this.universities.upsertSchoolProfile({
      universityId: university.id,
      source: ADMISSION_SOURCE,
      sourceSchoolId,
      sourceUrl,
      payloadJson: JSON.stringify(match),
      profileText: renderGaokaoSchoolProfile(match, sourceSchoolId, sourceUrl)
    });
  }

  private async fetchSchoolScores(
    university: UniversityRow,
    sourceSchoolId: string,
    year: number,
    provinceId: string,
    subjectTypeId: string
  ): Promise<FetchCount> {
    let saved = 0;
    let sourceRows = 0;
    for await (const { items, sourceId } of this.fetchPaged<GaokaoSchoolScore>("score-school", {
      uri: "apidata/api/gk/score/province",
      school_id: sourceSchoolId,
      local_province_id: provinceId,
      local_type_id: subjectTypeId,
      year,
      zslx: 0
    }, university.id, sourceSchoolId, 20)) {
      if (sourceId) sourceRows += 1;
      for (const item of items) {
        this.admissions.upsertScore({
          scoreType: "school",
          universityId: university.id,
          sourceSchoolId,
          year: toInt(item.year) ?? year,
          provinceId,
          provinceName: item.local_province_name ?? provinceNameById(provinceId),
          subjectTypeId,
          subjectType: item.local_type_name ?? subjectNameById(subjectTypeId),
          batch: item.local_batch_name,
          planGroup: stringify(item.sg_name),
          minScore: toNumber(item.min),
          minRank: toInt(item.min_section),
          avgScore: toNumber(item.average),
          avgRank: toInt(item.avg_section),
          maxScore: toNumber(item.max),
          planCount: toInt(item.num),
          controlScore: toNumber(item.proscore),
          diffScore: toNumber(item.diff),
          selectionRequirements: item.sg_info,
          sourceUrl: `${SITE_BASE}/school/${encodeURIComponent(sourceSchoolId)}/provinceline`,
          sourceRecordId: String(sourceId),
          rawJson: JSON.stringify(item)
        });
        saved += 1;
      }
    }
    return { rows: saved, sourceRows };
  }

  private async fetchPlanDetails(
    university: UniversityRow,
    sourceSchoolId: string,
    year: number,
    provinceId: string,
    subjectTypeId: string
  ): Promise<FetchCount> {
    let saved = 0;
    let sourceRows = 0;
    for await (const { items, sourceId } of this.fetchPaged<GaokaoPlanDetail>("plan-major", {
      uri: "apidata/api/gkv3/plan/school",
      school_id: sourceSchoolId,
      local_province_id: provinceId,
      local_type_id: subjectTypeId,
      year
    }, university.id, sourceSchoolId, 10)) {
      if (sourceId) sourceRows += 1;
      for (const item of items) {
        this.admissions.upsertPlan({
          universityId: university.id,
          sourceSchoolId,
          year: toInt(item.year) ?? year,
          provinceId,
          provinceName: item.local_province_name ?? provinceNameById(provinceId),
          subjectTypeId,
          subjectType: item.local_type_name ?? subjectNameById(subjectTypeId),
          batch: item.local_batch_name,
          planGroup: stringify(item.sg_name ?? item.special_group),
          majorName: item.spname ?? joinMajorName(item.sp_name, item.info),
          planCount: toInt(item.num),
          tuition: joinTuition(item.tuition, item.tuition_unit),
          duration: stringify(item.length),
          campus: pickCampus(item),
          selectionRequirements: item.sg_info || item.sp_xuanke || item.sp_info,
          sourceUrl: `${SITE_BASE}/school/${encodeURIComponent(sourceSchoolId)}/plan`,
          sourceRecordId: String(sourceId),
          rawJson: JSON.stringify(item)
        });
        saved += 1;
      }
    }
    return { rows: saved, sourceRows };
  }

  private async fetchMajorScores(
    university: UniversityRow,
    sourceSchoolId: string,
    year: number,
    provinceId: string,
    subjectTypeId: string
  ): Promise<FetchCount> {
    let saved = 0;
    let sourceRows = 0;
    for await (const { items, sourceId } of this.fetchPaged<GaokaoMajorScore>("score-major", {
      uri: "apidata/api/gk/score/special",
      school_id: sourceSchoolId,
      local_province_id: provinceId,
      local_type_id: subjectTypeId,
      year,
      zslx: 0
    }, university.id, sourceSchoolId, 20)) {
      if (sourceId) sourceRows += 1;
      for (const item of items) {
        this.admissions.upsertScore({
          scoreType: "major",
          universityId: university.id,
          sourceSchoolId,
          year: toInt(item.year) ?? year,
          provinceId,
          provinceName: item.local_province_name ?? provinceNameById(provinceId),
          subjectTypeId,
          subjectType: item.local_type_name ?? subjectNameById(subjectTypeId),
          batch: item.local_batch_name,
          planGroup: stringify(item.sg_name ?? item.special_group),
          majorName: item.spname ?? joinMajorName(item.sp_name, item.info),
          minScore: toNumber(item.min),
          minRank: toInt(item.min_section),
          avgScore: toNumber(item.average),
          avgRank: toInt(item.avg_section),
          maxScore: toNumber(item.max),
          planCount: toInt(item.num),
          controlScore: toNumber(item.proscore),
          diffScore: toNumber(item.diff),
          selectionRequirements: item.sg_info || item.sp_info,
          sourceUrl: `${SITE_BASE}/school/${encodeURIComponent(sourceSchoolId)}/specialtyline`,
          sourceRecordId: String(sourceId),
          rawJson: JSON.stringify(item)
        });
        saved += 1;
      }
    }
    return { rows: saved, sourceRows };
  }

  private async *fetchPaged<T extends object>(
    sourceKind: string,
    baseRequest: Record<string, unknown>,
    universityId: number,
    sourceSchoolId: string,
    pageSize = DEFAULT_PAGE_SIZE
  ): AsyncGenerator<{ items: T[]; sourceId: number | null }> {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const request = { ...baseRequest, page, size: pageSize };
      const { payload, sourceId } = await this.fetchAndRecord<T>(sourceKind, request, universityId, sourceSchoolId);
      const items = responseItems(payload);
      yield { items, sourceId };
      const total = responseTotal(payload, items.length);
      if (!items.length || page * pageSize >= total) break;
      await delay(220);
    }
  }

  private async fetchAndRecord<T extends object>(
    sourceKind: string,
    request: Record<string, unknown>,
    universityId: number | undefined,
    sourceSchoolId: string | null
  ): Promise<{ payload: GaokaoApiResponse<T>; sourceId: number | null }> {
    const url = buildApiUrl(request);
    let payload: GaokaoApiResponse<T>;
    try {
      payload = (await fetchJsonWithRetry(url)) as GaokaoApiResponse<T>;
    } catch (error) {
      this.admissions.insertSource({
        sourceKind,
        universityId,
        sourceSchoolId,
        sourceUrl: url,
        requestJson: JSON.stringify(request),
        status: "error",
        error: getErrorMessage(error)
      });
      throw new Error(`Gaokao.cn ${sourceKind} fetch failed (${summarizeRequestTarget(request)}): ${getErrorMessage(error)}`);
    }

    const sourceId = this.admissions.insertSource({
      sourceKind,
      universityId,
      sourceSchoolId,
      sourceUrl: url,
      requestJson: JSON.stringify(request),
      responseJson: JSON.stringify(payload),
      status: payload.code === "0000" ? "success" : "error",
      error: payload.code === "0000" ? null : payload.message ?? payload.code ?? "unknown_error"
    });
    if (payload.code !== "0000") {
      throw new Error(
        `Gaokao.cn ${sourceKind} returned ${payload.code ?? "unknown"} (${summarizeRequestTarget(request)}): ${payload.message ?? "unknown_error"}`
      );
    }
    return { payload, sourceId };
  }

  private report(message: string): void {
    this.progress?.(message);
  }
}

function buildApiUrl(params: Record<string, unknown>): string {
  const uri = params.uri ? String(params.uri) : "";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "uri") continue;
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return `${API_BASE}?${uri ? `uri=${uri}${suffix ? `&${suffix}` : ""}` : suffix}`;
}

function responseItems<T extends object>(payload: GaokaoApiResponse<T>): T[] {
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") return payload.data.item ?? [];
  return [];
}

function responseTotal<T extends object>(payload: GaokaoApiResponse<T>, fallback: number): number {
  if (payload.data && !Array.isArray(payload.data) && typeof payload.data === "object") {
    return Number(payload.data.numFound ?? fallback);
  }
  return fallback;
}

function pickBestSchool(universityName: string, schools: GaokaoSchool[]): GaokaoSchool | null {
  const target = normalizeName(universityName);
  return (
    schools.find((school) => normalizeName(school.name) === target) ??
    schools.find((school) => normalizeName(school.name).includes(target) || target.includes(normalizeName(school.name))) ??
    null
  );
}

function isLikelyGaokaoCandidate(university: UniversityRow): boolean {
  const name = university.name.trim();
  if (!/^[\u4e00-\u9fff]/u.test(name)) return false;
  if (/[A-Za-z&]/u.test(name)) return false;
  return /[\u4e00-\u9fff]/u.test(name);
}

function parseSchoolSnapshot(payloadJson: string): GaokaoSchool | null {
  try {
    const parsed = JSON.parse(payloadJson) as GaokaoSchool;
    return parsed?.school_id && parsed?.name ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[·.\s（）()]/g, "");
}

function normalizeProvinceFilter(values: string[] | undefined): Array<{ id: string; name: string }> {
  if (!values?.length) return GAOKAO_PROVINCES.map(([id, name]) => ({ id, name }));
  const wanted = new Set(values.map(normalizeProvinceName));
  return GAOKAO_PROVINCES.filter(([, name]) => wanted.has(name)).map(([id, name]) => ({ id, name }));
}

function normalizeSubjectFilter(values: string[] | undefined): typeof SUBJECT_TYPES[number][] | null {
  if (!values?.length) return null;
  const wanted = new Set(values.map((value) => normalizeSubjectType(value)));
  const matched = SUBJECT_TYPES.filter((subject) => wanted.has(normalizeSubjectType(subject.name)) || wanted.has(subject.id));
  return matched.length ? matched : null;
}

function defaultSubjectTypesForProvinceYear(provinceName: string, year: number): typeof SUBJECT_TYPES[number][] {
  const province = normalizeProvinceName(provinceName);
  if (COMPREHENSIVE_REFORM_PROVINCES.has(province)) return SUBJECT_TYPES.filter((subject) => subject.name === "综合改革");
  if (TRADITIONAL_PROVINCES.has(province)) return SUBJECT_TYPES.filter((subject) => subject.name === "理科" || subject.name === "文科");
  if (THIRD_BATCH_3_1_2_PROVINCES.has(province)) return physicalHistorySubjects();
  if (FOURTH_BATCH_3_1_2_PROVINCES.has(province)) return year >= 2024 ? physicalHistorySubjects() : scienceArtsSubjects();
  if (FIFTH_BATCH_3_1_2_PROVINCES.has(province)) return year >= 2025 ? physicalHistorySubjects() : scienceArtsSubjects();
  return scienceArtsSubjects();
}

function physicalHistorySubjects(): typeof SUBJECT_TYPES[number][] {
  return SUBJECT_TYPES.filter((subject) => subject.name === "物理类" || subject.name === "历史类");
}

function scienceArtsSubjects(): typeof SUBJECT_TYPES[number][] {
  return SUBJECT_TYPES.filter((subject) => subject.name === "理科" || subject.name === "文科");
}

function normalizeYears(values: number[] | undefined, fallback: number[]): number[] {
  const years = (values?.length ? values : fallback)
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isFinite(value) && value >= 2000 && value <= 2100);
  return Array.from(new Set(years)).sort((a, b) => b - a);
}

function provinceNameById(id: string): string {
  return GAOKAO_PROVINCES.find(([provinceId]) => provinceId === id)?.[1] ?? id;
}

function subjectNameById(id: string): string {
  return SUBJECT_TYPES.find((subject) => subject.id === id)?.name ?? id;
}

function joinMajorName(name: unknown, info: unknown): string | null {
  const main = stringify(name);
  const suffix = stringify(info);
  if (!main) return suffix;
  if (!suffix) return main;
  return `${main}${suffix}`;
}

function joinTuition(value: unknown, unit: unknown): string | null {
  const amount = stringify(value);
  if (!amount) return null;
  const suffix = stringify(unit);
  return suffix ? `${amount}${suffix}` : amount;
}

function pickCampus(item: GaokaoPlanDetail): string | null {
  return (
    stringify(item.campus_name) ??
    stringify(item.campus) ??
    stringify(item.school_area) ??
    stringify(item.address) ??
    campusFromRemark(item.remark)
  );
}

function campusFromRemark(value: unknown): string | null {
  const text = stringify(value);
  if (!text || !/校区/u.test(text)) return null;
  return text.length <= 80 ? text : null;
}

function stringify(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text && text !== "-" ? text : null;
}

function toNumber(value: unknown): number | null {
  const text = stringify(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInt(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function clampLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function normalizeOffset(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function computeNextOffset(offset: number, selected: number, candidateTotal: number): number {
  if (!candidateTotal || !selected) return 0;
  const next = offset + selected;
  return next >= candidateTotal ? 0 : next;
}

function gaokaoJobType(options: GaokaoCnSyncOptions): string {
  const includePlans = options.includePlans !== false;
  const includeScores = options.includeScores !== false;
  if (includePlans && includeScores) return "sync-mixed";
  if (includePlans) return "sync-plan";
  if (includeScores) return "sync-score";
  return "sync-mapping";
}

function summarizeRequestTarget(request: Record<string, unknown>): string {
  const picked = [
    "uri",
    "school_id",
    "local_province_id",
    "local_type_id",
    "year",
    "page",
    "size"
  ]
    .map((key) => (request[key] === undefined || request[key] === null || request[key] === "" ? null : `${key}=${String(request[key])}`))
    .filter((item): item is string => Boolean(item));
  return picked.length ? picked.join(", ") : "no request target";
}

function summarizeErrors(errors: Array<{ university: string; message: string }>): string {
  return errors
    .slice(0, 5)
    .map((error) => `${error.university}: ${error.message}`)
    .join("; ");
}

function schoolUrl(schoolId: string): string {
  return `${SITE_BASE}/school/${encodeURIComponent(schoolId)}`;
}

function renderGaokaoSchoolProfile(school: GaokaoSchool, schoolId: string, sourceUrl: string): string {
  const tags = [
    truthyFlag(school.f985) ? "985" : null,
    truthyFlag(school.f211) ? "211" : null,
    stringify(school.dual_class_name)
  ].filter(Boolean);
  return [
    `来源：掌上高考（${sourceUrl}）`,
    `学校：${school.name}`,
    `掌上高考 school_id：${schoolId}`,
    `地区：${[school.province_name, school.city_name].filter(Boolean).join(" ") || "-"}`,
    `层次/类型：${[school.level_name, school.type_name, school.nature_name].filter(Boolean).join(" / ") || "-"}`,
    `标签：${tags.length ? tags.join("；") : "-"}`
  ].join("\n");
}

function truthyFlag(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim().toLowerCase();
  return Boolean(text && text !== "0" && text !== "false" && text !== "否");
}

async function fetchJsonWithRetry(url: string, retries = 3): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json,text/plain,*/*",
          referer: "https://www.gaokao.cn/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await delay(800 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
