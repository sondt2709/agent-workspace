// End-to-end tests of the checkpoint branch (openspec move-paused-task, docs/architecture.md 4.6
// item 8): awd, a real tmux on a private socket, the fake agent and a local bare repository as
// `origin`. Never a real remote.
import { execa } from "execa";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../testing.ts";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;
const folders: string[] = [];

afterEach(async () => {
  await awd?.close();
  awd = null;
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

const data = (row: { event: unknown }) => (row.event as { data: Record<string, unknown> }).data;
const git = (cwd: string, args: string[]) =>
  execa(
    "git",
    ["-C", cwd, "-c", "user.name=AW Test", "-c", "user.email=test@example.com", ...args],
    {
      reject: false,
    },
  );

/** A bare repository as `origin` of the checkout, with `main` pushed. */
async function bareRemote(checkout: string): Promise<string> {
  const dir = await tempDir("aw-remote-");
  folders.push(dir);
  const bare = join(dir, "project.git");
  await execa("git", ["init", "-q", "--bare", "-b", "main", bare]);
  await git(checkout, ["remote", "add", "origin", bare]);
  expect((await git(checkout, ["push", "-q", "origin", "main"])).exitCode).toBe(0);
  return bare;
}

async function subjects(repo: string, ref: string): Promise<string[]> {
  const log = await git(repo, ["log", "--format=%s", ref]);
  return log.exitCode === 0 ? String(log.stdout).split("\n") : [];
}

describe.skipIf(!TEST_TMUX)("checkpoint branch with tmux and the fake agent", () => {
  it("pushes aw/<key> to origin at the Stop after the agent commits", async () => {
    awd = await startSessionDaemon();
    const bare = await bareRemote(awd.checkout);
    // CI runners have no git identity: the agent command gives one.
    const task = await awd.createTask(
      "bash git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m work-of-macbook-pro",
    );
    const opened = await awd.waitRow(
      task.id,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_command",
    );
    await awd.answerFrom("pixel-9", task.id, String(data(opened).gate), "Allow once");
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const branch = `aw/${task.key}`;
    await waitFor(
      async () => (await subjects(bare, branch)).includes("work-of-macbook-pro"),
      20_000,
    );
    expect(await subjects(bare, branch)).toEqual(["work-of-macbook-pro", "init"]);
  }, 60_000);

  it("bases the worktree of a moved task on origin aw/<key>", async () => {
    awd = await startSessionDaemon();
    const bare = await bareRemote(awd.checkout);
    const reply = await awd.client.createTask("-", {
      project: "billing-api",
      title: "Moved task",
      first_message: "reply started",
    });
    const task = reply.task as { id: string; key: string };
    // Another device pushed its checkpoint of the task before the move.
    const other = await tempDir("aw-other-");
    folders.push(other);
    expect((await execa("git", ["clone", "-q", bare, join(other, "repo")])).exitCode).toBe(0);
    const repo = join(other, "repo");
    await git(repo, ["checkout", "-q", "-b", `aw/${task.key}`]);
    await git(repo, ["commit", "-q", "--allow-empty", "-m", "work-of-ubuntu-01"]);
    expect((await git(repo, ["push", "-q", "origin", `aw/${task.key}`])).exitCode).toBe(0);

    await awd.client.assignTask("-", task.id, "claude@macbook-pro");
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const worktree = awd.worktree(task.id);
    expect(await subjects(worktree, "HEAD")).toEqual(["work-of-ubuntu-01", "init"]);
  }, 60_000);

  it("never moves the task branch in a checkout of the person (fix list 0-0e)", async () => {
    awd = await startSessionDaemon();
    const bare = await bareRemote(awd.checkout);
    const reply = await awd.client.createTask("-", {
      project: "billing-api",
      title: "Read by the person",
      first_message: "reply started",
    });
    const task = reply.task as { id: string; key: string };
    const branch = `aw/${task.key}`;
    const other = await tempDir("aw-other-");
    folders.push(other);
    expect((await execa("git", ["clone", "-q", bare, join(other, "repo")])).exitCode).toBe(0);
    const repo = join(other, "repo");
    await git(repo, ["checkout", "-q", "-b", branch]);
    await git(repo, ["commit", "-q", "--allow-empty", "-m", "first-of-ubuntu-01"]);
    expect((await git(repo, ["push", "-q", "origin", branch])).exitCode).toBe(0);
    // The person reads the work in the own checkout; then ubuntu-01 pushes more.
    await git(awd.checkout, ["fetch", "-q", "origin"]);
    await git(awd.checkout, ["checkout", "-q", "-b", branch, `origin/${branch}`]);
    await git(repo, ["commit", "-q", "--allow-empty", "-m", "second-of-ubuntu-01"]);
    expect((await git(repo, ["push", "-q", "origin", branch])).exitCode).toBe(0);
    await awd.client.assignTask("-", task.id, "claude@macbook-pro");
    await awd.waitRow(
      task.id,
      (r) =>
        r.type === "comment.added" && String(data(r).text).includes("did not make for this task"),
      30_000,
    );
    expect(await subjects(awd.checkout, "HEAD")).toEqual(["first-of-ubuntu-01", "init"]);
  }, 90_000);

  it("moves only the task branch when the agent checked out another branch in its worktree", async () => {
    awd = await startSessionDaemon();
    const bare = await bareRemote(awd.checkout);
    const task = await awd.createTask("reply started");
    await awd.waitRow(task.id, (r) => r.type === "message.agent");
    const worktree = awd.worktree(task.id);
    // The agent checks out another branch of the person (fix list 0-0d).
    expect((await git(worktree, ["checkout", "-q", "-b", "person-work"])).exitCode).toBe(0);
    // The human moves the task away; ubuntu-01 pushes its checkpoint; the human moves it back.
    await awd.client.assignTask("-", task.id, "claude@ubuntu-01");
    await awd.waitRow(task.id, (r) => r.type === "session.ended");
    const other = await tempDir("aw-other-");
    folders.push(other);
    expect((await execa("git", ["clone", "-q", bare, join(other, "repo")])).exitCode).toBe(0);
    const repo = join(other, "repo");
    await git(repo, ["checkout", "-q", "-b", `aw/${task.key}`]);
    await git(repo, ["commit", "-q", "--allow-empty", "-m", "work-of-ubuntu-01"]);
    expect((await git(repo, ["push", "-q", "origin", `aw/${task.key}`])).exitCode).toBe(0);
    await awd.client.assignTask("-", task.id, "claude@macbook-pro");
    await waitFor(
      async () => (await awd!.rows(task.id)).filter((r) => r.type === "session.started").length > 1,
      30_000,
    );
    // The branch of the person keeps its commit; the session works on aw/<key> from origin.
    expect(await subjects(awd.checkout, "person-work")).toEqual(["init"]);
    const started = (await awd.rows(task.id)).filter((r) => r.type === "session.started");
    expect(data(started.at(-1)!).branch).toBe(`aw/${task.key}`);
    const head = await git(worktree, ["symbolic-ref", "--short", "HEAD"]);
    expect(String(head.stdout)).toBe(`aw/${task.key}`);
    expect(await subjects(worktree, "HEAD")).toEqual(["work-of-ubuntu-01", "init"]);
  }, 90_000);
});
