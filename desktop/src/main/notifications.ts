// The desktop notifications of the main process (docs/architecture.md 4.10.6, docs/tech-stack.md
// 1.4 "Notifications", openspec add-desktop-devices-knowledge). The logic is here, with no
// Electron import: index.ts gives a factory on the Electron `Notification`, tests give a fake. An
// unsigned build cannot show them (`isSupported()` or the `failed` event), so the code path is unit
// tested and the real check waits for the signed app.
import type { ShownPause } from "@aw/client/pause";
import type { Task, UnassignedTaskView } from "../shared/channels.ts";
import { pauseLabel } from "../shared/pause-text.ts";

/** The bytes of a notification body that macOS shows; a longer command gets no action. */
export const BODY_BYTES = 256;

/** Gates with no notification: they have no push either (docs/workflow.md 3). */
const QUIET_GATES = new Set(["approve_knowledge", "approve_device", "fix_file"]);

const GATE_LABEL: Record<string, string> = {
  question: "Answer question",
  reply: "Reply",
  confirm_approach: "Confirm approach",
  assign: "Assign task",
  approve_command: "Approve command",
  approve_result: "Approve result",
  continue_after_limit: "Continue after usage limit",
  take_over_terminal: "Take over terminal",
  custom: "Decision",
};

export interface NotificationTarget {
  ws: string;
  task: string;
}

/** What a gate action or reply answers. */
export interface NotificationAnswer {
  gate: string;
  version: number;
}

export interface NotificationSpec {
  /** `<gate>:v<version>` (a new version is a new notification), or `done:<task>`, `paused:<task>:<cause>`, `assign:<task>`. */
  id: string;
  /** The task id. */
  groupId: string;
  title: string;
  body: string;
  /** The text of each action button; an action sends its text as the answer. */
  actions: string[];
  hasReply: boolean;
  target: NotificationTarget;
  answer: NotificationAnswer | null;
}

export interface NotificationHandlers {
  click(): void;
  action(index: number): void;
  reply(text: string): void;
}

export interface NotificationHandle {
  close(): void;
}

/** A delivered notification of an earlier app process (`Notification.getHistory()`). */
export interface DeliveredNotification extends NotificationHandle {
  id: string;
  attach(handlers: NotificationHandlers): void;
}

export interface NotificationFactory {
  supported(): boolean;
  show(spec: NotificationSpec, handlers: NotificationHandlers): NotificationHandle;
  history(): Promise<DeliveredNotification[]>;
}

/** Cuts a text to at most `bytes` UTF-8 bytes, on a character border. */
export function cutBytes(text: string, bytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= bytes) return text;
  let out = "";
  for (const char of text) {
    if (encoder.encode(`${out}${char}…`).length > bytes) break;
    out += char;
  }
  return `${out}…`;
}

function fits(text: string): boolean {
  return new TextEncoder().encode(text).length <= BODY_BYTES;
}

function label(task: Pick<Task, "id" | "key">): string {
  return task.key ?? task.id.slice(0, 8);
}

type GateOf = Task["gates"][number];

/**
 * The notification of an open gate, or null for a gate with no notification. The gate title is
 * the first part of the text (at most 500 characters), so a title that fits in the body is the full
 * command of an Approve command gate.
 */
export function gateNotification(ws: string, task: Task, gate: GateOf): NotificationSpec | null {
  if (gate.state !== "open" || QUIET_GATES.has(gate.kind)) return null;
  let actions: string[] = [];
  let hasReply = false;
  if (gate.kind === "question") actions = [...gate.options];
  if (gate.kind === "reply") hasReply = true;
  if (gate.kind === "approve_command" && fits(gate.title)) {
    const allow = gate.options.find((o) => o.trim().toLowerCase() === "allow once");
    if (allow) actions = [allow];
  }
  return {
    id: `${gate.gate}:v${gate.version}`,
    groupId: task.id,
    title: `${label(task)} · ${GATE_LABEL[gate.kind] ?? gate.kind.replaceAll("_", " ")}`,
    body: cutBytes(gate.title, BODY_BYTES),
    actions,
    hasReply,
    target: { ws, task: task.id },
    answer: actions.length > 0 || hasReply ? { gate: gate.gate, version: gate.version } : null,
  };
}

interface PausedField {
  paused?: (Pick<ShownPause, "cause" | "needs_human" | "next_step"> & Partial<ShownPause>) | null;
}

/**
 * The pause text of a notification title. A presence pause names its device: "ubuntu-01 was
 * revoked" (openspec revoke-device); another pause names its cause.
 */
function pausedTitle(paused: NonNullable<PausedField["paused"]>): string {
  return pauseLabel({ since: "", resumes_at: null, ...paused });
}

/** The notifications of one task: its open gates, "done", and a pause that needs the human. */
export function taskNotifications(ws: string, task: Task): NotificationSpec[] {
  if (task.archived) return [];
  const specs: NotificationSpec[] = [];
  for (const gate of task.gates) {
    const spec = gateNotification(ws, task, gate);
    if (spec) specs.push(spec);
  }
  const base = { groupId: task.id, actions: [], hasReply: false, answer: null };
  const target = { ws, task: task.id };
  if (task.stage === "done") {
    specs.push({
      ...base,
      id: `done:${task.id}`,
      title: `${label(task)} · Done`,
      body: cutBytes(task.title ?? "The task is done.", BODY_BYTES),
      target,
    });
  }
  const paused = (task as Task & PausedField).paused;
  if (paused?.needs_human) {
    specs.push({
      ...base,
      id: `paused:${task.id}:${paused.cause}`,
      title: `${label(task)} · Paused: ${pausedTitle(paused)}`,
      body: cutBytes(paused.next_step || (task.title ?? ""), BODY_BYTES),
      target,
    });
  }
  return specs;
}

/**
 * The "Assign task" notifications (openspec queue-and-assign): one for each task with no assignee
 * that an agent created, as the push rule of the gate table (docs/workflow.md 3). A task that a
 * person created gets none. The notification goes away when the task gets an assignee.
 */
export function assignNotifications(
  ws: string,
  unassigned: readonly UnassignedTaskView[],
): NotificationSpec[] {
  return unassigned
    .filter((t) => t.by_agent)
    .map((t) => ({
      id: `assign:${t.task}`,
      groupId: t.task,
      title: `${t.key ?? t.task.slice(0, 8)} · ${GATE_LABEL.assign}`,
      body: cutBytes(t.title ?? "The task needs an assignee.", BODY_BYTES),
      actions: [],
      hasReply: false,
      target: { ws, task: t.task },
      answer: null,
    }));
}

export interface NotificationCenterDeps {
  factory: NotificationFactory;
  answer(ws: string, gate: string, body: { answer: string; version: number }): Promise<unknown>;
  open(target: NotificationTarget): void;
  onError?(error: unknown): void;
}

/**
 * Shows a notification for each new item and closes the notification of an item that went away
 * (an answer on any device). The first listing of each workspace only records its items, so a
 * restart, or a workspace that was not ready at the start, does not show old gates again.
 */
export class NotificationCenter {
  readonly #deps: NotificationCenterDeps;
  /** The item ids of each workspace at its last listing. */
  #known = new Map<string, Set<string>>();
  #shown = new Map<string, { ws: string; handle: NotificationHandle }>();
  #delivered: DeliveredNotification[] = [];

  constructor(deps: NotificationCenterDeps) {
    this.#deps = deps;
  }

  /** Reads the delivered notifications of an earlier process; the next updates attach them. */
  async start(): Promise<void> {
    if (!this.#deps.factory.supported()) return;
    try {
      this.#delivered = await this.#deps.factory.history();
    } catch (error) {
      this.#deps.onError?.(error);
    }
  }

  #handlers(spec: NotificationSpec): NotificationHandlers {
    const send = (answer: string) => {
      if (!spec.answer || !answer.trim()) return;
      this.#deps
        .answer(spec.target.ws, spec.answer.gate, { answer, version: spec.answer.version })
        .catch((error: unknown) => this.#deps.onError?.(error));
    };
    return {
      click: () => this.#deps.open(spec.target),
      action: (index) => {
        const text = spec.actions[index];
        if (text !== undefined) send(text);
      },
      reply: (text) => {
        if (spec.hasReply) send(text);
      },
    };
  }

  /**
   * Takes the tasks (and the tasks with no assignee) of each listed workspace after a change.
   * `complete: false` tells that a workspace of awd is missing from the list (not ready, or its
   * load failed): a delivered notification of an earlier process then stays open.
   */
  update(
    workspaces: { ws: string; tasks: Task[]; unassigned?: readonly UnassignedTaskView[] }[],
    options: { complete?: boolean } = {},
  ): void {
    if (!this.#deps.factory.supported()) return;
    const listed = new Map<string, Map<string, NotificationSpec>>();
    for (const { ws, tasks, unassigned } of workspaces) {
      const specs = new Map<string, NotificationSpec>();
      for (const task of tasks) {
        for (const spec of taskNotifications(ws, task)) specs.set(spec.id, spec);
      }
      for (const spec of assignNotifications(ws, unassigned ?? [])) specs.set(spec.id, spec);
      listed.set(ws, specs);
    }
    this.#attachDelivered(listed, options.complete ?? true);
    for (const [id, shown] of this.#shown) {
      if (!listed.get(shown.ws)?.has(id)) {
        shown.handle.close();
        this.#shown.delete(id);
      }
    }
    for (const [ws, specs] of listed) {
      const known = this.#known.get(ws);
      this.#known.set(ws, new Set(specs.keys()));
      if (!known) continue;
      for (const [id, spec] of specs) {
        if (known.has(id) || this.#shown.has(id)) continue;
        try {
          this.#shown.set(id, { ws, handle: this.#deps.factory.show(spec, this.#handlers(spec)) });
        } catch (error) {
          this.#deps.onError?.(error);
        }
      }
    }
    for (const ws of this.#known.keys()) {
      if (!listed.has(ws)) this.#known.delete(ws);
    }
  }

  /** Attaches the handlers to the delivered notifications that have an item now. */
  #attachDelivered(listed: Map<string, Map<string, NotificationSpec>>, complete: boolean): void {
    if (this.#delivered.length === 0) return;
    const waiting: DeliveredNotification[] = [];
    for (const delivered of this.#delivered) {
      let found: NotificationSpec | undefined;
      for (const specs of listed.values()) found ??= specs.get(delivered.id);
      if (found) {
        delivered.attach(this.#handlers(found));
        this.#shown.set(found.id, { ws: found.target.ws, handle: delivered });
      } else if (complete) {
        // Answered on another device while the app was closed.
        delivered.close();
      } else {
        waiting.push(delivered);
      }
    }
    this.#delivered = waiting;
  }
}
