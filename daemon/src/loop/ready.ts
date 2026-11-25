// The ready checks of the implementing device (docs/workflow.md 4.7, docs/phase-1.md 9.5.4) as a
// pure function, and the proposal rule of a subtask (task-model decision §5.2).
import { compareOrder, type EventRow, type TaskView } from "@aw/core";
import type { Stage } from "@aw/schema";

/** The result of the sync check: in sync, or the text of the wait ("knowledge 92 %"). */
export type SyncCheck = { ok: true } | { ok: false; text: string };

export interface ReadyInput {
  task: TaskView;
  parent: TaskView | null;
  /** The events of the task in merge order. */
  rows: EventRow[];
  /** This device. */
  me: string;
  /** The `task.claimed` event of the running session. */
  claimEvent: string;
  sync: SyncCheck;
}

export interface ReadyResult {
  pass: boolean;
  /** The checks that fail, in words. Empty when it passes. */
  failing: string[];
  /** The sync wait text when only the sync check fails, else null. */
  waitingForSync: string | null;
  /** True when the agent ran `ready` in this session (the other checks wait for the human). */
  readyReported: boolean;
}

function data(row: EventRow): Record<string, unknown> {
  return (row.event as { data?: Record<string, unknown> }).data ?? {};
}

/**
 * True when the proposal is approved: the own proposal, or for a subtask with no own proposal
 * the approved proposal of its parent (it starts at Ready with it).
 */
export function proposalApproved(task: TaskView, parent: TaskView | null): boolean {
  if (task.proposal.approved !== null) return true;
  return task.proposal.latest === 0 && parent !== null && parent.proposal.approved !== null;
}

/** The stage at the first claim: Ready for a subtask that starts with the parent proposal. */
export function firstStage(task: TaskView, parent: TaskView | null): Stage {
  return task.parent !== null && task.proposal.latest === 0 && proposalApproved(task, parent)
    ? "ready"
    : "discuss";
}

/** The newest applied `task.ready` of this device after the claim of the session, or null. */
export function readyRow(rows: EventRow[], me: string, claimEvent: string): EventRow | null {
  const claim = rows.find((r) => r.id === claimEvent);
  const row = rows.filter((r) => r.type === "task.ready" && r.applied && r.dev === me).at(-1);
  if (!row || !claim || compareOrder(row, claim) < 0) return null;
  return row;
}

export function readyChecks(input: ReadyInput): ReadyResult {
  const { task } = input;
  const failing: string[] = [];
  const row = readyRow(input.rows, input.me, input.claimEvent);
  if (!row) failing.push("the agent did not run aw ready in this session");
  else {
    const gates = Array.isArray(data(row).gates) ? (data(row).gates as string[]) : [];
    const open = gates.filter((id) => task.gates.find((g) => g.gate === id)?.state !== "resolved");
    if (open.length > 0) failing.push(`${open.length} missing item(s) wait for an answer`);
  }
  if (!proposalApproved(task, input.parent)) failing.push("the proposal is not approved");
  if (task.assignee === null) failing.push("the task has no assignee");
  if (task.open_dependencies.length > 0) {
    failing.push(`${task.open_dependencies.length} dependency task(s) are not done`);
  }
  const onlySync = failing.length === 0 && !input.sync.ok;
  if (!input.sync.ok) failing.push(`Waiting for sync: ${input.sync.text}`);
  return {
    pass: failing.length === 0,
    failing,
    waitingForSync: onlySync && !input.sync.ok ? `Waiting for sync: ${input.sync.text}` : null,
    readyReported: row !== null,
  };
}
