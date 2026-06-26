import { loadConfig } from "../config.js";
import { AppDatabase } from "../db.js";
import { AdmissionRepository } from "../services/admission-repository.js";
import { JiangsuOfficialPlanAdapter, type JiangsuOfficialPlanSyncOptions } from "../services/jiangsu-official-plan-adapter.js";
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
const adapter = new JiangsuOfficialPlanAdapter(universities, admissions, (message) => {
  console.log(`[sync:jiangsu-official-plans] ${message}`);
});

try {
  const result = await adapter.sync(buildSyncOptions(cli));
  console.log(
    `[sync:jiangsu-official-plans] Synced official Jiangsu plan rows: mapped ${result.mapped}, plans ${result.planRows}/${result.total}, source snapshots ${result.sourceRows}, skipped ${result.skipped}, errors ${result.errors.length}.`
  );
  for (const error of result.errors.slice(0, 10)) {
    console.log(`[sync:jiangsu-official-plans] ERROR ${error.source}: ${error.message}`);
  }
} finally {
  database.close();
}

function buildSyncOptions(cliOptions: CliOptions): JiangsuOfficialPlanSyncOptions {
  return {
    query: optionString(cliOptions, ["query", "q"], process.env.JIANGSU_OFFICIAL_PLAN_QUERY),
    limit: optionNumberOptional(cliOptions, ["limit"], process.env.JIANGSU_OFFICIAL_PLAN_LIMIT)
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

function printUsage(): void {
  console.log(`
Usage:
  npm run sync:jiangsu-official-plans
  npm run sync:jiangsu-official-plans -- --query=苏州大学

Default:
  同步已适配高校官网中的 2026 江苏招生计划；不请求掌上高考。

Options:
  --query=苏州大学        只同步学校名包含该关键词的官方计划来源。
  --limit=20             最多同步多少个已适配官方计划来源。
`);
}
