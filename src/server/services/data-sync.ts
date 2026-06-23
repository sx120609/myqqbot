import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { parseUniversityMarkdown } from "../domain/parser.js";
import { UniversityRepository } from "./university-repository.js";

const execFileAsync = promisify(execFile);

export type SyncProgressReporter = (message: string) => void;

export interface SyncResult {
  commitSha: string;
  totalFiles: number;
  totalUniversities: number;
  skipped?: boolean;
}

export interface SyncOptions {
  force?: boolean;
}

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

  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    const startedAt = new Date().toISOString();
    const syncInfo = this.database.db
      .prepare("INSERT INTO sync_runs(status, started_at) VALUES (?, ?)")
      .run("running", startedAt);
    const syncId = Number(syncInfo.lastInsertRowid);

    try {
      this.report("Preparing CollegesChat data repository...");
      const commitSha = (await this.ensureRepo()).trim();
      this.report(`Using data commit ${commitSha.slice(0, 12)}.`);
      const latestSuccessful = this.latestSuccessfulSync();
      if (!options.force && latestSuccessful?.commitSha === commitSha && this.universities.countUniversities() > 0) {
        this.report("Data commit unchanged; skipping parse/import. Set FORCE_DATA_SYNC=1 to rebuild anyway.");
        this.database.db
          .prepare(
            `
            UPDATE sync_runs
            SET status = ?, finished_at = ?, commit_sha = ?, total_files = ?, total_universities = ?
            WHERE id = ?
          `
          )
          .run(
            "skipped",
            new Date().toISOString(),
            commitSha,
            latestSuccessful.totalFiles ?? 0,
            latestSuccessful.totalUniversities ?? this.universities.countUniversities(),
            syncId
          );
        return {
          commitSha,
          totalFiles: latestSuccessful.totalFiles ?? 0,
          totalUniversities: latestSuccessful.totalUniversities ?? this.universities.countUniversities(),
          skipped: true
        };
      }

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

  private latestSuccessfulSync(): { commitSha: string | null; totalFiles: number | null; totalUniversities: number | null } | undefined {
    return this.database.db
      .prepare(
        `
        SELECT commit_sha AS commitSha, total_files AS totalFiles, total_universities AS totalUniversities
        FROM sync_runs
        WHERE status = 'success' AND commit_sha IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get() as { commitSha: string | null; totalFiles: number | null; totalUniversities: number | null } | undefined;
  }

  private async ensureRepo(): Promise<string> {
    mkdirSync(this.config.dataDir, { recursive: true });
    if (!existsSync(join(this.repoDir, ".git"))) {
      return this.cloneDataRepo();
    }

    await this.git(["remote", "set-url", "origin", this.config.dataSource.repoUrl]);
    if (await this.isPartialClone()) {
      this.report("Existing data repository is a partial clone; recreating it to avoid lazy blob fetch failures...");
      rmSync(this.repoDir, { recursive: true, force: true });
      return this.cloneDataRepo();
    }

    this.report(`Fetching latest ${this.config.dataSource.branch} branch...`);
    await this.git(["fetch", "--depth", "1", "origin", this.config.dataSource.branch]);
    return this.git(["rev-parse", "FETCH_HEAD"]);
  }

  private async cloneDataRepo(): Promise<string> {
    if (existsSync(this.repoDir) && !existsSync(join(this.repoDir, ".git"))) {
      this.report("Removing incomplete data repository directory...");
      rmSync(this.repoDir, { recursive: true, force: true });
    }
    this.report(`Cloning ${this.config.dataSource.repoUrl} (${this.config.dataSource.branch})...`);
    await execFileAsync("git", [
      "-c",
      "core.longpaths=true",
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--no-checkout",
      "--branch",
      this.config.dataSource.branch,
      this.config.dataSource.repoUrl,
      this.repoDir
    ]);
    return this.git(["rev-parse", "HEAD"]);
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-c", "core.longpaths=true", ...args], {
      cwd: this.repoDir,
      maxBuffer: 1024 * 1024 * 20
    });
    return stdout;
  }

  private async gitOptional(args: string[]): Promise<string> {
    try {
      return await this.git(args);
    } catch {
      return "";
    }
  }

  private async isPartialClone(): Promise<boolean> {
    const promisor = (await this.gitOptional(["config", "--get", "remote.origin.promisor"])).trim();
    const partialFilter = (await this.gitOptional(["config", "--get", "remote.origin.partialclonefilter"])).trim();
    const extension = (await this.gitOptional(["config", "--get", "extensions.partialclone"])).trim();
    return promisor === "true" || Boolean(partialFilter || extension);
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
