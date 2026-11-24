// Usage limits (docs/architecture.md 4.6.6, design of add-continuity decision 9): the windows of
// the statusline, the pause of a StopFailure `rate_limit`, and when AW continues by itself.
import type { PauseCause } from "@aw/schema";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const HOUR = 60 * 60 * 1000;
/** A reset further away than this is a weekly limit: Claude Code does not wait for it. */
export const AUTO_RESUME_HORIZON_MS = 24 * HOUR;
/** AW continues this long after the reset (the reset time is rounded). */
export const CONTINUE_AFTER_RESET_MS = 2 * 60 * 1000;
/** The continues of AW in one session before the gate "Continue after usage limit". */
export const MAX_CONTINUES = 3;
/** AW starts no queued task above this use of the 5-hour window (4.6.6 item 4). */
export const QUEUE_USAGE_LIMIT = 90;

/** One window of the statusline. `resets_at` is in ms here (the statusline has Unix seconds). */
export interface UsageWindow {
  used_percentage: number;
  resets_at: number | null;
}

export const usageFile = z.object({
  five_hour: z.object({ used_percentage: z.number(), resets_at: z.number().nullable() }).nullable(),
  seven_day: z.object({ used_percentage: z.number(), resets_at: z.number().nullable() }).nullable(),
  /** The wall time in ms of the statusline run that wrote it. */
  at: z.number(),
});
export type UsageState = z.infer<typeof usageFile>;

/** Reads `usage.json` of a session, or null. */
export async function readUsage(path: string): Promise<UsageState | null> {
  try {
    const parsed = usageFile.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface LimitPlan {
  cause: Extract<PauseCause, "usage_limit" | "usage_limit_weekly">;
  /** The reset time in ms, or null when no window tells it. */
  resetsAt: number | null;
  /** When AW continues the session itself, or null: Claude Code continues by itself. */
  continueAt: number | null;
}

function full(window: UsageWindow | null | undefined): boolean {
  return window !== null && window !== undefined && window.used_percentage >= 100;
}

/**
 * The pause of a StopFailure `rate_limit`. The window at 100 % gives the reset (both at 100 %: the
 * later one). With no full window the 5-hour reset is the best guess (the statusline can be late).
 * A 7-day window at 100 %, or a reset more than 24 h away, is the weekly limit: Claude Code does
 * not wait for it, so AW continues at the reset + 2 min.
 */
export function limitPlan(usage: UsageState | null, now: number): LimitPlan {
  const five = usage?.five_hour ?? null;
  const week = usage?.seven_day ?? null;
  const resets = [five, week]
    .filter((w) => full(w) && w!.resets_at !== null)
    .map((w) => w!.resets_at!);
  let resetsAt: number | null = resets.length > 0 ? Math.max(...resets) : null;
  if (resetsAt === null && !full(week)) resetsAt = five?.resets_at ?? null;
  const weekly = full(week) || (resetsAt !== null && resetsAt - now > AUTO_RESUME_HORIZON_MS);
  return {
    cause: weekly ? "usage_limit_weekly" : "usage_limit",
    resetsAt,
    continueAt: weekly && resetsAt !== null ? resetsAt + CONTINUE_AFTER_RESET_MS : null,
  };
}

/** The time as `HH:MM UTC`, or `ddd HH:MM UTC` when it is not today. */
export function shortTime(ms: number, now: number): string {
  const date = new Date(ms);
  const hhmm = `${date.toISOString().slice(11, 16)} UTC`;
  if (date.toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) return hhmm;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()]!;
  return `${day} ${date.toISOString().slice(5, 10)} ${hhmm}`;
}

/** The next step text of a usage pause. */
export function limitText(plan: LimitPlan, now: number, continues: number): string {
  const at = plan.resetsAt === null ? null : shortTime(plan.resetsAt, now);
  if (plan.cause === "usage_limit") {
    return at
      ? `Usage limit. Resumes at ${at}: Claude Code continues by itself.`
      : "Usage limit. Claude Code continues by itself after the reset.";
  }
  return at
    ? `Weekly limit. Resumes ${at}: AW continues the session (continue ${continues + 1} of ${MAX_CONTINUES}).`
    : "Weekly limit. The reset time is not known: AW waits.";
}

/** The highest use of the 5-hour window of these sessions, or null. */
export function fiveHourUse(states: readonly (UsageState | null)[], now: number): number | null {
  let max: number | null = null;
  for (const state of states) {
    const window = state?.five_hour;
    if (!window) continue;
    // After the reset the stored percentage is old.
    if (window.resets_at !== null && window.resets_at <= now) continue;
    max = Math.max(max ?? 0, window.used_percentage);
  }
  return max;
}
