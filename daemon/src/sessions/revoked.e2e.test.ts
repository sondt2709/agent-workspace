// A revoked device stops its sessions and claims nothing (docs/phase-1.md 9.6.8, openspec
// revoke-device): awd, a real tmux on a private socket and the fake agent. The revoke record of
// this device arrives as a synced file signed with the master key.
import { masterFromPhrase, newDeviceKey, signRecord } from "@aw/identity";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { tempDir } from "../testing.ts";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

const SYNC_ID = "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

/** Writes the revoke record of this device (macbook-pro), signed with the master key. */
async function writeOwnRevoke(daemon: SessionTestDaemon, folder: string): Promise<void> {
  const master = masterFromPhrase(await daemon.server.daemon.identity.phrase());
  const key = await newDeviceKey();
  const record = signRecord(
    {
      kind: "device",
      schema: 1,
      slug: "macbook-pro",
      name: "MacBook Pro",
      role: "local",
      keys: { ed25519: key.ed25519, x25519: key.x25519 },
      sync_device_id: SYNC_ID,
      seq: 5,
      revoked: true,
      revoked_at: `${new Date().toISOString()}#0000`,
      addresses: [],
      paired_at: "2026-11-23T08:00:00.000Z",
    },
    master.secret,
  );
  const dir = join(folder, "tasks", "devices", "macbook-pro");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "device.yaml"), stringify(record));
}

const data = (row: { event: unknown }) => (row.event as { data: Record<string, unknown> }).data;

describe.skipIf(!TEST_TMUX)("sessions on a revoked device", () => {
  it("stops the running session and starts no new one after its own revoke", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("ask Which limit per client? | 100/min|1000/min");
    await awd.waitRow(task.id, (r) => r.type === "gate.opened" && data(r).kind === "question");
    const session = awd.session(task.id);
    const state = () => awd!.server.daemon.sessions!.list().find((r) => r.id === session)?.state;
    expect(state()).toBe("running");

    await writeOwnRevoke(awd, awd.folder);
    await awd.server.daemon.workspace().refresh();

    await waitFor(() => Promise.resolve(state() === "stopped"), 20_000);
    // The window of the session is gone.
    expect((await awd.host.list()).some((p) => p.name === `aw-${task.id}`)).toBe(false);
    // No resume and no new claim of the task: the checks run every 500 ms, so wait 3 s.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(state()).toBe("stopped");
    expect(awd.server.daemon.sessions!.list().filter((r) => r.state === "running")).toEqual([]);
    const claims = (await awd.rows(task.id)).filter((r) => r.type === "task.claimed");
    expect(claims).toHaveLength(1);
  }, 60_000);

  it("stops the sessions of each workspace when another workspace revoked this device", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("ask Which limit per client? | 100/min|1000/min");
    await awd.waitRow(task.id, (r) => r.type === "gate.opened" && data(r).kind === "question");
    const session = awd.session(task.id);
    const state = () => awd!.server.daemon.sessions!.list().find((r) => r.id === session)?.state;
    expect(state()).toBe("running");
    // A second workspace of this device revokes it. The first workspace still has a valid record.
    const folder = await tempDir("aw-side-");
    await awd.client.initWorkspace({ path: folder, name: "side" });
    await writeOwnRevoke(awd, folder);
    await awd.server.daemon.workspace("side").refresh();
    await waitFor(() => Promise.resolve(state() === "stopped"), 20_000);
    expect((await awd.host.list()).some((p) => p.name === `aw-${task.id}`)).toBe(false);
  }, 60_000);
});
