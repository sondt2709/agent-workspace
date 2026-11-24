// The remove of a project on 2 awd containers (docs/phase-1.md 6.9, openspec project-remove):
// ubuntu-01 pairs and runs a session of the project. The person removes the project on
// macbook-pro. ubuntu-01 stops its session, removes its worktree, its branch and its checkout, and
// both devices show neither the project nor its task. The person adds the same slug again with a
// new folder; a new task runs on ubuntu-01 in the new folder. Run it with "task e2e". Each step
// writes one "EVIDENCE {json}" line to stdout.
import type { SyncStatusReply, Task, ThreadReply } from "@aw/client";
import type { PairingView } from "@aw/client/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aw, awJson, compose, exec, waitFor, WORKSPACE, type Device } from "./compose.ts";

const A: Device = "macbook-pro";
const B: Device = "ubuntu-01";
const SLUG = "demo-api";
const REMOTE = "/remote/demo.git";
const OLD = "/aw/wrong-folder";
const NEW = "/aw/demo";
const GIT_USER = ["-c", "user.name=Agent", "-c", "user.email=agent@example.com"];
const ASK = "ask Which limit per client? | 100/min|1000/min";

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

const status = (device: Device) => awJson<SyncStatusReply>(device, ["sync", "status"]);
const git = (device: Device, args: string[]) => exec(device, ["git", ...args]);
const thread = (device: Device, task: string) =>
  awJson<ThreadReply>(device, ["thread", task, "--limit", "1000"]);
const data = (row: { event: { data: unknown } }) => row.event.data as Record<string, unknown>;
const sessions = (device: Device) =>
  awJson<{ id: string; task: string; state: string; cwd: string }[]>(device, ["session", "list"]);
const projects = (device: Device) =>
  awJson<{ slug: string; tasks: string[] }[]>(device, ["project", "list"]);
const tasks = (device: Device) => awJson<Task[]>(device, ["task", "list", "--all"]);
const checkouts = async (device: Device) =>
  (await awJson<{ checkouts: { project: string; path: string }[] }>(device, ["binding", "show"]))
    .checkouts;

async function clone(device: Device, path: string): Promise<void> {
  expect((await git(device, ["clone", "-q", REMOTE, path])).code).toBe(0);
}

async function newTask(): Promise<Task> {
  const reply = await awJson<{ task: Task }>(A, [
    "task",
    "create",
    "--project",
    SLUG,
    "--title",
    "Add rate limits",
    "--assignee",
    `claude@${B}`,
    "--first-message",
    ASK,
  ]);
  return reply.task;
}

async function questionOnA(task: Task): Promise<void> {
  await waitFor(
    async () =>
      (await thread(A, task.id)).events.find(
        (r) => r.type === "gate.opened" && data(r).kind === "question",
      ),
    120_000,
    `the question of ${task.key} on A`,
    1000,
  );
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
}, 900_000);

afterAll(async () => {
  await compose(["down", "-v", "--remove-orphans"]);
});

describe("remove a project while a session runs on the other device", () => {
  let task: Task;
  let session: { id: string; cwd: string };

  it("1. pairs ubuntu-01, and binds the project to a folder on each device", async () => {
    expect((await aw(A, ["workspace", "init", WORKSPACE, "--name", "demo"])).code).toBe(0);
    expect((await aw(A, ["project", "add", SLUG])).code).toBe(0);
    expect((await aw(A, ["project", "edit", SLUG, "--device", B, "--device", A])).code).toBe(0);
    await waitFor(
      async () =>
        (await exec(A, ["test", "-f", `${WORKSPACE}/tasks/devices/${A}/device.yaml`])).code === 0,
      30_000,
      "the own record of A",
    );
    const offer = await awJson<PairingView>(A, ["device", "add", "--no-wait"]);
    const joined = await awJson<PairingView>(B, [
      "pair",
      offer.code!,
      "--path",
      WORKSPACE,
      "--no-wait",
    ]);
    await waitFor(
      async () =>
        (await aw(A, ["--json", "device", "approve", offer.id, joined.check_code!])).code === 0,
      60_000,
      "the approval of ubuntu-01",
      1000,
    );
    await waitFor(
      async () => (await status(A)).peers.find((p) => p.device === B && p.connected),
      120_000,
      "A connected to B",
    );
    expect((await git(A, ["init", "-q", "--bare", "-b", "main", REMOTE])).code).toBe(0);
    expect((await git(A, ["init", "-q", "-b", "main", NEW])).code).toBe(0);
    await git(A, ["-C", NEW, ...GIT_USER, "commit", "-q", "--allow-empty", "-m", "init"]);
    await git(A, ["-C", NEW, "remote", "add", "origin", REMOTE]);
    expect((await git(A, ["-C", NEW, "push", "-q", "origin", "main"])).code).toBe(0);
    // The wrong folder of the owner journey: the project points to another clone on B.
    await clone(B, OLD);
    await waitFor(
      async () => (await projects(B)).some((p) => p.slug === SLUG),
      60_000,
      "the project on B",
    );
    expect((await aw(B, ["binding", "set", SLUG, OLD])).code).toBe(0);
    expect((await aw(A, ["binding", "set", SLUG, NEW])).code).toBe(0);
    evidence("bound", { b: await checkouts(B), a: await checkouts(A) });
  }, 300_000);

  it("2. a session of the project runs on ubuntu-01 in the old folder", async () => {
    task = await newTask();
    await questionOnA(task);
    const list = await sessions(B);
    session = list.find((s) => s.task === task.id && s.state === "running")!;
    expect(session).toBeTruthy();
    const common = await git(B, ["-C", session.cwd, "rev-parse", "--git-common-dir"]);
    evidence("running-on-b", { task: task.key, session: session.id, cwd: session.cwd });
    expect(common.stdout.trim()).toBe(`${OLD}/.git`);
  }, 240_000);

  it("3. remove on macbook-pro: ubuntu-01 stops the session and cleans its folders", async () => {
    const preview = await aw(A, ["project", "remove", SLUG]);
    expect(preview.code).toBe(1);
    expect(preview.stdout).toContain(`${task.key} on ${B}`);
    const started = Date.now();
    const removed = await aw(A, ["project", "remove", SLUG, "--yes"]);
    expect(removed.code, removed.stderr).toBe(0);
    const stopped = await waitFor(
      async () => {
        const list = await sessions(B);
        return list.find((s) => s.id === session.id && s.state === "stopped") ? list : null;
      },
      60_000,
      "the stopped session on B",
      500,
    );
    const stopMs = Date.now() - started;
    await waitFor(
      async () => (await exec(B, ["test", "-d", session.cwd])).code !== 0,
      30_000,
      "the worktree of B removed",
    );
    await waitFor(async () => (await checkouts(B)).length === 0, 30_000, "no checkout on B");
    const branches = (await git(B, ["-C", OLD, "branch", "--format=%(refname:short)"])).stdout;
    const viewA = { projects: await projects(A), tasks: await tasks(A) };
    const viewB = await waitFor(
      async () => {
        const [p, t] = [await projects(B), await tasks(B)];
        return p.length === 0 && t.length === 0 ? { projects: p, tasks: t } : null;
      },
      30_000,
      "the view of B",
    );
    const files = await exec(B, ["ls", `${WORKSPACE}/tasks/${task.id}/log`]);
    evidence("removed", {
      reply: removed.stdout.trim(),
      session_stopped_ms: stopMs,
      sessions_b: stopped.map((s) => `${s.task} ${s.state}`),
      branches_b: branches.trim().split("\n"),
      checkouts_b: await checkouts(B),
      view_a: viewA,
      view_b: viewB,
      task_logs_on_b: files.stdout.trim().split("\n"),
    });
    expect(viewA).toEqual({ projects: [], tasks: [] });
    expect(branches).not.toContain(`aw/${task.key}`);
    // The files stay (principle 8).
    expect(files.stdout).toContain(`${B}.jsonl`);
  }, 180_000);

  it("4. add the same slug again with the right folder: a new task runs on ubuntu-01 there", async () => {
    const added = await aw(A, ["project", "add", SLUG]);
    expect(added.code, added.stderr).toBe(0);
    expect((await aw(A, ["project", "edit", SLUG, "--device", B, "--device", A])).code).toBe(0);
    await waitFor(
      async () => (await projects(B)).some((p) => p.slug === SLUG),
      60_000,
      "the new project on B",
    );
    await clone(B, NEW);
    expect((await aw(B, ["binding", "set", SLUG, NEW])).code).toBe(0);
    const next = await newTask();
    await questionOnA(next);
    const running = (await sessions(B)).find((s) => s.task === next.id && s.state === "running")!;
    const common = await git(B, ["-C", running.cwd, "rev-parse", "--git-common-dir"]);
    const [pa, pb] = [await projects(A), await projects(B)];
    evidence("added-again", {
      key: next.key,
      cwd: running.cwd,
      git_common_dir: common.stdout.trim(),
      projects_a: pa,
      projects_b: pb,
      checkouts_b: await checkouts(B),
    });
    expect(next.key).toBe("AW-2");
    expect(common.stdout.trim()).toBe(`${NEW}/.git`);
    expect(pa.map((p) => p.tasks.length)).toEqual([1]);
    expect(pb.map((p) => p.tasks.length)).toEqual([1]);
  }, 300_000);
});
