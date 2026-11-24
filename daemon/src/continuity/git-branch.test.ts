// The git adapter of the branch pushes on real repositories in temp folders (openspec
// move-paused-task). The remotes are local bare repositories.
import { execa } from "execa";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitOf, fetchBranch, hookFile, pushBranch, scrubUrls } from "./git-branch.ts";

let root = "";
const git = (cwd: string, args: string[]) =>
  execa("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);

async function repoWithRemote(): Promise<{ repo: string; origin: string }> {
  const origin = join(root, "origin.git");
  await execa("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const repo = join(root, "repo");
  await execa("git", ["init", "-q", "-b", "main", repo]);
  await git(repo, ["commit", "-q", "--allow-empty", "-m", "one"]);
  await git(repo, ["remote", "add", "origin", origin]);
  await git(repo, ["push", "-q", "origin", "main"]);
  return { repo, origin };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-git-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("fetchBranch", () => {
  it("gives no_remote, no_branch, then the commit of the remote branch", async () => {
    const lone = join(root, "lone");
    await execa("git", ["init", "-q", "-b", "main", lone]);
    expect(await fetchBranch(lone, "aw/AW-1")).toEqual({ kind: "no_remote" });
    const { repo } = await repoWithRemote();
    expect(await fetchBranch(repo, "aw/AW-1")).toEqual({ kind: "no_branch" });
    await git(repo, ["push", "-q", "origin", "main:refs/heads/aw/AW-1"]);
    const main = await commitOf(repo, "main");
    expect(await fetchBranch(repo, "aw/AW-1")).toEqual({ kind: "fetched", commit: main });
    expect(await commitOf(repo, "refs/remotes/origin/aw/AW-1")).toBe(main);
  });

  it("gives failed with the git error for a remote that does not answer", async () => {
    const { repo } = await repoWithRemote();
    await git(repo, ["remote", "set-url", "origin", join(root, "missing.git")]);
    const result = await fetchBranch(repo, "aw/AW-1");
    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.error).toMatch(/^fatal:/);
  });
});

describe("pushBranch", () => {
  it("pushes with an empty lease only when the remote branch does not exist", async () => {
    const { repo, origin } = await repoWithRemote();
    await git(repo, ["branch", "aw/AW-1"]);
    const first = await pushBranch({ cwd: repo, local: "aw/AW-1", remote: "aw/AW-1", lease: null });
    expect(first).toEqual({ kind: "pushed", commit: await commitOf(repo, "aw/AW-1") });
    expect(await commitOf(origin, "aw/AW-1")).toBe(await commitOf(repo, "aw/AW-1"));
    await git(repo, ["commit", "-q", "--allow-empty", "-m", "two"]);
    await git(repo, ["branch", "-f", "aw/AW-1", "HEAD"]);
    const again = await pushBranch({ cwd: repo, local: "aw/AW-1", remote: "aw/AW-1", lease: null });
    expect(again.kind).toBe("rejected");
  });

  it("refuses a stale lease and accepts the right one, also for a rewrite", async () => {
    const { repo, origin } = await repoWithRemote();
    const one = (await commitOf(repo, "main"))!;
    await git(repo, ["push", "-q", "origin", "main:refs/heads/aw/AW-1"]);
    await git(repo, ["checkout", "-q", "-b", "aw/AW-1"]);
    await git(repo, ["commit", "-q", "--amend", "--allow-empty", "-m", "amended one"]);
    const stale = await pushBranch({
      cwd: repo,
      local: "aw/AW-1",
      remote: "aw/AW-1",
      lease: "0".repeat(40),
    });
    expect(stale.kind).toBe("rejected");
    expect(await commitOf(origin, "aw/AW-1")).toBe(one);
    const ok = await pushBranch({ cwd: repo, local: "aw/AW-1", remote: "aw/AW-1", lease: one });
    expect(ok.kind).toBe("pushed");
    expect(await commitOf(origin, "aw/AW-1")).toBe(await commitOf(repo, "aw/AW-1"));
  });

  it("runs the pre-push hook and names it when it refuses, with no line of its output", async () => {
    const { repo, origin } = await repoWithRemote();
    const hook = join(repo, ".git", "hooks", "pre-push");
    await writeFile(hook, "#!/bin/sh\necho 'leak check: found stg_live_9f8e7d6c' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    expect(await hookFile(repo, "pre-push")).toBe(hook);
    await git(repo, ["branch", "aw/AW-2"]);
    const result = await pushBranch({
      cwd: repo,
      local: "aw/AW-2",
      remote: "aw/AW-2",
      lease: null,
    });
    // A secret scanner can print what it found: the comment that syncs gets the exit code only.
    expect(result).toEqual({ kind: "hook", hook: "pre-push", error: "exit code 1" });
    expect(await commitOf(origin, "aw/AW-2")).toBeNull();
  });

  it("names a slow pre-push hook at the time limit, and stops its children (fix list 0-0e)", async () => {
    const { repo, origin } = await repoWithRemote();
    const marker = join(root, "child.pid");
    const hook = join(repo, ".git", "hooks", "pre-push");
    await writeFile(hook, `#!/bin/sh\nsleep 30 &\necho $! > '${marker}'\nwait\n`);
    await chmod(hook, 0o755);
    await git(repo, ["branch", "aw/AW-3"]);
    const result = await pushBranch({
      cwd: repo,
      local: "aw/AW-3",
      remote: "aw/AW-3",
      lease: null,
      timeoutMs: 1500,
    });
    expect(result).toEqual({
      kind: "hook",
      hook: "pre-push",
      error: "git push with its pre-push hook did not end in 2 s",
    });
    expect(await commitOf(origin, "aw/AW-3")).toBeNull();
    const pid = Number((await readFile(marker, "utf8")).trim());
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 20 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive()).toBe(false);
  });

  it("gives no_remote for a repository with no origin", async () => {
    const lone = join(root, "lone");
    await execa("git", ["init", "-q", "-b", "main", lone]);
    expect(await pushBranch({ cwd: lone, local: "main", remote: "main", lease: null })).toEqual({
      kind: "no_remote",
    });
  });
});

describe("scrubUrls", () => {
  it("removes the user and the password of a URL", () => {
    expect(
      scrubUrls("fatal: unable to access 'https://bot:tok123@example.com/acme/api.git/': 403"),
    ).toBe("fatal: unable to access 'https://example.com/acme/api.git/': 403");
    expect(scrubUrls("To ssh://claude@ubuntu-01/srv/api.git")).toBe(
      "To ssh://ubuntu-01/srv/api.git",
    );
  });
});
