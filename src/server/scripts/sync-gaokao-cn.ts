import { loadConfig } from "../config.js";
import { AppDatabase } from "../db.js";
import { AdmissionRepository } from "../services/admission-repository.js";
import { defaultAdmissionPlanYears, defaultAdmissionScoreYears } from "../services/admission-calendar.js";
import { GaokaoCnAdapter, type GaokaoCnSyncOptions, type GaokaoCnSyncResult } from "../services/gaokao-cn-adapter.js";
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
const sync = new GaokaoCnAdapter(universities, admissions, (message) => {
  console.log(`[sync:gaokao-cn] ${message}`);
});

try {
  const options = buildSyncOptions(cli);
  const loop = optionBoolean(cli, ["loop", "all"], process.env.GAOKAO_CN_SYNC_LOOP, false);
  const maxBatches = Math.max(1, optionNumber(cli, ["max-batches"], process.env.GAOKAO_CN_MAX_BATCHES, loop ? 100 : 1));
  const continueOnError = optionBoolean(cli, ["continue-on-error"], process.env.GAOKAO_CN_CONTINUE_ON_ERROR, false);
  const aggregate = createAggregate();
  let offset = options.offset ?? 0;

  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const batchOptions = { ...options, offset };
    console.log(
      `[sync:gaokao-cn] Batch ${batch}/${maxBatches}: ${describeBatch(batchOptions)}`
    );
    const result = await sync.sync(batchOptions);
    appendAggregate(aggregate, result);
    printResult(result);

    if (result.errors.length && !continueOnError) {
      console.log("[sync:gaokao-cn] Stopped because this batch has errors. Use --continue-on-error to keep going.");
      break;
    }
    if (!loop || result.nextOffset === 0) {
      printContinuationHint(result, options);
      break;
    }
    offset = result.nextOffset;
  }

  if (aggregate.batches > 1) {
    console.log(
      `[sync:gaokao-cn] Total ${aggregate.mapped}/${aggregate.total} mapped in ${aggregate.batches} batches. Plans: ${aggregate.planRows}. School scores: ${aggregate.schoolScoreRows}. Major scores: ${aggregate.majorScoreRows}. Sources: ${aggregate.sourceRows}. Errors: ${aggregate.errors}.`
    );
  }
} finally {
  database.close();
}

function buildSyncOptions(cliOptions: CliOptions): GaokaoCnSyncOptions {
  const plansOnly = cliOptions.flags.has("plans-only");
  const scoresOnly = cliOptions.flags.has("scores-only");
  const noPlans = optionBoolean(cliOptions, ["no-plans"], undefined, false);
  const noScores = optionBoolean(cliOptions, ["no-scores"], undefined, false);
  const includePlans = plansOnly ? true : scoresOnly || noPlans ? false : envBoolean(process.env.GAOKAO_CN_INCLUDE_PLANS, true);
  const includeScores = scoresOnly ? true : plansOnly || noScores ? false : envBoolean(process.env.GAOKAO_CN_INCLUDE_SCORES, true);

  return {
    query: optionString(cliOptions, ["query", "q"], process.env.GAOKAO_CN_SYNC_QUERY),
    limit: optionNumber(cliOptions, ["limit"], process.env.GAOKAO_CN_SYNC_LIMIT, 10),
    offset: optionNumberOptional(cliOptions, ["offset"], process.env.GAOKAO_CN_SYNC_OFFSET),
    universityId: optionNumberOptional(cliOptions, ["university-id", "university"], process.env.GAOKAO_CN_UNIVERSITY_ID),
    provinces: optionList(cliOptions, ["province", "provinces"], process.env.GAOKAO_CN_PROVINCES),
    subjectTypes: optionList(
      cliOptions,
      ["subject", "subjects", "subject-type", "subject-types"],
      process.env.GAOKAO_CN_SUBJECT_TYPES
    ),
    scoreYears: optionNumberList(
      cliOptions,
      ["score-year", "score-years"],
      process.env.GAOKAO_CN_SCORE_YEARS ?? defaultAdmissionScoreYears().join(",")
    ),
    planYears: optionNumberList(
      cliOptions,
      ["plan-year", "plan-years"],
      process.env.GAOKAO_CN_PLAN_YEARS ?? defaultAdmissionPlanYears().join(",")
    ),
    includePlans,
    includeScores,
    includeSpecialScores:
      optionBoolean(cliOptions, ["no-special-scores"], undefined, false)
        ? false
        : envBoolean(process.env.GAOKAO_CN_INCLUDE_SPECIAL_SCORES, true),
    eligibleOnly:
      optionBoolean(cliOptions, ["no-eligible-only"], undefined, false)
        ? false
        : envBoolean(process.env.GAOKAO_CN_ELIGIBLE_ONLY, true)
  };
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

function optionString(cliOptions: CliOptions, names: string[], envValue: string | undefined): string | undefined {
  for (const name of names) {
    const value = cliOptions.values.get(name);
    if (value !== undefined) return value;
  }
  return envValue || undefined;
}

function optionNumber(cliOptions: CliOptions, names: string[], envValue: string | undefined, fallback: number): number {
  return optionNumberOptional(cliOptions, names, envValue) ?? fallback;
}

function optionNumberOptional(cliOptions: CliOptions, names: string[], envValue: string | undefined): number | undefined {
  const value = optionString(cliOptions, names, envValue);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionList(cliOptions: CliOptions, names: string[], envValue: string | undefined): string[] | undefined {
  return splitList(optionString(cliOptions, names, envValue));
}

function optionNumberList(cliOptions: CliOptions, names: string[], envValue: string | undefined): number[] | undefined {
  return splitNumberList(optionString(cliOptions, names, envValue));
}

function optionBoolean(cliOptions: CliOptions, names: string[], envValue: string | undefined, fallback: boolean): boolean {
  for (const name of names) {
    if (cliOptions.flags.has(name)) return true;
    const value = cliOptions.values.get(name);
    if (value !== undefined) return parseBoolean(value, fallback);
  }
  return parseBoolean(envValue, fallback);
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  return parseBoolean(value, fallback);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(/[,，\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function splitNumberList(value: string | undefined): number[] | undefined {
  const items = splitList(value)
    ?.map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  return items?.length ? items : undefined;
}

function createAggregate() {
  return {
    batches: 0,
    total: 0,
    mapped: 0,
    planRows: 0,
    schoolScoreRows: 0,
    majorScoreRows: 0,
    sourceRows: 0,
    errors: 0
  };
}

function appendAggregate(aggregate: ReturnType<typeof createAggregate>, result: GaokaoCnSyncResult): void {
  aggregate.batches += 1;
  aggregate.total += result.total;
  aggregate.mapped += result.mapped;
  aggregate.planRows += result.planRows;
  aggregate.schoolScoreRows += result.schoolScoreRows;
  aggregate.majorScoreRows += result.majorScoreRows;
  aggregate.sourceRows += result.sourceRows;
  aggregate.errors += result.errors.length;
}

function printResult(result: GaokaoCnSyncResult): void {
  console.log(
    `Synced ${result.mapped}/${result.total} Gaokao.cn mappings at offset ${result.offset}/${result.candidateTotal}, next offset ${result.nextOffset}. Plans: ${result.planRows}. School scores: ${result.schoolScoreRows}. Major scores: ${result.majorScoreRows}. Sources: ${result.sourceRows}. Errors: ${result.errors.length}.`
  );
  if (result.errors.length) {
    for (const error of result.errors.slice(0, 20)) {
      console.log(`- ${error.university}: ${error.message}`);
    }
  }
}

function printContinuationHint(result: GaokaoCnSyncResult, options: GaokaoCnSyncOptions): void {
  if (result.nextOffset === 0 || result.nextOffset <= result.offset) {
    console.log("[sync:gaokao-cn] No next batch.");
    return;
  }
  console.log(`[sync:gaokao-cn] Next batch: ${renderContinuationCommand(options, result.nextOffset)}`);
}

function renderContinuationCommand(options: GaokaoCnSyncOptions, nextOffset: number): string {
  const args = [`--offset=${nextOffset}`];
  if (options.query) args.push(`--query=${quoteArg(options.query)}`);
  if (options.limit) args.push(`--limit=${options.limit}`);
  if (options.universityId) args.push(`--university-id=${options.universityId}`);
  if (options.provinces?.length) args.push(`--provinces=${quoteArg(options.provinces.join(","))}`);
  if (options.subjectTypes?.length) args.push(`--subjects=${quoteArg(options.subjectTypes.join(","))}`);
  if (options.planYears?.length) args.push(`--plan-years=${options.planYears.join(",")}`);
  if (options.scoreYears?.length) args.push(`--score-years=${options.scoreYears.join(",")}`);
  if (options.includePlans === true && options.includeScores === false) args.push("--plans-only");
  if (options.includePlans === false && options.includeScores === true) args.push("--scores-only");
  if (options.includeSpecialScores === false) args.push("--no-special-scores");
  if (options.eligibleOnly === false) args.push("--no-eligible-only");
  return `npm run sync:gaokao-cn -- ${args.join(" ")}`;
}

function quoteArg(value: string): string {
  if (!/[\s'"$`]/u.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function describeBatch(options: GaokaoCnSyncOptions): string {
  return [
    `limit=${options.limit ?? 10}`,
    `offset=${options.offset ?? 0}`,
    options.query ? `query=${options.query}` : null,
    options.universityId ? `universityId=${options.universityId}` : null,
    options.provinces?.length ? `provinces=${options.provinces.join(",")}` : "provinces=all",
    options.subjectTypes?.length ? `subjects=${options.subjectTypes.join(",")}` : "subjects=auto",
    options.planYears?.length && options.includePlans !== false ? `planYears=${options.planYears.join(",")}` : null,
    options.scoreYears?.length && options.includeScores !== false ? `scoreYears=${options.scoreYears.join(",")}` : null,
    options.includePlans === false ? "plans=off" : null,
    options.includeScores === false ? "scores=off" : null
  ]
    .filter(Boolean)
    .join(", ");
}

function printUsage(): void {
  console.log(`Usage:
  npm run sync:gaokao-cn -- [options]

Common:
  --limit=10                    同步本批学校数，默认 10。
  --offset=0                    从候选学校列表的第几个开始，适合续跑。
  --query=南航                  只同步名称匹配的学校。
  --university-id=123           只同步本地库里的某个学校 ID。
  --provinces=四川,河南         限制生源省份；留空为全国。
  --subjects=理科,文科          限制科类；留空按省份和年份自动选择。
  --plan-years=2026             招生计划年份，默认当前计划年份。
  --score-years=2025,2024,2023  分数线年份，默认近三年历史年份。

Mode:
  --plans-only                  只抓招生计划。
  --scores-only                 只抓分数线和位次。
  --no-special-scores           不抓专业分。
  --no-eligible-only            不过滤疑似非普通高校候选。
  --loop                        按 next offset 自动跑多批。
  --max-batches=20              loop 时最多跑多少批，默认 100。
  --continue-on-error           单批有失败时继续下一批。

Environment variables remain supported:
  GAOKAO_CN_SYNC_LIMIT, GAOKAO_CN_SYNC_OFFSET, GAOKAO_CN_PROVINCES,
  GAOKAO_CN_SUBJECT_TYPES, GAOKAO_CN_PLAN_YEARS, GAOKAO_CN_SCORE_YEARS.
`);
}
