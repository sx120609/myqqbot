import { loadConfig } from "../config.js";
import { AppDatabase } from "../db.js";
import { AdmissionRepository } from "../services/admission-repository.js";
import { UniversityRepository } from "../services/university-repository.js";
import { XuefengAgentAdapter, type XuefengAgentSyncOptions } from "../services/xuefeng-agent-adapter.js";

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
const adapter = new XuefengAgentAdapter(config.dataDir, database, universities, admissions, (message) => {
  console.log(`[sync:xuefeng-agent] ${message}`);
});

try {
  const options = buildSyncOptions(cli);
  const result = await adapter.sync(options);
  console.log(
    `[sync:xuefeng-agent] Done. Rows ${result.scoreRows}/${result.total}, mapped ${result.mapped}, school scores ${result.schoolScoreRows}, major scores ${result.majorScoreRows}, unmapped ${result.unmapped}, skipped ${result.skipped}, next offset ${result.nextOffset}.`
  );
  if (result.errors.length) {
    console.log(`[sync:xuefeng-agent] First issues: ${result.errors.map((item) => `${item.school}: ${item.message}`).join("; ")}`);
  }
} finally {
  database.close();
}

function buildSyncOptions(cliOptions: CliOptions): XuefengAgentSyncOptions {
  return {
    dbPath: optionString(cliOptions, ["db", "db-path"], process.env.XUEFENG_AGENT_DB_PATH),
    gzPath: optionString(cliOptions, ["gz", "gz-path"], process.env.XUEFENG_AGENT_GZ_PATH),
    url: optionString(cliOptions, ["url"], process.env.XUEFENG_AGENT_DB_URL),
    query: optionString(cliOptions, ["query", "q"], process.env.XUEFENG_AGENT_QUERY),
    provinces: optionList(cliOptions, ["province", "provinces"], process.env.XUEFENG_AGENT_PROVINCES),
    years: optionNumberList(cliOptions, ["year", "years"], process.env.XUEFENG_AGENT_YEARS),
    limit: optionNumberOptional(cliOptions, ["limit"], process.env.XUEFENG_AGENT_LIMIT),
    offset: optionNumberOptional(cliOptions, ["offset"], process.env.XUEFENG_AGENT_OFFSET)
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
  return envValue?.trim() || undefined;
}

function optionNumberOptional(cliOptions: CliOptions, names: string[], envValue: string | undefined): number | undefined {
  const value = optionString(cliOptions, names, envValue);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionList(cliOptions: CliOptions, names: string[], envValue: string | undefined): string[] | undefined {
  const value = optionString(cliOptions, names, envValue);
  if (!value) return undefined;
  const items = value.split(/[,，\s]+/u).map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function optionNumberList(cliOptions: CliOptions, names: string[], envValue: string | undefined): number[] | undefined {
  const values = optionList(cliOptions, names, envValue)
    ?.map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item));
  return values?.length ? values : undefined;
}

function printUsage(): void {
  console.log(`
Usage:
  npm run sync:xuefeng-agent -- [options]

Options:
  --db <path>             Use an existing admission_clean.db SQLite file.
  --gz <path>             Use an existing admission_clean.db.gz file and decompress it.
  --url <url>             Download admission_clean.db.gz from a custom URL.
  --query <school/major>  Import rows matching a school or major keyword.
  --provinces <list>      Comma separated province names, for example 江苏,浙江.
  --years <list>          Comma separated years, for example 2024,2025.
  --limit <n>             Max rows to import. Default: all rows.
  --offset <n>            Start offset for batched imports.
`);
}
