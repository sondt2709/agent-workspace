// The background load of the main process with the presence (openspec revoke-device): a task of a
// revoked device gets the shown pause, so the notifications and the Tray count see it.
import type { AwClient } from "@aw/client";
import { describe, expect, it } from "vitest";
import type { Task } from "../shared/channels.ts";
import { loadBackground } from "./background-load.ts";
import { taskNotifications } from "./notifications.ts";
import { countNeedsYou } from "./tray.ts";

const task = {
  id: "t1",
  key: "AW-1",
  title: "Rate limit",
  stage: "implement",
  archived: false,
  gates: [],
  paused: null,
  needs_you_lane: false,
  needs_you_reasons: [],
} as unknown as Task;

function client(options: { w2Ready?: boolean; w2Tasks?: () => Promise<Task[]> } = {}): AwClient {
  const replies: Record<string, unknown> = {
    "/v1/workspaces/w1/presence": {
      now: "2026-11-23T10:00:00.000Z",
      devices: [],
      offline_tasks: [
        {
          task: "t1",
          device: "ubuntu-01",
          cause: "device_revoked",
          since: "2026-11-23T09:00:00.000Z",
        },
      ],
    },
    "/v1/workspaces/w1/devices": [],
    "/v1/workspaces/w2/presence": {
      now: "2026-11-23T10:00:00.000Z",
      devices: [],
      offline_tasks: [],
    },
    "/v1/workspaces/w2/devices": [],
    "/v1/workspaces/w2/queues": { device: "macbook-pro", agents: [], unassigned: [] },
    "/v1/workspaces/w1/queues": {
      device: "macbook-pro",
      agents: [],
      unassigned: [
        {
          task: "t2",
          key: "AW-2",
          title: "Subtask",
          created_by: "claude@ubuntu-01",
          by_agent: true,
        },
      ],
    },
  };
  return {
    workspaces: () =>
      Promise.resolve([
        { id: "w1", ready: true },
        { id: "w2", ready: options.w2Ready ?? false },
      ]),
    tasks: (ws: string) =>
      ws === "w1" ? Promise.resolve([task]) : (options.w2Tasks?.() ?? Promise.resolve([])),
    syncStatus: () => Promise.reject(new Error("no engine")),
    request: (_method: string, path: string) => Promise.resolve(replies[path]),
  } as unknown as AwClient;
}

describe("loadBackground", () => {
  it("merges the revoked pause into the tasks of each ready workspace", async () => {
    const { lists, unsynced, complete } = await loadBackground(client());
    expect(lists.map((l) => l.ws)).toEqual(["w1"]);
    expect(complete).toBe(false);
    expect(unsynced).toBeNull();
    // The tasks with no assignee of the queues route, for "Assign task" (queue-and-assign).
    expect(lists[0]!.unassigned.map((u) => u.key)).toEqual(["AW-2"]);
    const [shown] = lists[0]!.tasks;
    expect(countNeedsYou(lists)).toBe(1);
    expect(taskNotifications("w1", shown!).map((s) => s.title)).toEqual([
      "AW-1 · Paused: ubuntu-01 was revoked",
    ]);
  });

  it("keeps the last tasks of a workspace that is not ready or fails one load (fix list 0-12)", async () => {
    const w2Task = { ...task, id: "t9", key: "AW-9" } as Task;
    const first = await loadBackground(
      client({ w2Ready: true, w2Tasks: () => Promise.resolve([w2Task]) }),
    );
    expect(first.complete).toBe(true);
    expect(first.lists.map((l) => [l.ws, l.tasks.map((t) => t.key)])).toEqual([
      ["w1", ["AW-1"]],
      ["w2", ["AW-9"]],
    ]);
    const notReady = await loadBackground(client({ w2Ready: false }), first);
    expect(notReady.complete).toBe(false);
    expect(notReady.lists.map((l) => [l.ws, l.tasks.map((t) => t.key)])).toEqual([
      ["w1", ["AW-1"]],
      ["w2", ["AW-9"]],
    ]);
    const failed = await loadBackground(
      client({ w2Ready: true, w2Tasks: () => Promise.reject(new Error("not_ready")) }),
      notReady,
    );
    expect(failed.complete).toBe(false);
    expect(failed.lists.map((l) => l.ws)).toEqual(["w1", "w2"]);
    expect(failed.lists[1]!.tasks).toBe(first.lists[1]!.tasks);
  });
});
