// The move journey on 2 awd containers (docs/prd.md 7.4, openspec move-paused-task): the agent on
// macbook-pro commits, and awd pushes `aw/<key>` at the Stop to a bare repository that both devices
// reach. macbook-pro stops (docker compose pause). ubuntu-01 shows "Paused: macbook-pro offline"
// and moves nothing by itself. The human assigns the task to claude@ubuntu-01; ubuntu-01 claims it
// and its worktree has the commit of macbook-pro. When macbook-pro comes back, it stops its session
// and pushes its unpushed work as a wake branch, with the hooks. Run it with "task e2e". Each step
// writes one "EVIDENCE {json}" line to stdout.
import type { Task, ThreadReply } from "@aw/client";
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
const REMOTE = "/remote/demo.git";
const CHECKOUT = "/aw/demo";
const HOOK_LOG = "/aw/pre-push.log";
const GIT_USER = ["-c", "user.name=Agent", "-c", "user.email=agent@example.com"];

function evidence(step: string, data: Record<string, unknown>): void {
  process.stdout.write(`EVIDENCE ${JSON.stringify({ step, ...data })}\n`);
}

const status = (device: Device) =>
  awJson<{ engine: string; sync_id: string | null; peers: { connected: boolean }[] }>(device, [
    "sync",
    "status",
  ]);
const git = (device: Device, args: string[]) => exec(device, ["git", ...args]);
const thread = (device: Device, task: string) =>
  awJson<ThreadReply>(device, ["thread", task, "--limit", "1000"]);
const data = (row: { event: { data: unknown } }) => row.event.data as Record<string, unknown>;

async function remoteLog(ref: string): Promise<string[]> {
  const log = await git(A, ["-C", REMOTE, "log", "--format=%s", ref]);
  return log.code === 0 ? log.stdout.trim().split("\n") : [];
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
  await compose(["unpause", A]);
  await compose(["down", "-v", "--remove-orphans"]);
});

describe("move a paused task to another device", () => {
  let task: Task;
  let worktreeA = "";

  it("1. pairs the 2 devices, makes the project remote, and binds a checkout on each", async () => {
    expect((await aw(A, ["workspace", "init", WORKSPACE, "--name", "demo"])).code).toBe(0);
    expect((await aw(A, ["project", "add", PROJECT_SLUG])).code).toBe(0);
    expect(
      (await aw(A, ["project", "edit", PROJECT_SLUG, "--device", A, "--device", B])).code,
    ).toBe(0);
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

    // The project remote: a bare repository on the shared volume, with main.
    expect((await git(A, ["init", "-q", "--bare", "-b", "main", REMOTE])).code).toBe(0);
    expect((await git(A, ["init", "-q", "-b", "main", CHECKOUT])).code).toBe(0);
    await git(A, ["-C", CHECKOUT, ...GIT_USER, "commit", "-q", "--allow-empty", "-m", "init"]);
    await git(A, ["-C", CHECKOUT, "remote", "add", "origin", REMOTE]);
    expect((await git(A, ["-C", CHECKOUT, "push", "-q", "origin", "main"])).code).toBe(0);
    expect((await git(B, ["clone", "-q", REMOTE, CHECKOUT])).code).toBe(0);
    // A pre-push hook on macbook-pro that logs each run: AW must not skip it.
    const hook = `${CHECKOUT}/.git/hooks/pre-push`;
    await exec(A, ["sh", "-c", `printf '#!/bin/sh\\necho "$2" >> ${HOOK_LOG}\\n' > ${hook}`]);
    await exec(A, ["chmod", "755", hook]);
    // ubuntu-01 binds its checkout after the project file arrived there.
    await waitFor(
      async () =>
        (await awJson<{ slug: string; devices: string[] }[]>(B, ["project", "list"])).some(
          (p) => p.slug === PROJECT_SLUG && p.devices.includes(B),
        ),
      30_000,
      "the project on B",
    );
    for (const device of [A, B]) {
      const bound = await aw(device, ["binding", "set", PROJECT_SLUG, CHECKOUT]);
      expect(bound.code, bound.stderr).toBe(0);
    }
  }, 180_000);

  it("2. the agent on macbook-pro commits, and awd pushes aw/<key> at the Stop", async () => {
    const reply = await awJson<{ task: Task }>(A, [
      "task",
      "create",
      "--project",
      PROJECT_SLUG,
      "--title",
      "Add rate limit to the billing API",
      "--assignee",
      `claude@${A}`,
      "--first-message",
      `bash git ${GIT_USER.join(" ")} commit -q --allow-empty -m work-of-macbook-pro`,
    ]);
    task = reply.task;
    const gate = await waitFor(
      async () =>
        (await thread(A, task.id)).events.find(
          (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
        ),
      90_000,
      "the approve_command gate on A",
    );
    expect((await aw(A, ["gate", "answer", String(data(gate).gate), "Allow once"])).code).toBe(0);
    const branch = `aw/${task.key}`;
    await waitFor(
      async () => (await remoteLog(branch)).includes("work-of-macbook-pro"),
      60_000,
      `${branch} on the remote`,
    );
    worktreeA = `/aw/state/worktrees/aw-${task.key}`;
    evidence("checkpoint-pushed", {
      remote_branches: (await git(A, ["-C", REMOTE, "branch", "--list", "aw/*"])).stdout.trim(),
      remote_log: await remoteLog(branch),
      pre_push_log: (await exec(A, ["cat", HOOK_LOG])).stdout.trim(),
    });
    expect(await remoteLog(branch)).toEqual(["work-of-macbook-pro", "init"]);
    expect((await exec(A, ["cat", HOOK_LOG])).stdout).toContain(REMOTE);
    // Work after the last Stop: a commit and a file that nobody added. It is not on the remote.
    await git(A, [
      "-C",
      worktreeA,
      ...GIT_USER,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "late-work-of-macbook-pro",
    ]);
    await exec(A, ["sh", "-c", `echo draft > ${worktreeA}/notes.txt`]);
    await waitFor(
      async () => (await awJson<Task>(B, ["task", "show", task.id])).owner === A,
      60_000,
      "the claim of A on B",
    );
  }, 180_000);

  it("3. macbook-pro stops; ubuntu-01 shows the pause and moves nothing by itself", async () => {
    const before = await aw(B, ["task", "show", task.key!]);
    expect((await compose(["pause", A])).code).toBe(0);
    const paused = await waitFor(
      async () => {
        const shown = await aw(B, ["task", "show", task.key!]);
        return shown.stdout.includes(`Paused:    ${A} offline`) ? shown : false;
      },
      180_000,
      "the offline pause on B",
      2000,
    );
    const list = await aw(B, ["task", "list"]);
    const rows = (await thread(B, task.id)).events;
    evidence("paused-on-b", {
      show_before_pause: before.stdout.trim(),
      show: paused.stdout.trim(),
      list: list.stdout.trim(),
      rows: rows.map((r) => `${r.type} ${r.event.by} ${r.applied ? "" : "(not applied)"}`),
    });
    expect(list.stdout).toContain(`(paused: ${A} offline)`);
    // AW moved nothing: no assignment and no claim of ubuntu-01 before the human acts.
    // The first assignee is in task.created; a move would be a task.assigned.
    expect(rows.some((r) => r.type === "task.assigned")).toBe(false);
    expect(rows.some((r) => r.type === "task.claimed" && data(r).device === B)).toBe(false);
  }, 240_000);

  it("4. the human assigns it to claude@ubuntu-01, which continues from aw/<key>", async () => {
    expect((await aw(B, ["task", "assign", task.key!, `claude@${B}`])).code).toBe(0);
    const claim = await waitFor(
      async () =>
        (await thread(B, task.id)).events.find(
          (r) => r.type === "task.claimed" && data(r).device === B && r.applied,
        ),
      90_000,
      "the claim of B",
    );
    const worktreeB = `/aw/state/worktrees/aw-${task.key}`;
    const log = await waitFor(
      async () => {
        const result = await git(B, ["-C", worktreeB, "log", "--format=%s"]);
        return result.code === 0 ? result.stdout.trim().split("\n") : false;
      },
      60_000,
      "the worktree on B",
    );
    evidence("continued-on-b", {
      claim: data(claim),
      worktree_log_b: log,
      branch_b: (await git(B, ["-C", worktreeB, "branch", "--show-current"])).stdout.trim(),
      show: (await aw(B, ["task", "show", task.key!])).stdout.trim(),
    });
    expect(data(claim).epoch).toBe(2);
    expect(log).toEqual(["work-of-macbook-pro", "init"]);
  }, 180_000);

  it("5. macbook-pro comes back, stops its session and pushes its unpushed work", async () => {
    expect((await compose(["unpause", A])).code).toBe(0);
    const comment = await waitFor(
      async () =>
        (await thread(B, task.id)).events.find(
          (r) =>
            r.type === "comment.added" &&
            String(data(r).text).startsWith(`Moved to ${B}. Unpushed work of ${A}`),
        ),
      180_000,
      "the wake comment on B",
      2000,
    );
    const text = String(data(comment).text);
    const branch = /is on (aw\/\S+)\./.exec(text)?.[1] ?? "";
    evidence("wake-branch", {
      comment: text,
      remote_branches: (await git(A, ["-C", REMOTE, "branch", "--list", "aw/*"])).stdout.trim(),
      wake_log: await remoteLog(branch),
      pre_push_log: (await exec(A, ["cat", HOOK_LOG])).stdout.trim(),
      checkpoint_log: await remoteLog(`aw/${task.key}`),
    });
    expect(branch).toMatch(new RegExp(`^aw/${task.key}-${A}-\\d{4}$`));
    expect(await remoteLog(branch)).toEqual([
      "late-work-of-macbook-pro",
      "work-of-macbook-pro",
      "init",
    ]);
    expect(text).toContain(`1 untracked file stays in the worktree on ${A}: notes.txt.`);
    // The hook ran for the checkpoint push and for the wake push.
    const runs = (await exec(A, ["cat", HOOK_LOG])).stdout.trim().split("\n");
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((line) => line === REMOTE)).toBe(true);
  }, 240_000);
});
