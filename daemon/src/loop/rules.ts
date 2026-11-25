// The push, reminder and timeout rule of each gate (docs/workflow.md 3, the gate table) as a pure
// function of the tasks, the time and the pushes that were sent (design of add-task-loop, decision
// 10). The loop sends the result and records it, so a restart sends no push twice.
import { hlcMs, type TaskView } from "@aw/core";
import type { PushPreview } from "@aw/push-webpush";
import type { GateKind } from "@aw/schema";

const HOUR = 60 * 60 * 1000;

export interface GateRule {
  /** A push when the gate opens. */
  open: boolean;
  /** The reminder pushes, in ms after the open. */
  reminders: number[];
}

/** The gate table of docs/workflow.md 3. "Approve command" has its 120 s timeout in the hook. */
export const GATE_RULES: Record<GateKind, GateRule> = {
  question: { open: true, reminders: [HOUR, 24 * HOUR] },
  reply: { open: true, reminders: [HOUR, 24 * HOUR] },
  approve_proposal: { open: true, reminders: [HOUR, 24 * HOUR] },
  // Only for a task that an agent created (see duePushes).
  assign: { open: true, reminders: [24 * HOUR] },
  approve_command: { open: true, reminders: [] },
  approve_result: { open: true, reminders: [HOUR, 24 * HOUR] },
  approve_knowledge: { open: false, reminders: [] },
  approve_device: { open: false, reminders: [] },
  continue_after_limit: { open: true, reminders: [24 * HOUR] },
  take_over_terminal: { open: true, reminders: [HOUR, 24 * HOUR] },
  fix_file: { open: false, reminders: [24 * HOUR] },
  custom: { open: true, reminders: [HOUR, 24 * HOUR] },
};

/**
 * An "open" push only while the gate is this new: after a long awd stop, an old gate gets only its
 * reminders, not a late "open" push.
 */
export const OPEN_PUSH_WINDOW_MS = 10 * 60 * 1000;

export interface DuePush {
  /** The key in the record of sent pushes: `<gate or assign:<task>>:<open|ms>` or `done:<task>`. */
  key: string;
  /** Other keys that this push covers (the earlier reminders that were missed). */
  covers: string[];
  task: TaskView;
  /** The event id of the preview: the gate open, or the task creation. */
  event: string | null;
  /** `gate` for a gate or "Assign task" push, `done` for a Done task (gate-full-context). */
  kind: "gate" | "done";
  gateKind: GateKind | null;
  text: string;
}

export interface DueInput {
  tasks: TaskView[];
  /** This device: only the owner of a task sends its pushes. */
  me: string;
  now: number;
  sent: ReadonlySet<string>;
  /** True when an agent created the task ("Assign task" pushes only then). */
  createdByAgent(task: TaskView): boolean;
  /** The time of the `task.done` event of a done task, or null. */
  doneAt(task: TaskView): number | null;
}

/** The label of a gate kind in a push text. */
export const GATE_LABELS: Record<GateKind, string> = {
  question: "Reply to a question",
  reply: "Reply to a question",
  approve_proposal: "Approve proposal",
  assign: "Assign task",
  approve_command: "Approve command",
  approve_result: "Approve result",
  approve_knowledge: "Approve knowledge change",
  approve_device: "Approve device",
  continue_after_limit: "Continue after usage limit",
  take_over_terminal: "Take over terminal",
  fix_file: "Fix a file",
  custom: "Decision",
};

function schedule(
  rule: GateRule,
  base: string,
  opened: number,
  now: number,
  sent: ReadonlySet<string>,
): { key: string; covers: string[]; reminder: boolean } | null {
  const reminders = rule.reminders.filter((delay) => now >= opened + delay);
  if (reminders.length > 0) {
    const keys = reminders.map((delay) => `${base}:${delay}`);
    const last = keys.at(-1)!;
    if (sent.has(last)) return null;
    // The open push and the earlier reminders are covered by the newest due reminder.
    return { key: last, covers: [`${base}:open`, ...keys.slice(0, -1)], reminder: true };
  }
  const key = `${base}:open`;
  if (!rule.open || sent.has(key) || now - opened > OPEN_PUSH_WINDOW_MS) return null;
  return { key, covers: [], reminder: false };
}

/** The pushes that are due now. */
export function duePushes(input: DueInput): DuePush[] {
  const due: DuePush[] = [];
  for (const task of input.tasks) {
    if (task.owner !== input.me || task.archived || task.created === null) continue;
    const key = task.key ?? task.id.slice(0, 8);
    if (task.stage === "done") {
      const at = input.doneAt(task);
      const doneKey = `done:${task.id}`;
      if (at !== null && !input.sent.has(doneKey) && input.now - at <= OPEN_PUSH_WINDOW_MS) {
        due.push({
          key: doneKey,
          covers: [],
          task,
          event: null,
          kind: "done",
          gateKind: null,
          text: `Done: ${task.title ?? key}`,
        });
      }
      continue;
    }
    for (const gate of task.gates) {
      if (gate.state !== "open") continue;
      const item = schedule(
        GATE_RULES[gate.kind],
        gate.gate,
        hlcMs(gate.opened.hlc),
        input.now,
        input.sent,
      );
      if (!item) continue;
      due.push({
        ...item,
        task,
        event: gate.opened.event,
        kind: "gate",
        gateKind: gate.kind,
        text: `${item.reminder ? "Reminder: " : ""}${gate.title || GATE_LABELS[gate.kind]}`,
      });
    }
    // "Assign task" pushes and reminds only for a task that an agent created (docs/workflow.md 3;
    // task-loop review L3): a person who parks a task with no assignee gets no push.
    if (task.assignee === null && input.createdByAgent(task)) {
      const item = schedule(
        GATE_RULES.assign,
        `assign:${task.id}`,
        hlcMs(task.created.hlc),
        input.now,
        input.sent,
      );
      if (item) {
        due.push({
          ...item,
          task,
          event: task.created.event,
          kind: "gate",
          gateKind: "assign",
          text: `${item.reminder ? "Reminder: " : ""}Needs you: assign ${task.title ?? key}`,
        });
      }
    }
  }
  return due;
}

/**
 * The push of an agent login on the session device (gate-full-context, M23): `login_expired` or
 * `login_ends`, so the phone title says "AW-7 · Login expired", not "A gate needs you".
 */
export function loginPush(
  kind: "login_expired" | "login_ends",
  task: string,
  key: string | null,
  text: string,
): PushPreview {
  return { event: null, task, key, kind, gate_kind: null, text };
}
