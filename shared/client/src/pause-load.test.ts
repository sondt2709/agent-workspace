// The loader of the shown pause for the CLI and the desktop main process (openspec revoke-device).
import { describe, expect, it } from "vitest";
import type { AwClient } from "./index.ts";
import { tasksWithPresence } from "./pause-load.ts";

function client(replies: Record<string, unknown>, asked: string[] = []): AwClient {
  return {
    request: (_method: string, path: string) => {
      asked.push(path);
      return path in replies
        ? Promise.resolve(replies[path])
        : Promise.reject(new Error(`no reply for ${path}`));
    },
  } as unknown as AwClient;
}

const presence = (rows: unknown[]) => ({
  now: "2026-11-23T10:00:00.000Z",
  devices: [],
  offline_tasks: rows,
});
const device = (slug: string, name: string, state = "valid") => ({
  slug,
  name,
  role: "remote",
  state,
  sync_device_id: "X",
  seq: 2,
  paired_at: "2026-11-23T08:00:00.000Z",
  revoked_at: null,
  this_device: false,
});

describe("tasksWithPresence", () => {
  const tasks = [{ id: "t1", paused: null, needs_you_lane: false, needs_you_reasons: [] }];

  it("merges a revoked row with the device name of the records", async () => {
    const replies = {
      "/v1/workspaces/w/presence": presence([
        {
          task: "t1",
          device: "ubuntu-01",
          cause: "device_revoked",
          since: "2026-11-23T09:00:00.000Z",
        },
      ]),
      "/v1/workspaces/w/devices": [device("ubuntu-01", "Ubuntu server", "revoked")],
    };
    const [t1] = await tasksWithPresence(client(replies), "w", tasks);
    expect(t1!.paused).toMatchObject({ cause: "device_revoked", device_name: "Ubuntu server" });
    expect(t1!.needs_you_lane).toBe(true);
  });

  it("reads no device list when the presence has no row, and keeps the tasks on an error", async () => {
    const asked: string[] = [];
    const none = client({ "/v1/workspaces/w/presence": presence([]) }, asked);
    expect(await tasksWithPresence(none, "w", tasks)).toBe(tasks);
    expect(asked).toEqual(["/v1/workspaces/w/presence"]);
    expect(await tasksWithPresence(client({}), "w", tasks)).toBe(tasks);
  });

  it("uses no name of a record with a bad signature", async () => {
    const replies = {
      "/v1/workspaces/w/presence": presence([
        { task: "t1", device: "ubuntu-01", cause: "device_revoked", since: "x" },
      ]),
      "/v1/workspaces/w/devices": [device("ubuntu-01", "Forged", "bad_signature")],
    };
    const [t1] = await tasksWithPresence(client(replies), "w", tasks);
    expect(t1!.paused).toMatchObject({ device_name: "ubuntu-01" });
  });
});
