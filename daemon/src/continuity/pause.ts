// The pause states of the session device (docs/architecture.md 4.6.5, design of add-continuity
// decision 8). A pause is a `task.paused` of the owner device; AW writes it only when the cause or
// the text changes, so a repeat of a signal writes nothing.
import type { PauseView } from "@aw/core";
import type { PauseCause } from "@aw/schema";

export interface PauseInput {
  cause: PauseCause;
  next_step: string;
  /** The time in ms when the work continues, or null. */
  resumes_at: number | null;
  needs_human: boolean;
}

/** The data of the `task.paused` event. */
export function pauseData(input: PauseInput) {
  return {
    cause: input.cause,
    resumes_at: input.resumes_at === null ? null : new Date(input.resumes_at).toISOString(),
    next_step: input.next_step,
    needs_human: input.needs_human,
  };
}

/** True when the task must get a new `task.paused` for this input. */
export function pauseChanged(current: PauseView | null, input: PauseInput): boolean {
  if (current === null) return true;
  const data = pauseData(input);
  return (
    current.cause !== data.cause ||
    current.next_step !== data.next_step ||
    current.needs_human !== data.needs_human ||
    (current.resumes_at === null ? null : Date.parse(current.resumes_at)) !==
      (data.resumes_at === null ? null : Date.parse(data.resumes_at))
  );
}

/** The causes that the session device ends when the agent is active again. */
export const ACTIVE_ENDS: readonly PauseCause[] = [
  "usage_limit",
  "usage_limit_weekly",
  "agent_error",
];

/** True when the task has a pause of one of these causes. */
export function pausedBy(current: PauseView | null, causes: readonly PauseCause[]): boolean {
  return current !== null && causes.includes(current.cause);
}
