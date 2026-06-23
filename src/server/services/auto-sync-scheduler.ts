import type { SettingsStore } from "../settings.js";
import type { DataSyncService } from "./data-sync.js";
import type { SrgaoxiaoSyncService } from "./srgaoxiao-sync.js";

type JobKey = "colleges" | "srgaoxiao";

interface JobState {
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

export interface AutoSyncStatus {
  jobs: Record<
    JobKey,
    JobState & {
      enabled: boolean;
      intervalHours: number;
      nextRunAt: string | null;
    }
  >;
}

const TICK_MS = 60 * 1000;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 24 * 30;

export class AutoSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly states: Record<JobKey, JobState> = {
    colleges: { running: false, lastStartedAt: null, lastFinishedAt: null, lastError: null },
    srgaoxiao: { running: false, lastStartedAt: null, lastFinishedAt: null, lastError: null }
  };

  constructor(
    private readonly settings: SettingsStore,
    private readonly dataSync: DataSyncService,
    private readonly srgaoxiaoSync: SrgaoxiaoSyncService
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 10_000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): void {
    setTimeout(() => void this.tick(), 1000);
  }

  status(): AutoSyncStatus {
    const runtime = this.settings.runtime().sync;
    return {
      jobs: {
        colleges: {
          ...this.states.colleges,
          enabled: runtime.collegesAutoEnabled,
          intervalHours: clampInterval(runtime.collegesIntervalHours),
          nextRunAt: this.nextRunAt("colleges", runtime.collegesAutoEnabled, runtime.collegesIntervalHours)
        },
        srgaoxiao: {
          ...this.states.srgaoxiao,
          enabled: runtime.srgaoxiaoAutoEnabled,
          intervalHours: clampInterval(runtime.srgaoxiaoIntervalHours),
          nextRunAt: this.nextRunAt("srgaoxiao", runtime.srgaoxiaoAutoEnabled, runtime.srgaoxiaoIntervalHours)
        }
      }
    };
  }

  private async tick(): Promise<void> {
    const runtime = this.settings.runtime().sync;
    if (runtime.collegesAutoEnabled && this.isDue("colleges", runtime.collegesIntervalHours)) {
      void this.run("colleges", () => this.dataSync.sync());
    }
    if (runtime.srgaoxiaoAutoEnabled && this.isDue("srgaoxiao", runtime.srgaoxiaoIntervalHours)) {
      const limit = Math.max(1, Math.min(500, Math.floor(runtime.srgaoxiaoLimit)));
      void this.run("srgaoxiao", () => this.srgaoxiaoSync.sync({ limit }));
    }
  }

  private async run(key: JobKey, task: () => Promise<unknown>): Promise<void> {
    const state = this.states[key];
    if (state.running) return;

    const startedAt = new Date().toISOString();
    state.running = true;
    state.lastStartedAt = startedAt;
    state.lastError = null;
    this.settings.setInternal(this.lastAttemptKey(key), startedAt);

    try {
      await task();
      state.lastFinishedAt = new Date().toISOString();
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lastFinishedAt = new Date().toISOString();
      console.error(`[auto-sync] ${key} failed:`, error);
    } finally {
      state.running = false;
    }
  }

  private isDue(key: JobKey, intervalHours: number): boolean {
    const state = this.states[key];
    if (state.running) return false;

    const lastAttempt = this.lastAttemptAt(key);
    if (!lastAttempt) return true;
    return lastAttempt.getTime() + clampInterval(intervalHours) * 60 * 60 * 1000 <= Date.now();
  }

  private nextRunAt(key: JobKey, enabled: boolean, intervalHours: number): string | null {
    if (!enabled) return null;
    if (this.states[key].running) return null;

    const lastAttempt = this.lastAttemptAt(key);
    if (!lastAttempt) return "服务启动后约 10 秒";
    const next = lastAttempt.getTime() + clampInterval(intervalHours) * 60 * 60 * 1000;
    return new Date(Math.max(next, Date.now())).toISOString();
  }

  private lastAttemptAt(key: JobKey): Date | null {
    const value = this.settings.getString(this.lastAttemptKey(key), "");
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private lastAttemptKey(key: JobKey): string {
    return `sync.internal.${key}.lastAttemptAt`;
  }
}

function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return 24;
  return Math.max(MIN_INTERVAL_HOURS, Math.min(MAX_INTERVAL_HOURS, value));
}
