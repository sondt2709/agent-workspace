// Device health (docs/architecture.md 4.6.12, design of add-continuity decision 17): the document
// `tasks/devices/<device>/health.yaml`, written at most once per 60 s.
import type { TaskView } from "@aw/core";
import type { SessionRecord } from "../sessions/records.ts";
import { commitOf } from "./git-branch.ts";
import type { UsageState } from "./usage.ts";

export const HEALTH_MIN_MS = 60_000;
/** Without a change, AW writes the file again after this time (the readers see a fresh time). */
export const HEALTH_REFRESH_MS = 10 * 60 * 1000;

export type HealthSessionState = "running" | "gate" | "paused" | "ended";

export function sessionState(
  record: SessionRecord,
  task: TaskView | undefined,
): HealthSessionState {
  if (record.state !== "running") return "ended";
  if (task?.paused) return "paused";
  if (task?.gates.some((g) => g.state === "open")) return "gate";
  return "running";
}

function window(w: UsageState["five_hour"]) {
  if (!w) return null;
  return {
    used_percentage: Math.max(0, Math.min(100, w.used_percentage)),
    resets_at: w.resets_at === null ? null : new Date(w.resets_at).toISOString(),
  };
}

export interface HealthInput {
  device: string;
  updated: string;
  bootTime: string;
  versions: Record<string, string>;
  sessions: { session: string; task: string; state: HealthSessionState }[];
  usage: UsageState | null;
  loginExpiresAt: string | null;
  disk: number | null;
  /**
   * The checkouts of this device and whether each has a commit (openspec
   * project-checkout-no-worktree); absent in older tests.
   */
  checkouts?: { project: string; has_commit: boolean }[];
  /** The limits of the agent queue (openspec queue-and-assign); absent in older tests. */
  queue?: { maxWorking: number; diskFullPercent: number; loginValid: boolean | null };
}

/**
 * Whether the `HEAD` of each checkout names a commit (openspec project-checkout-no-worktree). A
 * folder that is missing or not a git repository has no commit.
 */
export async function checkoutCommits(
  checkouts: { project: string; path: string }[],
): Promise<{ project: string; has_commit: boolean }[]> {
  return Promise.all(
    checkouts.map(async (c) => ({
      project: c.project,
      has_commit: (await commitOf(c.path, "HEAD")) !== null,
    })),
  );
}

/** The health document (the body without `updated` decides whether it changed). */
export function healthDocument(input: HealthInput) {
  return {
    kind: "health" as const,
    schema: 1 as const,
    device: input.device,
    updated: input.updated,
    boot_time: input.bootTime,
    versions: input.versions,
    sessions: input.sessions,
    usage: [
      {
        login: "default",
        five_hour: window(input.usage?.five_hour ?? null),
        seven_day: window(input.usage?.seven_day ?? null),
        login_expires_at: input.loginExpiresAt,
      },
    ],
    disk: { used_percentage: Math.max(0, Math.min(100, Math.round((input.disk ?? 0) * 10) / 10)) },
    ...(input.checkouts ? { checkouts: input.checkouts } : {}),
    ...(input.queue
      ? {
          queue: {
            max_working: input.queue.maxWorking,
            disk_full_percent: input.queue.diskFullPercent,
            login_valid: input.queue.loginValid,
          },
        }
      : {}),
    sync: [],
    repairs: [],
    /** A placeholder until the backup (a second computer) is in the health view. */
    last_backup: null,
  };
}

/** The part of the document that decides a new write. */
export function healthKey(doc: ReturnType<typeof healthDocument>): string {
  return JSON.stringify({ ...doc, updated: null });
}

/** True when AW writes the health file now. */
export function healthDue(input: {
  now: number;
  lastWrite: number | null;
  lastKey: string | null;
  key: string;
}): boolean {
  if (input.lastWrite === null) return true;
  const age = input.now - input.lastWrite;
  if (age < HEALTH_MIN_MS) return false;
  return input.key !== input.lastKey || age >= HEALTH_REFRESH_MS;
}
