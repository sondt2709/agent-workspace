// 2 real pinned engines in one process (openspec add-syncthing-sync: sync-engine, sync-transport,
// sync-conflicts). macbook-pro is the local device, ubuntu-01 the remote device.
import { MergeEngine, systemClock } from "@aw/core";
import { newId } from "@aw/schema";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareEngineHome, readConfigText } from "./config.ts";
import { shortId } from "./peers.ts";
import { EngineRest } from "./rest.ts";
import { ensureTestEngine, testNode, waitFor, type TestNode } from "./testing.ts";

const WS = "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c01";
let binary: string;
let a: TestNode;
let b: TestNode;

async function conflictCopies(node: TestNode): Promise<string[]> {
  const entries = await readdir(node.root, { recursive: true });
  return entries.filter((name) => name.includes(".sync-conflict-"));
}

async function text(node: TestNode, path: string): Promise<string | null> {
  return readFile(join(node.root, ...path.split("/")), "utf8").catch(() => null);
}

function peerOf(node: TestNode) {
  return {
    device: node.slug,
    sync_id: node.transport.syncId!,
    role: node.role,
    addresses: [`tcp://127.0.0.1:${node.port}`],
  };
}

beforeAll(async () => {
  binary = await ensureTestEngine();
  const order = ["ubuntu-01"];
  a = await testNode({
    binary,
    slug: "macbook-pro",
    role: "local",
    workspace: WS,
    deviceOrder: order,
  });
  b = await testNode({
    binary,
    slug: "ubuntu-01",
    role: "remote",
    workspace: WS,
    deviceOrder: order,
  });
  await Promise.all([a.transport.start(), b.transport.start()]);
  await a.transport.addWorkspace(WS, a.root);
  await b.transport.addWorkspace(WS, b.root);
}, 120_000);

afterAll(async () => {
  // 2 connected engines that stop at the same time can take the 10 s stop grace.
  await Promise.all([a?.close(), b?.close()]);
}, 30_000);

describe("pairing by REST only", () => {
  it("connects with the pairing reconnect interval, then goes back to 60 s", async () => {
    await a.transport.addPeer(peerOf(b));
    expect(await a.transport.reconnectInterval()).toBe(5);
    await b.transport.addPeer(peerOf(a));
    await waitFor(async () => (await a.transport.status())[0]?.connected, 30_000);
    await waitFor(async () => (await a.transport.reconnectInterval()) === 60, 20_000);
    const [peer] = await a.transport.status();
    expect(peer).toMatchObject({
      device: "ubuntu-01",
      connected: true,
      route: "lan",
      role: "remote",
    });
    expect(peer!.folders!.map((f) => f.kind).sort()).toEqual(["knowledge", "secure", "tasks"]);
  }, 60_000);

  it("syncs a task event and scans the written path", async () => {
    // The watcher of the tasks folder of A is off: only the targeted scan finds the write.
    const config = readConfigText(await readFile(join(a.home, "sync", "config.xml"), "utf8"));
    const rest = new EngineRest({ socket: config.socket!, apiKey: config.apiKey! });
    const tasksFolder = `aw-${WS}-tasks`;
    await rest.putFolder({ ...(await rest.folder(tasksFolder))!, fsWatcherEnabled: false });
    const task = newId(systemClock);
    const log = `tasks/${task}/log/macbook-pro.jsonl`;
    await a.files.writeEvent(
      log,
      "comment.added",
      { text: "hello" },
      { task, by: "human@macbook-pro" },
    );
    await waitFor(() =>
      a.log.entries.find(
        (e) =>
          e.msg === "Targeted scan" &&
          (e.obj as { sub?: string }).sub === `${task}/log/macbook-pro.jsonl`,
      ),
    );
    await waitFor(async () => (await text(b, log))?.includes("hello"), 20_000);
    await rest.putFolder({ ...(await rest.folder(tasksFolder))!, fsWatcherEnabled: true });
  }, 30_000);

  it("waits until the peer has the newest version of a file (openspec revoke-device)", async () => {
    // Only a device with the master key writes a record through AW: write the file as the engine
    // sees a synced file.
    const path = "tasks/devices/ubuntu-01/device.yaml";
    const file = join(a.root, ...path.split("/"));
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, "seq: 1\n");
    expect(await a.transport.waitDelivered("ubuntu-01", WS, path, 20_000)).toBe(true);
    expect(await text(b, path)).toBe("seq: 1\n");
    // A new version: the peer has it when the wait ends, with no other sync step.
    await writeFile(file, "seq: 2\nrevoked: true\n");
    expect(await a.transport.waitDelivered("ubuntu-01", WS, path, 20_000)).toBe(true);
    expect(await text(b, path)).toBe("seq: 2\nrevoked: true\n");
    // By the engine device id too: one sync id can have another slug in another workspace
    // (revoke-device review low 3).
    await writeFile(file, "seq: 3\nrevoked: true\n");
    expect(await a.transport.waitDelivered(b.transport.syncId!, WS, path, 20_000)).toBe(true);
    // No such peer, or a path outside the folders: false at once.
    expect(await a.transport.waitDelivered("mac-mini-lab", WS, path, 20_000)).toBe(false);
    expect(await a.transport.waitDelivered("ubuntu-01", WS, "other/x", 20_000)).toBe(false);
  }, 60_000);
});

describe("per-device logs written at the same time", () => {
  it("syncs 300 lines of each device with 0 conflict copies and the same merge", async () => {
    const task = newId(systemClock);
    const write = async (node: TestNode) => {
      const log = `tasks/${task}/log/${node.slug}.jsonl`;
      for (let i = 0; i < 300; i += 1) {
        await node.files.writeEvent(log, "comment.added", { text: `${node.slug} ${i}` }, { task });
      }
    };
    await Promise.all([write(a), write(b)]);
    for (const node of [a, b]) {
      await waitFor(async () => {
        const lines = await Promise.all(
          ["macbook-pro", "ubuntu-01"].map(
            async (d) =>
              ((await text(node, `tasks/${task}/log/${d}.jsonl`)) ?? "").split("\n").filter(Boolean)
                .length,
          ),
        );
        return lines.every((n) => n === 300);
      }, 60_000);
    }
    expect(await conflictCopies(a)).toEqual([]);
    expect(await conflictCopies(b)).toEqual([]);
    const views = await Promise.all(
      [a, b].map(async (node) => {
        const engine = new MergeEngine({ root: node.root, clock: systemClock });
        await engine.update();
        const view = engine.view!.tasks.find((t) => t.id === task);
        return JSON.stringify(view);
      }),
    );
    expect(views[0]).toBe(views[1]);
  }, 120_000);
});

describe("Sync now", () => {
  it("returns no pending peer after 1 and after 200 changed files", async () => {
    await a.files.writeFile("knowledge/shared/one.md", "one\n");
    const first = await a.transport.syncNow({ timeoutMs: 20_000 });
    expect(first.pending).toEqual([]);
    expect(await text(b, "knowledge/shared/one.md")).toBe("one\n");
    for (let i = 0; i < 200; i += 1)
      await a.files.writeFile(`knowledge/shared/bulk/f${i}.md`, `${i}\n`);
    const started = Date.now();
    const second = await a.transport.syncNow({ timeoutMs: 20_000 });
    expect(second.pending).toEqual([]);
    expect((await readdir(join(b.root, "knowledge", "shared", "bulk"))).length).toBe(200);
    expect(Date.now() - started).toBeLessThan(20_000);
    const [peer] = await a.transport.status();
    expect(peer).toMatchObject({ inSync: true, needItems: 0 });
    // "Synced 12 s ago" counts from the sync. A later poll gives the same time, or the time of a
    // later FolderCompletion of the engine, never a time after the poll (kb-4: a FolderCompletion
    // can come between 2 polls; the rule that a poll never moves the time is in units.test.ts).
    expect(peer!.lastSynced).toBeDefined();
    const after = (await a.transport.status())[0]!.lastSynced!;
    expect(Date.parse(after)).toBeGreaterThanOrEqual(Date.parse(peer!.lastSynced!));
    expect(Date.parse(after)).toBeLessThanOrEqual(Date.now());
  }, 60_000);
});

describe("conflict copies", () => {
  async function editBoth(first: TestNode, second: TestNode, path: string): Promise<void> {
    await a.transport.pause();
    await b.transport.pause();
    await waitFor(async () => !(await a.transport.status())[0]?.connected, 15_000);
    await first.files.writeFile(path, `${first.slug} edit\n`);
    // The second edit must be newer by the file time: wait until the clock passes the first one.
    const firstTime = (await stat(join(first.root, ...path.split("/")))).mtimeMs;
    await waitFor(() => Date.now() >= firstTime + 1100, 5000, 50);
    await second.files.writeFile(path, `${second.slug} edit\n`);
    await first.transport.scansIdle();
    await second.transport.scansIdle();
    await a.transport.resume();
    await b.transport.resume();
  }

  for (const order of ["remote edit newer", "local edit newer"] as const) {
    it(`keeps the local version with no copy left (${order})`, async () => {
      const path = `knowledge/shared/${order.replaceAll(" ", "-")}.md`;
      await a.files.writeFile(path, "base\n");
      await waitFor(async () => (await text(b, path)) === "base\n", 20_000);
      if (order === "remote edit newer") await editBoth(a, b, path);
      else await editBoth(b, a, path);
      for (const node of [a, b]) {
        await waitFor(async () => {
          const copies = (await conflictCopies(node)).filter((c) => c.includes("knowledge"));
          return copies.length === 0 && (await text(node, path)) === "macbook-pro edit\n";
        }, 45_000);
      }
      const handledOn = (node: TestNode) =>
        node.log.entries
          .filter(
            (e) =>
              e.msg === "Conflict copy handled" &&
              (e.obj as { original?: string }).original === path,
          )
          .map((e) => (e.obj as { action: string }).action);
      // With the local edit newer, the file state of macbook-pro is final at once: the copy of the
      // older version can reach it later (kb-4). Wait for its resolver, or for 3 s with no copy on
      // any device and no copy seen by ubuntu-01 (then the engine made no copy at all).
      let quiet = 0;
      await waitFor(async () => {
        if (handledOn(a).length > 0) return true;
        const copies = [...(await conflictCopies(a)), ...(await conflictCopies(b))];
        const none = copies.every((c) => !c.includes("knowledge")) && handledOn(b).length === 0;
        quiet = none ? quiet + 1 : 0;
        return quiet >= 30;
      }, 45_000);
      // A copy of this path appeared and the local device resolved it. A remote edit that is
      // newer always makes a copy: the local version wins only through the resolver.
      const expected = order === "remote edit newer" ? "restored_copy" : "kept_original";
      if (order === "remote edit newer" || handledOn(a).length > 0) {
        expect(handledOn(a)).toEqual([expected]);
      }
      // The remote device saw the copy too, but left it: the local device is online.
      expect(handledOn(b).every((action) => action === "left_not_elected")).toBe(true);
      if (handledOn(a).length > 0) {
        const history = await readdir(join(a.home, "history", WS));
        expect(history.length).toBeGreaterThan(0);
      }
    }, 90_000);
  }

  it("does not journal a version of another device that the resolver restores", async () => {
    const original = "knowledge/shared/restored.md";
    const copy = `knowledge/shared/restored.sync-conflict-20261123-120000-${shortId(b.transport.syncId!)}.md`;
    await writeFile(join(a.root, ...copy.split("/")), "from ubuntu-01\n");
    for (const node of [a, b]) {
      await waitFor(
        async () =>
          (await text(node, copy)) === null && (await text(node, original)) === "from ubuntu-01\n",
        45_000,
      );
    }
    const sha = createHash("sha256").update("from ubuntu-01\n").digest("hex");
    expect(await a.transport.journal.has(WS, original, sha)).toBe(false);
  }, 60_000);

  it("merges a copy of an own log by event id on the owner device", async () => {
    const task = newId(systemClock);
    const log = `tasks/${task}/log/macbook-pro.jsonl`;
    const first = await a.files.writeEvent(log, "comment.added", { text: "kept" }, { task });
    await waitFor(async () => (await text(b, log))?.includes(first.id), 20_000);
    const lost = a.files.newEvent("comment.added", { text: "only in the copy" }, { task });
    // A copy that appears on the remote device: it is not the owner and leaves it.
    const copy = `tasks/${task}/log/macbook-pro.sync-conflict-20261123-120000-ABCDEFG.jsonl`;
    await mkdir(join(b.root, "tasks", task, "log"), { recursive: true });
    await writeFile(
      join(b.root, ...copy.split("/")),
      `${JSON.stringify(first)}\n${JSON.stringify(lost)}\n`,
    );
    for (const node of [a, b]) {
      await waitFor(async () => {
        const body = (await text(node, log)) ?? "";
        return (
          (await text(node, copy)) === null &&
          body.split("\n").filter((l) => l.includes(lost.id)).length === 1 &&
          body.split("\n").filter((l) => l.includes(first.id)).length === 1
        );
      }, 45_000);
    }
  }, 60_000);
});

describe("engine restart and an offline peer", () => {
  it("completes a sync after the peer engine is killed during it", async () => {
    for (let i = 0; i < 200; i += 1)
      await a.files.writeFile(`knowledge/shared/kill/f${i}.md`, `${i}\n`);
    // Kill the worker child: the monitor then exits too (Syncthing v2.1.7).
    const pids = b.transport.pids;
    process.kill(pids[pids.length - 1]!, "SIGKILL");
    // Within 10 s: the exit starts the restart at once (the health check needs 30 s).
    await waitFor(
      () => b.transport.state === "running" && !b.transport.pids.includes(pids[0]!),
      10_000,
    );
    await waitFor(
      async () => (await a.transport.syncNow({ timeoutMs: 20_000 })).pending.length === 0,
      60_000,
    );
    expect((await readdir(join(b.root, "knowledge", "shared", "kill"))).length).toBe(200);
  }, 120_000);

  it("reports an offline peer as not synced", async () => {
    await b.transport.stop();
    await waitFor(async () => !(await a.transport.status())[0]?.connected, 15_000);
    await a.files.writeFile("knowledge/shared/offline.md", "x\n");
    const result = await a.transport.syncNow({ timeoutMs: 3000 });
    expect(result.pending).toEqual([{ device: "ubuntu-01", items: 1, reason: "offline" }]);
    // A peer that is not connected gets nothing: the delivery wait ends at once.
    const started = Date.now();
    expect(
      await a.transport.waitDelivered("ubuntu-01", WS, "knowledge/shared/offline.md", 10_000),
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  }, 30_000);

  it("goes on with Sync now when the scan of one folder fails", async () => {
    // The secure folder is missing: the engine refuses its scan ("folder path missing").
    const secure = join(a.root, "secure");
    await rename(secure, `${secure}.away`);
    try {
      const started = Date.now();
      const result = await a.transport.syncNow({ timeoutMs: 3000 });
      expect(Date.now() - started).toBeLessThan(6000);
      expect(result.pending).toEqual([
        { device: "ubuntu-01", items: expect.any(Number) as number, reason: "offline" },
      ]);
      expect(
        a.log.entries.some(
          (e) =>
            e.msg === "A folder scan of Sync now failed" &&
            (e.obj as { folder?: string }).folder === `aw-${WS}-secure`,
        ),
      ).toBe(true);
    } finally {
      await rename(`${secure}.away`, secure);
    }
  }, 30_000);

  it("shares the secure folder only with computers", async () => {
    const phone = "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG";
    await a.transport.addPeer({
      device: "pixel-9",
      sync_id: phone,
      role: "mobile",
      addresses: ["dynamic"],
    });
    const config = readConfigText(await readFile(join(a.home, "sync", "config.xml"), "utf8"));
    const rest = new EngineRest({ socket: config.socket!, apiKey: config.apiKey! });
    const devicesOf = async (kind: string) =>
      (await rest.folder(`aw-${WS}-${kind}`))!.devices.map((d) => d.deviceID);
    expect(await devicesOf("tasks")).toContain(phone);
    expect(await devicesOf("knowledge")).toContain(phone);
    expect(await devicesOf("secure")).not.toContain(phone);
    await a.transport.removePeer("pixel-9");
    expect(await devicesOf("tasks")).not.toContain(phone);
  }, 30_000);

  it("keeps the device id of each device after an awd restart with shared folders", async () => {
    // config.xml lists the folder devices (sorted by id) before the top-level devices: on one
    // of the 2 devices the id of the peer comes first.
    const ids = { a: a.transport.syncId!, b: b.transport.syncId! };
    expect([ids.a < ids.b, ids.b < ids.a]).toContain(true);
    for (const [node, peer] of [
      [a, b],
      [b, a],
    ] as const) {
      const me = node === a ? ids.a : ids.b;
      const config = await readFile(join(node.home, "sync", "config.xml"), "utf8");
      expect(config).toContain(`<device id="${node === a ? ids.b : ids.a}" introducedBy=`);
      const prepared = await prepareEngineHome(binary, {
        home: join(node.home, "sync"),
        socket: join(node.home, "run", "sync.sock"),
        name: node.slug,
        listen: `tcp://127.0.0.1:${node.port}`,
      });
      expect(prepared).toMatchObject({ deviceId: me, created: false });
      // A new start on the same home, as after an awd restart.
      await node.transport.stop();
      await node.transport.start();
      expect(node.transport.syncId).toBe(me);
      const rest = new EngineRest({
        socket: prepared.socket,
        apiKey: prepared.apiKey,
      });
      const names = Object.fromEntries((await rest.devices()).map((d) => [d.deviceID, d.name]));
      expect(names).toMatchObject({ [me]: node.slug, [peer === a ? ids.a : ids.b]: peer.slug });
    }
  }, 60_000);

  it("removes the folders of a workspace that awd removed while the engine was down (gap-setup M2)", async () => {
    const other = "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c02";
    const root = join(a.home, "other-ws");
    for (const kind of ["tasks", "knowledge", "secure"]) {
      await mkdir(join(root, kind), { recursive: true });
    }
    await a.transport.addWorkspace(other, root);
    const config = () => readFile(join(a.home, "sync", "config.xml"), "utf8");
    await waitFor(async () => (await config()).includes(`id="aw-${other}-tasks"`), 10_000);
    await a.transport.stop();
    // The remove of `aw workspace remove` while the engine does not run.
    await a.transport.removeWorkspace(other);
    await a.transport.start();
    await waitFor(async () => !(await config()).includes(`aw-${other}-`), 10_000);
    // The folders of the open workspace stay.
    expect(await config()).toContain(`id="aw-${WS}-tasks"`);
  }, 60_000);
});
