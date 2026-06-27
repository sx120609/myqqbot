import {
  ADMISSION_SOURCE,
  AdmissionRepository,
  normalizePlanGroup,
  normalizeProvinceName,
  normalizeSubjectType
} from "./admission-repository.js";
import type { AdmissionPlanRow, AdmissionScoreRow, AdmissionSourceRow } from "./admission-repository.js";
import { defaultAdmissionPlanYears, defaultAdmissionScoreYears } from "./admission-calendar.js";
import { defaultAdmissionSubjectTypeNamesForProvinceYear, GAOKAO_PROVINCES, GAOKAO_SUBJECT_TYPES } from "./admission-regions.js";
import type { UniversityRepository, UniversityRow } from "./university-repository.js";

const API_BASE = "https://api.zjzw.cn/web/api/";
const MNZY_API_BASE = "https://mnzy.gaokao.cn/api";
const SITE_BASE = "https://www.gaokao.cn";
const DEFAULT_LIMIT = 10;
const DEFAULT_PAGE_SIZE = 80;
const MAX_PAGES = 8;
const DEFAULT_REQUEST_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 180000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MINUTES = 1440;
const DEFAULT_MAX_SOURCE_REQUESTS = process.env.NODE_ENV === "test" ? 0 : 1;
const GLOBAL_RATE_LIMIT_COOLDOWN_KEY = "sync.internal.gaokaoCn.rateLimitCooldownUntil";

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
  includePlanDetails?: boolean;
  useMnzyPlanDetails?: boolean;
  eligibleOnly?: boolean;
  requestDelayMs?: number;
  rateLimitCooldownMinutes?: number;
  maxSourceRequests?: number;
  skipExisting?: boolean;
}

export interface GaokaoCnSyncResult {
  source: typeof ADMISSION_SOURCE;
  total: number;
  candidateTotal: number;
  offset: number;
  nextOffset: number;
  mapped: number;
  planRows: number;
  planSummaryRows: number;
  majorPlanRows: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
  sourceRequests: number;
  sourceRequestBudget: number | null;
  requestBudgetExhausted: boolean;
  skippedRequests: number;
  skipped: number;
  errors: Array<{ university: string; message: string }>;
}

export interface GaokaoCnRealtimeAdmissionOptions {
  universityId: number;
  universityName: string;
  sourceSchoolId?: string | null;
  province: string;
  subjectType: string;
  subjectTypes?: string[];
  scoreYears?: number[];
  planYears?: number[];
  planGroup?: string | null;
  majorName?: string | null;
  includePlans?: boolean;
  includeScores?: boolean;
  includePlanDetails?: boolean;
  requestDelayMs?: number;
  rateLimitCooldownMinutes?: number;
  maxSourceRequests?: number;
}

export interface GaokaoCnRealtimeAdmissionResult {
  plans: AdmissionPlanRow[];
  scores: AdmissionScoreRow[];
  sourceSnapshots: AdmissionSourceRow[];
  summary: GaokaoCnSyncResult;
  sourceUrl: string;
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

interface MnzyApiResponse<T> {
  code?: number | string;
  msg?: string;
  message?: string;
  body?: T | null;
}

interface MnzyRecommendPageBody {
  list?: MnzyRecommendGroup[];
  total?: number;
  pageNum?: number;
  pageSize?: number;
}

interface MnzyRecommendMajorBody {
  intentionList?: MnzyRecommendMajor[];
  notIntentionList?: MnzyRecommendMajor[];
}

interface MnzyRecommendGroup {
  universityName?: string;
  zsgkId?: string | number;
  recruitCode?: string | number;
  universityMajorGroup?: string | number;
  province?: string;
  year?: number | string;
  batch?: string;
  planNum?: number | string;
  majorNum?: number | string;
  claim?: string;
  historyScore?: string;
}

interface MnzyRecommendMajor {
  universityName?: string;
  recruitCode?: string | number;
  universityMajorGroup?: string | number;
  majorName?: string;
  majorRemarks?: string;
  year?: number | string;
  planNum?: number | string;
  enrollNum?: number | string;
  claim?: string;
  studyCost?: string | number;
  studyYear?: string | number;
  historyScore?: string;
  minScore?: number | string;
  minRanks?: number | string;
}

interface FetchCount {
  rows: number;
  sourceRows: number;
  requestBudgetExhausted?: boolean;
}

interface MnzyPlanFetchCount extends FetchCount {
  summaryRows: number;
  detailRows: number;
}

interface GaokaoRequestContext {
  requestDelayMs: number;
  rateLimitCooldownMinutes: number;
  maxSourceRequests: number;
  requestCount: number;
  lastRequestAt: number;
  rateLimited: boolean;
  requestBudgetExhausted: boolean;
}

interface GaokaoCooldownStore {
  getString(key: string, fallback: string): string;
  setInternal(key: string, value: string): void;
}

export { GAOKAO_PROVINCES } from "./admission-regions.js";

const SUBJECT_TYPES = GAOKAO_SUBJECT_TYPES;

export class GaokaoCnAdapter {
  private syncTail: Promise<void> = Promise.resolve();
  private rateLimitUntil = 0;
  private lastRequestAt = 0;

  constructor(
    private readonly universities: UniversityRepository,
    private readonly admissions: AdmissionRepository,
    private readonly progress?: GaokaoCnProgressReporter,
    private readonly cooldownStore?: GaokaoCooldownStore
  ) {}

  async sync(options: GaokaoCnSyncOptions = {}): Promise<GaokaoCnSyncResult> {
    const previous = this.syncTail;
    let release!: () => void;
    this.syncTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.performSync(options);
    } finally {
      release();
    }
  }

  private async performSync(options: GaokaoCnSyncOptions = {}): Promise<GaokaoCnSyncResult> {
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
      planSummaryRows: 0,
      majorPlanRows: 0,
      schoolScoreRows: 0,
      majorScoreRows: 0,
      sourceRows: 0,
      sourceRequests: 0,
      sourceRequestBudget: null,
      requestBudgetExhausted: false,
      skippedRequests: 0,
      skipped: 0,
      errors: []
    };

    try {
      const cooldownUntil = this.activeRateLimitCooldownUntil();
      if (cooldownUntil) {
        const message = `Gaokao.cn 仍在限流冷却中，预计 ${cooldownUntil.toISOString()} 后再试；本次未请求源站。`;
        result.errors.push({ university: "掌上高考", message });
        this.report(message);
        this.admissions.finishJob(jobId, {
          status: "error",
          error: message,
          resultJson: JSON.stringify(result)
        });
        return result;
      }

      const candidates = this.candidateUniversities(options);
      const rows = candidates.slice(result.offset, result.offset + clampLimit(options.limit));
      result.candidateTotal = candidates.length;
      result.total = rows.length;
      result.nextOffset = computeNextOffset(result.offset, rows.length, result.candidateTotal);
      this.report(`Preparing Gaokao.cn admission sync for ${rows.length} schools...`);
      const requestContext = createRequestContext(options.requestDelayMs, options.rateLimitCooldownMinutes, options.maxSourceRequests);
      result.sourceRequestBudget = requestContext.maxSourceRequests || null;

      for (const [index, university] of rows.entries()) {
        if (index > 0) await delay(700);
        try {
          const mapped = await this.ensureMapping(university, requestContext);
          result.sourceRequests = requestContext.requestCount;
          if (!mapped) {
            result.skipped += 1;
            continue;
          }
          result.mapped += 1;
          const partial = await this.syncMappedUniversity(university, mapped.sourceSchoolId, options, requestContext);
          result.planRows += partial.planRows;
          result.planSummaryRows += partial.planSummaryRows;
          result.majorPlanRows += partial.majorPlanRows;
          result.schoolScoreRows += partial.schoolScoreRows;
          result.majorScoreRows += partial.majorScoreRows;
          result.sourceRows += partial.sourceRows;
          result.skippedRequests += partial.skippedRequests;
          result.sourceRequests = requestContext.requestCount;
          if (partial.requestBudgetExhausted) {
            result.requestBudgetExhausted = true;
            result.nextOffset = result.offset;
            this.report(`Gaokao.cn source request budget exhausted after ${requestContext.requestCount} requests; stopping this batch and keeping offset ${result.offset}.`);
            break;
          }
          this.report(
            `Saved admission data for ${university.name}: plan summaries ${partial.planSummaryRows}, major plans ${partial.majorPlanRows}, school scores ${partial.schoolScoreRows}, major scores ${partial.majorScoreRows}, skipped requests ${partial.skippedRequests}.`
          );
        } catch (error) {
          const message = getErrorMessage(error);
          result.sourceRequests = requestContext.requestCount;
          if (isGaokaoCnRequestBudgetError(error)) {
            result.requestBudgetExhausted = true;
            result.nextOffset = result.offset;
            this.report(`Gaokao.cn source request budget exhausted after ${requestContext.requestCount} requests; stopping this batch and keeping offset ${result.offset}.`);
            break;
          }
          result.errors.push({ university: university.name, message });
          this.report(`Gaokao.cn sync failed for ${university.name}: ${message}`);
          if (isGaokaoCnRateLimitError(error)) {
            const until = this.setRateLimitCooldown(options.rateLimitCooldownMinutes);
            this.report(`Gaokao.cn rate limit detected; stopping the current batch. Cooldown until ${until.toISOString()}.`);
            break;
          }
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

  async ensureMapping(
    university: UniversityRow,
    requestContext = createRequestContext()
  ): Promise<{ sourceSchoolId: string; sourceSchoolName: string } | null> {
    const existing = this.admissions.getMapping(university.id);
    if (existing?.matchStatus === "unmatched" || existing?.matchStatus === "ambiguous") {
      return null;
    }
    if (existing?.sourceSchoolId) {
      const snapshot = parseSchoolSnapshot(existing.payloadJson);
      if (snapshot) this.recordSchoolProfileSnapshot(university, existing.sourceSchoolId, snapshot);
      return { sourceSchoolId: existing.sourceSchoolId, sourceSchoolName: existing.sourceSchoolName };
    }

    const { schools, sourceOk } = await this.searchSchoolCandidates(university.name, university.id, requestContext);
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

  async fetchRealtimeAdmissionData(options: GaokaoCnRealtimeAdmissionOptions): Promise<GaokaoCnRealtimeAdmissionResult> {
    const requestContext = createRequestContext(options.requestDelayMs, options.rateLimitCooldownMinutes, options.maxSourceRequests);
    const now = new Date().toISOString();
    const sourceSnapshots: AdmissionSourceRow[] = [];
    const plans: AdmissionPlanRow[] = [];
    const scores: AdmissionScoreRow[] = [];
    const summary: GaokaoCnSyncResult = {
      source: ADMISSION_SOURCE,
      total: 1,
      candidateTotal: 1,
      offset: 0,
      nextOffset: 0,
      mapped: 1,
      planRows: 0,
      planSummaryRows: 0,
      majorPlanRows: 0,
      schoolScoreRows: 0,
      majorScoreRows: 0,
      sourceRows: 0,
      sourceRequests: 0,
      sourceRequestBudget: requestContext.maxSourceRequests || null,
      requestBudgetExhausted: false,
      skippedRequests: 0,
      skipped: 0,
      errors: []
    };

    const cooldownUntil = this.activeRateLimitCooldownUntil();
    if (cooldownUntil) {
      summary.errors.push({
        university: options.universityName,
        message: `Gaokao.cn 仍在限流冷却中，预计 ${cooldownUntil.toISOString()} 后再试；本次未请求源站。`
      });
      return { plans, scores, sourceSnapshots, summary, sourceUrl: MNZY_API_BASE };
    }

    const subjectTypes = options.subjectTypes?.length ? options.subjectTypes : [options.subjectType];
    const planYears = normalizeYears(options.planYears, defaultAdmissionPlanYears());
    const scoreYears = normalizeYears(options.scoreYears, defaultAdmissionScoreYears());
    const includePlans = options.includePlans !== false;
    const includeScores = options.includeScores !== false;
    const includePlanDetails = options.includePlanDetails !== false;
    const seenGroups = new Set<string>();
    let rowId = -1;

    try {
      for (const subjectType of subjectTypes) {
        const allYears = Array.from(new Set([...planYears, ...scoreYears])).sort((a, b) => b - a);
        const queryYears = allYears.length ? allYears : [new Date().getFullYear()];
        for (const year of queryYears) {
          const yearNeedsPlans = includePlans && planYears.includes(year);
          const yearNeedsScores = includeScores && scoreYears.some((scoreYear) => scoreYear <= year);
          if (!yearNeedsPlans && !yearNeedsScores) continue;

          for (const batch of mnzyBatchCandidates(subjectType)) {
            const rowsBeforeBatch = plans.length + scores.length;
            for (let page = 1; page <= MAX_PAGES; page += 1) {
              if (!this.hasRequestBudget(requestContext)) {
                requestContext.requestBudgetExhausted = true;
                summary.requestBudgetExhausted = true;
                break;
              }
              const request = buildMnzyRecommendPageRequest(options.universityName, options.province, subjectType, year, page, batch);
              const { payload } = await this.fetchMnzyRealtime<MnzyRecommendPageBody>(
                "mnzy-recommend-page",
                "/v3/v1/query/recommendPage",
                request,
                options,
                requestContext,
                sourceSnapshots,
                now
              );
              const list = payload.body?.list ?? [];
              const groups = list
                .filter((item) => matchesMnzyUniversity(item, options.universityName, options.sourceSchoolId ?? ""))
                .filter((item) => matchesRequestedPlanGroup(item.universityMajorGroup, options.planGroup));

              for (const group of groups) {
                const recruitCode = stringify(group.recruitCode);
                const planGroup = stringify(group.universityMajorGroup);
                if (!recruitCode || !planGroup) continue;
                const groupKey = `${subjectType}:${batch}:${year}:${recruitCode}:${planGroup}`;
                if (seenGroups.has(groupKey)) continue;
                seenGroups.add(groupKey);

                if (yearNeedsPlans) {
                  plans.push(makeRealtimePlanRow({
                    id: rowId--,
                    options,
                    now,
                    subjectType,
                    year: toInt(group.year) ?? year,
                    batch,
                    planGroup,
                    majorName: null,
                    planCount: toInt(group.planNum),
                    majorCount: toInt(group.majorNum),
                    selectionRequirements: stringify(group.claim),
                    sourceUrl: `${MNZY_API_BASE}/v3/v1/query/recommendPage`,
                    rawJson: JSON.stringify(group)
                  }));
                }
                if (includeScores) {
                  for (const history of parseMnzyHistoryScores(group.historyScore)) {
                    if (!scoreYears.includes(history.year)) continue;
                    scores.push(makeRealtimeScoreRow({
                      id: rowId--,
                      options,
                      now,
                      subjectType,
                      scoreType: "school",
                      year: history.year,
                      batch,
                      planGroup,
                      majorName: null,
                      minScore: history.minScore,
                      minRank: history.minRank,
                      planCount: history.planCount ?? toInt(group.planNum),
                      selectionRequirements: stringify(group.claim),
                      sourceUrl: `${MNZY_API_BASE}/v3/v1/query/recommendPage`,
                      rawJson: JSON.stringify(group)
                    }));
                  }
                }

                if (!includePlanDetails) continue;
                if (!this.hasRequestBudget(requestContext)) {
                  requestContext.requestBudgetExhausted = true;
                  summary.requestBudgetExhausted = true;
                  break;
                }
                const majorRequest = buildMnzyRecommendMajorRequest(group, options.province, subjectType, year, batch);
                const majorResponse = await this.fetchMnzyRealtime<MnzyRecommendMajorBody>(
                  "mnzy-recommend-major",
                  "/v4/v1/query/recommendMajorList",
                  majorRequest,
                  options,
                  requestContext,
                  sourceSnapshots,
                  now
                );
                const majors = [
                  ...(majorResponse.payload.body?.intentionList ?? []),
                  ...(majorResponse.payload.body?.notIntentionList ?? [])
                ].filter((major) => matchesRequestedMajor(major.majorName, major.majorRemarks, options.majorName));
                for (const major of majors) {
                  const majorName = joinMajorName(major.majorName, major.majorRemarks);
                  if (!majorName) continue;
                  if (yearNeedsPlans) {
                    plans.push(makeRealtimePlanRow({
                      id: rowId--,
                      options,
                      now,
                      subjectType,
                      year: toInt(major.year) ?? year,
                      batch,
                      planGroup: stringify(major.universityMajorGroup) ?? planGroup,
                      majorName,
                      planCount: toInt(major.planNum),
                      tuition: stringify(major.studyCost),
                      duration: stringify(major.studyYear),
                      selectionRequirements: stringify(major.claim),
                      sourceUrl: `${MNZY_API_BASE}/v4/v1/query/recommendMajorList`,
                      rawJson: JSON.stringify(major)
                    }));
                  }
                  if (includeScores) {
                    for (const history of parseMnzyHistoryScores(major.historyScore)) {
                      if (!scoreYears.includes(history.year)) continue;
                      scores.push(makeRealtimeScoreRow({
                        id: rowId--,
                        options,
                        now,
                        subjectType,
                        scoreType: "major",
                        year: history.year,
                        batch,
                        planGroup: stringify(major.universityMajorGroup) ?? planGroup,
                        majorName,
                        minScore: history.minScore ?? toNumber(major.minScore),
                        minRank: history.minRank ?? toInt(major.minRanks),
                        planCount: history.planCount ?? toInt(major.planNum),
                        selectionRequirements: stringify(major.claim),
                        sourceUrl: `${MNZY_API_BASE}/v4/v1/query/recommendMajorList`,
                        rawJson: JSON.stringify(major)
                      }));
                    }
                  }
                }
              }

              if (summary.requestBudgetExhausted) break;
              const total = Number(payload.body?.total ?? list.length);
              const pageSize = Number(payload.body?.pageSize ?? request.pageSize);
              if (!list.length || !Number.isFinite(total) || page * pageSize >= total) break;
            }
            if (summary.requestBudgetExhausted || plans.length + scores.length > rowsBeforeBatch) break;
          }
        }
      }
    } catch (error) {
      const message = getErrorMessage(error);
      summary.errors.push({ university: options.universityName, message });
      if (isGaokaoCnRateLimitError(error)) this.setRateLimitCooldown(options.rateLimitCooldownMinutes);
    }

    summary.planRows = plans.length;
    summary.planSummaryRows = plans.filter((row) => !row.majorName).length;
    summary.majorPlanRows = plans.filter((row) => Boolean(row.majorName)).length;
    summary.schoolScoreRows = scores.filter((row) => row.scoreType === "school").length;
    summary.majorScoreRows = scores.filter((row) => row.scoreType === "major").length;
    summary.sourceRows = sourceSnapshots.length;
    summary.sourceRequests = requestContext.requestCount;
    summary.mapped = plans.length || scores.length || sourceSnapshots.length ? 1 : 0;
    return { plans, scores, sourceSnapshots, summary, sourceUrl: MNZY_API_BASE };
  }

  private async searchSchoolCandidates(
    keyword: string,
    universityId?: number,
    requestContext = createRequestContext()
  ): Promise<{ schools: GaokaoSchool[]; sourceOk: boolean }> {
    this.assertRequestBudget(requestContext);
    const request = { keyword, uri: "apidata/api/gk/school/lists" };
    const { payload, sourceId } = await this.fetchAndRecord<GaokaoSchool>("school-search", request, universityId, null, requestContext);
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
    options: GaokaoCnSyncOptions,
    requestContext: GaokaoRequestContext
  ): Promise<Pick<GaokaoCnSyncResult, "planRows" | "planSummaryRows" | "majorPlanRows" | "schoolScoreRows" | "majorScoreRows" | "sourceRows" | "skippedRequests" | "requestBudgetExhausted">> {
    const provinces = normalizeProvinceFilter(options.provinces);
    const scoreYears = normalizeYears(options.scoreYears, defaultAdmissionScoreYears());
    const planYears = normalizeYears(options.planYears, defaultAdmissionPlanYears());
    const explicitSubjectTypes = normalizeSubjectFilter(options.subjectTypes);
    const result = {
      planRows: 0,
      planSummaryRows: 0,
      majorPlanRows: 0,
      schoolScoreRows: 0,
      majorScoreRows: 0,
      sourceRows: 0,
      skippedRequests: 0,
      requestBudgetExhausted: false
    };
    const includePlans = options.includePlans !== false;
    const includeScores = options.includeScores !== false;
    const includePlanDetails = options.includePlanDetails !== false;
    const skipExisting = options.skipExisting === true;

    for (const province of provinces) {
      if (includePlans) {
        for (const year of planYears) {
          const subjectTypes = explicitSubjectTypes ?? defaultSubjectTypesForProvinceYear(province.name, year);
          for (const subject of subjectTypes) {
            let summary: FetchCount = { rows: 0, sourceRows: 0 };
            let detail: FetchCount = { rows: 0, sourceRows: 0 };
            if (includePlanDetails && options.useMnzyPlanDetails) {
              const mnzyCoverageRequest = buildMnzyRecommendPageRequest(university.name, province.name, subject.name, year, 1, primaryMnzyBatch(subject.name));
              if (skipExisting && this.admissions.hasSourceCoverage({
                sourceKind: "mnzy-recommend-page",
                universityId: university.id,
                sourceSchoolId,
                request: pickMnzyCoverageRequest(mnzyCoverageRequest)
              })) {
                result.skippedRequests += 1;
              } else {
                if (!this.hasRequestBudget(requestContext)) return { ...result, requestBudgetExhausted: true };
                try {
                  const mnzy = await this.fetchMnzyPlanDetails(university, sourceSchoolId, year, province.name, subject.name, requestContext);
                  result.planRows += mnzy.rows;
                  result.planSummaryRows += mnzy.summaryRows;
                  result.majorPlanRows += mnzy.detailRows;
                  result.sourceRows += mnzy.sourceRows;
                  if (mnzy.requestBudgetExhausted) return { ...result, requestBudgetExhausted: true };
                  detail = { rows: mnzy.detailRows, sourceRows: mnzy.sourceRows };
                  summary = { rows: mnzy.summaryRows, sourceRows: 0 };
                } catch (error) {
                  if (isGaokaoCnRequestBudgetError(error)) return { ...result, requestBudgetExhausted: true };
                  this.report(`Mnzy recommendation plan detail fallback for ${university.name}: ${getErrorMessage(error)}`);
                }
              }
            }
            if (summary.rows + detail.rows === 0) {
              if (skipExisting && this.admissions.hasSourceCoverage({
                sourceKind: "plan-school-summary",
                universityId: university.id,
                sourceSchoolId,
                request: {
                  uri: "apidata/api/gkv3/plan/schoollists",
                  school_id: sourceSchoolId,
                  local_province_id: province.id,
                  local_type_id: subject.id,
                  year,
                  page: 1,
                  size: DEFAULT_PAGE_SIZE
                }
              })) {
                result.skippedRequests += 1;
              } else {
                if (!this.hasRequestBudget(requestContext)) return { ...result, requestBudgetExhausted: true };
                summary = await this.fetchPlanSummary(university, sourceSchoolId, year, province.id, subject.id, requestContext);
                result.planRows += summary.rows;
                result.planSummaryRows += summary.rows;
                result.sourceRows += summary.sourceRows;
                if (summary.requestBudgetExhausted) return { ...result, requestBudgetExhausted: true };
              }
              if (includePlanDetails) {
                if (skipExisting && this.admissions.hasSourceCoverage({
                  sourceKind: "plan-major",
                  universityId: university.id,
                  sourceSchoolId,
                  request: {
                    uri: "apidata/api/gkv3/plan/school",
                    school_id: sourceSchoolId,
                    local_province_id: province.id,
                    local_type_id: subject.id,
                    year
                  }
                })) {
                  result.skippedRequests += 1;
                } else {
                  if (!this.hasRequestBudget(requestContext)) return { ...result, requestBudgetExhausted: true };
                  detail = await this.fetchPlanDetails(university, sourceSchoolId, year, province.id, subject.id, requestContext);
                  result.planRows += detail.rows;
                  result.majorPlanRows += detail.rows;
                  result.sourceRows += detail.sourceRows;
                  if (detail.requestBudgetExhausted) return { ...result, requestBudgetExhausted: true };
                }
              }
            }
            if (summary.rows + detail.rows > 0) await delay(180);
          }
        }
      }

      if (includeScores) {
        for (const year of scoreYears) {
          const subjectTypes = explicitSubjectTypes ?? defaultSubjectTypesForProvinceYear(province.name, year);
          for (const subject of subjectTypes) {
            let schoolScores: FetchCount = { rows: 0, sourceRows: 0 };
            if (skipExisting && this.admissions.hasSourceCoverage({
              sourceKind: "score-school",
              universityId: university.id,
              sourceSchoolId,
              request: {
                uri: "apidata/api/gk/score/province",
                school_id: sourceSchoolId,
                local_province_id: province.id,
                local_type_id: subject.id,
                year,
                zslx: 0
              }
            })) {
              result.skippedRequests += 1;
            } else {
              if (!this.hasRequestBudget(requestContext)) return { ...result, requestBudgetExhausted: true };
              schoolScores = await this.fetchSchoolScores(university, sourceSchoolId, year, province.id, subject.id, requestContext);
              result.schoolScoreRows += schoolScores.rows;
              result.sourceRows += schoolScores.sourceRows;
              if (schoolScores.requestBudgetExhausted) return { ...result, requestBudgetExhausted: true };
            }
            if (options.includeSpecialScores !== false) {
              if (skipExisting && this.admissions.hasSourceCoverage({
                sourceKind: "score-major",
                universityId: university.id,
                sourceSchoolId,
                request: {
                  uri: "apidata/api/gk/score/special",
                  school_id: sourceSchoolId,
                  local_province_id: province.id,
                  local_type_id: subject.id,
                  year,
                  zslx: 0
                }
              })) {
                result.skippedRequests += 1;
              } else {
                if (!this.hasRequestBudget(requestContext)) return { ...result, requestBudgetExhausted: true };
                const majorScores = await this.fetchMajorScores(university, sourceSchoolId, year, province.id, subject.id, requestContext);
                result.majorScoreRows += majorScores.rows;
                result.sourceRows += majorScores.sourceRows;
                if (majorScores.requestBudgetExhausted) return { ...result, requestBudgetExhausted: true };
              }
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
    subjectTypeId: string,
    requestContext: GaokaoRequestContext
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
      sourceSchoolId,
      requestContext
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
    subjectTypeId: string,
    requestContext: GaokaoRequestContext
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
    }, university.id, sourceSchoolId, 20, requestContext)) {
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
    return { rows: saved, sourceRows, requestBudgetExhausted: requestContext.requestBudgetExhausted };
  }

  private async fetchPlanDetails(
    university: UniversityRow,
    sourceSchoolId: string,
    year: number,
    provinceId: string,
    subjectTypeId: string,
    requestContext: GaokaoRequestContext
  ): Promise<FetchCount> {
    let saved = 0;
    let sourceRows = 0;
    for await (const { items, sourceId } of this.fetchPaged<GaokaoPlanDetail>("plan-major", {
      uri: "apidata/api/gkv3/plan/school",
      school_id: sourceSchoolId,
      local_province_id: provinceId,
      local_type_id: subjectTypeId,
      year
    }, university.id, sourceSchoolId, 10, requestContext)) {
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
    return { rows: saved, sourceRows, requestBudgetExhausted: requestContext.requestBudgetExhausted };
  }

  private async fetchMnzyPlanDetails(
    university: UniversityRow,
    sourceSchoolId: string,
    year: number,
    provinceName: string,
    subjectType: string,
    requestContext: GaokaoRequestContext
  ): Promise<MnzyPlanFetchCount> {
    const subject = mnzySubjectProfile(subjectType);
    if (!subject) return { rows: 0, summaryRows: 0, detailRows: 0, sourceRows: 0 };
    let rows = 0;
    let summaryRows = 0;
    let detailRows = 0;
    let sourceRows = 0;
    const seenGroups = new Set<string>();

    for (const batch of mnzyBatchCandidates(subjectType)) {
      const rowsBeforeBatch = rows;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        if (!this.hasRequestBudget(requestContext)) {
          requestContext.requestBudgetExhausted = true;
          return { rows, summaryRows, detailRows, sourceRows, requestBudgetExhausted: true };
        }
        const request = buildMnzyRecommendPageRequest(university.name, provinceName, subjectType, year, page, batch);
        const { payload, sourceId } = await this.fetchMnzyAndRecord<MnzyRecommendPageBody>(
          "mnzy-recommend-page",
          "/v3/v1/query/recommendPage",
          request,
          university.id,
          sourceSchoolId,
          requestContext
        );
        if (sourceId) sourceRows += 1;
        const body = payload.body;
        const groups = (body?.list ?? []).filter((item) => matchesMnzyUniversity(item, university.name, sourceSchoolId));
        for (const group of groups) {
          const recruitCode = stringify(group.recruitCode);
          const planGroup = stringify(group.universityMajorGroup);
          if (!recruitCode || !planGroup) continue;
          const key = `${recruitCode}:${planGroup}`;
          if (seenGroups.has(key)) continue;
          seenGroups.add(key);

          this.admissions.upsertPlan({
            universityId: university.id,
            sourceSchoolId,
            year: toInt(group.year) ?? year,
            provinceName,
            subjectType,
            batch,
            planGroup,
            majorName: null,
            planCount: toInt(group.planNum),
            majorCount: toInt(group.majorNum),
            selectionRequirements: stringify(group.claim),
            sourceUrl: `${MNZY_API_BASE}/v3/v1/query/recommendPage`,
            sourceRecordId: String(sourceId),
            rawJson: JSON.stringify(group)
          });
          rows += 1;
          summaryRows += 1;

          const majorRequest = buildMnzyRecommendMajorRequest(group, provinceName, subjectType, year, batch);
          if (!this.hasRequestBudget(requestContext)) {
            requestContext.requestBudgetExhausted = true;
            return { rows, summaryRows, detailRows, sourceRows, requestBudgetExhausted: true };
          }
          const majorResponse = await this.fetchMnzyAndRecord<MnzyRecommendMajorBody>(
            "mnzy-recommend-major",
            "/v4/v1/query/recommendMajorList",
            majorRequest,
            university.id,
            sourceSchoolId,
            requestContext
          );
          if (majorResponse.sourceId) sourceRows += 1;
          const majors = [
            ...(majorResponse.payload.body?.intentionList ?? []),
            ...(majorResponse.payload.body?.notIntentionList ?? [])
          ];
          for (const major of majors) {
            const majorName = joinMajorName(major.majorName, major.majorRemarks);
            if (!majorName) continue;
            this.admissions.upsertPlan({
              universityId: university.id,
              sourceSchoolId,
              year: toInt(major.year) ?? year,
              provinceName,
              subjectType,
              batch,
              planGroup: stringify(major.universityMajorGroup) ?? planGroup,
              majorName,
              planCount: toInt(major.planNum),
              tuition: stringify(major.studyCost),
              duration: stringify(major.studyYear),
              selectionRequirements: stringify(major.claim),
              sourceUrl: `${MNZY_API_BASE}/v4/v1/query/recommendMajorList`,
              sourceRecordId: String(majorResponse.sourceId),
              rawJson: JSON.stringify(major)
            });
            rows += 1;
            detailRows += 1;
          }
        }
        const total = Number(body?.total ?? groups.length);
        const pageSize = Number(body?.pageSize ?? request.pageSize);
        if (!body?.list?.length || !Number.isFinite(total) || page * pageSize >= total) break;
      }
      if (rows > rowsBeforeBatch) break;
    }
    return { rows, summaryRows, detailRows, sourceRows, requestBudgetExhausted: requestContext.requestBudgetExhausted };
  }

  private async fetchMajorScores(
    university: UniversityRow,
    sourceSchoolId: string,
    year: number,
    provinceId: string,
    subjectTypeId: string,
    requestContext: GaokaoRequestContext
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
    }, university.id, sourceSchoolId, 20, requestContext)) {
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
    return { rows: saved, sourceRows, requestBudgetExhausted: requestContext.requestBudgetExhausted };
  }

  private async *fetchPaged<T extends object>(
    sourceKind: string,
    baseRequest: Record<string, unknown>,
    universityId: number,
    sourceSchoolId: string,
    pageSize = DEFAULT_PAGE_SIZE,
    requestContext = createRequestContext()
  ): AsyncGenerator<{ items: T[]; sourceId: number | null }> {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      if (!this.hasRequestBudget(requestContext)) {
        requestContext.requestBudgetExhausted = true;
        break;
      }
      const request = { ...baseRequest, page, size: pageSize };
      const { payload, sourceId } = await this.fetchAndRecord<T>(sourceKind, request, universityId, sourceSchoolId, requestContext);
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
    sourceSchoolId: string | null,
    requestContext = createRequestContext()
  ): Promise<{ payload: GaokaoApiResponse<T>; sourceId: number | null }> {
    this.assertRequestBudget(requestContext);
    const url = buildApiUrl(request);
    let payload: GaokaoApiResponse<T>;
    try {
      const cooldownUntil = this.activeRateLimitCooldownUntil();
      if (cooldownUntil) {
        throw new GaokaoCnRateLimitError(`Gaokao.cn 仍在限流冷却中，预计 ${cooldownUntil.toISOString()} 后再试；本次未请求源站。`);
      }
      if (requestContext.rateLimited) {
        throw new GaokaoCnRateLimitError("Gaokao.cn rate limit already detected in this sync; skipped remaining requests.");
      }
      await this.waitBeforeRequest(requestContext);
      requestContext.requestCount += 1;
      payload = (await fetchJsonWithRetry(url)) as GaokaoApiResponse<T>;
    } catch (error) {
      if (isGaokaoCnRateLimitError(error)) {
        requestContext.rateLimited = true;
        if (!isExistingRateLimitCooldownError(error)) {
          this.setRateLimitCooldown(requestContext.rateLimitCooldownMinutes);
        }
      }
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
      error: payload.code === "0000" ? null : `${payload.code ?? "unknown"}: ${payload.message ?? "unknown_error"}`
    });
    if (payload.code !== "0000") {
      const message = `Gaokao.cn ${sourceKind} returned ${payload.code ?? "unknown"} (${summarizeRequestTarget(request)}): ${payload.message ?? "unknown_error"}`;
      if (isGaokaoCnRateLimitPayload(payload)) {
        requestContext.rateLimited = true;
        this.setRateLimitCooldown(requestContext.rateLimitCooldownMinutes);
        throw new GaokaoCnRateLimitError(message);
      }
      throw new Error(message);
    }
    return { payload, sourceId };
  }

  private async fetchMnzyAndRecord<T extends object>(
    sourceKind: string,
    path: string,
    request: Record<string, unknown>,
    universityId: number | undefined,
    sourceSchoolId: string | null,
    requestContext = createRequestContext()
  ): Promise<{ payload: MnzyApiResponse<T>; sourceId: number | null }> {
    this.assertRequestBudget(requestContext);
    const url = `${MNZY_API_BASE}${path}`;
    let payload: MnzyApiResponse<T>;
    try {
      const cooldownUntil = this.activeRateLimitCooldownUntil();
      if (cooldownUntil) {
        throw new GaokaoCnRateLimitError(`Gaokao.cn 仍在限流冷却中，预计 ${cooldownUntil.toISOString()} 后再试；本次未请求源站。`);
      }
      if (requestContext.rateLimited) {
        throw new GaokaoCnRateLimitError("Gaokao.cn rate limit already detected in this sync; skipped remaining requests.");
      }
      await this.waitBeforeRequest(requestContext);
      requestContext.requestCount += 1;
      payload = (await fetchJsonPostWithRetry(url, request)) as MnzyApiResponse<T>;
    } catch (error) {
      if (isGaokaoCnRateLimitError(error)) {
        requestContext.rateLimited = true;
        if (!isExistingRateLimitCooldownError(error)) {
          this.setRateLimitCooldown(requestContext.rateLimitCooldownMinutes);
        }
      }
      this.admissions.insertSource({
        sourceKind,
        universityId,
        sourceSchoolId,
        sourceUrl: url,
        requestJson: JSON.stringify(request),
        status: "error",
        error: getErrorMessage(error)
      });
      throw new Error(`Mnzy ${sourceKind} fetch failed (${summarizeMnzyRequestTarget(request)}): ${getErrorMessage(error)}`);
    }

    const success = isMnzySuccessPayload(payload);
    const sourceId = this.admissions.insertSource({
      sourceKind,
      universityId,
      sourceSchoolId,
      sourceUrl: url,
      requestJson: JSON.stringify(request),
      responseJson: JSON.stringify(payload),
      status: success ? "success" : "error",
      error: success ? null : `${payload.code ?? "unknown"}: ${payload.msg ?? payload.message ?? "unknown_error"}`
    });
    if (!success) {
      const message = `Mnzy ${sourceKind} returned ${payload.code ?? "unknown"} (${summarizeMnzyRequestTarget(request)}): ${payload.msg ?? payload.message ?? "unknown_error"}`;
      if (isGaokaoCnRateLimitMessage(message)) {
        requestContext.rateLimited = true;
        this.setRateLimitCooldown(requestContext.rateLimitCooldownMinutes);
        throw new GaokaoCnRateLimitError(message);
      }
      throw new Error(message);
    }
    return { payload, sourceId };
  }

  private async fetchMnzyRealtime<T extends object>(
    sourceKind: string,
    path: string,
    request: Record<string, unknown>,
    options: Pick<GaokaoCnRealtimeAdmissionOptions, "universityId" | "universityName" | "sourceSchoolId">,
    requestContext: GaokaoRequestContext,
    sourceSnapshots: AdmissionSourceRow[],
    fetchedAt: string
  ): Promise<{ payload: MnzyApiResponse<T>; snapshot: AdmissionSourceRow }> {
    this.assertRequestBudget(requestContext);
    const url = `${MNZY_API_BASE}${path}`;
    let payload: MnzyApiResponse<T> | null = null;
    let error: string | null = null;
    try {
      if (requestContext.rateLimited) {
        throw new GaokaoCnRateLimitError("Gaokao.cn rate limit already detected in this realtime request; skipped remaining requests.");
      }
      await this.waitBeforeRequest(requestContext);
      requestContext.requestCount += 1;
      payload = (await fetchJsonPostWithRetry(url, request)) as MnzyApiResponse<T>;
      if (!isMnzySuccessPayload(payload)) {
        const message = `Mnzy ${sourceKind} returned ${payload.code ?? "unknown"} (${summarizeMnzyRequestTarget(request)}): ${payload.msg ?? payload.message ?? "unknown_error"}`;
        if (isGaokaoCnRateLimitMessage(message)) {
          requestContext.rateLimited = true;
          throw new GaokaoCnRateLimitError(message);
        }
        throw new Error(message);
      }
    } catch (caught) {
      error = getErrorMessage(caught);
      if (isGaokaoCnRateLimitError(caught)) requestContext.rateLimited = true;
    }
    const snapshot = makeRealtimeSourceSnapshot({
      id: -(sourceSnapshots.length + 1),
      sourceKind,
      universityId: options.universityId,
      universityName: options.universityName,
      sourceSchoolId: options.sourceSchoolId ?? null,
      sourceUrl: url,
      request,
      response: payload,
      error,
      fetchedAt
    });
    sourceSnapshots.push(snapshot);
    if (error) throw new Error(error);
    return { payload: payload as MnzyApiResponse<T>, snapshot };
  }

  private report(message: string): void {
    this.progress?.(message);
  }

  private async waitBeforeRequest(context: GaokaoRequestContext): Promise<void> {
    const lastRequestAt = Math.max(context.lastRequestAt, this.lastRequestAt);
    if (!context.requestDelayMs) {
      const now = Date.now();
      context.lastRequestAt = now;
      this.lastRequestAt = now;
      return;
    }
    const elapsed = lastRequestAt ? Date.now() - lastRequestAt : context.requestDelayMs;
    if (elapsed < context.requestDelayMs) {
      await delay(context.requestDelayMs - elapsed);
    }
    const now = Date.now();
    context.lastRequestAt = now;
    this.lastRequestAt = now;
  }

  private hasRequestBudget(context: GaokaoRequestContext): boolean {
    return context.maxSourceRequests <= 0 || context.requestCount < context.maxSourceRequests;
  }

  private assertRequestBudget(context: GaokaoRequestContext): void {
    if (!this.hasRequestBudget(context)) {
      context.requestBudgetExhausted = true;
      throw new GaokaoCnRequestBudgetError(`Gaokao.cn source request budget exhausted (${context.requestCount}/${context.maxSourceRequests}); stopped before starting another source endpoint.`);
    }
  }

  rateLimitStatus(): { active: boolean; until: string | null } {
    const until = this.activeRateLimitCooldownUntil();
    return { active: Boolean(until), until: until?.toISOString() ?? null };
  }

  clearRateLimitCooldown(): void {
    this.rateLimitUntil = 0;
    this.cooldownStore?.setInternal(GLOBAL_RATE_LIMIT_COOLDOWN_KEY, "");
  }

  private activeRateLimitCooldownUntil(): Date | null {
    const storedValue = this.cooldownStore?.getString(GLOBAL_RATE_LIMIT_COOLDOWN_KEY, "") ?? "";
    const storedUntil = parseFutureDate(storedValue);
    if (storedUntil) this.rateLimitUntil = Math.max(this.rateLimitUntil, storedUntil.getTime());
    if (this.rateLimitUntil <= Date.now()) return null;
    return new Date(this.rateLimitUntil);
  }

  private setRateLimitCooldown(minutes?: number): Date {
    const cooldownMs = clampRateLimitCooldownMinutes(minutes) * 60 * 1000;
    this.rateLimitUntil = Date.now() + cooldownMs;
    const until = new Date(this.rateLimitUntil);
    this.cooldownStore?.setInternal(GLOBAL_RATE_LIMIT_COOLDOWN_KEY, until.toISOString());
    return until;
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

function buildMnzyRecommendPageRequest(
  universityName: string,
  provinceName: string,
  subjectType: string,
  year: number,
  pageNum: number,
  batch: string
): Record<string, unknown> {
  const subject = mnzySubjectProfile(subjectType);
  return {
    province: normalizeProvinceName(provinceName),
    ranks: 1,
    score: 750,
    classify: subject?.classify ?? subjectType.replace(/类$/u, ""),
    subjects: subject?.subjects ?? "物理,化学,生物",
    batch,
    year,
    pageNum,
    pageSize: 20,
    type: null,
    channel: "",
    entrantType: 1,
    universityName
  };
}

function buildMnzyRecommendMajorRequest(
  group: MnzyRecommendGroup,
  provinceName: string,
  subjectType: string,
  year: number,
  batch: string
): Record<string, unknown> {
  const subject = mnzySubjectProfile(subjectType);
  return {
    pageNum: 1,
    universityMajorGroup: stringify(group.universityMajorGroup),
    province: normalizeProvinceName(provinceName),
    ranks: 1,
    score: 750,
    classify: subject?.classify ?? subjectType.replace(/类$/u, ""),
    subjects: subject?.subjects ?? "物理,化学,生物",
    batch,
    year,
    recruitCode: stringify(group.recruitCode)
  };
}

function makeRealtimeSourceSnapshot(input: {
  id: number;
  sourceKind: string;
  universityId: number;
  universityName: string;
  sourceSchoolId: string | null;
  sourceUrl: string;
  request: Record<string, unknown>;
  response: unknown;
  error: string | null;
  fetchedAt: string;
}): AdmissionSourceRow {
  return {
    id: input.id,
    source: ADMISSION_SOURCE,
    sourceKind: input.sourceKind,
    universityId: input.universityId,
    universityName: input.universityName,
    sourceSchoolId: input.sourceSchoolId,
    sourceUrl: input.sourceUrl,
    requestJson: JSON.stringify(input.request),
    responseJson: input.response ? JSON.stringify(input.response) : null,
    status: input.error ? "error" : "success",
    error: input.error,
    fetchedAt: input.fetchedAt
  };
}

function makeRealtimePlanRow(input: {
  id: number;
  options: Pick<GaokaoCnRealtimeAdmissionOptions, "universityId" | "universityName" | "sourceSchoolId" | "province">;
  now: string;
  subjectType: string;
  year: number;
  batch: string;
  planGroup: string | null;
  majorName: string | null;
  planCount?: number | null;
  majorCount?: number | null;
  tuition?: string | null;
  duration?: string | null;
  selectionRequirements?: string | null;
  sourceUrl: string;
  rawJson: string;
}): AdmissionPlanRow {
  return {
    id: input.id,
    source: ADMISSION_SOURCE,
    universityId: input.options.universityId,
    universityName: input.options.universityName,
    sourceSchoolId: input.options.sourceSchoolId ?? "realtime",
    year: input.year,
    provinceName: normalizeProvinceName(input.options.province),
    subjectType: normalizeSubjectType(input.subjectType),
    batch: input.batch,
    planGroup: normalizePlanGroup(input.planGroup),
    majorName: input.majorName,
    planCount: input.planCount ?? null,
    schoolPlanCount: null,
    majorCount: input.majorCount ?? null,
    tuition: input.tuition ?? null,
    duration: input.duration ?? null,
    campus: null,
    selectionRequirements: input.selectionRequirements ?? null,
    sourceUrl: input.sourceUrl,
    sourceRecordId: `realtime:${Math.abs(input.id)}`,
    rawJson: input.rawJson,
    fetchedAt: input.now
  };
}

function makeRealtimeScoreRow(input: {
  id: number;
  options: Pick<GaokaoCnRealtimeAdmissionOptions, "universityId" | "universityName" | "sourceSchoolId" | "province">;
  now: string;
  subjectType: string;
  scoreType: "school" | "major";
  year: number;
  batch: string;
  planGroup: string | null;
  majorName: string | null;
  minScore?: number | null;
  minRank?: number | null;
  planCount?: number | null;
  selectionRequirements?: string | null;
  sourceUrl: string;
  rawJson: string;
}): AdmissionScoreRow {
  return {
    id: input.id,
    source: ADMISSION_SOURCE,
    scoreType: input.scoreType,
    universityId: input.options.universityId,
    universityName: input.options.universityName,
    sourceSchoolId: input.options.sourceSchoolId ?? "realtime",
    year: input.year,
    provinceName: normalizeProvinceName(input.options.province),
    subjectType: normalizeSubjectType(input.subjectType),
    batch: input.batch,
    planGroup: normalizePlanGroup(input.planGroup),
    majorName: input.majorName,
    minScore: input.minScore ?? null,
    minRank: input.minRank ?? null,
    avgScore: null,
    avgRank: null,
    maxScore: null,
    planCount: input.planCount ?? null,
    controlScore: null,
    diffScore: null,
    selectionRequirements: input.selectionRequirements ?? null,
    sourceUrl: input.sourceUrl,
    sourceRecordId: `realtime:${Math.abs(input.id)}`,
    rawJson: input.rawJson,
    fetchedAt: input.now
  };
}

function parseMnzyHistoryScores(value: unknown): Array<{ year: number; minScore: number | null; minRank: number | null; planCount: number | null }> {
  const text = stringify(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows: Array<{ year: number; minScore: number | null; minRank: number | null; planCount: number | null }> = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      for (const [yearText, payload] of Object.entries(item)) {
        const year = Number(yearText);
        if (!Number.isFinite(year)) continue;
        const [score, rank, plan] = String(payload ?? "").split(",").map((part) => part.trim());
        rows.push({
          year,
          minScore: toNumber(score),
          minRank: toInt(rank),
          planCount: toInt(plan)
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function pickMnzyCoverageRequest(request: Record<string, unknown>): Record<string, unknown> {
  return {
    province: request.province,
    classify: request.classify,
    batch: request.batch,
    year: request.year,
    pageNum: request.pageNum,
    universityName: request.universityName
  };
}

function matchesRequestedPlanGroup(value: unknown, requested: string | null | undefined): boolean {
  if (!requested) return true;
  const left = normalizePlanGroup(stringify(value));
  const right = normalizePlanGroup(requested);
  return Boolean(left && right && left === right);
}

function matchesRequestedMajor(name: unknown, remarks: unknown, requested: string | null | undefined): boolean {
  if (!requested) return true;
  const text = normalizeName([name, remarks].map((item) => String(item ?? "")).join(""));
  const target = normalizeName(requested);
  return Boolean(text && target && (text.includes(target) || target.includes(text)));
}

function mnzySubjectProfile(subjectType: string): { classify: string; subjects: string } | null {
  const normalized = normalizeSubjectType(subjectType) ?? subjectType;
  if (normalized.includes("物理") || normalized === "理科") return { classify: "物理", subjects: "物理,化学,生物" };
  if (normalized.includes("历史") || normalized === "文科") return { classify: "历史", subjects: "历史,政治,地理" };
  if (normalized.includes("综合")) return { classify: "综合", subjects: "物理,化学,生物" };
  return null;
}

function mnzyBatchCandidates(subjectType: string): string[] {
  const normalized = normalizeSubjectType(subjectType) ?? subjectType;
  if (normalized === "理科" || normalized === "文科") return ["本科一批", "本科二批", "本科批"];
  if (normalized.includes("综合")) return ["本科批", "普通类一段", "平行录取一段", "本科一批"];
  return ["本科批", "本科一批"];
}

function primaryMnzyBatch(subjectType: string): string {
  return mnzyBatchCandidates(subjectType)[0] ?? "本科批";
}

function matchesMnzyUniversity(group: MnzyRecommendGroup, universityName: string, sourceSchoolId: string): boolean {
  if (String(group.zsgkId ?? "") === sourceSchoolId) return true;
  return normalizeName(String(group.universityName ?? "")) === normalizeName(universityName);
}

function isMnzySuccessPayload<T>(payload: MnzyApiResponse<T>): boolean {
  return String(payload.code ?? "") === "200";
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
  if (/^[.。·、]/u.test(name)) return false;
  if (/皇家帝国|霍格沃茨|魔法|外星|宇宙|家里蹲|野鸡/u.test(name)) return false;
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
  const names = new Set(defaultAdmissionSubjectTypeNamesForProvinceYear(provinceName, year));
  return SUBJECT_TYPES.filter((subject) => names.has(subject.name));
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

function summarizeMnzyRequestTarget(request: Record<string, unknown>): string {
  const picked = [
    "province",
    "classify",
    "batch",
    "year",
    "pageNum",
    "universityName",
    "universityMajorGroup",
    "recruitCode"
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

export function renderGaokaoSchoolProfile(school: GaokaoSchool, schoolId: string, sourceUrl: string): string {
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

class GaokaoCnRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GaokaoCnRateLimitError";
  }
}

class GaokaoCnRequestBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GaokaoCnRequestBudgetError";
  }
}

export function isGaokaoCnRateLimitError(error: unknown): boolean {
  if (error instanceof GaokaoCnRateLimitError) return true;
  return isGaokaoCnRateLimitMessage(getErrorMessage(error));
}

function isGaokaoCnRequestBudgetError(error: unknown): boolean {
  return error instanceof GaokaoCnRequestBudgetError || /source request budget exhausted|请求预算/u.test(getErrorMessage(error));
}

function isGaokaoCnRateLimitPayload<T extends object>(payload: GaokaoApiResponse<T>): boolean {
  return isGaokaoCnRateLimitMessage(`${payload.code ?? ""} ${payload.message ?? ""}`);
}

function isGaokaoCnRateLimitMessage(message: string): boolean {
  return /\b1069\b|访问太过频繁|请稍后再试|限流|HTTP 429|too many requests|rate limit/i.test(message);
}

function isExistingRateLimitCooldownError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("仍在限流冷却中");
}

function createRequestContext(requestDelayMs?: number, rateLimitCooldownMinutes?: number, maxSourceRequests?: number): GaokaoRequestContext {
  return {
    requestDelayMs: clampRequestDelayMs(requestDelayMs),
    rateLimitCooldownMinutes: clampRateLimitCooldownMinutes(rateLimitCooldownMinutes),
    maxSourceRequests: clampMaxSourceRequests(maxSourceRequests),
    requestCount: 0,
    lastRequestAt: 0,
    rateLimited: false,
    requestBudgetExhausted: false
  };
}

function clampRequestDelayMs(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_REQUEST_DELAY_MS;
  const minDelay = process.env.NODE_ENV === "test" ? 0 : DEFAULT_REQUEST_DELAY_MS;
  return Math.max(minDelay, Math.min(60 * 60 * 1000, Math.floor(value)));
}

function clampRateLimitCooldownMinutes(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_RATE_LIMIT_COOLDOWN_MINUTES;
  return Math.max(1, Math.min(24 * 60, Math.floor(value)));
}

function clampMaxSourceRequests(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_SOURCE_REQUESTS;
  const minRequests = process.env.NODE_ENV === "test" ? 0 : 1;
  return Math.max(minRequests, Math.min(500, Math.floor(value)));
}

function parseFutureDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() > Date.now() ? date : null;
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
      if (isGaokaoCnRateLimitError(error)) break;
      if (attempt >= retries) break;
      await delay(800 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchJsonPostWithRetry(url: string, body: Record<string, unknown>, retries = 2): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json,text/plain,*/*",
          "content-type": "application/json",
          origin: "https://mnzy.gaokao.cn",
          referer: "https://mnzy.gaokao.cn/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (isGaokaoCnRateLimitError(error)) break;
      if (attempt >= retries) break;
      await delay(500 * attempt);
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
