// The queue view (openspec queue-and-assign, design decisions 3 to 6): for each `agent@device`, the
// tasks that wait for a session, their position and the cause that blocks them, from the merged
// files only. The session manager keeps its own live check (`startBlock`); this rule copies its
// checks and their order, so the desktop of another device and the phone show the same text.
// The Kotlin port is `android/control/.../Queues.kt`; both run contracts/fixtures/queue/cases.json.
import type { EventRef, TaskView } from "@aw/core";
import { DEFAULT_MAX_WORKING, DISK_FULL_PERCENT, queueOrder } from "./queue.ts";
import { QUEUE_USAGE_LIMIT } from "./usage.ts";

/** The fields of a task that the rule reads. */
export interface QueueTask {
  id: string;
  key: string | null;
  title: string | null;
  assignee: string | null;
  stage: string;
  archived: boolean;
  created: EventRef | null;
  /** The device of the accepted claim, or null. */
  claim_device: string | null;
  session: { device: string; state: "running" | "ended" } | null;
  paused: boolean;
  open_gate: boolean;
  open_dependencies: string[];
}

export interface QueueDevice {
  slug: string;
  revoked: boolean;
  /** The presence: false when offline, null when not known (no presence is not offline). */
  online: boolean | null;
  /** The last valid `health.yaml` of the device as plain JSON, or null. */
  health: unknown;
}

export interface QueueOrder {
  agent: string;
  tasks: readonly string[];
}

export type QueueCauseCode =
  | "device_revoked"
  | "device_offline"
  | "max_working"
  | "login_ended"
  | "usage_limit"
  | "disk_full"
  | "dependencies"
  | "starting";

export interface QueueCause {
  code: QueueCauseCode;
  text: string;
}

export interface QueueEntry {
  task: string;
  key: string | null;
  title: string | null;
  /** From 1; null for a task with open dependencies. */
  position: number | null;
  /** "Queued · 2nd for claude@ubuntu-01". */
  text: string;
  cause: QueueCause;
}

export interface AgentQueue {
  agent: string;
  device: string;
  max_working: number;
  working: number;
  tasks: QueueEntry[];
}

export interface QueueInput {
  tasks: readonly QueueTask[];
  /** The newest `queue.reordered` of each agent. */
  orders: readonly QueueOrder[];
  devices: readonly QueueDevice[];
  /** The time in ms. */
  now: number;
}

/** The fields of the rule from a task of the merged view. */
export function queueTask(task: TaskView): QueueTask {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    assignee: task.assignee,
    stage: task.stage,
    archived: task.archived,
    created: task.created,
    claim_device: task.claim?.device ?? null,
    session: task.session ? { device: task.session.device, state: task.session.state } : null,
    paused: task.paused !== null,
    open_gate: task.gates.some((g) => g.state === "open"),
    open_dependencies: [...task.open_dependencies],
  };
}

/** English ordinals: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const unit = n % 10;
  const suffix = unit === 1 ? "st" : unit === 2 ? "nd" : unit === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** "Queued · 2nd for claude@ubuntu-01", or "Queued for claude@ubuntu-01" with no position. */
export function queueLabel(agent: string, position: number | null): string {
  return position === null ? `Queued for ${agent}` : `Queued · ${ordinal(position)} for ${agent}`;
}

function split(assignee: string | null): { name: string; device: string } | null {
  if (assignee === null) return null;
  const at = assignee.indexOf("@");
  if (at <= 0 || at === assignee.length - 1) return null;
  return { name: assignee.slice(0, at), device: assignee.slice(at + 1) };
}

function active(task: QueueTask): boolean {
  return task.created !== null && !task.archived && task.stage !== "done";
}

/** True when the task waits for a session: no claim on the device of its assignee. */
export function isQueued(task: QueueTask): boolean {
  const who = split(task.assignee);
  return active(task) && who !== null && task.claim_device !== who.device;
}

interface Limits {
  maxWorking: number;
  diskFullPercent: number;
  loginValid: boolean | null;
  fiveHour: number | null;
  disk: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The limits of a device from its health file; the defaults when the file or a field is missing. */
export function healthLimits(health: unknown, now: number): Limits {
  const doc = record(health);
  const queue = record(doc?.queue);
  let fiveHour: number | null = null;
  for (const usage of Array.isArray(doc?.usage) ? (doc.usage as unknown[]) : []) {
    const window = record(record(usage)?.five_hour);
    const used = num(window?.used_percentage);
    if (used === null) continue;
    // After the reset the stored percentage is old (`fiveHourUse`).
    const resets = typeof window?.resets_at === "string" ? Date.parse(window.resets_at) : NaN;
    if (!Number.isNaN(resets) && resets <= now) continue;
    fiveHour = Math.max(fiveHour ?? 0, used);
  }
  const login = queue?.login_valid;
  return {
    maxWorking: num(queue?.max_working) ?? DEFAULT_MAX_WORKING,
    diskFullPercent: num(queue?.disk_full_percent) ?? DISK_FULL_PERCENT,
    loginValid: typeof login === "boolean" ? login : null,
    fiveHour,
    disk: num(record(doc?.disk)?.used_percentage),
  };
}

function sessions(n: number): string {
  return n === 1 ? "1 session working" : `${n} sessions working`;
}

/** The cause of the task at `index` (from 0) among the tasks with a position (design decision 5). */
function causeAt(
  index: number,
  agent: { name: string; device: string },
  device: QueueDevice | undefined,
  limits: Limits,
  working: number,
): QueueCause {
  if (device?.revoked === true) {
    return { code: "device_revoked", text: `${agent.device} was revoked` };
  }
  if (device?.online === false) return { code: "device_offline", text: `${agent.device} offline` };
  // The real count first, then the device blocks, then the projected count: a device block stops
  // each start, so no later task starts in a free slot (fix list 0-45).
  if (working >= limits.maxWorking) return { code: "max_working", text: sessions(working) };
  if (limits.loginValid === false) {
    return { code: "login_ended", text: `login of ${agent.name} ended` };
  }
  if (limits.fiveHour !== null && limits.fiveHour > QUEUE_USAGE_LIMIT) {
    return { code: "usage_limit", text: `5-hour usage at ${Math.round(limits.fiveHour)} %` };
  }
  if (limits.disk !== null && limits.disk >= limits.diskFullPercent) {
    return { code: "disk_full", text: `disk ${Math.round(limits.disk)} % full` };
  }
  if (working + index >= limits.maxWorking) {
    return { code: "max_working", text: sessions(Math.min(working + index, limits.maxWorking)) };
  }
  return { code: "starting", text: "starts soon" };
}

/** The queue of each agent that has a queued task, sorted by the agent. */
export function agentQueues(input: QueueInput): AgentQueue[] {
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const groups = new Map<string, QueueTask[]>();
  for (const task of input.tasks) {
    if (!isQueued(task)) continue;
    const list = groups.get(task.assignee!) ?? [];
    list.push(task);
    groups.set(task.assignee!, list);
  }
  const result: AgentQueue[] = [];
  for (const agent of [...groups.keys()].sort()) {
    const who = split(agent)!;
    const device = input.devices.find((d) => d.slug === who.device);
    const limits = healthLimits(device?.health ?? null, input.now);
    const working = input.tasks.filter(
      (t) =>
        active(t) &&
        t.assignee === agent &&
        t.claim_device === who.device &&
        t.session?.device === who.device &&
        t.session.state === "running" &&
        !t.paused &&
        !t.open_gate,
    ).length;
    const ordered = queueOrder(
      groups.get(agent)!,
      input.orders.find((o) => o.agent === agent),
    );
    const ready = ordered.filter((t) => t.open_dependencies.length === 0);
    const waiting = ordered.filter((t) => t.open_dependencies.length > 0);
    const entry = (task: QueueTask, position: number | null, cause: QueueCause): QueueEntry => ({
      task: task.id,
      key: task.key,
      title: task.title,
      position,
      text: queueLabel(agent, position),
      cause,
    });
    result.push({
      agent,
      device: who.device,
      max_working: limits.maxWorking,
      working,
      tasks: [
        ...ready.map((t, i) => entry(t, i + 1, causeAt(i, who, device, limits, working))),
        ...waiting.map((t) =>
          entry(t, null, {
            code: "dependencies",
            text: `waits for ${t.open_dependencies
              .map((id) => byId.get(id)?.key ?? id.slice(0, 8))
              .join(", ")}`,
          }),
        ),
      ],
    });
  }
  return result;
}
