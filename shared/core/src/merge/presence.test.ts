// The presence rows of a revoked device (openspec revoke-device): each task of a device with a
// revoked record waits for a person to change the assignee.
import { describe, expect, it } from "vitest";
import { presenceOf, type Receipt } from "./presence.ts";
import type { DeviceView, TaskView } from "./view.ts";

const NOW = Date.parse("2026-11-22T14:30:00.000Z");
const REVOKED_AT = "2026-11-22T14:20:00.000Z#0003";

function device(slug: string, revoked = false): DeviceView {
  return {
    slug,
    name: null,
    role: "remote",
    revoked,
    priority: 0,
    may_run: null,
    resources: {},
    health: null,
    heartbeat: null,
  };
}

function task(id: string, fields: Partial<TaskView>): TaskView {
  return {
    id,
    stage: "implement",
    archived: false,
    paused: null,
    assignee: "claude@ubuntu-01",
    owner: "ubuntu-01",
    claim: { epoch: 1, device: "ubuntu-01", session: "s1", event: "e1" },
    ...fields,
  } as TaskView;
}

const receipts = new Map<string, Receipt>([
  ["ubuntu-01", { hlc: "2026-11-22T14:19:00.000Z#0000", receivedAt: NOW - 600_000 }],
  ["macbook-pro", { hlc: "2026-11-22T14:29:50.000Z#0000", receivedAt: NOW - 10_000 }],
]);
const revokedAt = (slug: string) => (slug === "ubuntu-01" ? REVOKED_AT : undefined);
const devices = [device("macbook-pro"), device("ubuntu-01", true)];

describe("presence of a revoked device", () => {
  it("lists each open task of the revoked device with device_revoked and the revoke time", () => {
    const tasks = [
      task("t1", {}),
      // A queued task assigned to the revoked device: it can never start there.
      task("t2", { claim: null, owner: "macbook-pro", stage: "ready" }),
      // Its own pause does not end: the revoked device writes no task.resumed.
      task("t3", {
        paused: {
          cause: "usage_limit",
          since: "2026-11-22T14:00:00.000Z",
          resumes_at: null,
          next_step: "x",
          needs_human: false,
        },
      }),
      task("t4", { stage: "done" }),
      task("t5", { archived: true }),
      // The person moved it: the assignee is on another device.
      task("t6", { assignee: "claude@macbook-pro", moving_to: "macbook-pro" }),
      task("t7", { assignee: "claude@macbook-pro", owner: "macbook-pro", claim: null }),
    ];
    const presence = presenceOf({ devices, tasks }, receipts, NOW, revokedAt);
    expect(presence.offline_tasks).toEqual([
      {
        task: "t1",
        device: "ubuntu-01",
        cause: "device_revoked",
        since: "2026-11-22T14:20:00.000Z",
      },
      {
        task: "t2",
        device: "ubuntu-01",
        cause: "device_revoked",
        since: "2026-11-22T14:20:00.000Z",
      },
      {
        task: "t3",
        device: "ubuntu-01",
        cause: "device_revoked",
        since: "2026-11-22T14:20:00.000Z",
      },
    ]);
  });

  it("gives the revoked row instead of the offline row", () => {
    const presence = presenceOf({ devices, tasks: [task("t1", {})] }, receipts, NOW, revokedAt);
    expect(presence.offline_tasks.map((r) => r.cause)).toEqual(["device_revoked"]);
  });

  it("uses the local time when the revoke time is not known", () => {
    const presence = presenceOf({ devices, tasks: [task("t1", {})] }, receipts, NOW);
    expect(presence.offline_tasks[0]).toMatchObject({
      cause: "device_revoked",
      since: "2026-11-22T14:30:00.000Z",
    });
  });

  it("keeps device_offline for a device that is only offline", () => {
    const presence = presenceOf(
      { devices: [device("macbook-pro"), device("ubuntu-01")], tasks: [task("t1", {})] },
      receipts,
      NOW,
      revokedAt,
    );
    expect(presence.offline_tasks).toEqual([
      {
        task: "t1",
        device: "ubuntu-01",
        cause: "device_offline",
        since: "2026-11-22T14:21:30.000Z",
      },
    ]);
  });
});
