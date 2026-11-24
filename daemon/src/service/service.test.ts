// The awd service: socket and folder modes, the watcher, restarts, parallel writes, heartbeats,
// retention and the notices (specs awd-service).
import { AwApiError, AwClient } from "@aw/client";
import { FakeClock, MergeEngine, mergeWorkspace, systemClock, WorkspaceIndex } from "@aw/core";
import { eventV1 } from "@aw/schema";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../api/app.ts";
import { AlreadyRunningError, startServer } from "../server.ts";
import { loadSettings } from "../settings.ts";
import {
  memoryLogger,
  otherDevice,
  startTestDaemon,
  tempDir,
  waitFor,
  writeTestConfig,
  type TestDaemon,
} from "../testing.ts";
import { Daemon, OPEN_RETRY_MS } from "./daemon.ts";
import { heartbeatDate, isExpiredHeartbeat } from "./workspace.ts";

let d: TestDaemon | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await d?.close();
  d = null;
});

const failNextMerges = (count: number) => {
  const update = vi.spyOn(MergeEngine.prototype, "update");
  for (let i = 0; i < count; i++) update.mockRejectedValueOnce(new Error("EMFILE: too many files"));
};

const apiError = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("The call did not fail");
    },
    (error: unknown) => error as AwApiError,
  );

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe("state folder and socket", () => {
  it("creates AW_HOME and run/ with 0700 and the socket with 0600", async () => {
    d = await startTestDaemon();
    expect(await mode(d.home)).toBe(0o700);
    expect(await mode(join(d.home, "run"))).toBe(0o700);
    expect(await mode(d.settings.socketPath)).toBe(0o600);
    expect((await stat(d.settings.socketPath)).isSocket()).toBe(true);
  });

  it("sets the mode of run/ again after a change to 0755", async () => {
    d = await startTestDaemon();
    await chmod(join(d.home, "run"), 0o755);
    await d.restart();
    expect(await mode(join(d.home, "run"))).toBe(0o700);
  });

  it("refuses a second awd on the same socket, and the first one still answers", async () => {
    d = await startTestDaemon();
    const { log } = memoryLogger();
    await expect(
      startServer({ settings: d.settings, log, watch: false, heartbeat: false }),
    ).rejects.toThrow(AlreadyRunningError);
    expect(await d.client.health()).toEqual({ status: "ok" });
  });

  it("checks the socket path length before it listens", async () => {
    const home = await tempDir("awh-");
    const settings = loadSettings({ AW_HOME: join(home, "x".repeat(100)), HOME: home });
    await expect(
      startServer({ settings, log: memoryLogger().log, watch: false, heartbeat: false }),
    ).rejects.toThrow(/Use a shorter AW_HOME/);
    await rm(home, { recursive: true, force: true });
  });

  it("answers 503 on /readyz before the workspaces are open", async () => {
    const home = await tempDir("awh-");
    const settings = loadSettings({ AW_HOME: home, HOME: home });
    await writeTestConfig(settings);
    const daemon = new Daemon({
      settings,
      log: memoryLogger().log,
      watch: false,
      heartbeat: false,
    });
    const app = await createApp(daemon);
    try {
      const before = await app.inject({ method: "GET", url: "/readyz" });
      expect(before.statusCode).toBe(503);
      expect(before.headers["x-aw-version"]).toBe("0.0.0");
      await daemon.start();
      expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    } finally {
      await app.close();
      await daemon.stop();
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("workspace start and watcher", () => {
  it("indexes a log line of another device with no API call", async () => {
    d = await startTestDaemon({ watch: true, workspace: true });
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const task = ubuntu.newId();
    await ubuntu.writeEvent(
      `tasks/${task}/log/ubuntu-01.jsonl`,
      "task.created",
      { key: "AW-1", project: "billing-api", title: "From ubuntu-01", first_message: "hi" },
      { task, by: "human@ubuntu-01" },
    );
    const started = Date.now();
    await waitFor(async () => (await d!.client.tasks("-")).some((t) => t.id === task), 2000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("gives the same index rows after a restart as a full merge of the files", async () => {
    d = await startTestDaemon({ workspace: true });
    for (let i = 0; i < 5; i++) {
      await d.client.createTask("-", {
        project: "billing-api",
        title: `Task ${i}`,
        first_message: `m${i}`,
      });
    }
    await d.client.assignTask("-", "AW-2", "claude@ubuntu-01");
    await d.restart();
    const service = d.server.daemon.workspace();
    const expected = new WorkspaceIndex(":memory:");
    const { MergeEngine } = await import("@aw/core");
    const engine = new MergeEngine({ root: d.folder, clock: systemClock });
    expected.rebuild(await engine.update(), engine);
    const strip = (dump: ReturnType<WorkspaceIndex["dump"]>) => ({ ...dump, presence: [] });
    expect(strip(service.index.dump())).toEqual(strip(expected.dump()));
    expected.close();
    expect((await d.client.tasks("-")).map((t) => t.key)).toEqual([
      "AW-1",
      "AW-2",
      "AW-3",
      "AW-4",
      "AW-5",
    ]);
  });

  it("runs 20 parallel creates one at a time: 20 keys, valid lines, growing HLCs", async () => {
    d = await startTestDaemon({ workspace: true });
    const replies = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        d!.client.createTask("-", { project: "billing-api", title: `T${i}`, first_message: "x" }),
      ),
    );
    expect(new Set(replies.map((r) => r.task.key)).size).toBe(20);
    expect(new Set(replies.map((r) => r.event.hlc)).size).toBe(20);
    const ordered = [...replies].sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : 1));
    expect(ordered.map((r) => r.task.key)).toEqual(
      Array.from({ length: 20 }, (_, i) => `AW-${i + 1}`),
    );
    for (const reply of replies) {
      const text = await readFile(
        join(d.folder, "tasks", reply.task.id, "log", "macbook-pro.jsonl"),
        "utf8",
      );
      expect(() => eventV1.parse(JSON.parse(text))).not.toThrow();
    }
  });

  it("does not replace a schema file that another AW version wrote", async () => {
    d = await startTestDaemon({ workspace: true });
    const file = join(d.folder, "tasks", "schemas", "event.v1.schema.json");
    const other = '{"title":"event v1 of another AW version"}\n';
    await writeFile(file, other);
    await rm(join(d.folder, "tasks", "schemas", "task.v1.schema.json"));
    await d.restart();
    expect(await readFile(file, "utf8")).toBe(other);
    await expect(
      stat(join(d.folder, "tasks", "schemas", "task.v1.schema.json")),
    ).resolves.toBeTruthy();
  });

  it("copies the generated schemas to tasks/schemas/ byte for byte", async () => {
    d = await startTestDaemon({ workspace: true });
    const { generatedSchemasDir } = await import("@aw/schema");
    const names = (await readdir(generatedSchemasDir)).filter((n) => n.endsWith(".schema.json"));
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      expect(await readFile(join(d.folder, "tasks", "schemas", name), "utf8")).toBe(
        await readFile(join(generatedSchemasDir, name), "utf8"),
      );
    }
  });
});

describe("a workspace that does not open", () => {
  it("tries the open again on the clock, and the workspace opens", async () => {
    const clock = new FakeClock("2026-11-23T10:00:00.000Z");
    d = await startTestDaemon({ clock, workspace: true });
    failNextMerges(1);
    await d.restart();
    const [summary] = await d.client.workspaces();
    expect(summary!.error).toContain("EMFILE");
    expect((await d.client.ready()).ready).toBe(true);
    expect((await apiError(d.client.tasks("-"))).code).toBe("not_ready");
    clock.advance(OPEN_RETRY_MS);
    await waitFor(async () => (await d!.client.workspaces())[0]!.ready);
    expect((await d.client.workspaces())[0]!.error).toBeNull();
    expect(await d.client.tasks("-")).toEqual([]);
  });

  it("tries the open again at a second init, and reports the error while it fails", async () => {
    const clock = new FakeClock("2026-11-23T10:00:00.000Z");
    d = await startTestDaemon({ clock });
    failNextMerges(2);
    const first = await apiError(d.client.initWorkspace({ path: d.folder, name: "acme" }));
    expect(first).toMatchObject({ status: 503, code: "not_ready" });
    const second = await apiError(d.client.initWorkspace({ path: d.folder }));
    expect(second.message).toContain("EMFILE");
    const third = await d.client.initWorkspace({ path: d.folder });
    expect(third).toMatchObject({ created: false, workspace: { ready: true, error: null } });
    expect((await d.client.workspaces()).map((w) => w.name)).toEqual(["acme"]);
  });
});

describe("workspace selection and init", () => {
  it("refuses a name that 2 workspaces have, and accepts the ids", async () => {
    d = await startTestDaemon({ workspace: true });
    const second = await tempDir("awf-");
    try {
      await d.client.initWorkspace({ path: second, name: "acme" });
      const error = await apiError(d.client.tasks("acme"));
      expect(error).toMatchObject({ status: 409, code: "ambiguous" });
      const ids = (error.details as { ids: string[] }).ids;
      expect(ids).toHaveLength(2);
      for (const id of ids) expect(await d.client.tasks(id)).toEqual([]);
    } finally {
      await rm(second, { recursive: true, force: true });
    }
  });

  it("runs 2 parallel inits of one new folder as one workspace", async () => {
    d = await startTestDaemon();
    const folder = join(d.folder, "new");
    await mkdir(folder);
    const replies = await Promise.all([
      d.client.initWorkspace({ path: folder, name: "one" }),
      d.client.initWorkspace({ path: folder, name: "one" }),
    ]);
    expect(replies.map((r) => r.created).sort()).toEqual([false, true]);
    expect(replies[0].workspace.id).toBe(replies[1].workspace.id);
    const text = await readFile(join(folder, "tasks", "workspace.yaml"), "utf8");
    expect(text).toContain(`id: ${replies[0].workspace.id}`);
    expect(await d.client.workspaces()).toHaveLength(1);
  });
});

describe("heartbeats and retention", () => {
  it("writes a heartbeat at start and one every 30 s of the clock", async () => {
    const clock = new FakeClock("2026-11-22T14:20:00.000Z");
    d = await startTestDaemon({ clock, heartbeat: true, workspace: true });
    const file = join(d.folder, "tasks", "devices", "macbook-pro", "heartbeat", "2026-11-22.jsonl");
    const lines = async () => (await readFile(file, "utf8")).trimEnd().split("\n");
    expect(await lines()).toHaveLength(1);
    for (let i = 0; i < 2; i++) {
      clock.advance(30_000);
      await waitFor(async () => (await lines()).length === i + 2);
    }
    const events = (await lines()).map((line) => eventV1.parse(JSON.parse(line)));
    expect(events.map((e) => e.type)).toEqual([
      "device.heartbeat",
      "device.heartbeat",
      "device.heartbeat",
    ]);
    expect(events.map((e) => e.hlc.slice(0, 19))).toEqual([
      "2026-11-22T14:20:00",
      "2026-11-22T14:20:30",
      "2026-11-22T14:21:00",
    ]);
    expect(events[0]!.data).toEqual({ boot_time: "2026-11-22T08:00:00.000Z" });
  });

  it("removes its own heartbeat files older than 7 days, and no Sync problem shows", async () => {
    const clock = new FakeClock("2026-11-23T10:00:00.000Z");
    d = await startTestDaemon({ clock, workspace: true });
    const own = join(d.folder, "tasks", "devices", "macbook-pro", "heartbeat");
    const other = join(d.folder, "tasks", "devices", "ubuntu-01", "heartbeat");
    const ubuntu = otherDevice(d.folder, "ubuntu-01", { clock });
    const mac = d.server.daemon.workspace().files;
    for (const date of ["2026-11-15", "2026-11-16", "2026-11-23"]) {
      await mac.writeEvent(
        `tasks/devices/macbook-pro/heartbeat/${date}.jsonl`,
        "device.heartbeat",
        {
          boot_time: "2026-11-01T00:00:00.000Z",
        },
      );
    }
    await ubuntu.writeEvent(
      "tasks/devices/ubuntu-01/heartbeat/2026-11-01.jsonl",
      "device.heartbeat",
      {
        boot_time: "2026-11-01T00:00:00.000Z",
      },
    );
    const service = d.server.daemon.workspace();
    await service.refresh();
    await d.server.daemon.heartbeatOnce();
    expect((await readdir(own)).sort()).toEqual(["2026-11-16.jsonl", "2026-11-23.jsonl"]);
    expect(await readdir(other)).toEqual(["2026-11-01.jsonl"]);
    const update = await service.refresh();
    expect(update?.notices).toEqual([
      { code: "removed", path: "tasks/devices/macbook-pro/heartbeat/2026-11-15.jsonl" },
    ]);
    expect(service.summary().notices).toEqual([]);
  });

  it("keeps a removed task log as a Sync problem", async () => {
    d = await startTestDaemon({ workspace: true });
    const { task } = await d.client.createTask("-", {
      project: "billing-api",
      title: "x",
      first_message: "y",
    });
    await rm(join(d.folder, "tasks", task.id, "log", "macbook-pro.jsonl"));
    await d.server.daemon.workspace().refresh();
    const [status] = await d.client.workspaces();
    expect(status!.notices).toEqual([
      expect.objectContaining({ code: "removed", path: `tasks/${task.id}/log/macbook-pro.jsonl` }),
    ]);
  });

  it("knows the date of a heartbeat file and the retention bound", () => {
    expect(heartbeatDate("tasks/devices/a/heartbeat/2026-11-15.jsonl")).toBe("2026-11-15");
    expect(heartbeatDate("tasks/log/a.jsonl")).toBeNull();
    const now = Date.parse("2026-11-23T23:59:00.000Z");
    expect(isExpiredHeartbeat("2026-11-15", now)).toBe(true);
    expect(isExpiredHeartbeat("2026-11-16", now)).toBe(false);
  });
});

describe("crash safety in process", () => {
  it("removes a stale temp file at start", async () => {
    d = await startTestDaemon({ workspace: true });
    const temp = join(d.folder, "tasks", "workspace.yaml.123-abcd.aw-tmp");
    await writeFile(temp, "half");
    await d.restart();
    await expect(stat(temp)).rejects.toThrow(/ENOENT/);
  });

  it("starts with a merge result equal to a new full merge after a cut log line", async () => {
    d = await startTestDaemon({ workspace: true });
    const { task } = await d.client.createTask("-", {
      project: "billing-api",
      title: "x",
      first_message: "y",
    });
    await d.server.close();
    const log = join(d.folder, "tasks", task.id, "log", "macbook-pro.jsonl");
    await writeFile(log, `${await readFile(log, "utf8")}{"v":1,"id":"01`, { flag: "w" });
    await d.restart();
    const merged = await mergeWorkspace(d.folder, { clock: systemClock });
    const tasks = await d.client.tasks("-");
    expect(tasks.map((t) => t.id)).toEqual(merged.view.tasks.map((t) => t.id));
    // The next write appends after the cut line and stays valid.
    const edit = await d.client.editTask("-", task.id, { title: "after the cut" });
    expect(edit.applied).toBe(true);
  });
});

describe("client errors", () => {
  it("throws AwUnreachableError when no awd runs", async () => {
    const home = await tempDir("awh-");
    const client = new AwClient({ socketPath: join(home, "run", "awd.sock") });
    await expect(client.status()).rejects.toMatchObject({
      name: "AwUnreachableError",
      reason: "ENOENT",
    });
    await rm(home, { recursive: true, force: true });
  });
});
