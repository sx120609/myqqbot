import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_DATA_REPO_URL = "https://gh.lizmt.cn/CollegesChat/university-information.git";

export interface AppConfig {
  cwd: string;
  dataDir: string;
  dbPath: string;
  server: {
    host: string;
    port: number;
    publicBaseUrl: string;
  };
  dataSource: {
    repoUrl: string;
    branch: string;
    dataPath: string;
  };
}

export function loadDotEnv(cwd = process.cwd()): void {
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  loadDotEnv(cwd);
  const dataDir = resolve(cwd, readString("DATA_DIR", "data"));

  return {
    cwd,
    dataDir,
    dbPath: resolve(dataDir, "bot.sqlite"),
    server: {
      host: readString("APP_HOST", "127.0.0.1"),
      port: readNumber("APP_PORT", 8787),
      publicBaseUrl: readString("PUBLIC_BASE_URL", "http://127.0.0.1:8787")
    },
    dataSource: {
      repoUrl: readString("DATA_REPO_URL", DEFAULT_DATA_REPO_URL),
      branch: readString("DATA_REPO_BRANCH", "generated"),
      dataPath: readString("DATA_PATH", "docs/universities")
    }
  };
}
