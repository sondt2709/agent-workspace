// The watchdog (docs/architecture.md 4.6.9, design of add-continuity decision 14): "No recent
// update" after 2 min with no hook event and no screen change, and a check after 15 min. A pure
// step function; the manager gives the screen hash and the times every 30 s.
import { createHash } from "node:crypto";

export const WATCHDOG_CHECK_MS = 30_000;
export const QUIET_MS = 2 * 60 * 1000;
export const LONG_QUIET_MS = 15 * 60 * 1000;
/** Other devices add this to their own staleness rule: a sync delay is normal (docs 6.3). */
export const SYNC_DELAY_MS = 8_000;

export interface WatchState {
  /** The hash of the visible screen at the last check. */
  hash: string | null;
  /** The clock time of the last screen change. */
  changed: number;
  /** The start of the quiet period: the later of the last hook event and the last screen change. */
  start: number;
  /** What AW wrote in this quiet period. */
  noticed: "quiet" | "long" | null;
}

export interface WatchInput {
  now: number;
  /** The clock time of the last hook event of the session (or of the window open). */
  lastEvent: number;
  screen: string;
  /** True when the task has an open gate or a pause: no warning then. */
  waiting: boolean;
  /**
   * True when the agent ended its turn and waits for input (after a Stop, with no tool running): no
   * warning then, also when a background shell still runs (verify-journeys finding 9).
   */
  idle?: boolean;
}

export type WatchAction = { kind: "none" } | { kind: "quiet"; line: string } | { kind: "long" };

/**
 * The spinner line of Claude Code in a turn, for example `✽ Hullaballooing… (28s · ↓ 3.0k tokens)`
 * (Claude Code 2.1.330, captured on a test server on 2026-11-23): a glyph, a word with `…`, then
 * the time and the token count in parentheses.
 */
const SPINNER = /^\s*[·✢✳✶✻✽*]\s+\S+…\s*\(.*\)/u;

/**
 * The screen as the watchdog compares it: with no spinner line and with each number as `0`. The
 * spinner glyph, its word, the elapsed time, the token count and a clock in the statusline change
 * during a turn with no progress, so they must not start a new quiet period (fix list 0h).
 */
export function watchedScreen(screen: string): string {
  return screen
    .split("\n")
    .map((line) => (SPINNER.test(line) ? "<spinner>" : line.replace(/\d+/g, "0")))
    .join("\n");
}

export function screenHash(screen: string): string {
  return createHash("sha256").update(watchedScreen(screen)).digest("hex");
}

/** The last line of the screen with text. */
export function lastLine(screen: string): string {
  const lines = screen.split("\n").map((l) => l.trimEnd());
  return (lines.filter((l) => l.trim().length > 0).at(-1) ?? "").trim().slice(0, 300);
}

export function newWatchState(now: number): WatchState {
  return { hash: null, changed: now, start: now, noticed: null };
}

export function watchStep(
  state: WatchState,
  input: WatchInput,
): { state: WatchState; action: WatchAction } {
  const hash = screenHash(input.screen);
  const changed = hash !== state.hash ? input.now : state.changed;
  const start = Math.max(input.lastEvent, changed);
  // A hook event or a screen change starts a new quiet period.
  const noticed = start > state.start ? null : state.noticed;
  const next: WatchState = { hash, changed, start, noticed };
  if (input.waiting || input.idle === true) {
    return { state: { ...next, noticed: null }, action: { kind: "none" } };
  }
  const quiet = input.now - start;
  if (quiet >= LONG_QUIET_MS && noticed !== "long") {
    return { state: { ...next, noticed: "long" }, action: { kind: "long" } };
  }
  if (quiet >= QUIET_MS && noticed === null) {
    return {
      state: { ...next, noticed: "quiet" },
      action: { kind: "quiet", line: lastLine(input.screen) },
    };
  }
  return { state: next, action: { kind: "none" } };
}
