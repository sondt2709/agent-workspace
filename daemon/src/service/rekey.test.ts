// The rekey writer of awd (openspec offline-task-keys): the device of a duplicate task key writes
// task.rekeyed once, with the next free key. The other device writes its log lines with the real
// files API in the same folder, as its awd does after a sync.
import type { EventRow, Task } from "@aw/client";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { otherDevice, startTestDaemon, type TestDaemon } from "../testing.ts";

let d: TestDaemon | undefined;
afterEach(async () => {
  await d?.close();
  d = undefined;
});

/** Writes `task.created` with a key on another device, as its awd does when it is offline. */
async function createOn(daemon: TestDaemon, device: string, key: string): Promise<string> {
  const other = otherDevice(daemon.folder, device);
  const task = other.newId();
  await other.writeEvent(
    `tasks/${task}/log/${device}.jsonl`,
    "task.created",
    { key, project: "billing-api", title: `From ${device}`, first_message: "hi" },
    { task, by: `human@${device}` },
  );
  return task;
}

async function keys(daemon: TestDaemon): Promise<string[]> {
  return (await daemon.client.tasks("-")).map((t: Task) => `${t.key} ${t.key_state}`).sort();
}

/** The task.rekeyed rows of all tasks. */
async function rekeys(daemon: TestDaemon): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  for (const task of await daemon.client.tasks("-")) {
    const thread = await daemon.client.thread("-", task.id, { limit: 1000 });
    rows.push(...thread.events.filter((r) => r.type === "task.rekeyed"));
  }
  return rows;
}

const refresh = (daemon: TestDaemon) => daemon.server.daemon.workspace().refresh();

/**
 * A test daemon on ubuntu-01 in a workspace that macbook-pro made: `device_order` lists macbook-pro
 * first, so a task of ubuntu-01 is the duplicate (docs/architecture.md 4.3.3 item 2).
 */
async function lowerPriorityDaemon(): Promise<TestDaemon> {
  const daemon = await startTestDaemon({ workspace: true, device: "ubuntu-01" });
  const path = join(daemon.folder, "tasks", "workspace.yaml");
  const doc = parse(await readFile(path, "utf8")) as { device_order: string[] };
  doc.device_order = ["macbook-pro", "ubuntu-01"];
  await writeFile(path, stringify(doc));
  await refresh(daemon);
  return daemon;
}

describe("rekey writer", () => {
  it("the device of the duplicate writes 1 task.rekeyed with the next free key", async () => {
    d = await lowerPriorityDaemon();
    const own = (
      await d.client.createTask("-", { project: "billing-api", title: "Own", first_message: "x" })
    ).task;
    const other = await createOn(d, "macbook-pro", own.key!);
    // The refresh returns the view after the rekey (offline-task-keys review low 6).
    const update = await refresh(d);
    expect(update?.view.tasks.find((t) => t.id === own.id)).toMatchObject({
      key: "AW-2",
      key_state: "ok",
    });
    expect(await keys(d)).toEqual(["AW-1 ok", "AW-2 ok"]);
    const rows = await rekeys(d);
    expect(rows.map((r) => [r.task, r.dev, r.event.by, r.applied, r.event.data])).toEqual([
      [own.id, "ubuntu-01", "aw@ubuntu-01", true, { from: "AW-1", to: "AW-2" }],
    ]);
    expect((await d.client.task("-", "AW-1")).id).toBe(other);
    expect((await d.client.task("-", "AW-2")).id).toBe(own.id);
    // The thread of aw shows the old and the new key.
    const thread = await d.aw(["thread", own.id]);
    expect(thread.stdout).toContain("task.rekeyed\n  AW-1 is now AW-2");
  });

  it("the device that keeps the key writes nothing", async () => {
    d = await startTestDaemon({ workspace: true, device: "macbook-pro" });
    const own = (
      await d.client.createTask("-", { project: "billing-api", title: "Own", first_message: "x" })
    ).task;
    await createOn(d, "ubuntu-01", own.key!);
    await refresh(d);
    expect(await keys(d)).toEqual(["AW-1 duplicate", "AW-1 ok"]);
    expect(await rekeys(d)).toEqual([]);
  });

  it("writes no second rekey after a restart or a second merge", async () => {
    d = await lowerPriorityDaemon();
    const own = (
      await d.client.createTask("-", { project: "billing-api", title: "Own", first_message: "x" })
    ).task;
    await createOn(d, "macbook-pro", own.key!);
    await refresh(d);
    await refresh(d);
    await d.restart();
    await refresh(d);
    const log = await readFile(join(d.folder, "tasks", own.id, "log", "ubuntu-01.jsonl"), "utf8");
    expect(log.split("\n").filter((line) => line.includes('"task.rekeyed"'))).toHaveLength(1);
    expect(await keys(d)).toEqual(["AW-1 ok", "AW-2 ok"]);
  });

  it("rekeys a duplicate that is on disk before the start, at the open", async () => {
    d = await lowerPriorityDaemon();
    const own = (
      await d.client.createTask("-", { project: "billing-api", title: "Own", first_message: "x" })
    ).task;
    // No file watcher in this test daemon: awd merges the new log at the open after the restart.
    await createOn(d, "macbook-pro", own.key!);
    await d.restart();
    expect(await keys(d)).toEqual(["AW-1 ok", "AW-2 ok"]);
    expect((await rekeys(d)).map((r) => r.event.data)).toEqual([{ from: "AW-1", to: "AW-2" }]);
  });

  it("gives 2 own duplicates 2 different keys", async () => {
    d = await lowerPriorityDaemon();
    for (const title of ["One", "Two"]) {
      await d.client.createTask("-", { project: "billing-api", title, first_message: "x" });
    }
    await createOn(d, "macbook-pro", "AW-1");
    await createOn(d, "macbook-pro", "AW-2");
    await refresh(d);
    expect(await keys(d)).toEqual(["AW-1 ok", "AW-2 ok", "AW-3 ok", "AW-4 ok"]);
    expect((await rekeys(d)).map((r) => r.event.data)).toEqual(
      expect.arrayContaining([
        { from: "AW-1", to: "AW-3" },
        { from: "AW-2", to: "AW-4" },
      ]),
    );
  });

  it("writes nothing for a task with a rekey of this device from the current key in its log", async () => {
    d = await lowerPriorityDaemon();
    const own = (
      await d.client.createTask("-", { project: "billing-api", title: "Own", first_message: "x" })
    ).task;
    // A rekey of ubuntu-01 from AW-1 that the merge refused (not_creator): its HLC is 1 s before
    // task.created. awd does not merge the file before the restart (no file watcher here).
    const path = join(d.folder, "tasks", own.id, "log", "ubuntu-01.jsonl");
    const text = await readFile(path, "utf8");
    const created = JSON.parse(text) as { hlc: string; id: string };
    const time = new Date(Date.parse(created.hlc.slice(0, 24)) - 1000).toISOString();
    const rekey = {
      v: 1,
      id: created.id.replace(/.$/, (c) => (c === "0" ? "1" : "0")),
      hlc: `${time}#0000`,
      dev: "ubuntu-01",
      type: "task.rekeyed",
      task: own.id,
      by: "aw@ubuntu-01",
      data: { from: "AW-1", to: "AW-5" },
    };
    await writeFile(path, `${JSON.stringify(rekey)}\n${text}`);
    await createOn(d, "macbook-pro", "AW-1");
    await d.restart();
    const rows = await rekeys(d);
    expect(rows.map((r) => [r.applied, r.event.data])).toEqual([
      [false, { from: "AW-1", to: "AW-5" }],
    ]);
    expect(await keys(d)).toEqual(["AW-1 duplicate", "AW-1 ok"]);
  });
});
