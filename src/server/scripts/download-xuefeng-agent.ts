import { loadConfig } from "../config.js";
import { AppDatabase } from "../db.js";
import { AdmissionRepository } from "../services/admission-repository.js";
import { UniversityRepository } from "../services/university-repository.js";
import { XuefengAgentAdapter, type XuefengAgentSourceOptions } from "../services/xuefeng-agent-adapter.js";

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
  console.log(`[download:xuefeng-agent] ${message}`);
});

try {
  const result = await adapter.ensureSourceDb(buildOptions(cli));
  console.log(
    `[download:xuefeng-agent] Done. SQLite: ${result.dbPath}; gzip: ${result.gzPath}; downloaded: ${result.downloaded ? "yes" : "no"}.`
  );
} finally {
  database.close();
}

function buildOptions(cliOptions: CliOptions): XuefengAgentSourceOptions {
  return {
    dbPath: optionString(cliOptions, ["db", "db-path"], process.env.XUEFENG_AGENT_DB_PATH),
    gzPath: optionString(cliOptions, ["gz", "gz-path"], process.env.XUEFENG_AGENT_GZ_PATH),
    url: optionString(cliOptions, ["url"], process.env.XUEFENG_AGENT_DB_URL),
    force: cliOptions.flags.has("force")
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

function printUsage(): void {
  console.log(`
Usage:
  npm run download:xuefeng-agent -- [options]

Options:
  --url <url>     Download admission_clean.db.gz from a custom URL.
  --gz <path>     Use an existing admission_clean.db.gz file and decompress it.
  --db <path>     Validate an existing admission_clean.db SQLite file.
  --force         Re-download and re-decompress the default cached file.
`);
}
