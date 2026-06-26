import { loadConfig } from "../config.js";
import { AppDatabase } from "../db.js";
import { AdmissionRepository } from "../services/admission-repository.js";
import {
  DEFAULT_JIANGSU_OFFICIAL_SCORE_SOURCES,
  JiangsuOfficialAdmissionAdapter,
  type JiangsuOfficialSyncOptions
} from "../services/jiangsu-official-adapter.js";
import { UniversityRepository } from "../services/university-repository.js";

interface CliOptions {
  values: Map<string, string>;
  flags: Set<string>;
}

const cli = parseCliOptions(process.argv.slice(2));

if (cli.flags.has("help") || cli.flags.has("h")) {
  printUsage();
  process.exit(0);
}

const config = loadConfig();
const database = new AppDatabase(config.dbPath);
const universities = new UniversityRepository(database);
const admissions = new AdmissionRepository(database);
const adapter = new JiangsuOfficialAdmissionAdapter(universities, admissions, (message) => {
  console.log(`[sync:jiangsu-official] ${message}`);
});

try {
  const result = await adapter.sync(buildSyncOptions(cli));
  console.log(
    `[sync:jiangsu-official] Synced official Jiangsu rows: mapped ${result.mapped}/${result.total}, scores ${result.scoreRows}, source snapshots ${result.sourceRows}, skipped ${result.skipped}, errors ${result.errors.length}.`
  );
  for (const error of result.errors.slice(0, 10)) {
    console.log(`[sync:jiangsu-official] ERROR ${error.source}: ${error.message}`);
  }
} finally {
  database.close();
}

function buildSyncOptions(cliOptions: CliOptions): JiangsuOfficialSyncOptions {
  const year = optionNumberOptional(cliOptions, ["year"], process.env.JIANGSU_OFFICIAL_YEAR);
  const subject = optionString(cliOptions, ["subject", "subject-type"], process.env.JIANGSU_OFFICIAL_SUBJECT);
  const pdfUrl = optionString(cliOptions, ["pdf-url"], process.env.JIANGSU_OFFICIAL_PDF_URL);
  const excelUrl = optionString(cliOptions, ["excel-url", "xls-url", "xlsx-url"], process.env.JIANGSU_OFFICIAL_EXCEL_URL);
  const pageUrl = optionString(cliOptions, ["page-url"], process.env.JIANGSU_OFFICIAL_PAGE_URL);
  const query = optionString(cliOptions, ["query", "q"], process.env.JIANGSU_OFFICIAL_QUERY);
  const limit = optionNumberOptional(cliOptions, ["limit"], process.env.JIANGSU_OFFICIAL_LIMIT);
  const options: JiangsuOfficialSyncOptions = { query, limit };
  if (year || subject || pdfUrl || excelUrl || pageUrl) {
    const subjectType = normalizeSubject(subject);
    if (!subjectType) throw new Error("--subject must be 物理类 or 历史类 when custom source options are used");
    const defaultSource = DEFAULT_JIANGSU_OFFICIAL_SCORE_SOURCES.find(
      (source) => source.subjectType === subjectType && (!year || source.year === year)
    );
    if (!pageUrl && !pdfUrl && !excelUrl && !defaultSource) {
      throw new Error("No built-in Jiangsu official source found for this year/subject; pass --page-url, --pdf-url or --excel-url.");
    }
    options.sources = [
      {
        ...(defaultSource ?? {
          year: year ?? 2025,
          subjectType,
          batch: "本科批",
          linkTextIncludes: subjectType.includes("物理") ? "物理" : "历史"
        }),
        year: year ?? defaultSource?.year ?? 2025,
        subjectType,
        batch: optionString(cliOptions, ["batch"], process.env.JIANGSU_OFFICIAL_BATCH) ?? defaultSource?.batch ?? "本科批",
        title: optionString(cliOptions, ["title"], process.env.JIANGSU_OFFICIAL_TITLE) ?? defaultSource?.title,
        pageUrl: pageUrl ?? defaultSource?.pageUrl,
        pdfUrl: pdfUrl ?? defaultSource?.pdfUrl,
        excelUrl: excelUrl ?? defaultSource?.excelUrl,
        linkTextIncludes: subjectType.includes("物理") ? "物理" : "历史"
      }
    ];
  }
  return options;
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex >= 0) {
      values.set(raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1));
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(raw, next);
      index += 1;
    } else {
      flags.add(raw);
    }
  }
  return { values, flags };
}

function optionString(cliOptions: CliOptions, names: string[], envValue?: string): string | undefined {
  for (const name of names) {
    const value = cliOptions.values.get(name);
    if (value !== undefined) return value;
  }
  return envValue || undefined;
}

function optionNumberOptional(cliOptions: CliOptions, names: string[], envValue?: string): number | undefined {
  const value = optionString(cliOptions, names, envValue);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSubject(value?: string): "物理类" | "历史类" | null {
  if (!value) return null;
  if (value.includes("物理")) return "物理类";
  if (value.includes("历史")) return "历史类";
  return null;
}

function printUsage(): void {
  console.log(`
Usage:
  npm run sync:jiangsu-official
  npm run sync:jiangsu-official -- --query=南京大学
  npm run sync:jiangsu-official -- --year=2025 --subject=物理类 --page-url=https://www.jseea.cn/...

Default:
  同步江苏省教育考试院 2025 普通类本科批次物理类、历史类平行志愿投档线。

Options:
  --query=南京大学        只入库学校名包含该关键词的记录。
  --limit=50             每个来源最多入库多少条匹配记录；不填则全量入库。
  --year=2025            自定义官方来源年份。
  --subject=物理类        自定义官方来源科类：物理类或历史类。
  --page-url=...         官方网页 URL，脚本会按科类解析页面里的 PDF 链接。
  --pdf-url=...          直接指定官方 PDF URL。
  --excel-url=...        直接指定官方 xls/xlsx URL。
  --batch=本科批          批次名称，默认本科批。
`);
}
