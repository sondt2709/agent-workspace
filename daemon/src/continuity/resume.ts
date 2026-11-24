// The resume policy of a session whose pane is dead or gone (docs/phase-1.md 9.7.3, design of
// add-continuity decisions 2 to 5). A pure function, so the unit tests cover each rule with no tmux.

/** Resumes with no progress before the session fails. */
export const MAX_RESUMES = 2;
/** The hard limit: resumes in one rolling hour, also with progress between them. */
export const MAX_RESUMES_PER_HOUR = 5;
export const RESUME_WINDOW_MS = 60 * 60 * 1000;
/**
 * New starts of a session whose agent has no conversation (it stopped before its first prompt, or
 * its transcript is lost). They never reset.
 */
export const MAX_RESTARTS = 3;
/** A window alive this long counts as progress: the resume count goes back to 0. */
export const PROGRESS_ALIVE_MS = 10 * 60 * 1000;
/** The exit status of aw-launch when awd did not answer /readyz in time. */
export const LAUNCH_NOT_READY_STATUS = 3;
/** The wait before AW opens a window again after the exit status 3. */
export const LAUNCH_WAIT_RETRY_MS = 30_000;
/** The exit-3 openings in a row that do not count; after them the exit counts as a failure. */
export const MAX_LAUNCH_WAITS = 20;

export interface ResumeInput {
  now: number;
  /** The exit status of the dead pane, or null when the window is gone. */
  status: number | null;
  /** True when a prompt reached the agent (the first input or later). */
  firstSeen: boolean;
  /** True after the first SessionStart of the session. */
  started: boolean;
  /** The answer of the adapter: true, false, or undefined when it cannot tell. */
  conversation: boolean | undefined;
  resumes: number;
  /** The clock times of the earlier resumes. */
  resumeTimes: readonly number[];
  restarts: number;
  /** The exit-3 openings in a row. */
  launchWaits: number;
  /** The clock time of the last window open, if known. */
  openedAt: number | undefined;
}

export type ResumePlan =
  /** The exit-3 wait is not over: nothing now. */
  | { action: "wait" }
  /**
   * `resume`: `--resume` with the continue message (`message: "continue"`), or with the first input
   * when no prompt reached the agent yet (`message: "first"`).
   * `fresh`: `--session-id` with the first input; `lost` adds the note about the lost conversation.
   * `counted` is false for an exit-3 opening: no count changes.
   */
  | { action: "resume"; message: "continue" | "first"; counted: boolean }
  | { action: "fresh"; lost: boolean; counted: boolean }
  | { action: "failed"; text: string };

/** True when `--resume` can open the conversation of the session. */
export function canResume(input: Pick<ResumeInput, "firstSeen" | "conversation" | "started">) {
  // A prompt reached the agent: the conversation exists (or existed: see the lost transcript).
  if (input.firstSeen) return true;
  return input.conversation ?? input.started;
}

/** The resumes of the last hour. */
export function recentResumes(times: readonly number[], now: number): number[] {
  return times.filter((t) => now - t < RESUME_WINDOW_MS);
}

export function resumePlan(input: ResumeInput): ResumePlan {
  const why = input.status === null ? "no window" : `exit ${input.status}`;
  const notReady = input.status === LAUNCH_NOT_READY_STATUS && input.launchWaits < MAX_LAUNCH_WAITS;
  if (
    notReady &&
    input.openedAt !== undefined &&
    input.now - input.openedAt < LAUNCH_WAIT_RETRY_MS
  ) {
    return { action: "wait" };
  }
  const counted = !notReady;
  if (!canResume(input)) {
    if (counted && input.restarts >= MAX_RESTARTS) {
      return {
        action: "failed",
        text: `Start failed: the agent stopped before its first prompt ${MAX_RESTARTS + 1} times (${why}).`,
      };
    }
    return { action: "fresh", lost: false, counted };
  }
  const message = input.firstSeen ? "continue" : "first";
  if (!counted) return { action: "resume", message, counted };
  const recent = recentResumes(input.resumeTimes, input.now).length;
  if (input.resumes >= MAX_RESUMES || recent >= MAX_RESUMES_PER_HOUR) {
    // A prompt reached the agent, but its transcript is gone (30-day cleanup, or a kill before the
    // first transcript write): start the conversation again with a note (review item 3).
    if (input.firstSeen && input.conversation === false && input.restarts < MAX_RESTARTS) {
      return { action: "fresh", lost: true, counted };
    }
    const cause =
      input.resumes >= MAX_RESUMES
        ? `the agent made no progress after ${MAX_RESUMES} resumes`
        : `${recent} resumes in the last hour`;
    return { action: "failed", text: `Resume failed: ${cause} (${why}).` };
  }
  return { action: "resume", message, counted };
}

/** The note after the first input of a session whose conversation was lost (review item 3). */
export function lostNote(key: string): string {
  return `AW note: the earlier conversation of this session was lost (its transcript is gone). Read \`aw thread ${key}\` before you act: it has each message and each answer.`;
}
