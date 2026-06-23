import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { parseUniversityMarkdown } from "../domain/parser.js";
import { UniversityRepository } from "./university-repository.js";

const execFileAsync = promisify(execFile);

export type SyncProgressReporter = (message: string) => void;

export class DataSyncService {
  private readonly repoDir: string;

  constructor(
    private readonly config: AppConfig,
    private readonly database: AppDatabase,
    private readonly universities: UniversityRepository,
    private readonly progress?: SyncProgressReporter
  ) {
    this.repoDir = resolve(config.dataDir, "university-information");
  }

  async sync(): Promise<{ commitSha: string; totalFiles: number; totalUniversities: number }> {
    const startedAt = new Date().toISOString();
    const syncInfo = this.database.db
      .prepare("INSERT INTO sync_runs(status, started_at) VALUES (?, ?)")
      .run("running", startedAt);
    const syncId = Number(syncInfo.lastInsertRowid);

    try {
      this.report("Preparing CollegesChat data repository...");
      const commitSha = (await this.ensureRepo()).trim();
      this.report(`Using data commit ${commitSha.slice(0, 12)}.`);
      this.report(`Listing markdown files under ${this.config.dataSource.dataPath}...`);
      const files = await this.listMarkdownFiles(commitSha);
      this.report(`Found ${files.length} markdown files.`);
      let completed = 0;
      let lastReported = 0;
      const parsed = (
        await mapLimit(files, 8, async (filePath) => {
          const markdown = await this.git(["show", `${commitSha}:${filePath}`]);
          const sourceUrl = `https://raw.githubusercontent.com/CollegesChat/university-information/${this.config.dataSource.branch}/${filePath}`;
          const result = parseUniversityMarkdown(filePath, sourceUrl, markdown);
          completed += 1;
          if (completed === files.length || completed - lastReported >= 100) {
            lastReported = completed;
            this.report(`Parsed ${completed}/${files.length} files...`);
          }
          return result;
        })
      ).filter((item): item is NonNullable<typeof item> => Boolean(item));

      this.report(`Importing ${parsed.length} universities into SQLite...`);
      this.universities.importAll(parsed);
      this.database.db
        .prepare(
          `
          UPDATE sync_runs
          SET status = ?, finished_at = ?, commit_sha = ?, total_files = ?, total_universities = ?
          WHERE id = ?
        `
        )
        .run("success", new Date().toISOString(), commitSha.trim(), files.length, parsed.length, syncId);

      this.report("Data sync finished.");
      return { commitSha: commitSha.trim(), totalFiles: files.length, totalUniversities: parsed.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.database.db
        .prepare("UPDATE sync_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?")
        .run("failed", new Date().toISOString(), message, syncId);
      throw error;
    }
  }

  latestSync(): unknown {
    return this.database.db
      .prepare(
        `
        SELECT id, status, started_at AS startedAt, finished_at AS finishedAt, commit_sha AS commitSha,
          total_files AS totalFiles, total_universities AS totalUniversities, error
        FROM sync_runs
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get();
  }

  private async ensureRepo(): Promise<string> {
    mkdirSync(this.config.dataDir, { recursive: true });
    if (!existsSync(join(this.repoDir, ".git"))) {
      this.report(`Cloning ${this.config.dataSource.repoUrl} (${this.config.dataSource.branch})...`);
      await execFileAsync("git", [
        "-c",
        "core.longpaths=true",
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--no-checkout",
        "--branch",
        this.config.dataSource.branch,
        this.config.dataSource.repoUrl,
        this.repoDir
      ]);
      return this.git(["rev-parse", "HEAD"]);
    }

    this.report(`Fetching latest ${this.config.dataSource.branch} branch...`);
    await this.git(["fetch", "--depth", "1", "origin", this.config.dataSource.branch]);
    return this.git(["rev-parse", "FETCH_HEAD"]);
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-c", "core.longpaths=true", ...args], {
      cwd: this.repoDir,
      maxBuffer: 1024 * 1024 * 20
    });
    return stdout;
  }

  private async listMarkdownFiles(commitSha: string): Promise<string[]> {
    const output = await this.git(["ls-tree", "-r", "--name-only", commitSha, this.config.dataSource.dataPath]);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".md"))
      .sort();
  }

  private report(message: string): void {
    this.progress?.(message);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
