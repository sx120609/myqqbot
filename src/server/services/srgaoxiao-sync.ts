import type { AppConfig } from "../config.js";
import type { SchoolReviewInput, SchoolReviewRow, UniversityRepository, UniversityRow } from "./university-repository.js";

const SOURCE = "srgaoxiao";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_REVIEW_PAGE_SIZE = 100;
const DEFAULT_REVIEW_MAX_PAGES = 20;

export type SrgaoxiaoProgressReporter = (message: string) => void;

export interface SrgaoxiaoSyncOptions {
  query?: string;
  limit?: number;
  full?: boolean;
  pageSize?: number;
  refreshReviews?: "none" | "changed" | "always";
  reviewPageSize?: number;
  reviewMaxPages?: number;
}

export interface SrgaoxiaoSyncResult {
  source: typeof SOURCE;
  baseUrl: string;
  mode: "batch" | "full";
  total: number;
  remoteTotal: number | null;
  matched: number;
  saved: number;
  skipped: number;
  reviewsRefreshed: number;
  reviewsSaved: number;
  errors: Array<{ university: string; message: string }>;
}

interface SrgaoxiaoSchool {
  id: number | string;
  name: string;
  type?: string | null;
  province?: string | null;
  city?: string | null;
  detailed_address?: string | null;
  tags?: string | null;
  full_tags?: string | null;
  description?: string | null;
  website?: string | null;
  admission_website?: string | null;
  phone?: string | null;
  area?: string | number | null;
  founded_year?: string | number | null;
  review_count?: string | number | null;
  verified_count?: string | number | null;
  dormitory?: string | number | null;
  cafeteria?: string | number | null;
  faculty?: string | number | null;
  environment?: string | number | null;
  culture?: string | number | null;
  employment?: string | number | null;
  safety?: string | number | null;
  rating?: string | number | null;
  rating_rank?: string | number | null;
}

interface SrgaoxiaoReview {
  id: number | string;
  school_id: number | string;
  content?: string | null;
  display_name?: string | null;
  nickname?: string | null;
  campus_name?: string | null;
  is_verified?: number | boolean | null;
  isVerified?: boolean | null;
  like_count?: number | string | null;
  reply_count?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  rating?: unknown;
}

export class SrgaoxiaoSyncService {
  private readonly baseUrl: string;

  constructor(
    private readonly config: AppConfig,
    private readonly universities: UniversityRepository,
    private readonly progress?: SrgaoxiaoProgressReporter
  ) {
    this.baseUrl = config.srgaoxiao.baseUrl.replace(/\/+$/, "");
  }

  async sync(options: SrgaoxiaoSyncOptions = {}): Promise<SrgaoxiaoSyncResult> {
    if (options.full) return this.syncAll(options);

    const limit = clampLimit(options.limit);
    const query = options.query?.trim() ?? "";
    const rows = this.universities.listUniversitiesForProfileSync(SOURCE, query, limit);
    const result: SrgaoxiaoSyncResult = {
      source: SOURCE,
      baseUrl: this.baseUrl,
      mode: "batch",
      total: rows.length,
      remoteTotal: null,
      matched: 0,
      saved: 0,
      skipped: 0,
      reviewsRefreshed: 0,
      reviewsSaved: 0,
      errors: []
    };

    this.report(`Preparing ${rows.length} local universities for srgaoxiao profile sync...`);
    for (const [index, university] of rows.entries()) {
      if (index > 0) await delay(this.config.srgaoxiao.delayMs);

      try {
        const school = await this.fetchSchool(university.name);
        if (!school) {
          result.skipped += 1;
          this.report(`No srgaoxiao match for ${university.name}.`);
          continue;
        }

        result.matched += 1;
        this.saveProfile(university, school);
        result.saved += 1;
        this.report(`Saved srgaoxiao profile for ${university.name}.`);
      } catch (error) {
        result.errors.push({
          university: university.name,
          message: error instanceof Error ? error.message : String(error)
        });
        this.report(`Failed ${university.name}: ${result.errors.at(-1)?.message}`);
      }
    }

    this.report(`srgaoxiao profile sync finished: ${result.saved}/${result.total} saved.`);
    return result;
  }

  async fetchLiveReviewContext(universityId: number, limit = 6): Promise<string | null> {
    const profile = this.universities.getSchoolProfile(universityId, SOURCE);
    if (!profile?.sourceSchoolId) return renderCachedReviews(this.universities.getSchoolReviews(universityId, SOURCE, limit));
    const sourceSchoolId = profile.sourceSchoolId;

    try {
      const reviews = await this.fetchReviews(sourceSchoolId, Math.max(1, Math.min(20, limit)), 1);
      if (reviews.length) {
        const schoolName = parseProfileSchoolName(profile.payloadJson) ?? "";
        this.universities.upsertSchoolReviews({
          universityId,
          source: SOURCE,
          sourceSchoolId,
          reviews: reviews.map((review) =>
            toReviewInput(review, this.reviewUrl({ id: sourceSchoolId, name: schoolName || sourceSchoolId }, review))
          )
        });
      }
      return renderLiveReviews(reviews, profile.sourceUrl);
    } catch (error) {
      this.report(`Live srgaoxiao review fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      return renderCachedReviews(this.universities.getSchoolReviews(universityId, SOURCE, limit));
    }
  }

  private async syncAll(options: SrgaoxiaoSyncOptions): Promise<SrgaoxiaoSyncResult> {
    const pageSize = clampPageSize(options.pageSize);
    const refreshReviews = options.refreshReviews ?? "changed";
    const reviewPageSize = clampPageSize(options.reviewPageSize ?? DEFAULT_REVIEW_PAGE_SIZE);
    const reviewMaxPages = clampReviewMaxPages(options.reviewMaxPages);
    const localByName = new Map<string, UniversityRow>();
    for (const university of this.universities.listAllUniversities()) {
      localByName.set(normalizeName(university.name), university);
    }

    const result: SrgaoxiaoSyncResult = {
      source: SOURCE,
      baseUrl: this.baseUrl,
      mode: "full",
      total: 0,
      remoteTotal: null,
      matched: 0,
      saved: 0,
      skipped: 0,
      reviewsRefreshed: 0,
      reviewsSaved: 0,
      errors: []
    };

    this.report(`Preparing full srgaoxiao profile sync with pageSize=${pageSize}...`);
    for (let page = 1; ; page += 1) {
      if (page > 1) await delay(this.config.srgaoxiao.delayMs);

      const payload = await this.fetchSchoolPage(page, pageSize);
      if (result.remoteTotal === null) result.remoteTotal = payload.total;
      if (!payload.data.length) break;

      result.total += payload.data.length;
      this.report(`Fetched srgaoxiao page ${page}: ${result.total}/${payload.total} schools...`);

      for (const school of payload.data) {
        const university = localByName.get(normalizeName(school.name));
        if (!university) {
          result.skipped += 1;
          continue;
        }

        try {
          const previousProfile = this.universities.getSchoolProfile(university.id, SOURCE);
          const shouldRefreshReviews = this.shouldRefreshReviews(university.id, previousProfile?.payloadJson, school, refreshReviews);
          this.saveProfile(university, school);
          result.matched += 1;
          result.saved += 1;
          if (shouldRefreshReviews) {
            const reviews = await this.fetchReviews(String(school.id), reviewPageSize, reviewMaxPages);
            this.universities.replaceSchoolReviews({
              universityId: university.id,
              source: SOURCE,
              sourceSchoolId: String(school.id),
              reviews: reviews.map((review) => toReviewInput(review, this.reviewUrl(school, review)))
            });
            result.reviewsRefreshed += 1;
            result.reviewsSaved += reviews.length;
            this.report(`Refreshed ${reviews.length} srgaoxiao reviews for ${school.name}.`);
          }
        } catch (error) {
          result.errors.push({
            university: school.name,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (result.total >= payload.total) break;
    }

    this.report(`Full srgaoxiao profile sync finished: ${result.saved}/${result.total} saved.`);
    return result;
  }

  private shouldRefreshReviews(
    universityId: number,
    previousPayloadJson: string | undefined,
    school: SrgaoxiaoSchool,
    mode: "none" | "changed" | "always"
  ): boolean {
    if (mode === "none") return false;
    const reviewCount = toNumber(school.review_count);
    if (reviewCount <= 0) return false;
    if (mode === "always") return true;
    if (this.universities.countSchoolReviews(universityId, SOURCE) <= 0) return true;
    return parseReviewCount(previousPayloadJson) !== reviewCount;
  }

  private saveProfile(university: UniversityRow, school: SrgaoxiaoSchool): void {
    const sourceUrl = `${this.baseUrl}/school/${encodeURIComponent(school.name)}`;
    this.universities.upsertSchoolProfile({
      universityId: university.id,
      source: SOURCE,
      sourceSchoolId: String(school.id),
      sourceUrl,
      payloadJson: JSON.stringify(school),
      profileText: renderProfileText(school, sourceUrl)
    });
  }

  private async fetchSchool(universityName: string): Promise<SrgaoxiaoSchool | null> {
    const url = new URL("/api/schools", this.baseUrl);
    url.searchParams.set("keyword", universityName);
    url.searchParams.set("page", "1");
    url.searchParams.set("pageSize", "3");

    const payload = (await fetchJsonWithRetry(url, 30_000)) as { data?: unknown };
    const items = Array.isArray(payload.data) ? (payload.data as SrgaoxiaoSchool[]) : [];
    return pickBestMatch(universityName, items);
  }

  private async fetchSchoolPage(page: number, pageSize: number): Promise<{ data: SrgaoxiaoSchool[]; total: number }> {
    const url = new URL("/api/schools", this.baseUrl);
    url.searchParams.set("sort", "hot");
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));

    const payload = (await fetchJsonWithRetry(url, 60_000)) as { data?: unknown; total?: unknown };
    return {
      data: Array.isArray(payload.data) ? (payload.data as SrgaoxiaoSchool[]) : [],
      total: Number(payload.total ?? 0)
    };
  }

  private async fetchReviews(schoolId: string, pageSize: number, maxPages: number): Promise<SrgaoxiaoReview[]> {
    const reviews: SrgaoxiaoReview[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      if (page > 1) await delay(this.config.srgaoxiao.delayMs);
      const payload = await this.fetchReviewPage(schoolId, page, pageSize);
      reviews.push(...payload.data);
      if (!payload.data.length || reviews.length >= payload.total) break;
    }
    return reviews;
  }

  private async fetchReviewPage(
    schoolId: string,
    page: number,
    pageSize: number
  ): Promise<{ data: SrgaoxiaoReview[]; total: number }> {
    const url = new URL(`/api/reviews/school/${encodeURIComponent(schoolId)}`, this.baseUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));

    const payload = (await fetchJsonWithRetry(url, 60_000)) as { data?: unknown; total?: unknown };
    return {
      data: Array.isArray(payload.data) ? (payload.data as SrgaoxiaoReview[]) : [],
      total: Number(payload.total ?? 0)
    };
  }

  private reviewUrl(school: Pick<SrgaoxiaoSchool, "id" | "name">, review: SrgaoxiaoReview): string {
    return `${this.baseUrl}/school/${encodeURIComponent(school.name || String(school.id))}?review=${encodeURIComponent(String(review.id))}`;
  }

  private report(message: string): void {
    this.progress?.(message);
  }
}

function pickBestMatch(universityName: string, items: SrgaoxiaoSchool[]): SrgaoxiaoSchool | null {
  if (!items.length) return null;
  const target = normalizeName(universityName);
  return (
    items.find((item) => normalizeName(item.name) === target) ??
    items.find((item) => normalizeName(item.name).includes(target) || target.includes(normalizeName(item.name))) ??
    null
  );
}

function renderProfileText(school: SrgaoxiaoSchool, sourceUrl: string): string {
  const lines = [
    `来源：神人高校网（${sourceUrl}）`,
    `学校：${school.name}`,
    joinValues("定位", [school.type, school.province, school.city]),
    joinValues("标签", [school.full_tags || school.tags]),
    joinValues("地址/校区", [school.detailed_address]),
    joinValues("建校/占地", [
      school.founded_year ? `${school.founded_year} 年建校` : null,
      school.area ? `占地约 ${school.area} 亩` : null
    ]),
    joinValues("官网", [school.website]),
    joinValues("招生网", [school.admission_website]),
    joinValues("电话", [school.phone]),
    renderScoreLine(school),
    joinValues("评价规模", [
      school.review_count ? `${school.review_count} 条评价` : null,
      school.verified_count ? `${school.verified_count} 条认证` : null,
      school.rating_rank ? `评分排名 ${school.rating_rank}` : null
    ]),
    joinValues("简介", [truncate(cleanText(school.description), 1200)])
  ];
  return lines.filter(Boolean).join("\n");
}

function renderScoreLine(school: SrgaoxiaoSchool): string | null {
  return joinValues("评分", [
    score("综合", school.rating),
    score("宿舍", school.dormitory),
    score("食堂", school.cafeteria),
    score("师资", school.faculty),
    score("环境", school.environment),
    score("校风", school.culture),
    score("就业", school.employment),
    score("安全", school.safety)
  ]);
}

function toReviewInput(review: SrgaoxiaoReview, sourceUrl: string): SchoolReviewInput {
  return {
    sourceReviewId: String(review.id),
    sourceUrl,
    authorLabel: cleanText(review.display_name || review.nickname),
    campusName: cleanText(review.campus_name),
    isVerified: Boolean(review.is_verified || review.isVerified),
    content: cleanText(review.content) ?? "",
    ratingJson: review.rating ? JSON.stringify(review.rating) : null,
    likeCount: toNumber(review.like_count),
    replyCount: toNumber(review.reply_count),
    reviewedAt: cleanText(review.created_at),
    payloadJson: JSON.stringify(review)
  };
}

function renderLiveReviews(reviews: SrgaoxiaoReview[], sourceUrl: string | null): string | null {
  if (!reviews.length) return null;
  return [
    `来源：神人高校网实时评论${sourceUrl ? `（${sourceUrl}）` : ""}`,
    ...reviews.slice(0, 8).map((review, index) => renderReviewLine(index + 1, toReviewInput(review, "")))
  ].join("\n");
}

function renderCachedReviews(reviews: SchoolReviewRow[]): string | null {
  if (!reviews.length) return null;
  return [
    "来源：神人高校网评论缓存（实时获取失败或未触发实时刷新时使用）",
    ...reviews.slice(0, 8).map((review, index) =>
      renderReviewLine(index + 1, {
        sourceReviewId: review.sourceReviewId,
        sourceUrl: review.sourceUrl,
        authorLabel: review.authorLabel,
        campusName: review.campusName,
        isVerified: Boolean(review.isVerified),
        content: review.content,
        ratingJson: review.ratingJson,
        likeCount: review.likeCount,
        replyCount: review.replyCount,
        reviewedAt: review.reviewedAt,
        payloadJson: review.payloadJson
      })
    )
  ].join("\n");
}

function renderReviewLine(index: number, review: SchoolReviewInput): string {
  const meta = [
    review.reviewedAt,
    review.campusName,
    review.isVerified ? "已认证" : null,
    review.likeCount ? `${review.likeCount}赞` : null,
    renderRatingSummary(review.ratingJson)
  ].filter(Boolean);
  const content = truncate(cleanText(review.content), 360) ?? "";
  return `${index}. ${meta.length ? `【${meta.join("；")}】` : ""}${content}`;
}

function renderRatingSummary(ratingJson: string | null | undefined): string | null {
  if (!ratingJson) return null;
  try {
    const rating = JSON.parse(ratingJson) as Record<string, unknown>;
    return joinValues("评分", [
      score("宿舍", rating.dormitory),
      score("食堂", rating.cafeteria),
      score("师资", rating.faculty),
      score("环境", rating.environment),
      score("校风", rating.culture),
      score("就业", rating.employment),
      score("安全", rating.safety)
    ]);
  } catch {
    return null;
  }
}

function parseProfileSchoolName(payloadJson: string): string | null {
  try {
    return cleanText((JSON.parse(payloadJson) as { name?: unknown }).name);
  } catch {
    return null;
  }
}

function parseReviewCount(payloadJson: string | undefined): number | null {
  if (!payloadJson) return null;
  try {
    return toNumber((JSON.parse(payloadJson) as { review_count?: unknown }).review_count);
  } catch {
    return null;
  }
}

function joinValues(label: string, values: Array<unknown>): string | null {
  const clean = values.map((value) => cleanText(value)).filter(Boolean);
  return clean.length ? `${label}：${clean.join("；")}` : null;
}

function score(label: string, value: unknown): string | null {
  const clean = cleanText(value);
  return clean ? `${label}${clean}/5` : null;
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncate(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function clampLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function clampPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.max(20, Math.min(MAX_PAGE_SIZE, Math.floor(value)));
}

function clampReviewMaxPages(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_REVIEW_MAX_PAGES;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

async function fetchJsonWithRetry(url: URL, timeoutMs: number, retries = 3): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "myqqbot/0.1 school-profile-cache"
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await delay(1200 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
