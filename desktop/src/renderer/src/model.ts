// The screen logic that does not need React: stages, board columns, list groups, gate rules and
// text helpers. The task view of awd has more fields than `Task` names (docs/phase-1.md 3.5);
// `details()` reads them with defaults.
import type { ShownPause } from "@aw/client/pause";
import type { EventRow, Gate, Project, Task, ThreadReply } from "../../shared/channels.ts";

export const STAGES = ["backlog", "discuss", "ready", "implement", "review", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  backlog: "Backlog",
  discuss: "Discuss",
  ready: "Ready",
  implement: "Implement",
  review: "Review",
  done: "Done",
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage as Stage] ?? stage;
}

/** The shown pause: the pause event, else the pause from the presence (with the device). */
export type PauseView = ShownPause;

export interface SessionView {
  session: string;
  device: string;
  host: string;
  state: "running" | "ended";
  reason: string | null;
  /** The link to the agent session and its terminal (openspec agent-pushes-updates). */
  name?: string | null;
  terminal?: { window: string | null; pane: string | null } | null;
  pid?: number | null;
}

/**
 * The link lines of the session summary: the Claude session id (the AW session id is the
 * `--session-id`), the session name, the terminal and the pid (openspec agent-pushes-updates).
 */
export function sessionLink(session: SessionView): string[] {
  const lines = [`Claude session ${session.session}`];
  if (session.name) lines.push(`name ${session.name}`);
  const t = session.terminal;
  if (t && (t.window || t.pane)) {
    lines.push(
      session.host === "orca"
        ? `Orca terminal ${t.pane ?? t.window}`
        : [t.window ? `tmux window ${t.window}` : null, t.pane ? `pane ${t.pane}` : null]
            .filter(Boolean)
            .join(" · "),
    );
  }
  if (session.pid) lines.push(`pid ${session.pid}`);
  return lines;
}

export interface TaskDetails {
  paused: PauseView | null;
  approach: { latest: number; confirmed: number | null };
  session: SessionView | null;
  claim: { epoch: number; device: string; session: string } | null;
  test_server: string | null;
  credentials: string[];
  links: string[];
  branch: string | null;
  progress: string | null;
  moving_to: string | null;
  ready: { passed_on: string | null; missing: string[] } | null;
}

/** The fields of the awd task view that `Task` does not name, with defaults. */
export function details(task: Task): TaskDetails {
  const t = task as Task & Partial<TaskDetails>;
  return {
    paused: t.paused ?? null,
    approach: t.approach ?? { latest: 0, confirmed: null },
    session: t.session ?? null,
    claim: t.claim ?? null,
    test_server: t.test_server ?? null,
    credentials: t.credentials ?? [],
    links: t.links ?? [],
    branch: t.branch ?? null,
    progress: t.progress ?? null,
    moving_to: t.moving_to ?? null,
    ready: t.ready ?? null,
  };
}

// The pause texts are shared with the notifications of the main process (integrate-continuity).
export { pauseLabel, pauseText } from "../../shared/pause-text.ts";

/** The short description of each Board column (docs/design.md 8.5.1). */
export const STAGE_HINT: Record<Stage, string> = {
  backlog: "Not started, or waits for an assignee.",
  discuss: "The agent reads the task and proposes an approach. You confirm it.",
  ready: "The approach is confirmed. The work starts when the checks pass.",
  implement: "The agent changes the code and runs the tests.",
  review: "You review the result and the artifacts.",
  done: "You approved the result.",
};

/**
 * The board (openspec navigation-prototype): one column per stage, and 2 rows. A task with a
 * "Needs you" reason is in the "Needs you" row of its stage column; the others are in the
 * "Everything else" row. A task shows in one place only.
 */
export function boardLanes(tasks: Task[]): {
  needsYou: Record<Stage, Task[]>;
  rest: Record<Stage, Task[]>;
} {
  const empty = () =>
    Object.fromEntries(STAGES.map((s) => [s, [] as Task[]])) as Record<Stage, Task[]>;
  const needsYou = empty();
  const rest = empty();
  for (const task of tasks) {
    if (task.archived) continue;
    const stage: Stage = (STAGES as readonly string[]).includes(task.stage)
      ? (task.stage as Stage)
      : "backlog";
    (task.needs_you_lane ? needsYou : rest)[stage].push(task);
  }
  return { needsYou, rest };
}

export type GroupId =
  "needs_you" | "running" | "paused" | "queued" | "backlog" | "done" | "archived";

export const GROUP_LABEL: Record<GroupId, string> = {
  needs_you: "Needs you",
  running: "Running",
  paused: "Paused",
  queued: "Queued",
  backlog: "Backlog",
  done: "Done",
  archived: "Archived",
};

/**
 * The groups of the List (prd TSK-06). Empty groups are left out. `queued` holds the ids of the
 * tasks that wait for a session (the queues route, openspec queue-and-assign). The archived tasks
 * are the last group, "Archived" (openspec task-actions).
 */
export function listGroups(
  tasks: Task[],
  queued: ReadonlySet<string> | ReadonlyMap<string, unknown> = new Set(),
): { id: GroupId; tasks: Task[] }[] {
  const groups: Record<GroupId, Task[]> = {
    needs_you: [],
    running: [],
    paused: [],
    queued: [],
    backlog: [],
    done: [],
    archived: [],
  };
  for (const task of tasks) {
    if (task.archived) groups.archived.push(task);
    else if (task.needs_you_lane) groups.needs_you.push(task);
    else if (details(task).paused) groups.paused.push(task);
    else if (queued.has(task.id)) groups.queued.push(task);
    else if (task.stage === "done") groups.done.push(task);
    else if (task.stage === "backlog") groups.backlog.push(task);
    else groups.running.push(task);
  }
  return (Object.keys(groups) as GroupId[])
    .filter((id) => groups[id].length > 0)
    .map((id) => ({ id, tasks: groups[id] }));
}

/** The title of a new task when the person leaves it empty: the first line of the first message. */
export function titleFromFirstMessage(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

/** The time of an HLC (`<ISO time>#<counter>`) in ms. */
export function hlcMs(hlc: string): number {
  return Date.parse(hlc.split("#")[0] ?? "");
}

/** The hook of "Approve command" waits 120 s, then denies (docs/workflow.md 3). */
export const PERMISSION_TIMEOUT_MS = 120_000;

export function countdown(openedMs: number, nowMs: number): { left: number; expired: boolean } {
  const left = Math.ceil((openedMs + PERMISSION_TIMEOUT_MS - nowMs) / 1000);
  return { left: Math.max(0, left), expired: left <= 0 };
}

/** The `agent@device` choices of a project: its default agent on each device of the project. */
export function agentChoices(
  projects: Project[],
  project: string | null,
  extra: (string | null)[] = [],
) {
  const choices = projects
    .filter((p) => project === null || p.slug === project)
    .flatMap((p) => p.devices.map((device) => `${p.default_agent}@${device}`));
  for (const value of extra) if (value) choices.push(value);
  return [...new Set(choices)];
}

/** What an option of a gate needs: a comment that is required, optional, or none. */
export function commentRule(option: string): "required" | "optional" | "none" {
  const o = option.trim().toLowerCase();
  if (o === "request changes" || o === "reject") return "required";
  if (o === "deny") return "optional";
  return "none";
}

export const GATE_LABEL: Record<string, string> = {
  question: "Answer question",
  reply: "Reply",
  confirm_approach: "Confirm approach",
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

export function gateLabel(kind: string): string {
  return GATE_LABEL[kind] ?? kind.replaceAll("_", " ");
}

/** The pending answer of this device to a gate, or else of another device. */
export function pendingAnswer(gate: Gate, device: string | null) {
  const pending = gate.answers.filter((a) => a.use === "pending");
  return {
    mine: pending.find((a) => a.dev === device) ?? null,
    other: pending.find((a) => a.dev !== device) ?? null,
  };
}

/** The HLC of the `gate.opened` event from the gate view (`opened.hlc`), or null. */
export function openedHlc(gate: Gate): string | null {
  const opened = gate.opened as { hlc?: unknown } | undefined;
  return typeof opened?.hlc === "string" ? opened.hlc : null;
}

/** The `gate.opened` event of a gate in a thread: its text, its request id and its time. */
export function gateOpened(thread: ThreadReply | undefined, gate: string): EventRow | null {
  return thread?.events.find((r) => r.type === "gate.opened" && r.event.data.gate === gate) ?? null;
}

/** The approach versions of a thread, oldest first. */
export function approachVersions(
  thread: ThreadReply | undefined,
): { version: number; text: string }[] {
  const versions = new Map<number, string>();
  for (const row of thread?.events ?? []) {
    const data = row.event.data;
    if (row.type === "approach.proposed" && typeof data.version === "number") {
      versions.set(data.version, versions.get(data.version) ?? "");
    }
    if (
      row.type === "gate.opened" &&
      data.kind === "confirm_approach" &&
      typeof data.file === "string"
    ) {
      const match = /v(\d+)\.md$/.exec(data.file);
      if (match) versions.set(Number(match[1]), typeof data.text === "string" ? data.text : "");
    }
  }
  return [...versions.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([version, text]) => ({ version, text }));
}

/** "12 s ago", "5 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86_400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The key, else the first 8 characters of the id. */
export function taskLabel(task: { id: string; key: string | null }): string {
  return task.key ?? task.id.slice(0, 8);
}

// ---- Gate full context (openspec gate-full-context) ----

/** The work events of a task: the gate cards and the fields read them, not the thread window. */
export const WORK_TYPES = "gate.opened,approach.proposed,result.posted,artifact.added";

/** The chip of an approach version (fix list 0-8). */
export function approachChip(
  version: number,
  approach: { latest: number; confirmed: number | null },
): "confirmed" | "waits" | "replaced" {
  if (approach.confirmed === version) return "confirmed";
  const newer = approach.confirmed === null || approach.latest > approach.confirmed;
  return version === approach.latest && newer ? "waits" : "replaced";
}

/** An artifact of a result: its path in the task folder, its name and its size (null: not known). */
export interface ResultArtifact {
  path: string;
  name: string;
  size: number | null;
}

/** The artifacts of the result of an "Approve result" gate (its `file` is the result file). */
export function resultArtifacts(rows: readonly EventRow[], gate: Gate): ResultArtifact[] {
  const result = [...rows]
    .reverse()
    .find(
      (r) => r.type === "result.posted" && (gate.file === null || r.event.data.file === gate.file),
    );
  const paths = Array.isArray(result?.event.data.artifacts)
    ? result.event.data.artifacts.filter((p): p is string => typeof p === "string")
    : [];
  const sizes = new Map<string, number>();
  for (const r of rows) {
    const d = r.event.data;
    if (r.type === "artifact.added" && typeof d.path === "string" && typeof d.size === "number") {
      sizes.set(d.path, d.size);
    }
  }
  return paths.map((path) => ({
    path,
    name: path.split("/").at(-1) ?? path,
    size: sizes.get(path) ?? null,
  }));
}

/** The notice after an answer that awd wrote but did not use, or null (design decision 8). */
export function answerNotice(reply: {
  applied: boolean;
  reason?: string | null;
  event?: { id: string };
  gate?: Gate;
}): string | null {
  if (!reply.applied) return `AW did not use your answer: ${reply.reason ?? "not applied"}.`;
  const mine = reply.gate?.answers.find((a) => a.event === reply.event?.id);
  if (mine?.use !== "comment") return null;
  // No answer event: AW closed the gate, for example because its session ended (stale-gates).
  const closed = reply.gate?.state === "resolved" && reply.gate.answer_event === null;
  if (closed && reply.gate?.answer) {
    return `Your answer came after AW closed this gate: “${reply.gate.answer}”. It is a comment now.`;
  }
  return "Your answer came after another answer. It is a comment now.";
}

/** The notice of a refused answer, or null for another error. */
export function refusedNotice(error: unknown): string | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  if (e?.code !== "gate_not_open") return null;
  const details = e.details as { answer?: unknown; answer_event?: unknown } | undefined;
  const answer = details?.answer;
  if (typeof answer !== "string") {
    return "Another answer resolved this gate first. AW did not send your answer.";
  }
  // `answer_event: null`: AW closed the gate, no person answered it (stale-gates).
  return details?.answer_event === null
    ? `AW closed this gate first: “${answer}”. AW did not send your answer.`
    : `Another answer resolved this gate first: “${answer}”. AW did not send your answer.`;
}

/** The need-you navigation of the task page (openspec task-review-layout, design decision 3). */
export interface NeedYouNav {
  /** "1 of 2 need you", "2 need you", or null when no task needs the person. */
  text: string | null;
  prev: string | null;
  next: string | null;
}

/**
 * The need-you navigation of a task: the tasks of the Inbox ("Needs you" lane, not archived) in the
 * Inbox order. A task in the list gets its place with Previous and Next; another task gets the count
 * and Next to the first of them.
 */
export function needYouNav(tasks: readonly Task[], current: string): NeedYouNav {
  const ids = tasks.filter((t) => !t.archived && t.needs_you_lane).map((t) => t.id);
  if (ids.length === 0) return { text: null, prev: null, next: null };
  const verb = ids.length === 1 ? "needs you" : "need you";
  const at = ids.indexOf(current);
  if (at < 0) return { text: `${ids.length} ${verb}`, prev: null, next: ids[0]! };
  return {
    text: `${at + 1} of ${ids.length} ${verb}`,
    prev: ids[at - 1] ?? null,
    next: ids[at + 1] ?? null,
  };
}

/** The groups of the task list of the task page: the tasks that need the person, then the working tasks. */
export function switchGroups(
  tasks: Task[],
  queued: ReadonlySet<string> | ReadonlyMap<string, unknown> = new Set(),
): { id: GroupId; tasks: Task[] }[] {
  const shown: GroupId[] = ["needs_you", "running", "paused", "queued"];
  return listGroups(tasks, queued).filter((g) => shown.includes(g.id));
}

/** The task page widths (openspec task-review-layout, design decisions 1 and 2). */
export const TASK_LIST_PX = 300;
export const LIST_FROM_PX = 700;
export const PROPERTIES_PANEL_PX = 280;
export const CONTENT_MAX_PX = 840;

/** The layout of the task page for its own width: the task list and the Properties panel. */
export function taskPageLayout(
  width: number,
  listOn: boolean,
  wideFrom: number,
): { canList: boolean; list: boolean; propertiesPanel: boolean } {
  const canList = width >= LIST_FROM_PX;
  const list = canList && listOn;
  return { canList, list, propertiesPanel: width - (list ? TASK_LIST_PX : 0) >= wideFrom };
}
