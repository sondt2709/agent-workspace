// The failed start of a task and "Restart agent" (openspec restart-agent): the pure rules of the
// task header. The task view gives `start_failure` from the `start_failed` comment of awd.
import type { Task } from "../../shared/channels.ts";

export interface StartFailure {
  device: string;
  text: string;
  at: string;
  retrying: boolean;
}

/** The `start_failure` of the task view, or null (an older awd gives none). */
export function startFailureOf(task: Task): StartFailure | null {
  const value = (task as Task & { start_failure?: StartFailure | null }).start_failure;
  return value ?? null;
}

/**
 * The header text: "Did not start on <device>: <cause>", or "Starting again on <device>…" after a
 * restart. The cause is the comment after "The session did not start on <device>: ", with no
 * "AW tries again in <n> s." at the end.
 */
export function startFailureText(failure: StartFailure): string {
  if (failure.retrying) return `Starting again on ${failure.device}…`;
  const prefix = `The session did not start on ${failure.device}: `;
  const cause = (failure.text.startsWith(prefix) ? failure.text.slice(prefix.length) : failure.text)
    .replace(/\.? AW tries again in \d+ s\.$/, "")
    .trim();
  return `Did not start on ${failure.device}: ${cause}`;
}

/** "Restart agent" shows for a task with an assignee and no running session. */
export function canRestart(task: Task): boolean {
  const session = (task as Task & { session?: { state?: string } | null }).session;
  return task.assignee !== null && session?.state !== "running";
}
