// The agent queue (docs/architecture.md 4.6.8, design of add-continuity decision 12): the order of
// the tasks that wait for a session, and the count of the working sessions of an agent.
import { compareOrder, type EventRef, type TaskView } from "@aw/core";

/** `AW_MAX_WORKING` default: working sessions per agent on one device. */
export const DEFAULT_MAX_WORKING = 2;
/** AW starts no session when the disk of AW_HOME is this full (4.6.12). */
export const DISK_FULL_PERCENT = 95;

/**
 * The tasks in queue order: the order of the newest `queue.reordered` of the agent first, then the
 * other tasks by their creation (HLC order).
 */
export function queueOrder<T extends { id: string; created: EventRef | null }>(
  tasks: readonly T[],
  queue: { tasks: readonly string[] } | undefined,
): T[] {
  const rank = new Map((queue?.tasks ?? []).map((id, i) => [id, i]));
  return [...tasks].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined || rb !== undefined) {
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    }
    if (a.created && b.created) {
      return compareOrder(
        { hlc: a.created.hlc, dev: a.created.dev, id: a.created.event },
        { hlc: b.created.hlc, dev: b.created.dev, id: b.created.event },
      );
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** True when a running session of this task counts toward the maximum: no open gate, no pause. */
export function isWorking(task: TaskView | undefined): boolean {
  if (!task) return false;
  if (task.paused !== null) return false;
  return !task.gates.some((g) => g.state === "open");
}

export interface StartGate {
  working: number;
  max: number;
  /** False when the login of the agent ended; null when not known. */
  loginValid: boolean | null;
  /** The use of the 5-hour window in percent, or null. */
  fiveHour: number | null;
  /** The disk use of AW_HOME in percent, or null. */
  disk: number | null;
  /** The disk use at which no session starts. Default DISK_FULL_PERCENT. */
  diskLimit?: number;
}

/** Why a new session cannot start now, or null (4.6.8 item 2). */
export function startBlock(input: StartGate, usageLimit = 90): string | null {
  if (input.working >= input.max) return `${input.working} of ${input.max} sessions work`;
  if (input.loginValid === false) return "the login of the agent ended";
  if (input.fiveHour !== null && input.fiveHour > usageLimit) {
    return `the 5-hour usage window is at ${Math.round(input.fiveHour)} %`;
  }
  if (input.disk !== null && input.disk >= (input.diskLimit ?? DISK_FULL_PERCENT)) {
    return `the disk is ${Math.round(input.disk)} % full`;
  }
  return null;
}
