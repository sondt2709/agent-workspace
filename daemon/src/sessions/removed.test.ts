// The cleanup of the worktrees and branches of a removed project (openspec project-remove), with
// real git repositories in a temp folder: a clean pushed worktree goes, unpushed or uncommitted work
// stays, and AW removes no folder of a checkout session or a folder session.
import { execa } from "execa";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removedCheckouts } from "../service/project-remove.ts";
import { editedBindings } from "../service/setup.ts";
import { cleanupTarget, keptComment, unpushedCommits, type CleanupTarget } from "./removed.ts";

let root: string;
let repo: string;

const run = (cwd: string, ...args: string[]) =>
  execa("git", ["-C", cwd, "-c", "user.name=AW", "-c", "user.email=test@example.com", ...args]);
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
const branches = async () => (await run(repo, "branch", "--format=%(refname:short)")).stdout;

/** A worktree of the repository on a new branch, with `commits` commits. Pushed when asked. */
async function worktree(key: string, options: { commits?: number; push?: boolean } = {}) {
  const path = join(root, "worktrees", `aw-${key}`);
  await run(repo, "worktree", "add", "-b", `aw/${key}`, path, "HEAD");
  for (let i = 0; i < (options.commits ?? 0); i++) {
    await writeFile(join(path, `${key}-${i}.txt`), `${i}\n`);
    await run(path, "add", ".");
    await run(path, "commit", "-q", "-m", `${key} ${i}`);
  }
  if (options.push) await run(path, "push", "-q", "origin", `aw/${key}`);
  return path;
}

const target = (key: string, cwd: string, extra: Partial<CleanupTarget> = {}): CleanupTarget => ({
  task: `task-${key}`,
  key,
  cwd,
  branch: `aw/${key}`,
  workIn: "worktree",
  host: "tmux",
  ...extra,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-pr-git-"));
  repo = join(root, "billing-api");
  await execa("git", ["init", "-q", "--bare", join(root, "origin.git")]);
  await execa("git", ["init", "-q", "-b", "main", repo]);
  await run(repo, "commit", "-q", "--allow-empty", "-m", "init");
  await run(repo, "remote", "add", "origin", join(root, "origin.git"));
  await run(repo, "push", "-q", "origin", "main");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("cleanupTarget", () => {
  it("removes a clean worktree whose commits are on origin, and its branch", async () => {
    const path = await worktree("AW-1", { commits: 2, push: true });
    const item = await cleanupTarget(target("AW-1", path));
    expect(item).toMatchObject({ result: "removed", reason: null, path, branch: "aw/AW-1" });
    expect(await exists(path)).toBe(false);
    expect(await branches()).not.toContain("aw/AW-1");
  });

  it("removes a worktree with no own commit: main has each commit", async () => {
    const path = await worktree("AW-5");
    expect(await unpushedCommits(repo, "aw/AW-5")).toBe(0);
    expect((await cleanupTarget(target("AW-5", path))).result).toBe("removed");
  });

  it("keeps a branch with unpushed commits and its worktree", async () => {
    const path = await worktree("AW-2", { commits: 1 });
    expect(await unpushedCommits(repo, "aw/AW-2")).toBe(1);
    const item = await cleanupTarget(target("AW-2", path));
    expect(item).toMatchObject({ result: "kept", reason: "unpushed commits" });
    expect(await exists(path)).toBe(true);
    expect(await branches()).toContain("aw/AW-2");
  });

  it("keeps a worktree whose HEAD has commits that no branch has (a detached HEAD)", async () => {
    const path = await worktree("AW-6", { commits: 1, push: true });
    await run(path, "checkout", "-q", "--detach");
    await writeFile(join(path, "detached.txt"), "work\n");
    await run(path, "add", ".");
    await run(path, "commit", "-q", "-m", "work on a detached HEAD");
    const item = await cleanupTarget(target("AW-6", path));
    expect(item).toMatchObject({ result: "kept", reason: "commits that no branch has" });
    expect(await exists(path)).toBe(true);
  });

  it("keeps a worktree with uncommitted changes", async () => {
    const path = await worktree("AW-3", { push: true });
    await writeFile(join(path, "draft.txt"), "work in progress\n");
    const item = await cleanupTarget(target("AW-3", path));
    expect(item).toMatchObject({ result: "kept", reason: "uncommitted changes" });
    expect(await exists(path)).toBe(true);
  });

  it("keeps the project checkout and a branch that is checked out there", async () => {
    await run(repo, "switch", "-q", "-c", "aw/AW-4");
    const item = await cleanupTarget(target("AW-4", repo, { workIn: "checkout" }));
    expect(item.result).toBe("kept");
    expect(item.reason).toContain("the branch is checked out in");
    await run(repo, "switch", "-q", "main");
    // The checkout is on main now: the branch has no own commit, so it goes; the folder stays.
    expect((await cleanupTarget(target("AW-4", repo, { workIn: "checkout" }))).result).toBe(
      "removed",
    );
    expect(await exists(repo)).toBe(true);
    expect(await branches()).not.toContain("aw/AW-4");
  });

  it("never touches a folder of the person", async () => {
    const other = await mkdtemp(join(root, "notes-"));
    const item = await cleanupTarget(target("AW-6", other, { workIn: "folder", branch: null }));
    expect(item).toMatchObject({ result: "kept", reason: "a folder of the person" });
    expect(await exists(other)).toBe(true);
  });

  it("uses the session host for its own worktree", async () => {
    const path = await worktree("AW-7", { push: true });
    const calls: { path: string; checkout: string }[] = [];
    const item = await cleanupTarget(target("AW-7", path, { host: "orca" }), {
      removeHostWorktree: async (host, input) => {
        expect(host).toBe("orca");
        calls.push(input);
        await run(input.checkout, "worktree", "remove", input.path);
        return true;
      },
    });
    expect(item.result).toBe("removed");
    expect(calls).toHaveLength(1);
    expect(await branches()).not.toContain("aw/AW-7");
  });

  it("writes one comment line for each kept item", () => {
    expect(
      keptComment([
        {
          task: "t",
          key: "AW-2",
          path: "/w/aw-AW-2",
          branch: "aw/AW-2",
          result: "kept",
          reason: "unpushed commits",
        },
        { task: "t", key: "AW-2", path: null, branch: "aw/AW-2", result: "removed", reason: null },
      ]),
    ).toBe(
      "The project of this task was removed. AW kept on this device:\n/w/aw-AW-2 on the branch aw/AW-2: kept (unpushed commits)",
    );
    expect(keptComment([])).toBeNull();
  });
});

describe("removedCheckouts and bound_at", () => {
  const removal = (slug: string, hlc: string) => ({
    slug,
    name: slug,
    removed: { event: "e", dev: "macbook-pro", hlc, by: "human@macbook-pro" },
    document: {} as never,
  });

  it("drops a checkout that has no bound_at or one before the removal, and keeps a newer one", () => {
    const view = { removed_projects: [removal("billing-api", "2026-11-24T10:00:00.000Z#0000")] };
    const checkouts = (bound_at?: string) => ({
      checkouts: [{ project: "billing-api", path: "/w/b", ...(bound_at ? { bound_at } : {}) }],
    });
    expect(removedCheckouts(view, checkouts())).toEqual(["billing-api"]);
    expect(removedCheckouts(view, checkouts("2026-11-24T09:00:00.000Z#0000"))).toEqual([
      "billing-api",
    ]);
    expect(removedCheckouts(view, checkouts("2026-11-24T11:00:00.000Z#0000"))).toEqual([]);
    expect(removedCheckouts({ removed_projects: [] }, checkouts())).toEqual([]);
  });

  it("stamps a new or changed checkout, and keeps the stamp of an unchanged one", () => {
    const old = {
      kind: "bindings" as const,
      schema: 1 as const,
      device: "macbook-pro",
      may_run: true,
      use_orca: false,
      checkouts: [
        { project: "billing-api", path: "/w/b", bound_at: "2026-11-24T08:00:00.000Z#0000" },
      ],
      plugins: [],
      skills: [],
      resources: {},
      vapid_public_key: null,
    };
    const now = "2026-11-24T12:00:00.000Z#0000";
    const same = editedBindings(
      old,
      { checkouts: [{ project: "billing-api", path: "/w/b" }] },
      now,
    );
    expect(same.checkouts[0]!.bound_at).toBe("2026-11-24T08:00:00.000Z#0000");
    const moved = editedBindings(
      old,
      { checkouts: [{ project: "billing-api", path: "/w/c" }] },
      now,
    );
    expect(moved.checkouts[0]!.bound_at).toBe(now);
    const added = editedBindings(old, { checkouts: [{ project: "web-app", path: "/w/w" }] }, now);
    expect(added.checkouts.find((c) => c.project === "web-app")!.bound_at).toBe(now);
  });
});
