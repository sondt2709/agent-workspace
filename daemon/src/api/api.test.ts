// Route tests of the local API through the real Unix socket and @aw/client (test plan 1).
import { AwApiError, type StreamMessage } from "@aw/client";
import { eventV1 } from "@aw/schema";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { otherDevice, startTestDaemon, tempDir, waitFor, type TestDaemon } from "../testing.ts";

let d: TestDaemon;
beforeEach(async () => {
  d = await startTestDaemon({ workspace: true });
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

const create = (title = "Fix the flaky invoice test", extra: Record<string, unknown> = {}) =>
  d.client.createTask("-", {
    project: "billing-api",
    title,
    first_message: "/opsx:explore The invoice test fails 1 time in 5 on CI.",
    ...extra,
  });

async function logLines(task: string, device = "macbook-pro") {
  const text = await readFile(join(d.folder, "tasks", task, "log", `${device}.jsonl`), "utf8");
  return text
    .trimEnd()
    .split("\n")
    .map((line) => eventV1.parse(JSON.parse(line)));
}

describe("probes and headers", () => {
  it("answers the probes with X-AW-Version and the trace id of the request", async () => {
    expect(await d.client.health()).toEqual({ status: "ok" });
    expect(d.client.last.version).toBe("0.0.0");
    const ready = await d.client.ready();
    expect(ready.ready).toBe(true);
    expect(ready.checks.sync_engine).toBe("not_installed");
    const version = await d.client.version();
    expect(version).toEqual({ version: "0.0.0", api: 1, node: process.version });
  });

  it("keeps a valid X-Trace-Id and replaces a bad one", async () => {
    const { AwClient } = await import("@aw/client");
    const good = new AwClient({ socketPath: d.settings.socketPath, traceId: () => "cli-test-1" });
    await good.health();
    expect(good.last.traceId).toBe("cli-test-1");
    const bad = new AwClient({ socketPath: d.settings.socketPath, traceId: () => "a b" });
    await bad.health();
    expect(bad.last.traceId).not.toBe("a b");
    expect(bad.last.traceId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it("logs each request with its trace id as JSON lines", async () => {
    const { AwClient } = await import("@aw/client");
    const client = new AwClient({
      socketPath: d.settings.socketPath,
      traceId: () => "trace-log-1",
    });
    await client.health();
    const lines = d.logLines().filter((line) => line.trace_id === "trace-log-1");
    expect(lines.map((line) => line.msg)).toEqual(["incoming request", "request completed"]);
    expect(lines[0]).toMatchObject({ name: "awd", level: 30 });
  });
});

describe("error envelope", () => {
  it("gives 400 invalid_input with the field of a missing title", async () => {
    const error = await apiError(
      d.client.createTask("-", { project: "billing-api", first_message: "x" } as never),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_input");
    expect(error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "title" })]),
    );
    expect(error.traceId).toBe(d.client.last.traceId);
  });

  it("gives 404 not_found for an unknown route, task and workspace", async () => {
    expect((await apiError(d.client.request("GET", "/v1/nothing", z.unknown()))).code).toBe(
      "not_found",
    );
    expect((await apiError(d.client.task("-", "AW-99"))).status).toBe(404);
    expect((await apiError(d.client.tasks("other"))).status).toBe(404);
  });

  it("gives 400 for an unknown project and an assignee that is not agent@device", async () => {
    expect((await apiError(create("x", { project: "nothing" }))).status).toBe(400);
    const task = await create();
    const error = await apiError(d.client.assignTask("-", task.task.id, "nobody"));
    expect(error.status).toBe(400);
  });
});

describe("workspaces and projects", () => {
  it("initializes a folder with workspace.yaml, the schemas and the bindings of this device", async () => {
    const [ws] = await d.client.workspaces();
    expect(ws).toMatchObject({ name: "acme", ready: true, path: d.folder });
    const yaml = await readFile(join(d.folder, "tasks", "workspace.yaml"), "utf8");
    expect(yaml).toContain("name: acme");
    expect(yaml).toContain("key_prefix: AW");
    const bindings = await readFile(
      join(d.folder, "tasks", "devices", "macbook-pro", "bindings.yaml"),
      "utf8",
    );
    expect(bindings).toContain("may_run: true");
    const config = await readFile(join(d.home, "config.yaml"), "utf8");
    expect(config).toContain(ws!.id);
  });

  it("registers a synced folder with its own id and changes nothing in it", async () => {
    const before = await readFile(join(d.folder, "tasks", "workspace.yaml"), "utf8");
    const again = await d.client.initWorkspace({ path: d.folder });
    expect(again.created).toBe(false);
    expect(await readFile(join(d.folder, "tasks", "workspace.yaml"), "utf8")).toBe(before);
    expect(await d.client.workspaces()).toHaveLength(1);
  });

  it("registers a folder that another device created, with the id of its workspace.yaml", async () => {
    const synced = await tempDir("aws-");
    try {
      const ubuntu = otherDevice(synced, "ubuntu-01");
      const id = ubuntu.newId();
      await ubuntu.writeDocument("tasks/workspace.yaml", {
        kind: "workspace",
        schema: 1,
        id,
        name: "lab",
        key_prefix: "LAB",
      });
      const before = await readFile(join(synced, "tasks", "workspace.yaml"), "utf8");
      const reply = await d.client.initWorkspace({ path: synced });
      expect(reply.created).toBe(false);
      expect(reply.workspace).toMatchObject({ id, name: "lab", path: synced, ready: true });
      expect(await readFile(join(synced, "tasks", "workspace.yaml"), "utf8")).toBe(before);
      expect((await d.client.workspaces()).map((w) => w.name).sort()).toEqual(["acme", "lab"]);
    } finally {
      await rm(synced, { recursive: true, force: true });
    }
  });

  it("asks for a name for a new folder and refuses a relative path", async () => {
    expect(
      (await apiError(d.client.initWorkspace({ path: "/tmp/aw-no-such-folder-x" }))).status,
    ).toBe(400);
    expect(
      (await apiError(d.client.initWorkspace({ path: "relative/path", name: "x" }))).status,
    ).toBe(400);
  });

  it("adds a project once and lists it", async () => {
    const error = await apiError(d.client.addProject("acme", { slug: "billing-api" }));
    expect(error.status).toBe(409);
    expect((await d.client.projects("acme")).map((p) => p.slug)).toEqual(["billing-api"]);
  });
});

describe("tasks", () => {
  it("creates a task with a task.created line of this device and the merged task", async () => {
    const reply = await create("Fix it", { assignee: "claude@macbook-pro" });
    expect(reply.applied).toBe(true);
    expect(reply.task).toMatchObject({
      key: "AW-1",
      stage: "backlog",
      assignee: "claude@macbook-pro",
      owner: "macbook-pro",
      needs_you_lane: false,
    });
    const [line] = await logLines(reply.task.id);
    expect(line).toMatchObject({
      type: "task.created",
      by: "human@macbook-pro",
      dev: "macbook-pro",
    });
    expect((await create("Second")).task.key).toBe("AW-2");
    const snapshot = await readFile(join(d.folder, "tasks", reply.task.id, "task.yaml"), "utf8");
    expect(snapshot).toContain("key: AW-1");
    expect(snapshot).toContain("title: Fix it");
  });

  it("puts a task with no assignee in the Needs you lane", async () => {
    const reply = await create();
    expect(reply.task.needs_you_lane).toBe(true);
    expect((await d.client.tasks("-", { needs_you: "true" })).map((t) => t.key)).toEqual(["AW-1"]);
  });

  it("finds a task by id, key in any letter case and id prefix", async () => {
    const { task } = await create();
    expect((await d.client.task("-", task.id)).key).toBe("AW-1");
    expect((await d.client.task("-", "aw-1")).id).toBe(task.id);
    expect((await d.client.task("-", task.id.slice(0, 13))).id).toBe(task.id);
  });

  it("edits, assigns and archives with one event each", async () => {
    const { task } = await create();
    const edit = await d.client.editTask("-", "AW-1", { title: "New title", priority: "high" });
    expect(edit.applied).toBe(true);
    expect(edit.task).toMatchObject({ title: "New title", priority: "high" });
    const assign = await d.client.assignTask("-", "AW-1", "claude@ubuntu-01");
    expect(assign.task.assignee).toBe("claude@ubuntu-01");
    const archive = await d.client.archiveTask("-", "AW-1");
    expect(archive.task.archived).toBe(true);
    expect((await logLines(task.id)).map((e) => e.type)).toEqual([
      "task.created",
      "task.edited",
      "task.edited",
      "task.assigned",
      "task.archived",
    ]);
    expect(await d.client.tasks("-", { archived: "false" })).toEqual([]);
  });

  it("archives, stops and unarchives with the rules of openspec task-actions", async () => {
    const { task } = await create();
    const ws = d.server.daemon.workspace();
    // No session: stop gives 409, archive needs no stop.
    expect((await apiError(d.client.stopTaskSession("-", "AW-1"))).message).toBe(
      "No session runs for AW-1.",
    );
    const session = ws.files.newId();
    await ws.files.writeEvent(`tasks/${task.id}/log/macbook-pro.jsonl`, "session.started", {
      session,
      host: "tmux",
      cwd: "/work/billing-api",
    });
    await ws.refresh();
    // A running session: archive without stop gives 409 with the device and the command.
    const refused = await apiError(d.client.archiveTask("-", "AW-1"));
    expect(refused).toMatchObject({ status: 409, code: "conflict" });
    expect(refused.message).toBe(
      'A session runs for AW-1 on macbook-pro. Stop it first, or archive with --stop: "aw task archive AW-1 --stop".',
    );
    const stop = await d.client.stopTaskSession("-", "AW-1");
    expect(stop.applied).toBe(true);
    const archive = await d.client.archiveTask("-", "AW-1", { stop: true });
    expect(archive.task.archived).toBe(true);
    expect((await apiError(d.client.archiveTask("-", "AW-1"))).message).toBe(
      "The task AW-1 is already archived.",
    );
    const unarchive = await d.client.unarchiveTask("-", "AW-1");
    expect(unarchive.task.archived).toBe(false);
    expect((await apiError(d.client.unarchiveTask("-", "AW-1"))).message).toBe(
      "The task AW-1 is not archived.",
    );
    const lines = await logLines(task.id);
    expect(lines.map((e) => e.type)).toEqual([
      "task.created",
      "session.started",
      "session.stop_requested",
      "session.stop_requested",
      "task.archived",
      "task.unarchived",
    ]);
    expect(lines[2]).toMatchObject({ by: "human@macbook-pro", data: { session } });
  });

  it("reports an edit that the merge refused: the first message after the first session", async () => {
    const { task } = await create();
    const ws = d.server.daemon.workspace();
    await ws.files.writeEvent(`tasks/${task.id}/log/macbook-pro.jsonl`, "session.started", {
      session: ws.files.newId(),
      host: "tmux",
      cwd: "/work/billing-api",
    });
    const edit = await d.client.editTask("-", "AW-1", { first_message: "changed" });
    expect(edit.applied).toBe(false);
    expect(edit.results[0]).toMatchObject({ applied: false, reason: "first_message_locked" });
    expect(edit.task.first_message).toContain("/opsx:explore");
  });

  it("gives 409 ambiguous when 2 tasks have the same key", async () => {
    const { task } = await create();
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const other = ubuntu.newId();
    await ubuntu.writeEvent(
      `tasks/${other}/log/ubuntu-01.jsonl`,
      "task.created",
      { key: "AW-1", project: "billing-api", title: "Offline task", first_message: "hi" },
      { task: other, by: "human@ubuntu-01" },
    );
    await d.server.daemon.workspace().refresh();
    const error = await apiError(d.client.task("-", "AW-1"));
    expect(error.status).toBe(409);
    expect(error.code).toBe("ambiguous");
    expect(error.details).toEqual({ ids: expect.arrayContaining([task.id, other]) as unknown });
  });
});

describe("thread", () => {
  it("returns the events in merge order in pages, each event once", async () => {
    await create();
    for (const title of ["A", "B", "C", "D"]) await d.client.editTask("-", "AW-1", { title });
    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = await d.client.thread("-", "AW-1", { limit: 2, ...(after ? { after } : {}) });
      seen.push(...page.events.map((e) => e.id));
      after = page.next ?? undefined;
      pages++;
    } while (after);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    const all = await d.client.thread("-", "AW-1");
    expect(all.events.map((e) => e.id)).toEqual(seen);
    expect(all.events[0]!.type).toBe("task.created");
    expect(all.next).toBeNull();
  });

  it("adds the threads of the parents with ancestors=true", async () => {
    await create("Parent", { assignee: "claude@macbook-pro" });
    await create("Child", { parent: "AW-1" });
    const reply = await d.client.thread("-", "AW-2", { ancestors: "true" });
    expect(reply.ancestors.map((p) => p.task.key)).toEqual(["AW-1"]);
    expect(reply.task.key).toBe("AW-2");
  });

  it("reads the newest page, the page before a cursor, and only some types (0-7)", async () => {
    await create();
    for (let i = 1; i <= 6; i++) await d.client.editTask("-", "AW-1", { title: `T${i}` });
    const all = (await d.client.thread("-", "AW-1")).events.map((e) => e.id);
    expect(all).toHaveLength(7);
    const newest = await d.client.thread("-", "AW-1", { newest: "true", limit: 3 });
    expect(newest.events.map((e) => e.id)).toEqual(all.slice(4));
    expect(newest.next).toBeNull();
    expect(newest.prev).not.toBeNull();
    const older = await d.client.thread("-", "AW-1", { before: newest.prev!, limit: 3 });
    expect(older.events.map((e) => e.id)).toEqual(all.slice(1, 4));
    const oldest = await d.client.thread("-", "AW-1", { before: older.prev!, limit: 3 });
    expect(oldest.events.map((e) => e.id)).toEqual(all.slice(0, 1));
    expect(oldest.prev).toBeNull();
    const created = await d.client.thread("-", "AW-1", { types: "task.created" });
    expect(created.events.map((e) => e.type)).toEqual(["task.created"]);
    const first = await d.client.thread("-", "AW-1", { limit: 3 });
    expect(first.prev).toBeNull();
  });

  it("refuses a cursor that is not <hlc>~<device>~<id>", async () => {
    await create();
    expect((await apiError(d.client.thread("-", "AW-1", { after: "x" }))).status).toBe(400);
  });
});

describe("gates", () => {
  async function gateOfUbuntu(taskId: string) {
    const ubuntu = otherDevice(d.folder, "ubuntu-01");
    const log = `tasks/${taskId}/log/ubuntu-01.jsonl`;
    await ubuntu.writeEvent(
      log,
      "task.claimed",
      { epoch: 1, device: "ubuntu-01", session: ubuntu.newId() },
      { task: taskId, by: "aw@ubuntu-01" },
    );
    const gate = ubuntu.newId();
    await ubuntu.writeEvent(
      log,
      "gate.opened",
      {
        gate,
        kind: "question",
        version: 1,
        title: "Which limit per client?",
        options: ["100/min", "1000/min"],
      },
      { task: taskId, by: "claude@ubuntu-01" },
    );
    await d.server.daemon.workspace().refresh();
    return { ubuntu, gate, log };
  }

  it("answers a gate of another device with a gate.answered line of this device", async () => {
    const { task } = await create("Rate limit", { assignee: "claude@ubuntu-01" });
    const { gate } = await gateOfUbuntu(task.id);
    const open = await d.client.gates("-");
    expect(open.map((g) => g.gate)).toEqual([gate]);
    const reply = await d.client.answerGate("-", gate.slice(0, 13), { answer: "1000/min" });
    expect(reply.applied).toBe(true);
    expect(reply.gate.state).toBe("open");
    expect(reply.gate.answers).toEqual([
      expect.objectContaining({ answer: "1000/min", use: "pending", dev: "macbook-pro" }),
    ]);
    const lines = await logLines(task.id);
    expect(lines.at(-1)).toMatchObject({
      type: "gate.answered",
      data: { gate, version: 1, answer: "1000/min" },
      by: "human@macbook-pro",
    });
  });

  it("gives 409 gate_not_open for a resolved gate and writes nothing", async () => {
    const { task } = await create("Rate limit", { assignee: "claude@ubuntu-01" });
    const { ubuntu, gate, log } = await gateOfUbuntu(task.id);
    await ubuntu.writeEvent(
      log,
      "gate.resolved",
      { gate, version: 1, answer_event: null, answer: "100/min" },
      { task: task.id, by: "aw@ubuntu-01" },
    );
    await d.server.daemon.workspace().refresh();
    expect(await d.client.gates("-")).toEqual([]);
    expect(await d.client.gates("-", { state: "all" })).toHaveLength(1);
    const before = await logLines(task.id);
    const error = await apiError(d.client.answerGate("-", gate, { answer: "1000/min" }));
    expect(error.status).toBe(409);
    expect(error.code).toBe("gate_not_open");
    expect(error.details).toEqual({ gate, answer: "100/min", answer_event: null });
    expect(await logLines(task.id)).toEqual(before);
  });
});

describe("event stream", () => {
  it("sends hello, then changed with the id of a new task", async () => {
    const messages: StreamMessage[] = [];
    const stream = await d.client.events((m) => messages.push(m));
    try {
      const { task } = await create();
      await waitFor(() => messages.some((m) => m.type === "changed" && m.tasks.includes(task.id)));
      expect(messages[0]).toEqual({ type: "hello", version: "0.0.0" });
    } finally {
      stream.close();
    }
  });
});
