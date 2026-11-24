// The permission gate (docs/phase-1.md 9.5, design decision 9). The PermissionRequest hook waits on
// the awd socket; awd answers from a rule of the task, a one-time approval, or the first answer of
// the gate "Approve command", else denies after the timeout. The gate stays open after the timeout:
// a later "Allow" becomes a one-time approval of the same tool and input.
import type { Clock } from "@aw/core";
import type { PermissionDecision } from "@aw/plugin-api";
import { createHash } from "node:crypto";

export const PERMISSION_TIMEOUT_MS = 120_000;
export const PERMISSION_OPTIONS = ["Allow once", "Allow for this task", "Deny"];

/** True for an answer that allows: "Allow once", "Allow for this task" (any letter case). */
export function isAllow(answer: string): boolean {
  return /^allow\b/i.test(answer.trim());
}

/** The decision of an answer. A deny names the person and the reason. */
export function decisionOf(
  answer: string,
  by: string | null,
  comment: string | null,
): PermissionDecision {
  if (isAllow(answer)) return { behavior: "allow" };
  const reason = comment ? `${answer}: ${comment}` : answer;
  return {
    behavior: "deny",
    message: `Denied by ${by ?? "the human"}: ${reason}`,
    interrupt: true,
  };
}

export function timeoutDecision(timeoutMs: number): PermissionDecision {
  return {
    behavior: "deny",
    message: `No answer from the human in ${Math.round(timeoutMs / 1000)} s. AW keeps the gate "Approve command" open. End your turn: a later approval arrives as your next input.`,
    interrupt: true,
  };
}

/** A stable text of a tool input, to compare a retry with an approval. */
export function inputKey(tool: string, input: Record<string, unknown>): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sort((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return `${tool}:${JSON.stringify(sort(input))}`;
}

/**
 * The sha256 of the stable text of a tool input. The gate event and the one-time approvals keep
 * only this hash: a Write of a large file does not fit in a log line.
 */
export function inputHash(tool: string, input: Record<string, unknown>): string {
  return createHash("sha256").update(inputKey(tool, input)).digest("hex");
}

/**
 * The rest of the wait of a permission request: the wait counts from the gate open, so a retry of
 * the hook (after an awd restart) does not wait a new full timeout. 0 means: answer the timeout now.
 */
export function remainingWaitMs(openedMs: number, nowMs: number, timeoutMs: number): number {
  return Math.max(0, Math.min(timeoutMs, openedMs + timeoutMs - nowMs));
}

interface Waiter {
  /** null: awd stops; the hook asks again after the restart. */
  resolve: (decision: PermissionDecision | null) => void;
  done: boolean;
}

/** The waiting hooks, by gate id. */
export class PermissionWaits {
  readonly #clock: Clock;
  readonly #timeoutMs: number;
  readonly #waiting = new Map<string, Waiter[]>();
  /** The sessions with a waiting hook: a permission dialog is open there. */
  readonly #bySession = new Map<string, Set<string>>();
  #closed = false;

  constructor(clock: Clock, timeoutMs = PERMISSION_TIMEOUT_MS) {
    this.#clock = clock;
    this.#timeoutMs = timeoutMs;
  }

  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  /** Waits for the decision of the gate, at most `waitMs` (default the timeout). */
  wait(
    session: string,
    gate: string,
    waitMs: number = this.#timeoutMs,
  ): Promise<PermissionDecision | null> {
    return new Promise((resolve) => {
      // awd stops: the hook asks the new awd.
      if (this.#closed) {
        resolve(null);
        return;
      }
      const waiter: Waiter = { resolve, done: false };
      const list = this.#waiting.get(gate) ?? [];
      list.push(waiter);
      this.#waiting.set(gate, list);
      const gates = this.#bySession.get(session) ?? new Set<string>();
      gates.add(gate);
      this.#bySession.set(session, gates);
      void this.#clock.sleep(waitMs).then(() => {
        this.#finish(session, gate, waiter, timeoutDecision(this.#timeoutMs));
      });
    });
  }

  /** Answers each hook that waits for the gate. Returns the count of answered hooks. */
  settle(session: string, gate: string, decision: PermissionDecision): number {
    let count = 0;
    for (const waiter of [...(this.#waiting.get(gate) ?? [])]) {
      if (!waiter.done) count++;
      this.#finish(session, gate, waiter, decision);
    }
    return count;
  }

  /** True when a hook of the session waits: its permission dialog is open. */
  waiting(session: string): boolean {
    return (this.#bySession.get(session)?.size ?? 0) > 0;
  }

  #finish(
    session: string,
    gate: string,
    waiter: Waiter,
    decision: PermissionDecision | null,
  ): void {
    if (waiter.done) return;
    waiter.done = true;
    waiter.resolve(decision);
    const list = (this.#waiting.get(gate) ?? []).filter((w) => !w.done);
    if (list.length > 0) this.#waiting.set(gate, list);
    else {
      this.#waiting.delete(gate);
      this.#bySession.get(session)?.delete(gate);
    }
  }

  /** Ends each wait with null (awd stops), and each later wait at once: the hook asks the new awd. */
  closeAll(): void {
    this.#closed = true;
    for (const [gate, list] of this.#waiting) {
      for (const waiter of list) {
        if (!waiter.done) {
          waiter.done = true;
          waiter.resolve(null);
        }
      }
      this.#waiting.delete(gate);
    }
    this.#bySession.clear();
  }
}

/**
 * The key of an "Allow for this task" rule (final check fc1-9): the command of Bash, the file of a
 * file tool (`file_path`, `notebook_path`, `path`), else the sha256 of the whole input. A rule
 * with another key, or with no key, never allows a call: a rule for one Write never allows a
 * Write of another file.
 */
export function ruleKey(tool: string, input: Record<string, unknown>): string {
  if (tool === "Bash") return `command ${typeof input.command === "string" ? input.command : ""}`;
  for (const field of ["file_path", "notebook_path", "path"]) {
    const value = input[field];
    if (typeof value === "string" && value.length > 0) return `${field} ${value}`;
  }
  return `input ${inputHash(tool, input)}`;
}
