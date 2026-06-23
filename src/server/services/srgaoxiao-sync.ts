import type { AppConfig } from "../config.js";
import type { UniversityRepository, UniversityRow } from "./university-repository.js";

const SOURCE = "srgaoxiao";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export type SrgaoxiaoProgressReporter = (message: string) => void;

export interface SrgaoxiaoSyncOptions {
  query?: string;
  limit?: number;
}

export interface SrgaoxiaoSyncResult {
  source: typeof SOURCE;
  baseUrl: string;
  total: number;
  matched: number;
  saved: number;
  skipped: number;
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
    const limit = clampLimit(options.limit);
    const query = options.query?.trim() ?? "";
    const rows = this.universities.listUniversitiesForProfileSync(SOURCE, query, limit);
    const result: SrgaoxiaoSyncResult = {
      source: SOURCE,
      baseUrl: this.baseUrl,
      total: rows.length,
      matched: 0,
      saved: 0,
      skipped: 0,
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
        const sourceUrl = `${this.baseUrl}/school/${encodeURIComponent(school.name)}`;
        this.universities.upsertSchoolProfile({
          universityId: university.id,
          source: SOURCE,
          sourceSchoolId: String(school.id),
          sourceUrl,
          payloadJson: JSON.stringify(school),
          profileText: renderProfileText(school, sourceUrl)
        });
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

  private async fetchSchool(universityName: string): Promise<SrgaoxiaoSchool | null> {
    const url = new URL("/api/schools", this.baseUrl);
    url.searchParams.set("keyword", universityName);
    url.searchParams.set("page", "1");
    url.searchParams.set("pageSize", "3");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "myqqbot/0.1 school-profile-cache"
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { data?: unknown };
      const items = Array.isArray(payload.data) ? (payload.data as SrgaoxiaoSchool[]) : [];
      return pickBestMatch(universityName, items);
    } finally {
      clearTimeout(timer);
    }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
