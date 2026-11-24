// E2E with real processes (test plan 2): awd as a child process with a temp AW_HOME and a temp AW
// folder, the aw binary, a gate of another device, the files on disk and the index, then SIGKILL
// of awd during writes and a restart.
import { AwClient } from "@aw/client";
import { mergeWorkspace, parseDocumentText, systemClock } from "@aw/core";
import { eventV1 } from "@aw/schema";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSettings } from "../settings.ts";
import { otherDevice, tempDir, waitFor, writeTestConfig } from "../testing.ts";

const AWD = fileURLToPath(new URL("../bin/awd.ts", import.meta.url));
const AW = fileURLToPath(new URL("../bin/aw.ts", import.meta.url));
const run = promisify(execFile);

let home: string;
let folder: string;
let awd: ChildProcess | null = null;
let stderr = "";
const env = () => ({ ...process.env, AW_HOME: home, AW_LOG_LEVEL: "info" });

function startAwd(): ChildProcess {
  const child = spawn(process.execPath, [AWD], { env: env(), stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  return child;
}

async function aw(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await run(process.execPath, [AW, ...args], { env: env(), cwd: folder });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

async function waitReady(client: AwClient): Promise<void> {
  await waitFor(async () => {
    try {
      return (await client.ready()).ready;
    } catch {
      return false;
    }
  }, 10_000);
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

beforeAll(async () => {
  home = await tempDir("awe-");
  folder = await tempDir("awf-");
  await writeTestConfig(loadSettings({ AW_HOME: home, HOME: home }));
});

afterAll(async () => {
  awd?.kill("SIGKILL");
  await rm(home, { recursive: true, force: true });
  await rm(folder, { recursive: true, force: true });
});

describe("awd and aw as real processes", { timeout: 60_000 }, () => {
  const socketPath = () => join(home, "run", "awd.sock");
  let client: AwClient;
  let taskId: string;
  let gate: string;

  it("starts awd with a 0600 socket in a 0700 folder", async () => {
    awd = startAwd();
    client = new AwClient({ socketPath: socketPath() });
    await waitReady(client);
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, "run"))).mode & 0o777).toBe(0o700);
    expect((await stat(socketPath())).mode & 0o777).toBe(0o600);
    expect(stderr).not.toContain("ExperimentalWarning");
  });

  it("runs the CLI flow: workspace, project, task from a file, list as JSON", async () => {
    expect((await aw(["workspace", "init", folder, "--name", "acme"])).code).toBe(0);
    expect((await aw(["project", "add", "billing-api"])).code).toBe(0);
    await writeFile(
      join(folder, "first.md"),
      "/opsx:explore Add a rate limit to the public API.\n",
    );
    const created = await aw([
      "task",
      "create",
      "--project",
      "billing-api",
      "--title",
      "Rate limit",
      "--first-message-file",
      "first.md",
      "--assignee",
      "claude@ubuntu-01",
    ]);
    expect(created.code).toBe(0);
    expect(created.stdout).toMatch(/^Created AW-1 /);
    const list = await aw(["task", "list", "--json"]);
    expect(list.code).toBe(0);
    const tasks = JSON.parse(list.stdout) as { id: string; key: string; first_message: string }[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.first_message).toBe("/opsx:explore Add a rate limit to the public API.\n");
    taskId = tasks[0]!.id;
  });

  it("indexes a gate that another device opened and answers it with aw gate answer", async () => {
    const ubuntu = otherDevice(folder, "ubuntu-01");
    const log = `tasks/${taskId}/log/ubuntu-01.jsonl`;
    await ubuntu.writeEvent(
      log,
      "task.claimed",
      { epoch: 1, device: "ubuntu-01", session: ubuntu.newId() },
      { task: taskId, by: "aw@ubuntu-01" },
    );
    gate = ubuntu.newId();
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
    await waitFor(async () => (await aw(["gate", "list", "--json"])).stdout.includes(gate), 5000);
    const answer = await aw(["gate", "answer", gate, "1000/min", "--json"]);
    expect(answer.code).toBe(0);
    expect(JSON.parse(answer.stdout)).toMatchObject({ applied: true, gate: { state: "open" } });
  });

  it("has the events in the log of this device with valid schemas, and the index shows the answer", async () => {
    const text = await readFile(join(folder, "tasks", taskId, "log", "macbook-pro.jsonl"), "utf8");
    const events = text
      .trimEnd()
      .split("\n")
      .map((line) => eventV1.parse(JSON.parse(line)));
    expect(events.map((e) => e.type)).toEqual(["task.created", "gate.answered"]);
    expect(events[1]).toMatchObject({
      by: "human@macbook-pro",
      data: { gate, version: 1, answer: "1000/min" },
    });
    const workspaceId = (await client.workspaces())[0]!.id;
    const db = new DatabaseSync(join(home, "index", `${workspaceId}.sqlite`), { readOnly: true });
    try {
      const row = db.prepare("SELECT json FROM tasks WHERE id = ?").get(taskId) as { json: string };
      const task = JSON.parse(row.json) as {
        gates: { gate: string; answers: { answer: string; use: string }[] }[];
      };
      expect(task.gates[0]).toMatchObject({
        gate,
        answers: [{ answer: "1000/min", use: "pending" }],
      });
    } finally {
      db.close();
    }
  });

  it("leaves no broken file and the same view after SIGKILL during writes", async () => {
    const pending = Array.from({ length: 40 }, (_, i) =>
      client.createTask("-", {
        project: "billing-api",
        title: `Load ${i}`,
        first_message: `m${i}`,
      }),
    );
    const ok: string[] = [];
    // Kill awd as soon as the first write of the batch has an answer: the other writes are open.
    await Promise.race(pending.map((p) => p.then((r) => ok.push(r.task.id))));
    awd!.kill("SIGKILL");
    const settled = await Promise.allSettled(pending);
    for (const result of settled)
      if (result.status === "fulfilled" && !ok.includes(result.value.task.id))
        ok.push(result.value.task.id);
    expect(settled.some((r) => r.status === "rejected")).toBe(true);
    await new Promise<void>((resolve) => awd!.once("exit", () => resolve()));

    awd = startAwd();
    await waitReady(client);

    for (const file of await filesUnder(join(folder, "tasks"))) {
      const path = relative(folder, file);
      expect(path.endsWith(".aw-tmp"), path).toBe(false);
      if (path.endsWith(".yaml"))
        expect(() => parseDocumentText(readFileSync(file, "utf8"), path)).not.toThrow();
    }
    const merged = await mergeWorkspace(folder, { clock: systemClock });
    expect(
      merged.view.issues.filter((i) =>
        ["bad_line", "partial_tail", "bad_document"].includes(i.code),
      ),
    ).toEqual([]);
    const listed = await client.tasks("-");
    for (const id of ok) expect(listed.map((t) => t.id)).toContain(id);
    const project = (t: {
      id: string;
      key: string | null;
      title: string | null;
      stage: string;
      gates: unknown[];
    }) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      stage: t.stage,
      gates: t.gates,
    });
    expect(listed.map(project)).toEqual(
      merged.view.tasks
        .slice()
        .sort(
          (a, b) => listed.findIndex((t) => t.id === a.id) - listed.findIndex((t) => t.id === b.id),
        )
        .map(project),
    );
    expect(new Set(listed.map((t) => t.key)).size).toBe(listed.length);
  });
});
