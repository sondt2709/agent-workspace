// The sync engine in awd (openspec add-syncthing-sync: awd-service, local-api, aw-cli). The tests
// with an engine run the real pinned binary.
import { EngineRest, readConfigText } from "@aw/sync-syncthing";
import { commandName, ensureTestEngine } from "@aw/sync-syncthing/testing";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { otherDevice, startTestDaemon, waitFor, type TestDaemon } from "../testing.ts";
import { ENGINE_CHECK_MS } from "./sync.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

let daemon: TestDaemon | null = null;
afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

describe("without an engine binary", () => {
  it("runs with sync off and says so", async () => {
    daemon = await startTestDaemon({ workspace: true });
    const ready = await daemon.client.ready();
    expect(ready.ready).toBe(true);
    expect(ready.checks.sync_engine).toBe("not_installed");
    const now = await daemon.aw(["sync", "now"]);
    expect(now.code).toBe(1);
    expect(now.stderr).toContain("The sync engine is not running (state not_installed)");
    const status = await daemon.aw(["sync", "status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("Sync engine: not_installed");
  });

  it("refuses a peer by device id unless AW_SYNC_TEST_PEERS is on", async () => {
    daemon = await startTestDaemon({ workspace: true });
    const add = await daemon.aw([
      "sync",
      "peer",
      "add",
      "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG",
      "tcp://127.0.0.1:1",
    ]);
    expect(add.code).toBe(1);
    expect(add.stderr).toContain("AW_SYNC_TEST_PEERS=on");
  });

  it("writes a conflict copy of the resolver in the write queue and merges after it", async () => {
    daemon = await startTestDaemon({ workspace: true });
    const created = await daemon.client.createTask("-", {
      project: "billing-api",
      title: "Fix the flaky test",
      first_message: "The test fails 1 time in 5.",
    });
    const service = daemon.server.daemon.workspace();
    const task = created.task.id;
    const lost = service.files.newEvent("comment.added", { text: "only in the copy" }, { task });
    const copy = `tasks/${task}/log/macbook-pro.sync-conflict-20261123-120000-ABCDEFG.jsonl`;
    await writeFile(join(daemon.folder, ...copy.split("/")), `${JSON.stringify(lost)}\n`);
    expect(await service.conflictFiles.mergeLogCopy(copy)).toBe(1);
    // No watcher in this test: only the refresh after the resolver write shows the event.
    const thread = await daemon.client.thread("-", task);
    expect(thread.events.map((e) => e.id)).toContain(lost.id);

    // A shared file: the version of the copy wins, and the index has it at once.
    const project = "tasks/projects/billing-api/project.yaml";
    const projectCopy =
      "tasks/projects/billing-api/project.sync-conflict-20261123-120000-ABCDEFG.yaml";
    const text = await readFile(join(daemon.folder, ...project.split("/")), "utf8");
    await writeFile(
      join(daemon.folder, ...projectCopy.split("/")),
      text.replace("Billing API", "Billing API v2"),
    );
    await service.conflictFiles.resolveConflictCopy(projectCopy, "copy");
    expect((await daemon.client.projects("-")).map((p) => p.name)).toEqual(["Billing API v2"]);
  });

  it("reconciles the knowledge store after a remote change in the knowledge folder", async () => {
    daemon = await startTestDaemon({ workspace: true });
    const service = daemon.server.daemon.workspace();
    const sync = daemon.server.daemon.sync;
    const path = "shared/testing.md";
    // ubuntu-01 writes a version and its log line; sync brings both (no watcher in this test).
    const ubuntu = otherDevice(daemon.folder, "ubuntu-01");
    await ubuntu.writeFile(`knowledge/${path}`, "from ubuntu-01\n");
    await ubuntu.writeEvent("knowledge/log/ubuntu-01.jsonl", "knowledge.changed", {
      path,
      hash: sha256("from ubuntu-01\n"),
      base: null,
      author: "human@ubuntu-01",
      kind: "edit",
    });
    const event = {
      type: "changed",
      folder: `aw-${service.id}-knowledge`,
      path: `knowledge/${path}`,
      at: new Date().toISOString(),
    } as const;
    const available = async () => (await service.knowledge.history(path))[0]?.available;
    // A local change, a change in another folder and a change of another workspace: no reconcile.
    sync.onEvent({ ...event, local: true });
    sync.onEvent({ ...event, local: false, folder: `aw-${service.id}-tasks` });
    sync.onEvent({ ...event, local: false, folder: "aw-other-knowledge" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await available()).toBe(false);
    // A remote change: the store reconciles, stores the version and logs no event of this device.
    sync.onEvent({ ...event, local: false });
    await waitFor(async () => (await available()) === true);
    const history = await service.knowledge.history(path);
    expect(history.map((h) => `${h.dev}:${h.kind}`)).toEqual(["ubuntu-01:edit"]);
  });

  it("logs a replaced change in the knowledge log when the resolver keeps a version", async () => {
    daemon = await startTestDaemon({ workspace: true });
    const service = daemon.server.daemon.workspace();
    const path = "shared/testing.md";
    const file = join(daemon.folder, "knowledge", "shared", "testing.md");
    await service.knowledge.write({ path, content: "base\n", base: null });
    const copyOf = (n: number) =>
      `knowledge/shared/testing.sync-conflict-20261123-12000${n}-ABCDEFG.md`;

    // The copy wins (keep "copy"): its version is written, the original is the lost version.
    await writeFile(join(daemon.folder, ...copyOf(1).split("/")), "copy wins\n");
    const lost = await service.conflictFiles.resolveConflictCopy(copyOf(1), "copy");
    expect(Buffer.from(lost!).toString()).toBe("base\n");
    expect(await readFile(file, "utf8")).toBe("copy wins\n");
    // The original wins (keep "original"): the file stays, the copy is the lost version.
    await writeFile(join(daemon.folder, ...copyOf(2).split("/")), "copy loses\n");
    const lost2 = await service.conflictFiles.resolveConflictCopy(copyOf(2), "original");
    expect(Buffer.from(lost2!).toString()).toBe("copy loses\n");
    expect(await readFile(file, "utf8")).toBe("copy wins\n");

    const history = await service.knowledge.history(path);
    expect(history.map((h) => [h.kind, h.by, h.label])).toEqual([
      ["edit", "human@macbook-pro", "Edited by human@macbook-pro"],
      ["replaced", "aw@macbook-pro", "Replaced by the macbook-pro version"],
      ["replaced", "aw@macbook-pro", "Replaced by the macbook-pro version"],
    ]);
    expect(history[1]).toMatchObject({ hash: sha256("copy wins\n"), base: sha256("base\n") });
    expect(history[2]).toMatchObject({
      hash: sha256("copy wins\n"),
      base: sha256("copy loses\n"),
      base_available: true,
    });
    // No copy is left, and Undo of the last replaced change gives the lost version back.
    expect(await readFile(join(daemon.folder, ...copyOf(2).split("/"))).catch(() => null)).toBe(
      null,
    );
    await service.knowledge.undo(history[2]!.id);
    expect(await readFile(file, "utf8")).toBe("copy loses\n");
  });
});

describe("with an engine that never answers", () => {
  it("is ready, with the engine state starting", async () => {
    // generate and device-id work; serve never opens the REST socket.
    const dir = await mkdtemp(join(tmpdir(), "awe-"));
    const engine = join(dir, "syncthing");
    await writeFile(
      engine,
      [
        "#!/bin/sh",
        'case "$1" in',
        '  generate) home="${2#--home=}"; mkdir -p "$home"; echo \'<configuration version="52"></configuration>\' > "$home/config.xml" ;;',
        "  device-id) echo MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5 ;;",
        "  serve) exec sleep 600 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    await chmod(engine, 0o755);
    try {
      daemon = await startTestDaemon({
        workspace: true,
        env: { AW_SYNC_ENGINE: engine, AW_SYNC_LISTEN: `tcp://127.0.0.1:${await freePort()}` },
      });
      const ready = await daemon.client.ready();
      expect(ready.ready).toBe(true);
      expect(ready.checks.sync_engine).toBe("starting");
      const now = await daemon.aw(["sync", "now"]);
      expect(now.code).toBe(1);
      expect(now.stderr).toContain("state starting");
      // The stop ends the start: no engine process is left.
      await waitFor(() => (daemon!.server.daemon.sync.transport?.pids.length ?? 0) === 1, 10_000);
      const pids = daemon.server.daemon.sync.transport!.pids;
      await daemon.close();
      daemon = null;
      for (const pid of pids) expect(await commandName(pid)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("with an engine that the person installs after the start", () => {
  it("starts the engine when its binary appears, with no awd restart (fix list 0-23)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awe-"));
    const engine = join(dir, "syncthing");
    try {
      daemon = await startTestDaemon({
        workspace: true,
        env: { AW_SYNC_ENGINE: engine, AW_SYNC_LISTEN: `tcp://127.0.0.1:${await freePort()}` },
      });
      expect((await daemon.client.ready()).checks.sync_engine).toBe("not_installed");
      // aw engine install places the binary: the same fake engine as above (serve never answers).
      await writeFile(
        engine,
        [
          "#!/bin/sh",
          'case "$1" in',
          '  generate) home="${2#--home=}"; mkdir -p "$home"; echo \'<configuration version="52"></configuration>\' > "$home/config.xml" ;;',
          "  device-id) echo MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5 ;;",
          "  serve) exec sleep 600 ;;",
          "esac",
          "",
        ].join("\n"),
      );
      await chmod(engine, 0o755);
      await waitFor(
        async () => (await daemon!.client.ready()).checks.sync_engine === "starting",
        ENGINE_CHECK_MS + 10_000,
      );
      await waitFor(() => (daemon!.server.daemon.sync.transport?.pids.length ?? 0) === 1, 10_000);
      const pids = daemon.server.daemon.sync.transport!.pids;
      await daemon.close();
      daemon = null;
      for (const pid of pids) expect(await commandName(pid)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 40_000);
});

describe("with the pinned engine", () => {
  it("starts the engine, shares the 3 folders, journals each write and stops the engine", async () => {
    const engine = await ensureTestEngine();
    daemon = await startTestDaemon({
      workspace: true,
      env: {
        AW_SYNC_ENGINE: engine,
        AW_SYNC_LISTEN: `tcp://127.0.0.1:${await freePort()}`,
        AW_SYNC_COMMUNITY: "off",
        AW_SYNC_TEST_PEERS: "on",
      },
    });
    // awd is ready before the engine runs: the engine state never changes the readiness.
    expect((await daemon.client.ready()).ready).toBe(true);
    await waitFor(
      async () => (await daemon!.client.ready()).checks.sync_engine === "running",
      30_000,
    );

    const status = await daemon.client.syncStatus();
    expect(status).toMatchObject({ engine: "running", device: "macbook-pro", peers: [] });
    expect(status.sync_id).toMatch(/^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$/);
    const transport = daemon.server.daemon.sync.transport!;
    const ws = (await daemon.client.workspaces())[0]!;
    expect(transport.folders.map((f) => f.kind).sort()).toEqual(["knowledge", "secure", "tasks"]);
    expect(transport.folders.every((f) => f.workspace === ws.id)).toBe(true);

    const created = await daemon.client.createTask("-", {
      project: "billing-api",
      title: "Fix the flaky test",
      first_message: "The test fails 1 time in 5.",
    });
    const log = `tasks/${created.task.id}/log/macbook-pro.jsonl`;
    await transport.scansIdle();
    const journal = await readFile(join(daemon.home, "journal", `${ws.id}.jsonl`), "utf8");
    expect(journal).toContain(`"path":"${log}"`);

    const now = await daemon.aw(["sync", "now"]);
    expect(now.code).toBe(0);
    expect(now.stdout).toContain("No peers to sync with.");

    const peer = await daemon.aw([
      "sync",
      "peer",
      "add",
      "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG",
      "tcp://127.0.0.1:1",
      "--name",
      "ubuntu-01",
    ]);
    expect(peer.code).toBe(0);
    // The new peer has none of the files yet, and it is offline.
    expect(peer.stdout).toMatch(
      /ubuntu-01 \(remote\): \d+ changes not synced to ubuntu-01 \(offline\)/,
    );
    const pending = await daemon.aw(["sync", "now", "--timeout", "1"]);
    expect(pending.code).toBe(1);
    expect(pending.stdout).toMatch(/ubuntu-01: \d+ changes not synced to ubuntu-01 \(offline\)/);
    // A bad device id is bad input (exit 2), and the peers file does not change.
    const bad = await daemon.aw(["sync", "peer", "add", "NOT-A-DEVICE-ID", "tcp://127.0.0.1:1"]);
    expect(bad.code).toBe(2);
    // The form is right, but a check character is wrong (a typo): bad input too, not an
    // engine error.
    const typo = await daemon.aw([
      "sync",
      "peer",
      "add",
      "MWAQSX5-ZFSDHGV-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5",
      "tcp://127.0.0.1:1",
    ]);
    expect(typo.code).toBe(2);
    expect(typo.stderr).toContain("is not a valid device id");
    expect(transport.peers.map((p) => p.device)).toEqual(["ubuntu-01"]);
    expect(await daemon.aw(["sync", "pause"])).toMatchObject({ code: 0 });
    // A peer added during a pause is paused too.
    const second = "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5";
    const added = await daemon.aw(["sync", "peer", "add", second, "tcp://127.0.0.1:1"]);
    expect(added.code).toBe(0);
    const engineDevices = async () => {
      const config = readConfigText(
        await readFile(join(daemon!.home, "sync", "config.xml"), "utf8"),
      );
      const rest = new EngineRest({ socket: config.socket!, apiKey: config.apiKey! });
      return Object.fromEntries((await rest.devices()).map((d) => [d.name, d.paused]));
    };
    expect(await engineDevices()).toMatchObject({ "ubuntu-01": true, [`peer-mwaqsx5`]: true });
    expect(await daemon.aw(["sync", "peer", "remove", "peer-mwaqsx5"])).toMatchObject({ code: 0 });

    // After a restart, awd shares the folders of the registered workspace again.
    const written = () =>
      daemon!.logLines().filter((l) => l.msg === "Sync folder config written").length;
    const before = written();
    await daemon.restart();
    await daemon.server.daemon.syncStarted;
    expect(daemon.server.daemon.sync.state).toBe("running");
    const again = daemon.server.daemon.sync.transport!;
    expect(again.folders.map((f) => f.kind).sort()).toEqual(["knowledge", "secure", "tasks"]);
    // The engine config is equal to the wanted config: no folder config change, no folder restart.
    expect(written()).toBe(before);
    // The engine keeps a pause in memory only: after an awd restart neither the engine nor awd
    // is paused, and awd says so.
    expect(await daemon.client.syncStatus()).toMatchObject({ paused: false });
    // A test peer stays in memory only (add-identity-and-pairing): after the restart awd has no
    // peers file, and the engine has no device without a signed record.
    await waitFor(async () => !("ubuntu-01" in (await engineDevices())), 10_000);
    await expect(stat(join(daemon.home, "sync-peers.json"))).rejects.toThrow(/ENOENT/);
    const removed = await daemon.aw(["sync", "peer", "remove", "ubuntu-01"]);
    expect(removed.code).toBe(2);
    expect((await daemon.aw(["sync", "status"])).stdout).toContain("No peers.");

    const pids = again.pids;
    expect(pids.length).toBeGreaterThan(0);
    await daemon.close();
    daemon = null;
    for (const pid of pids) expect(await commandName(pid)).toBeNull();
  }, 60_000);
});
