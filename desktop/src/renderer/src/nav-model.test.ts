import { describe, expect, it } from "vitest";
import inboxJson from "../../../../contracts/fixtures/inbox/items.json?raw";
import type { Issue, SyncPeerStatus, SyncStatusReply } from "../../shared/channels.ts";
import {
  activeCount,
  commandOptions,
  crumbs,
  filterCommands,
  inboxGroups,
  inboxItems,
  isShortcut,
  needsYouCount,
  needsYouReason,
  projectCounts,
  screenPath,
  syncSummary,
  workspaceName,
} from "./nav-model.ts";
import { makeGate, makeTask, PROJECT } from "./testing.tsx";

const NOW = Date.parse("2026-11-23T10:00:00Z");

const assign = makeTask({
  id: "t1",
  key: "AW-1",
  stage: "backlog",
  assignee: null,
  needs_you_lane: true,
  needs_you_reasons: [{ reason: "assign" }],
});
const result = makeTask({
  id: "t7",
  key: "AW-7",
  title: "Export invoices as CSV",
  stage: "review",
  needs_you_lane: true,
  needs_you_reasons: [{ reason: "gate", kind: "approve_result" }],
  gates: [makeGate({ kind: "approve_result" })],
});
const working = makeTask({ id: "t8", key: "AW-8", stage: "implement" });
const paused = makeTask({
  id: "t9",
  key: "AW-9",
  stage: "implement",
  paused: { cause: "device_offline", device: "ubuntu-01", needs_human: false, next_step: "" },
});
const done = makeTask({ id: "t10", key: "AW-10", stage: "done", project: "web-app" });
const archived = makeTask({ id: "t11", key: "AW-11", stage: "discuss", archived: true });
const tasks = [assign, result, working, paused, done, archived];

const badFile: Issue = {
  code: "bad_document",
  path: "tasks/projects/broken/project.yaml",
  line: 5,
  event: null,
  task: null,
  reason: null,
  message: "name: unclosed list",
};
const otherIssue: Issue = { ...badFile, code: "dup_event", path: "x" };

function peer(overrides: Partial<SyncPeerStatus>): SyncPeerStatus {
  return {
    device: "ubuntu-01",
    connected: true,
    needItems: 0,
    needBytes: 0,
    inSync: true,
    text: "Synced",
    ...overrides,
  };
}

function sync(
  peers: SyncPeerStatus[],
  engine: SyncStatusReply["engine"] = "running",
): SyncStatusReply {
  return { engine, device: "macbook-pro", sync_id: "x", paused: false, pids: [], peers };
}

describe("counts", () => {
  it("counts the Needs you rows of the Inbox: lane tasks and files to fix, not gates", () => {
    expect(needsYouCount(tasks, [badFile, otherIssue])).toBe(3);
    expect(needsYouCount(tasks, undefined)).toBe(2);
  });

  it("counts each row of the Needs you tab, also a task with an answer notice (fix list npc-6)", () => {
    const notices = new Set(["t8"]);
    const rows = inboxItems({ tasks, issues: [badFile], notices }).filter((i) => i.tab === "you");
    expect(needsYouCount(tasks, [badFile], notices)).toBe(rows.length);
    expect(rows).toHaveLength(4);
  });

  it("counts the active tasks that are not done for All tasks", () => {
    expect(activeCount(tasks)).toBe(4);
  });

  it("counts the tasks of a project that need you and that work", () => {
    expect(projectCounts(tasks, "billing-api")).toEqual({ you: 2, working: 1 });
    expect(projectCounts(tasks, "web-app")).toEqual({ you: 0, working: 0 });
  });
});

interface InboxFixture {
  cases: {
    name: string;
    tasks: {
      id: string;
      key: string;
      title: string;
      project: string;
      stage: string;
      archived: boolean;
      needs_you_lane: boolean;
      needs_you_reasons: { reason: string; kind?: string }[];
      paused: boolean;
      queued: boolean;
    }[];
    rows: { reason: string; title: string; key: string }[];
    groups: { id: string; label: string; keys: string[] }[];
  }[];
}

describe("the shared fixture contracts/fixtures/inbox/items.json", () => {
  const fixture = JSON.parse(inboxJson) as InboxFixture;

  it("gives the Needs you rows and the groups of each case", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(2);
    for (const c of fixture.cases) {
      // The fixture task as the desktop task view: a pause and a queue entry from their flags.
      const all = c.tasks.map((t) =>
        makeTask({
          id: t.id,
          key: t.key,
          title: t.title,
          project: t.project,
          stage: t.stage,
          archived: t.archived,
          needs_you_lane: t.needs_you_lane,
          needs_you_reasons: t.needs_you_reasons,
          ...(t.paused
            ? {
                paused: {
                  cause: "device_offline",
                  device: "ubuntu-01",
                  needs_human: false,
                  next_step: "",
                },
              }
            : {}),
        }),
      );
      const queued = new Set(c.tasks.filter((t) => t.queued).map((t) => t.id));
      // The Inbox lists the active tasks (Inbox.tsx).
      const active = all.filter((t) => !t.archived);
      const items = inboxItems({ tasks: active });
      expect({
        name: c.name,
        rows: items.map((i) => ({ reason: i.reason, title: i.title, key: i.key })),
        groups: inboxGroups(active, items, queued).map((g) => ({
          id: g.id,
          label: g.label,
          keys: g.tasks.map((t) => t.key),
        })),
      }).toEqual({ name: c.name, rows: c.rows, groups: c.groups });
    }
  });
});

describe("inboxGroups", () => {
  it("leaves a task with a row out of the groups, also a task with an answer notice", () => {
    const notices = new Set(["t8"]);
    const items = inboxItems({ tasks, notices });
    const other = makeTask({ id: "t12", key: "AW-12", stage: "discuss" });
    const groups = inboxGroups([...tasks, other], items, new Set());
    expect(items.map((i) => i.key)).toEqual(["AW-1", "AW-7", "AW-8"]);
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.key)])).toEqual([
      ["Working now", ["AW-12"]],
      ["Paused", ["AW-9"]],
    ]);
  });
});

describe("inboxItems", () => {
  it("lists the lane tasks and the files to fix in Needs you", () => {
    const items = inboxItems({ tasks, issues: [badFile, otherIssue] });
    expect(items.map((i) => [i.tab, i.reason, i.key ?? i.title])).toEqual([
      ["you", "Assign task", "AW-1"],
      ["you", "Approve result", "AW-7"],
      ["you", "Fix a file", "tasks/projects/broken/project.yaml"],
    ]);
  });

  it("keeps a task with an answer notice after it leaves the lane", () => {
    const items = inboxItems({ tasks: [working], notices: new Set(["t8"]) });
    expect(items.map((i) => [i.reason, i.key])).toEqual([["Answer notice", "AW-8"]]);
  });

  it("lists the knowledge of today and each offline device with changes in Updates", () => {
    const items = inboxItems({
      tasks: [],
      digest: { learned: 2, changes: 0, pending: 0 },
      digestLine: "2 learned",
      sync: sync([
        peer({
          device: "ubuntu-01",
          connected: false,
          needItems: 3,
          text: "3 changes not synced to ubuntu-01 (offline)",
        }),
        peer({ device: "mac-mini-lab", connected: true, needItems: 4, inSync: false }),
      ]),
    });
    expect(items.map((i) => [i.tab, i.kind, i.title])).toEqual([
      ["updates", "digest", "Knowledge today"],
      ["updates", "sync", "3 changes not synced to ubuntu-01 (offline)"],
    ]);
  });

  it("lists only the devices with changes of this workspace (fix list npc-7)", () => {
    const folder = (workspace: string, needItems: number) => ({
      folder: `${workspace}-tasks`,
      workspace,
      kind: "tasks" as const,
      needItems,
      needBytes: 1,
      remoteState: "valid",
      inSync: false,
    });
    const off = { connected: false, needItems: 3, inSync: false };
    const items = inboxItems({
      ws: "ws-1",
      tasks: [],
      sync: sync([
        peer({ ...off, device: "ubuntu-01", text: "a", folders: [folder("ws-2", 3)] }),
        peer({ ...off, device: "mac-mini-lab", text: "b", folders: [folder("ws-1", 3)] }),
      ]),
    });
    expect(items.map((i) => i.title)).toEqual(["b"]);
  });

  it("has no digest row when nothing happened today", () => {
    expect(inboxItems({ tasks: [], digest: { learned: 0, changes: 0, pending: 0 } })).toEqual([]);
  });

  it("names the reason of a pause that needs the person", () => {
    const t = makeTask({ needs_you_reasons: [{ reason: "paused", cause: "login_expired" }] });
    expect(needsYouReason(t)).toMatch(/^Paused: /);
    expect(needsYouReason(makeTask())).toBe("Needs you");
  });
});

describe("syncSummary", () => {
  it("says Synced with the age of the last sync", () => {
    const s = syncSummary(sync([peer({ lastSynced: "2026-11-23T09:59:48Z" })]), NOW);
    expect(s).toEqual({ tone: "ok", text: "Synced 12 s ago" });
  });

  it("counts the changes that wait for an offline device", () => {
    const s = syncSummary(
      sync([
        peer({ connected: false, needItems: 3, inSync: false }),
        peer({ device: "b", connected: false, needItems: 1 }),
      ]),
      NOW,
    );
    expect(s).toEqual({ tone: "wait", text: "4 changes not synced" });
  });

  it("says Syncing while a connected device is not in sync", () => {
    expect(syncSummary(sync([peer({ inSync: false, needItems: 2 })]), NOW).text).toBe("Syncing");
  });

  it("says Synced when an offline device has no change to get (fix list npc-1)", () => {
    // The sync engine plugin reports each offline peer with inSync false (status.ts).
    const off = peer({ device: "pixel-9", connected: false, needItems: 0, inSync: false });
    const on = peer({ lastSynced: "2026-11-23T09:59:48Z" });
    expect(syncSummary(sync([on, off]), NOW)).toEqual({ tone: "ok", text: "Synced 12 s ago" });
    expect(syncSummary(sync([off]), NOW)).toEqual({ tone: "ok", text: "Synced" });
  });

  it("names an engine that does not run", () => {
    expect(syncSummary(sync([], "not_configured"), NOW).text).toBe("Sync is off");
    expect(syncSummary(sync([], "failed"), NOW)).toEqual({ tone: "err", text: "Sync failed" });
    expect(syncSummary(sync([]), NOW).text).toBe("No other device");
    expect(syncSummary(undefined, NOW).tone).toBe("wait");
  });
});

describe("crumbs", () => {
  const names = {
    workspace: "Personal",
    project: (s: string) => (s === "billing-api" ? "Billing API" : s),
  };

  it("shows the workspace, the project and the tab of a project page", () => {
    expect(crumbs("/w/ws-1/p/billing-api/list", names)).toEqual([
      { label: "Personal", to: "/w/ws-1/inbox" },
      { label: "Billing API", to: "/w/ws-1/p/billing-api/board" },
      { label: "List", to: null },
    ]);
  });

  it("shows the project and the key of a task", () => {
    expect(crumbs("/w/ws-1/tasks/t7", { ...names, task: result })).toEqual([
      { label: "Personal", to: "/w/ws-1/inbox" },
      { label: "Billing API", to: "/w/ws-1/p/billing-api/board" },
      { label: "AW-7", to: null, mono: true },
    ]);
  });

  it("names the screens of a workspace and Settings", () => {
    expect(crumbs("/w/ws-1/inbox", names).map((c) => c.label)).toEqual(["Personal", "Inbox"]);
    expect(crumbs("/w/ws-1/tasks", names).map((c) => c.label)).toEqual(["Personal", "All tasks"]);
    expect(crumbs("/w/ws-1/devices", names).map((c) => c.label)).toEqual([
      "Personal",
      "Devices & sync",
    ]);
    expect(crumbs("/settings/setup").map((c) => c.label)).toEqual(["Settings", "Setup check"]);
    expect(crumbs("/")).toEqual([]);
  });

  it("uses the folder name of a workspace with no name", () => {
    expect(workspaceName({ id: "w", name: null, path: "/tmp/AW/Side" })).toBe("Side");
  });
});

describe("command menu", () => {
  const options = commandOptions({ ws: "ws-1", projects: [PROJECT], tasks });

  it("has the actions, the screens, the projects and the active tasks", () => {
    const groups = new Set(options.map((o) => o.group));
    expect([...groups]).toEqual(["Actions", "Screens", "Projects", "Tasks"]);
    expect(options.find((o) => o.label === "New task")?.shortcut).toBe("⌘N");
    expect(options.some((o) => o.key === "AW-11")).toBe(false);
  });

  it("finds a task by its key and by words of its title", () => {
    expect(filterCommands(options, "aw-7").map((o) => o.id)).toEqual(["t:t7"]);
    expect(filterCommands(options, "export csv").map((o) => o.run)).toEqual([
      { go: "/w/ws-1/tasks/t7" },
    ]);
    expect(filterCommands(options, "billing board").map((o) => o.id)).toEqual(["p:billing-api"]);
  });

  it("puts the task with the exact key first (fix list npc-5)", () => {
    const follow = makeTask({ id: "t3", key: "AW-3", title: "Follow up of AW-7" });
    const own = commandOptions({ ws: "ws-1", projects: [], tasks: [follow, result] });
    expect(filterCommands(own, "AW-7").map((o) => o.id)).toEqual(["t:t7", "t:t3"]);
  });

  it("opens the screens of ⌘1 to ⌘4", () => {
    expect(["1", "2", "3", "4", "5"].map((d) => screenPath("ws-1", d))).toEqual([
      "/w/ws-1/inbox",
      "/w/ws-1/tasks",
      "/w/ws-1/devices",
      "/settings",
      null,
    ]);
    expect(screenPath(undefined, "1")).toBeNull();
  });

  it("reads ⌘ on macOS and Ctrl on other systems (fix list npc-3)", () => {
    const key = (
      mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>>,
    ) => ({
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(isShortcut(key({ metaKey: true }), true)).toBe(true);
    // Ctrl+K deletes to the end of the line in a macOS text field: the app leaves it.
    expect(isShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isShortcut(key({ metaKey: true }), false)).toBe(false);
    expect(isShortcut(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
  });
});
