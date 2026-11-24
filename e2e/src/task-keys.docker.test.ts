// The task key journey on 2 awd containers (e2e/compose.yaml; openspec offline-task-keys): each
// device creates a task while the sync is paused, so both tasks get the same key. After the sync
// comes back, the device of the duplicate writes task.rekeyed once, and both devices show 2
// different keys (docs/architecture.md 4.3.3). Run it with "task e2e". Each step writes one
// "EVIDENCE {json}" line to stdout.
import type { SyncStatusReply, Task, ThreadReply } from "@aw/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aw,
  awJson,
  compose,
  copyBetween,
  exec,
  waitFor,
  WORKSPACE,
  type Device,
} from "./compose.ts";

const A: Device = "macbook-pro";
const B: Device = "ubuntu-01";
const PROJECT_SLUG = "demo-api";

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

const status = (device: Device) => awJson<SyncStatusReply>(device, ["sync", "status"]);
const tasks = (device: Device) => awJson<Task[]>(device, ["task", "list"]);

/** The `task.rekeyed` rows of the threads of each task that a device knows. */
async function rekeys(device: Device): Promise<ThreadReply["events"]> {
  const rows: ThreadReply["events"] = [];
  for (const task of await tasks(device)) {
    const thread = await awJson<ThreadReply>(device, ["thread", task.id, "--limit", "1000"]);
    rows.push(...thread.events.filter((row) => row.type === "task.rekeyed"));
  }
  return rows;
}

/** The keys of the tasks of a device, sorted, with the key state. */
async function keys(device: Device): Promise<string[]> {
  return (await tasks(device)).map((t) => `${t.key ?? "-"} ${t.key_state}`).sort();
}

beforeAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
  const up = await compose(["up", "-d", "--build"]);
  if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr}`);
  for (const device of [A, B]) {
    await waitFor(
      async () => (await status(device)).engine === "running",
      60_000,
      `engine on ${device}`,
    );
  }
}, 600_000);

afterAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
});

describe("task keys of 2 devices that were offline", () => {
  let created: { device: Device; task: Task }[] = [];

  it("1. pairs the 2 devices, and both know the project", async () => {
    expect((await aw(A, ["workspace", "init", WORKSPACE, "--name", "demo"])).code).toBe(0);
    expect((await aw(A, ["project", "add", PROJECT_SLUG])).code).toBe(0);
    await exec(B, ["mkdir", "-p", `${WORKSPACE}/tasks`]);
    await copyBetween(A, B, WORKSPACE, ["tasks/workspace.yaml", "tasks/schemas"]);
    expect((await aw(B, ["workspace", "init", WORKSPACE])).code).toBe(0);
    const [idA, idB] = [(await status(A)).sync_id!, (await status(B)).sync_id!];
    const peer = (device: Device, id: string, name: Device, role: string) =>
      aw(device, [
        "sync",
        "peer",
        "add",
        id,
        `tcp://${name}:22300`,
        "--name",
        name,
        "--role",
        role,
      ]);
    expect((await peer(A, idB, B, "remote")).code).toBe(0);
    expect((await peer(B, idA, A, "local")).code).toBe(0);
    await waitFor(async () => (await status(A)).peers[0]?.connected, 30_000, "A connected to B");
    await waitFor(
      async () =>
        (await awJson<{ slug: string }[]>(B, ["project", "list"])).some(
          (p) => p.slug === PROJECT_SLUG,
        ),
      30_000,
      "the project on B",
    );
  }, 120_000);

  it("2. offline, each device creates a task with the same key", async () => {
    expect((await aw(A, ["sync", "pause"])).code).toBe(0);
    expect((await aw(B, ["sync", "pause"])).code).toBe(0);
    created = [];
    for (const device of [A, B]) {
      const reply = await awJson<{ task: Task }>(device, [
        "task",
        "create",
        "--project",
        PROJECT_SLUG,
        "--title",
        `Task from ${device}`,
        "--first-message",
        `Created on ${device} while the sync was paused.`,
      ]);
      created.push({ device, task: reply.task });
    }
    const listA = await aw(A, ["task", "list"]);
    const listB = await aw(B, ["task", "list"]);
    evidence("before-sync", {
      keys: created.map((c) => `${c.device}: ${c.task.key} ${c.task.id}`),
      list_a: listA.stdout.trim(),
      list_b: listB.stdout.trim(),
    });
    expect(created[0]!.task.key).toBe(created[1]!.task.key);
  }, 60_000);

  it("3. after the sync, one device rekeys its task, and both show 2 different keys", async () => {
    const key = created[0]!.task.key!;
    const number = Number(key.split("-").pop());
    const next = key.replace(/\d+$/, String(number + 1));
    expect((await aw(A, ["sync", "resume"])).code).toBe(0);
    expect((await aw(B, ["sync", "resume"])).code).toBe(0);
    const resumed = Date.now();
    const expected = [`${key} ok`, `${next} ok`];
    try {
      for (const device of [A, B]) {
        await waitFor(
          async () => JSON.stringify(await keys(device)) === JSON.stringify(expected),
          60_000,
          `2 different keys on ${device}`,
        );
      }
    } catch (error) {
      // Keep the state of both devices: on the base code the duplicate stays.
      evidence("after-sync-timeout", {
        list_a: (await aw(A, ["task", "list"])).stdout.trim(),
        list_b: (await aw(B, ["task", "list"])).stdout.trim(),
        show_a: (await aw(A, ["task", "show", key])).stderr.trim(),
        rekeys: (await rekeys(A)).length,
      });
      throw error;
    }
    const settledMs = Date.now() - resumed;
    const rowsA = await rekeys(A);
    const rowsB = await rekeys(B);
    const thread = await aw(A, ["thread", created[1]!.task.id]);
    const listA = await aw(A, ["task", "list"]);
    const listB = await aw(B, ["task", "list"]);
    evidence("after-sync", {
      settled_ms: settledMs,
      list_a: listA.stdout.trim(),
      list_b: listB.stdout.trim(),
      rekeys_a: rowsA.map((r) => `${r.dev} ${r.event.by} ${JSON.stringify(r.event.data)}`),
      rekeys_b: rowsB.map((r) => `${r.dev} ${r.event.by} ${JSON.stringify(r.event.data)}`),
      thread_on_a: thread.stdout.trim(),
    });
    // The task of B (no device_order entry) is the duplicate: B rekeys it, A keeps the key.
    for (const rows of [rowsA, rowsB]) {
      expect(rows.map((r) => [r.task, r.dev, r.event.by, r.applied, r.event.data])).toEqual([
        [created[1]!.task.id, B, `aw@${B}`, true, { from: key, to: next }],
      ]);
    }
    expect(thread.stdout).toContain(`${key} is now ${next}`);
    // aw commands by key are not ambiguous on either device.
    for (const device of [A, B]) {
      const byOld = await awJson<Task>(device, ["task", "show", key]);
      const byNew = await awJson<Task>(device, ["task", "show", next]);
      expect([byOld.id, byNew.id]).toEqual([created[0]!.task.id, created[1]!.task.id]);
    }
  }, 120_000);

  it("4. after a restart of awd on B, B writes no second rekey", async () => {
    expect((await compose(["restart", B])).code).toBe(0);
    await waitFor(async () => (await status(B)).engine === "running", 60_000, "engine on B");
    // The open of the workspace merges all logs again: the duplicate is gone, so no rekey.
    await waitFor(async () => (await tasks(B)).length === 2, 60_000, "the tasks on B");
    // The peer state after the restart, for the record (the test peers of AW_SYNC_TEST_PEERS).
    const connected = await waitFor(
      async () => (await status(B)).peers.some((p) => p.connected),
      60_000,
      "B connected again",
    ).catch(() => false);
    const rowsB = await rekeys(B);
    const rowsA = await rekeys(A);
    evidence("after-restart", {
      peer_connected_again: connected,
      rekeys_a: rowsA.map((r) => `${r.dev} ${JSON.stringify(r.event.data)}`),
      rekeys_b: rowsB.map((r) => `${r.dev} ${JSON.stringify(r.event.data)}`),
      keys_a: await keys(A),
      keys_b: await keys(B),
    });
    expect(rowsB).toHaveLength(1);
    expect(rowsA).toHaveLength(1);
    expect(await keys(B)).toEqual(await keys(A));
  }, 300_000);
});
