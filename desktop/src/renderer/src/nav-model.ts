// The navigation logic that does not need React (openspec navigation-prototype, docs/design.md 8.2
// to 8.5 and 8.9): the breadcrumb of a path, the Inbox items, the sidebar counts, the sync summary
// and the options of the command menu.
import { matchPath } from "react-router";
import type {
  Issue,
  Project,
  SyncStatusReply,
  Task,
  WorkspaceSummary,
} from "../../shared/channels.ts";
import { ago, details, gateLabel, listGroups, pauseText, taskLabel } from "./model.ts";

/** The name of a workspace: its name, else the last part of its folder. */
export function workspaceName(ws: Pick<WorkspaceSummary, "id" | "name" | "path">): string {
  return ws.name ?? ws.path.split("/").filter(Boolean).at(-1) ?? ws.id.slice(0, 8);
}

/** The letter of the tile of a workspace or a project. */
export function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

// ---- Counts ----

const WORKING_STAGES = new Set(["discuss", "ready", "implement", "review"]);

/** A task that an agent works on now: in Discuss to Review, not in the lane and not paused. */
export function isWorking(task: Task): boolean {
  return (
    !task.archived &&
    !task.needs_you_lane &&
    WORKING_STAGES.has(task.stage) &&
    details(task).paused === null
  );
}

/** The files to fix: each document that fails its schema. */
export function badFiles(issues: readonly Issue[] | undefined): Issue[] {
  return (issues ?? []).filter((i) => i.code === "bad_document");
}

/**
 * The count of the Inbox item and of the top bar: the "Needs you" rows of the Inbox (F-10), with
 * the rows of the tasks that keep an answer notice (fix list npc-6).
 */
export function needsYouCount(
  tasks: readonly Task[],
  issues: readonly Issue[] | undefined,
  notices?: ReadonlySet<string>,
): number {
  const rows = tasks.filter((t) => !t.archived && (t.needs_you_lane || notices?.has(t.id)));
  return rows.length + badFiles(issues).length;
}

/** The count of All tasks: the active tasks that are not done. */
export function activeCount(tasks: readonly Task[]): number {
  return tasks.filter((t) => !t.archived && t.stage !== "done").length;
}

/** The counts of a project row: the tasks that need the person, and the working tasks. */
export function projectCounts(
  tasks: readonly Task[],
  project: string,
): { you: number; working: number } {
  const own = tasks.filter((t) => t.project === project && !t.archived);
  return {
    you: own.filter((t) => t.needs_you_lane).length,
    working: own.filter(isWorking).length,
  };
}

// ---- Inbox ----

/** The reason of a task in the lane, as the Inbox row shows it. */
export function needsYouReason(task: Task): string {
  const reason = task.needs_you_reasons[0];
  if (!reason) return "Needs you";
  if (reason.reason === "gate" && typeof reason.kind === "string") return gateLabel(reason.kind);
  if (reason.reason === "assign") return "Assign task";
  if (reason.reason === "paused" && typeof reason.cause === "string") {
    return `Paused: ${pauseText(reason.cause)}`;
  }
  return "Needs you";
}

export type InboxTab = "you" | "updates";

interface ItemBase {
  /** The id of the row in the route (`?item=`). */
  id: string;
  tab: InboxTab;
  reason: string;
  title: string;
  /** The task key, or null. */
  key: string | null;
  sub: string | null;
}

export type InboxItem =
  | (ItemBase & { kind: "task"; task: Task })
  | (ItemBase & { kind: "file"; issue: Issue })
  | (ItemBase & { kind: "digest" })
  | (ItemBase & { kind: "sync"; device: string });

export interface DigestCounts {
  learned: number;
  changes: number;
  pending: number;
}

/**
 * The rows of the Inbox: "Needs you" (each task in the lane or with an answer notice, each file to
 * fix) and "Updates" (the knowledge of today, each offline device with changes not synced).
 */
export function inboxItems(input: {
  /** The workspace of the Inbox: a device with changes of only other workspaces has no row. */
  ws?: string;
  tasks: readonly Task[];
  notices?: ReadonlySet<string>;
  issues?: readonly Issue[] | undefined;
  digest?: DigestCounts | null | undefined;
  digestLine?: string;
  sync?: SyncStatusReply | undefined;
}): InboxItem[] {
  const items: InboxItem[] = [];
  for (const task of input.tasks) {
    if (task.archived) continue;
    if (!task.needs_you_lane && !input.notices?.has(task.id)) continue;
    items.push({
      kind: "task",
      id: `task:${task.id}`,
      tab: "you",
      reason: task.needs_you_lane ? needsYouReason(task) : "Answer notice",
      title: task.title ?? "(no title)",
      key: taskLabel(task),
      sub: task.project,
      task,
    });
  }
  for (const issue of badFiles(input.issues)) {
    items.push({
      kind: "file",
      id: `file:${issue.path}`,
      tab: "you",
      reason: "Fix a file",
      title: issue.path,
      key: null,
      sub: issue.message,
      issue,
    });
  }
  const d = input.digest;
  if (d && d.learned + d.changes + d.pending > 0) {
    items.push({
      kind: "digest",
      id: "digest",
      tab: "updates",
      reason: "Knowledge",
      title: "Knowledge today",
      key: null,
      sub: input.digestLine ?? null,
    });
  }
  for (const peer of input.sync?.peers ?? []) {
    if (peer.connected || peer.needItems <= 0) continue;
    // The sync status is of the device, not of one workspace (fix list npc-7).
    const own = (f: { workspace: string; needItems: number }) =>
      f.workspace === input.ws && f.needItems > 0;
    if (input.ws && peer.folders && !peer.folders.some(own)) continue;
    items.push({
      kind: "sync",
      id: `sync:${peer.device}`,
      tab: "updates",
      reason: "Not synced",
      title: peer.text,
      key: null,
      sub: "The changes go to the device when both devices are online.",
      device: peer.device,
    });
  }
  return items;
}

/** The groups under the "Needs you" rows of the Inbox, in this order. */
export const INBOX_GROUPS = [
  { id: "running", label: "Working now" },
  { id: "paused", label: "Paused" },
  { id: "queued", label: "Queued" },
] as const;

/**
 * The groups of the "Needs you" tab under its rows (openspec proposal-and-discussion): Working now,
 * Paused and Queued, only when not empty. A task with a row (`rows`) is in no group.
 */
export function inboxGroups(
  tasks: readonly Task[],
  rows: readonly InboxItem[],
  queued: ReadonlySet<string> | ReadonlyMap<string, unknown> = new Set(),
): { id: (typeof INBOX_GROUPS)[number]["id"]; label: string; tasks: Task[] }[] {
  const inRows = new Set(rows.flatMap((i) => (i.kind === "task" ? [i.task.id] : [])));
  const groups = listGroups(
    tasks.filter((t) => !t.archived && !inRows.has(t.id)),
    queued,
  );
  return INBOX_GROUPS.flatMap(({ id, label }) => {
    const group = groups.find((g) => g.id === id);
    return group ? [{ id, label, tasks: group.tasks }] : [];
  });
}

// ---- Sync ----

export type SyncTone = "ok" | "run" | "wait" | "err";

/** The sync state of the sidebar footer and the top bar. */
export function syncSummary(
  reply: SyncStatusReply | undefined,
  now: number,
): { tone: SyncTone; text: string } {
  if (!reply) return { tone: "wait", text: "Sync state not known" };
  const engine = reply.engine;
  if (engine === "not_configured" || engine === "not_installed") {
    return { tone: "wait", text: "Sync is off" };
  }
  if (engine === "starting" || engine === "restarting") return { tone: "run", text: "Sync starts" };
  if (engine === "failed") return { tone: "err", text: "Sync failed" };
  if (engine === "stopped") return { tone: "wait", text: "Sync stopped" };
  if (reply.paused) return { tone: "wait", text: "Sync paused" };
  if (reply.peers.length === 0) return { tone: "wait", text: "No other device" };
  const waiting = reply.peers.filter((p) => !p.connected && p.needItems > 0);
  if (waiting.length > 0) {
    const n = waiting.reduce((sum, p) => sum + p.needItems, 0);
    return { tone: "wait", text: `${n} ${n === 1 ? "change" : "changes"} not synced` };
  }
  // The engine reports each offline device as not in sync. An offline device with no change to
  // get waits for nothing, so only a connected device can be "Syncing" (fix list npc-1).
  if (reply.peers.some((p) => p.connected && !p.inSync)) return { tone: "run", text: "Syncing" };
  const last = reply.peers
    .map((p) => (p.lastSynced ? Date.parse(p.lastSynced) : Number.NaN))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => b - a)[0];
  return { tone: "ok", text: last === undefined ? "Synced" : `Synced ${ago(last, now)}` };
}

// ---- Breadcrumb ----

export interface Crumb {
  label: string;
  /** The link of an earlier part; null for the last part. */
  to: string | null;
  mono?: boolean;
}

/** The project frame (openspec nav-tasks-needs-you): Board and List are in Tasks with a filter. */
export const PROJECT_TABS = [
  { tab: "knowledge", label: "Knowledge" },
  { tab: "files", label: "Files" },
  { tab: "settings", label: "Settings" },
] as const;

const WS_SCREENS: Record<string, string> = {
  inbox: "Inbox",
  tasks: "Tasks",
  projects: "Projects",
  sources: "Sources",
  knowledge: "Knowledge",
  devices: "Devices & sync",
  credentials: "Credentials",
};

/**
 * The breadcrumb of a path: the workspace and the screen; the workspace, the project and the tab;
 * or the workspace, the project and the task key. Earlier parts link to their screen.
 */
export function crumbs(
  pathname: string,
  names: {
    workspace?: string | undefined;
    project?: (slug: string) => string;
    task?: Pick<Task, "id" | "key" | "project"> | undefined;
  } = {},
): Crumb[] {
  const settings = matchPath("/settings/*", pathname);
  if (settings) {
    return settings.params["*"] === "setup"
      ? [
          { label: "Settings", to: "/settings" },
          { label: "Setup check", to: null },
        ]
      : [{ label: "Settings", to: null }];
  }
  const w = matchPath("/w/:ws/*", pathname);
  if (!w?.params.ws) return [];
  const ws = w.params.ws;
  const rest = w.params["*"] ?? "";
  const home: Crumb = { label: names.workspace ?? "Workspace", to: `/w/${ws}/inbox` };
  const projectName = (slug: string) => names.project?.(slug) ?? slug;
  const project = matchPath("/p/:project/:tab", `/${rest}`);
  if (project?.params.project) {
    const slug = project.params.project;
    const tab = PROJECT_TABS.find((t) => t.tab === project.params.tab);
    return [
      home,
      { label: projectName(slug), to: `/w/${ws}/tasks?tab=all&projects=${slug}` },
      { label: tab?.label ?? project.params.tab ?? "", to: null },
    ];
  }
  const task = matchPath("/tasks/:task", `/${rest}`);
  if (task?.params.task) {
    const t = names.task;
    const parts: Crumb[] = [home];
    if (t?.project)
      parts.push({
        label: projectName(t.project),
        to: `/w/${ws}/tasks?tab=all&projects=${t.project}`,
      });
    parts.push({ label: t ? taskLabel(t) : "Task", to: null, mono: true });
    return parts;
  }
  const screen = WS_SCREENS[rest];
  return screen ? [home, { label: screen, to: null }] : [home];
}

// ---- Command menu ----

export type CommandAction = "new-task" | "new-session" | "sync-now" | "add-project";

export interface CommandOption {
  group: "Actions" | "Screens" | "Projects" | "Tasks";
  id: string;
  label: string;
  /** More text that the search matches and the row shows, for example the project of a task. */
  hint?: string;
  /** The key hint of the row, for example "⌘N". */
  shortcut?: string;
  /** A task key, shown in mono. */
  key?: string;
  run: { go: string } | { action: CommandAction };
}

/** The screens of ⌘1 to ⌘4 (docs/design.md 9). */
export function screenPath(ws: string | undefined, digit: string): string | null {
  if (digit === "4") return "/settings";
  if (!ws) return null;
  if (digit === "1") return `/w/${ws}/inbox`;
  if (digit === "2") return `/w/${ws}/tasks`;
  if (digit === "3") return `/w/${ws}/devices`;
  return null;
}

/**
 * True for the modifier of the app keys (⌘K, ⌘1 to ⌘4): ⌘ alone on macOS, Ctrl alone on other
 * systems. On macOS, Ctrl+K stays "delete to the end of the line" in a text field (fix list npc-3).
 */
export function isShortcut(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  if (event.altKey || event.shiftKey) return false;
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** The options of the command menu: actions, screens, the projects and the tasks of a workspace. */
export function commandOptions(input: {
  ws: string | undefined;
  projects: readonly Project[];
  tasks: readonly Task[];
}): CommandOption[] {
  const ws = input.ws;
  const options: CommandOption[] = [];
  if (ws) {
    options.push(
      {
        group: "Actions",
        id: "a:new-task",
        label: "New task",
        shortcut: "⌘N",
        run: { action: "new-task" },
      },
      {
        group: "Actions",
        id: "a:new-session",
        label: "New session",
        run: { action: "new-session" },
      },
      {
        group: "Actions",
        id: "a:sync-now",
        label: "Sync now",
        shortcut: "⌘R",
        run: { action: "sync-now" },
      },
      {
        group: "Actions",
        id: "a:add-project",
        label: "Add a project",
        run: { action: "add-project" },
      },
      {
        group: "Screens",
        id: "s:inbox",
        label: "Inbox",
        shortcut: "⌘1",
        run: { go: `/w/${ws}/inbox` },
      },
      {
        group: "Screens",
        id: "s:tasks",
        label: "Tasks",
        shortcut: "⌘2",
        run: { go: `/w/${ws}/tasks` },
      },
      {
        group: "Screens",
        id: "s:devices",
        label: "Devices & sync",
        shortcut: "⌘3",
        run: { go: `/w/${ws}/devices` },
      },
      {
        group: "Screens",
        id: "s:projects",
        label: "Projects",
        run: { go: `/w/${ws}/projects` },
      },
      {
        group: "Screens",
        id: "s:knowledge",
        label: "Knowledge",
        run: { go: `/w/${ws}/knowledge` },
      },
      {
        group: "Screens",
        id: "s:sources",
        label: "Sources",
        run: { go: `/w/${ws}/sources` },
      },
      {
        group: "Screens",
        id: "s:credentials",
        label: "Credentials",
        run: { go: `/w/${ws}/credentials` },
      },
    );
  }
  options.push({
    group: "Screens",
    id: "s:settings",
    label: "Settings",
    shortcut: "⌘4",
    run: { go: "/settings" },
  });
  if (!ws) return options;
  for (const p of input.projects) {
    if (p.archived) continue;
    options.push({
      group: "Projects",
      id: `p:${p.slug}`,
      label: p.name,
      hint: p.slug === p.name ? "Tasks" : `${p.slug} · Tasks`,
      run: { go: `/w/${ws}/tasks?tab=all&projects=${p.slug}` },
    });
  }
  for (const t of input.tasks) {
    if (t.archived) continue;
    options.push({
      group: "Tasks",
      id: `t:${t.id}`,
      label: t.title ?? "(no title)",
      key: taskLabel(t),
      ...(t.project ? { hint: t.project } : {}),
      run: { go: `/w/${ws}/tasks/${t.id}` },
    });
  }
  return options;
}

/** True when each word of the query is in the key, the label or the hint of the option. */
export function matchCommand(option: CommandOption, query: string): boolean {
  const text =
    `${option.key ?? ""} ${option.label} ${option.hint ?? ""} ${option.group}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/**
 * The options that match the query: at most 8 tasks with an empty query, at most 50 in all. When
 * the query is a task key, that task is first and the tasks group comes first, so Enter opens it
 * (fix list npc-5). The groups stay in one block each, as the grouped list needs.
 */
export function filterCommands(options: readonly CommandOption[], query: string): CommandOption[] {
  const q = query.trim();
  if (!q) {
    const tasks = options.filter((o) => o.group === "Tasks").slice(0, 8);
    return [...options.filter((o) => o.group !== "Tasks"), ...tasks];
  }
  const hits = options.filter((o) => matchCommand(o, q));
  const exact = hits.find((o) => o.key?.toLowerCase() === q.toLowerCase());
  if (!exact) return hits.slice(0, 50);
  const tasks = hits.filter((o) => o.group === "Tasks" && o !== exact);
  const rest = hits.filter((o) => o.group !== "Tasks");
  return [exact, ...tasks, ...rest].slice(0, 50);
}
