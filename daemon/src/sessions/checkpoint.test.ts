// The checkpoint branch rules on real repositories in temp folders (openspec move-paused-task):
// the branch name after a rekey, the fetch and base rule before a worktree, and the push at a Stop
// with its lease and its comment once per cause. The remotes are local bare repositories.
import { execa } from "execa";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitOf } from "../continuity/git-branch.ts";
import {
  checkpointBranch,
  CheckpointPusher,
  prepareBranch,
  pushCheckpoint,
  pushesCheckpoint,
  type PushTarget,
} from "./checkpoint.ts";

let root = "";
const git = (cwd: string, args: string[]) =>
  execa("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);
const commit = async (cwd: string, message: string) => {
  await git(cwd, ["commit", "-q", "--allow-empty", "-m", message]);
  return (await commitOf(cwd, "HEAD"))!;
};

/**
 * A bare origin, the checkout `a` (macbook-pro) and the checkout `b` (ubuntu-01). With `clone`
 * false, no `b`: one git process less for a test that uses only `a` (ptfc-11).
 */
async function setup(options: { clone?: boolean } = {}) {
  const origin = join(root, "origin.git");
  await execa("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const a = join(root, "a");
  await execa("git", ["init", "-q", "-b", "main", a]);
  await commit(a, "init");
  await git(a, ["remote", "add", "origin", origin]);
  await git(a, ["push", "-q", "origin", "main"]);
  const b = join(root, "b");
  if (options.clone !== false) await execa("git", ["clone", "-q", origin, b]);
  return { origin, a, b };
}

const input = (checkout: string, folder: string | null = null) => ({
  checkout,
  local: "aw/AW-1",
  remote: "aw/AW-1",
  folder,
  device: "ubuntu-01",
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-checkpoint-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("checkpointBranch", () => {
  const task = (
    id: string,
    key: string | null,
    branch: string | null,
    project = "billing-api",
  ) => ({
    id,
    key,
    branch,
    project,
  });

  it("uses the branch of the first session, else aw/<key>", () => {
    expect(checkpointBranch(task("t1", "AW-1", null), [])).toBe("aw/AW-1");
    expect(checkpointBranch(task("t1", "AW-3", "aw/AW-1"), [])).toBe("aw/AW-1");
    // A synced record with another branch never makes AW push main (review finding 9).
    expect(checkpointBranch(task("t1", "AW-3", "main"), [])).toBe("aw/AW-3");
    expect(checkpointBranch(task("t1", "AW-3", "aw/../main"), [])).toBe("aw/AW-3");
  });

  it("gives a rekeyed task aw/<own key> when its first branch is the branch of another task", () => {
    const a = task("ta", "AW-1", "aw/AW-1");
    const b = task("tb", "AW-2", "aw/AW-1");
    const tasks = [a, b];
    expect(checkpointBranch(a, tasks)).toBe("aw/AW-1");
    expect(checkpointBranch(b, tasks)).toBe("aw/AW-2");
    // Another project has its own repository: no clash.
    expect(checkpointBranch(b, [task("ta", "AW-1", "aw/AW-1", "web"), b])).toBe("aw/AW-1");
  });
});

describe("prepareBranch", () => {
  it("does nothing with no remote and with no remote branch", async () => {
    const lone = join(root, "lone");
    await execa("git", ["init", "-q", "-b", "main", lone]);
    await commit(lone, "init");
    expect(await prepareBranch(input(lone))).toEqual({ base: null, comment: null });
    const { b } = await setup();
    expect(await prepareBranch(input(b))).toEqual({ base: null, comment: null });
    expect(await commitOf(b, "refs/heads/aw/AW-1")).toBeNull();
  });

  it("makes the local branch at the remote commit of another device", async () => {
    const { a, b } = await setup();
    await git(a, ["checkout", "-q", "-b", "aw/AW-1"]);
    const work = await commit(a, "work of macbook-pro");
    await git(a, ["push", "-q", "origin", "aw/AW-1"]);
    expect(await prepareBranch(input(b))).toEqual({ base: work, comment: null });
    expect(await commitOf(b, "refs/heads/aw/AW-1")).toBe(work);
  });

  it("fast-forwards a stale local branch, also in the folder that has it", async () => {
    const { a, b } = await setup();
    await git(b, ["branch", "aw/AW-1"]);
    const wt = join(root, "b-wt");
    await git(b, ["worktree", "add", "-q", wt, "aw/AW-1"]);
    await git(a, ["checkout", "-q", "-b", "aw/AW-1"]);
    const work = await commit(a, "work of macbook-pro");
    await git(a, ["push", "-q", "origin", "aw/AW-1"]);
    expect(await prepareBranch(input(b, wt))).toEqual({ base: work, comment: null });
    expect(await commitOf(wt, "HEAD")).toBe(work);
  });

  it("keeps a local branch that is ahead", async () => {
    const { a, b } = await setup();
    await git(a, ["push", "-q", "origin", "main:refs/heads/aw/AW-1"]);
    const base = (await commitOf(a, "main"))!;
    await git(b, ["checkout", "-q", "-b", "aw/AW-1"]);
    const own = await commit(b, "own work");
    expect(await prepareBranch(input(b, b))).toEqual({ base, comment: null });
    expect(await commitOf(b, "refs/heads/aw/AW-1")).toBe(own);
  });

  it("keeps a diverged local branch and says so once in a comment", async () => {
    const { a, b } = await setup();
    await git(b, ["checkout", "-q", "-b", "aw/AW-1"]);
    const own = await commit(b, "own work of ubuntu-01");
    await git(a, ["checkout", "-q", "-b", "aw/AW-1"]);
    await commit(a, "work of macbook-pro");
    await git(a, ["push", "-q", "origin", "aw/AW-1"]);
    const result = await prepareBranch(input(b, b));
    expect(result.base).toBeNull();
    expect(result.comment).toBe(
      "aw/AW-1 on ubuntu-01 has commits that origin/aw/AW-1 does not have, and origin/aw/AW-1 has commits that aw/AW-1 does not have. AW keeps the local branch and does not push it. Merge origin/aw/AW-1 into aw/AW-1 by hand.",
    );
    expect(await commitOf(b, "refs/heads/aw/AW-1")).toBe(own);
  });

  it("moves a diverged branch when a wake branch has its own commits", async () => {
    const { a, b } = await setup();
    await git(b, ["checkout", "-q", "-b", "aw/AW-1"]);
    await commit(b, "unpushed work");
    await git(b, ["branch", "aw/AW-1-ubuntu-01-0315"]);
    await git(a, ["checkout", "-q", "-b", "aw/AW-1"]);
    const work = await commit(a, "work of macbook-pro");
    await git(a, ["push", "-q", "origin", "aw/AW-1"]);
    expect(await prepareBranch(input(b, b))).toEqual({ base: work, comment: null });
    expect(await commitOf(b, "HEAD")).toBe(work);
  });

  it("starts from the local branch with one comment when the fetch fails", async () => {
    const { b } = await setup();
    await git(b, ["remote", "set-url", "origin", join(root, "gone.git")]);
    const result = await prepareBranch(input(b));
    expect(result.base).toBeNull();
    expect(result.comment).toMatch(
      /^AW could not fetch aw\/AW-1 from origin \(fatal: .*\)\. The session on ubuntu-01 starts from the local branch aw\/AW-1\.$/,
    );
  });
});

// Each test runs 10 to 20 git processes with hooks and waits for no time: the result does not
// depend on the time, and the limit stops only a hang. 5 s was too short on a busy computer
// (ptfc-11: "writes one comment per cause" took 1.4 s on a quiet one).
describe("checkpoint push at a Stop", { timeout: 20_000 }, () => {
  it("is done only by the running session with the highest claim epoch", () => {
    const session = { state: "running", branch: "aw/AW-1", epoch: 2 };
    expect(pushesCheckpoint(session, 2)).toBe(true);
    expect(pushesCheckpoint(session, 3)).toBe(false);
    expect(pushesCheckpoint({ ...session, state: "moved" }, 2)).toBe(false);
    expect(pushesCheckpoint({ ...session, branch: null }, 2)).toBe(false);
  });

  it("pushes, then refuses a remote commit that the session did not see", async () => {
    const { a, b, origin } = await setup();
    await git(a, ["checkout", "-q", "-b", "aw/AW-1"]);
    const one = await commit(a, "one");
    const target: PushTarget = {
      id: "s1",
      task: "t1",
      cwd: a,
      branch: "aw/AW-1",
      checkpoint: null,
    };
    expect(await pushCheckpoint(target, "aw/AW-1")).toEqual({ kind: "pushed", commit: one });
    target.checkpoint = one;
    expect(await pushCheckpoint(target, "aw/AW-1")).toEqual({ kind: "up_to_date", commit: one });
    // The agent amends its commit: the remote commit is the one the session pushed.
    await git(a, ["commit", "-q", "--amend", "--allow-empty", "-m", "one amended"]);
    const amended = (await commitOf(a, "HEAD"))!;
    expect(await pushCheckpoint(target, "aw/AW-1")).toEqual({ kind: "pushed", commit: amended });
    target.checkpoint = amended;
    // Another device pushed after a move: this session never saw that commit.
    await git(b, ["fetch", "-q", "origin", "aw/AW-1"]);
    await git(b, ["checkout", "-q", "-b", "aw/AW-1", "FETCH_HEAD"]);
    const other = await commit(b, "work of ubuntu-01");
    await git(b, ["push", "-q", "origin", "aw/AW-1"]);
    await commit(a, "late work of macbook-pro");
    expect(await pushCheckpoint(target, "aw/AW-1")).toMatchObject({
      kind: "failed",
      cause: "diverged",
    });
    expect(await commitOf(origin, "aw/AW-1")).toBe(other);
  });

  it("pushes a local branch of the old name to the checkpoint branch of a rekeyed task", async () => {
    const { a, origin } = await setup({ clone: false });
    await git(a, ["checkout", "-q", "-b", "aw/AW-1"]);
    const work = await commit(a, "work of the rekeyed task");
    const target: PushTarget = { id: "s1", task: "t1", cwd: a, branch: "aw/AW-1" };
    expect(await pushCheckpoint(target, "aw/AW-2")).toEqual({ kind: "pushed", commit: work });
    expect(await commitOf(origin, "aw/AW-2")).toBe(work);
    expect(await commitOf(origin, "aw/AW-1")).toBeNull();
  });

  it("writes one comment per cause and a new one after a success", async () => {
    const { a } = await setup({ clone: false });
    await git(a, ["checkout", "-q", "-b", "aw/AW-1"]);
    await commit(a, "one");
    const hook = join(a, ".git", "hooks", "pre-push");
    await writeFile(hook, "#!/bin/sh\necho 'leak check refused' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    const comments: string[] = [];
    const saved: (string | null | undefined)[] = [];
    const pusher = new CheckpointPusher({
      comment: (_task, text) => Promise.resolve(void comments.push(text)),
      save: (t) => Promise.resolve(void saved.push(t.checkpoint)),
      log: { info: () => undefined, warn: () => undefined },
    });
    const target: PushTarget = {
      id: "s1",
      task: "t1",
      cwd: a,
      branch: "aw/AW-1",
      checkpoint: null,
    };
    await pusher.push(target, "aw/AW-1");
    await pusher.push(target, "aw/AW-1");
    expect(comments).toEqual([
      "AW could not push aw/AW-1 to aw/AW-1 on origin: the pre-push hook refused the push (exit code 1). A move to another device starts from the last pushed commit.",
    ]);
    await rm(hook);
    await pusher.push(target, "aw/AW-1");
    expect(saved).toEqual([await commitOf(a, "HEAD")]);
    await writeFile(hook, "#!/bin/sh\nexit 1\n");
    await chmod(hook, 0o755);
    await commit(a, "two");
    await pusher.push(target, "aw/AW-1");
    expect(comments).toHaveLength(2);
  });

  it("runs one more push after a Stop that comes during a push", async () => {
    const { a, origin } = await setup({ clone: false });
    await git(a, ["checkout", "-q", "-b", "aw/AW-1"]);
    await commit(a, "one");
    const pusher = new CheckpointPusher({
      comment: () => Promise.resolve(),
      save: () => Promise.resolve(),
      log: { info: () => undefined, warn: () => undefined },
    });
    const target: PushTarget = {
      id: "s1",
      task: "t1",
      cwd: a,
      branch: "aw/AW-1",
      checkpoint: null,
    };
    const first = pusher.push(target, "aw/AW-1");
    const two = await commit(a, "two");
    const second = pusher.push(target, "aw/AW-1");
    await Promise.all([first, second]);
    await pusher.idle();
    expect(await commitOf(origin, "aw/AW-1")).toBe(two);
  });
});
