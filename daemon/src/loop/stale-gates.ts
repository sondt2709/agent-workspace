// The gates with no session (openspec stale-gates, fix list ux-5): the open gates that no session
// can use any more. The owner device closes them with `gate.resolved {answer_event: null}`, so they
// leave Needs you on each device, and each pending answer becomes a late-answer comment. The rule
// reads only the merged log: a gate that was stuck before an update closes at the next check.
import { hlcMs, type EventRow, type GateView, type TaskView } from "@aw/core";
import { idTime } from "@aw/schema";

/** The answer of a gate whose session ended. */
export const SESSION_ENDED = "Session ended";

/** The answer of a permission gate whose session went on after the deny of the hook. */
export function timeoutAnswer(timeoutMs: number): string {
  return `Denied after ${Math.round(timeoutMs / 1000)} s`;
}

/** True for an answer of this rule: AW closed the gate, no person answered it. */
export function isCloseAnswer(answer: string): boolean {
  return answer === SESSION_ENDED || /^Denied after [0-9]+ s$/.test(answer);
}

/**
 * The gates that wait for an answer to the conversation of their session. They close only when a
 * person stopped the session or the task is done: after a move or a replace the next session gets
 * them in its SessionStart context, and "Resume again" resumes a crashed session.
 */
const CONVERSATION_KINDS = new Set([
  "question",
  "reply",
  "confirm_approach",
  "custom",
  "continue_after_limit",
]);

export interface StaleGate {
  gate: GateView;
  answer: string;
}

interface Opened {
  session: string | null;
  at: number;
}

function data(row: EventRow): Record<string, unknown> {
  return (row.event as { data?: Record<string, unknown> }).data ?? {};
}

/**
 * The open gates of the task that no session can use, with their close answer:
 * - "Session ended" for an `approve_command` gate whose session ended (each reason, or the task
 *   shows another session), and for a conversation gate whose session ended with `stopped` or
 *   `done`;
 * - "Denied after <n> s" for an `approve_command` gate whose session went on: a new turn (a
 *   `message.human` of the session that is not the delivery of a permission gate), or another
 *   permission request more than the timeout after it.
 * The session of a gate is the session of the newest applied `session.started` or
 * `session.resumed` before its `gate.opened`. A gate with a pending answer of its current version
 * stays while its session runs: the session check uses the answer first.
 */
export function staleGates(task: TaskView, rows: EventRow[], timeoutMs: number): StaleGate[] {
  let current: string | null = null;
  const last = new Map<string, { type: string; reason: string | null }>();
  const opened = new Map<string, Opened>();
  const commands = new Set<string>();
  // The time of a turn is the time of its hook (the event id of a spool event): the spool can
  // drain after the gate open of the same turn, so the log order can put the prompt after it.
  const turns: { session: string; at: number; delivery: string | null }[] = [];
  for (const row of rows) {
    if (!row.applied) continue;
    const d = data(row);
    if (row.type === "session.started" || row.type === "session.resumed") {
      current = String(d.session);
      last.set(current, { type: row.type, reason: null });
    } else if (row.type === "session.ended") {
      last.set(String(d.session), {
        type: row.type,
        reason: typeof d.reason === "string" ? d.reason : null,
      });
    } else if (row.type === "gate.opened") {
      const gate = String(d.gate);
      if (d.kind === "approve_command") commands.add(gate);
      if (!opened.has(gate)) opened.set(gate, { session: current, at: hlcMs(row.hlc) });
    } else if (row.type === "message.human" && typeof d.session === "string") {
      const delivery = typeof d.delivery_id === "string" ? d.delivery_id : null;
      turns.push({ session: d.session, at: idTime(row.id), delivery });
    }
  }

  const stale: StaleGate[] = [];
  for (const gate of task.gates) {
    if (gate.state !== "open") continue;
    const open = opened.get(gate.gate);
    const session = open?.session ?? null;
    if (!open || session === null) continue;
    const command = gate.kind === "approve_command";
    if (!command && !CONVERSATION_KINDS.has(gate.kind)) continue;
    const end = last.get(session);
    // A move writes no `session.ended` on the new owner: the task shows another session.
    const reason =
      end?.type === "session.ended"
        ? (end.reason ?? "unknown")
        : task.session?.session !== session
          ? "replaced"
          : null;
    if (reason !== null) {
      if (command || reason === "stopped" || reason === "done") {
        stale.push({ gate, answer: SESSION_ENDED });
      }
      continue;
    }
    if (!command) continue;
    // The session runs: an answer that is in the log goes to it first.
    if (gate.answers.some((a) => a.use === "pending" && a.version === gate.version)) continue;
    const newTurn = turns.some(
      (t) =>
        t.session === session &&
        t.at > open.at &&
        (t.delivery === null || !commands.has(t.delivery)),
    );
    const laterRequest = [...opened.entries()].some(
      ([id, o]) =>
        id !== gate.gate && commands.has(id) && o.session === session && o.at > open.at + timeoutMs,
    );
    if (newTurn || laterRequest) stale.push({ gate, answer: timeoutAnswer(timeoutMs) });
  }
  return stale;
}
