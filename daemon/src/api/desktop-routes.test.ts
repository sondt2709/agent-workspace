// Route tests of the desktop routes (add-desktop-devices-knowledge): presence, the files of a task
// folder, and the restore of the last valid version of a document.
import { AwApiError } from "@aw/client";
import { DesktopClient } from "@aw/client/desktop";
import { systemClock } from "@aw/core/clock";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { healthDocument } from "../continuity/health.ts";
import { otherDevice, startTestDaemon, type TestDaemon } from "../testing.ts";

let d: TestDaemon;
let desktop: DesktopClient;

beforeEach(async () => {
  d = await startTestDaemon({ workspace: true });
  desktop = new DesktopClient(d.client);
});
afterEach(async () => {
  await d.close();
});

async function apiError(promise: Promise<unknown>): Promise<AwApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AwApiError);
  return error as AwApiError;
}

async function newTask() {
  const { task } = await d.client.createTask("-", {
    project: "billing-api",
    title: "Rate limit",
    first_message: "Add a rate limit",
    assignee: "claude@macbook-pro",
  });
  return task;
}

describe("presence", () => {
  it("lists a device with its last heartbeat", async () => {
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    // The time of the clock module, as the test daemon reads it (devices-kb review 11).
    const now = new Date(systemClock.now()).toISOString();
    await ubuntu.writeEvent(
      `tasks/devices/ubuntu-01/heartbeat/${now.slice(0, 10)}.jsonl`,
      "device.heartbeat",
      { boot_time: now },
      { by: "aw@ubuntu-01" },
    );
    await d.server.daemon.workspace().refresh();
    const presence = await desktop.presence("-");
    expect(typeof presence.now).toBe("string");
    const entry = presence.devices.find((p) => p.device === "ubuntu-01");
    expect(entry).toMatchObject({ online: true, offline_since: null });
    expect(entry?.last_heartbeat_hlc).not.toBeNull();
  });
});

describe("session hosts", () => {
  it("gives the bindings of each computer and the Orca state of this device only", async () => {
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    await ubuntu.writeDocument("tasks/devices/ubuntu-01/bindings.yaml", {
      kind: "bindings",
      schema: 1,
      device: "ubuntu-01",
      may_run: true,
      use_orca: true,
      checkouts: [{ project: "billing-api", path: "/srv/billing-api", session_host: "orca" }],
    });
    // The health of ubuntu-01 says that its billing-api checkout has no commit.
    await ubuntu.writeDocument(
      "tasks/devices/ubuntu-01/health.yaml",
      healthDocument({
        device: "ubuntu-01",
        updated: "2026-11-27T08:00:00.000Z#0000",
        bootTime: "2026-11-27T07:00:00.000Z",
        versions: {},
        sessions: [],
        usage: null,
        loginExpiresAt: null,
        disk: 10,
        checkouts: [{ project: "billing-api", has_commit: false }],
      }),
    );
    await d.server.daemon.workspace().refresh();
    const reply = await desktop.sessionHosts("-");
    expect(reply.device).toBe("macbook-pro");
    expect(reply.devices.map((e) => e.device)).toEqual(["macbook-pro", "ubuntu-01"]);
    // The test daemon runs no sessions: Orca cannot run here, and the reply says why.
    expect(reply.devices[0]).toMatchObject({
      may_run: true,
      use_orca: false,
      checkouts: [],
      orca: { available: false, reason: "the sessions are off on this device" },
    });
    // Another computer: its bindings, no checkout path, and no Orca state (AW cannot detect it).
    expect(reply.devices[1]).toEqual({
      device: "ubuntu-01",
      may_run: true,
      use_orca: true,
      checkouts: [{ project: "billing-api", session_host: "orca", has_commit: false }],
      orca: null,
    });
    expect(JSON.stringify(reply)).not.toContain("/srv/billing-api");
  });
});

describe("task files", () => {
  it("lists the folder of a task with its files and folders", async () => {
    const task = await newTask();
    const root = join(d.folder, "tasks", task.id);
    await mkdir(join(root, "proposal"), { recursive: true });
    await writeFile(join(root, "proposal", "v1.md"), "# Plan\n");
    await writeFile(join(root, "log", "x.jsonl.aw-tmp"), "tmp");
    const reply = await desktop.taskFiles("-", "AW-1");
    expect(reply.root).toBe(`tasks/${task.id}`);
    const names = reply.entries.map((e) => `${e.kind}:${e.name}`);
    expect(names).toContain("dir:proposal");
    expect(names).toContain("file:proposal/v1.md");
    expect(names).toContain("dir:log");
    expect(names).toContain("file:log/macbook-pro.jsonl");
    expect(names.some((n) => n.endsWith(".aw-tmp"))).toBe(false);
    expect(reply.truncated).toBe(false);
  });

  it("reads one file as text", async () => {
    const task = await newTask();
    const file = await desktop.taskFile("-", "AW-1", `tasks/${task.id}/log/macbook-pro.jsonl`);
    expect(file.reason).toBeNull();
    expect(file.text).toContain('"task.created"');
  });

  it("gives null text for a binary file", async () => {
    const task = await newTask();
    const dir = join(d.folder, "tasks", task.id, "artifacts", "macbook-pro");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "shot.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const file = await desktop.taskFile(
      "-",
      task.id,
      `tasks/${task.id}/artifacts/macbook-pro/shot.png`,
    );
    expect(file).toMatchObject({ text: null, reason: "binary", size: 4 });
  });

  it("refuses a path outside the folder of the task", async () => {
    const task = await newTask();
    for (const path of [
      `tasks/${task.id}/../workspace.yaml`,
      "tasks/workspace.yaml",
      `tasks/${task.id}//log`,
    ]) {
      const error = await apiError(desktop.taskFile("-", "AW-1", path));
      expect(error.status).toBe(400);
    }
  });

  it("refuses a symbolic link that leaves the folder", async () => {
    const task = await newTask();
    await symlink(join(d.folder, "tasks", "workspace.yaml"), join(d.folder, "tasks", task.id, "w"));
    const error = await apiError(desktop.taskFile("-", "AW-1", `tasks/${task.id}/w`));
    expect(error.status).toBe(400);
    const list = await desktop.taskFiles("-", "AW-1");
    expect(list.entries.some((e) => e.name === "w")).toBe(false);
  });

  it("gives 404 for an unknown task", async () => {
    const error = await apiError(desktop.taskFiles("-", "AW-99"));
    expect(error.status).toBe(404);
  });
});

describe("restore a document", () => {
  const path = "tasks/projects/billing-api/project.yaml";

  it("writes the last valid version of a broken document", async () => {
    const file = join(d.folder, ...path.split("/"));
    const good = await readFile(file, "utf8");
    await writeFile(file, "kind: project\nschema: 1\nslug: [broken\n");
    await d.server.daemon.workspace().refresh();
    expect((await d.client.issues("-")).some((i) => i.path === path)).toBe(true);

    const reply = await desktop.restoreDocument("-", path);
    expect(reply).toMatchObject({ path, kind: "project", restored: true });
    expect((await d.client.issues("-")).some((i) => i.path === path)).toBe(false);
    expect(await readFile(file, "utf8")).toContain("slug: billing-api");
    expect(good).toContain("slug: billing-api");
  });

  it("names the device that must fix a device-owned document (devices-kb review, workflow 1)", async () => {
    const owned = "tasks/devices/ubuntu-01/bindings.yaml";
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    await ubuntu.writeDocument(owned, {
      kind: "bindings",
      schema: 1,
      device: "ubuntu-01",
      may_run: true,
      use_orca: false,
      checkouts: [],
    });
    await d.server.daemon.workspace().refresh();
    await writeFile(join(d.folder, ...owned.split("/")), "kind: bindings\nschema: [broken\n");
    await d.server.daemon.workspace().refresh();
    expect((await d.client.issues("-")).some((i) => i.path === owned)).toBe(true);
    const error = await apiError(desktop.restoreDocument("-", owned));
    expect(error.status).toBe(403);
    expect(error.message).toContain("only ubuntu-01 writes this file");
  });

  it("gives 409 for a document with no schema error", async () => {
    const error = await apiError(desktop.restoreDocument("-", path));
    expect(error.status).toBe(409);
  });
});
