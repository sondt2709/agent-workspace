// The cleanup of the worktrees and branches of a removed project on this device (openspec
// project-remove, design decision 6). AW removes an AW worktree only when it is clean and its branch
// has no unpushed commit, and deletes the branch after it. Everything else stays, with a reason.
// AW never removes a folder of a checkout session or of a folder session.
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { git } from "../continuity/git-branch.ts";
import type { CleanupItem } from "../service/project-remove.ts";

/** One folder and branch of a removed task on this device (from the session records). */
export interface CleanupTarget {
  task: string;
  key: string | null;
  /** The working folder of the session. */
  cwd: string;
  /** The local branch of the task, for example `aw/AW-3`. */
  branch: string | null;
  /** Where the session worked: an AW worktree (default), the project checkout or another folder. */
  workIn: "worktree" | "checkout" | "folder";
  /** The session host (`tmux`, `orca`). */
  host: string;
}

export interface CleanupDeps {
  /** Removes an Orca worktree by its folder (`SessionHost.removeWorktree`), else git does it. */
  removeHostWorktree?: (
    host: string,
    input: { path: string; checkout: string },
  ) => Promise<boolean>;
}

const exists = (path: string) =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );

/** The main folder of the repository of a worktree, or null. */
async function repositoryOf(cwd: string): Promise<string | null> {
  if (!(await exists(cwd))) return null;
  const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.exitCode !== 0 || !common.stdout) return null;
  const dir = isAbsolute(common.stdout) ? common.stdout : resolve(cwd, common.stdout);
  return dirname(dir);
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  return (
    (await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).exitCode === 0
  );
}

/**
 * The count of commits of the branch that no remote branch and no other local branch has: the work
 * that a branch delete would lose. -1 when git cannot tell.
 */
export async function unpushedCommits(repo: string, branch: string): Promise<number> {
  const ref = `refs/heads/${branch}`;
  const result = await git(repo, [
    "rev-list",
    "--count",
    ref,
    "--not",
    // With --branches, git matches the pattern without the prefix refs/heads/.
    `--exclude=${branch}`,
    "--branches",
    "--remotes",
  ]);
  if (result.exitCode !== 0) return -1;
  const count = Number(result.stdout);
  return Number.isSafeInteger(count) ? count : -1;
}

/** The folder where the branch is checked out, or null. */
async function checkedOutIn(repo: string, branch: string): Promise<string | null> {
  const list = await git(repo, ["worktree", "list", "--porcelain"]);
  let path: string | null = null;
  for (const line of list.stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

/** Deletes the branch when it exists and has no unpushed commit. Null: deleted or no branch. */
async function deleteBranch(repo: string, branch: string): Promise<string | null> {
  if (!(await branchExists(repo, branch))) return null;
  const unpushed = await unpushedCommits(repo, branch);
  if (unpushed !== 0)
    return unpushed < 0 ? "git cannot tell the unpushed commits" : "unpushed commits";
  const deleted = await git(repo, ["branch", "-D", branch]);
  return deleted.exitCode === 0 ? null : `git branch -D failed: ${deleted.stderr}`;
}

/** Cleans one folder and branch of a removed task. */
export async function cleanupTarget(
  target: CleanupTarget,
  deps: CleanupDeps = {},
): Promise<CleanupItem> {
  const item = (result: "removed" | "kept", reason: string | null, path: string | null) => ({
    task: target.task,
    key: target.key,
    path,
    branch: target.branch,
    result,
    reason,
  });
  // A folder of the person: AW made no worktree and no branch there (openspec session-options).
  if (target.workIn === "folder") return item("kept", "a folder of the person", target.cwd);
  const repo = await repositoryOf(target.cwd);
  if (repo === null) return item("kept", "the folder is not a git repository", target.cwd);
  const branch = target.branch;
  if (target.workIn === "checkout") {
    // The project checkout stays. Its branch goes only when no folder has it checked out.
    if (branch === null || !(await branchExists(repo, branch))) return item("removed", null, null);
    const taken = await checkedOutIn(repo, branch);
    if (taken !== null) return item("kept", `the branch is checked out in ${taken}`, null);
    const reason = await deleteBranch(repo, branch);
    return item(reason === null ? "removed" : "kept", reason, null);
  }
  const status = await git(target.cwd, ["status", "--porcelain", "--untracked-files=normal"]);
  if (status.exitCode !== 0) return item("kept", "git status failed", target.cwd);
  if (status.stdout.length > 0) return item("kept", "uncommitted changes", target.cwd);
  // A commit of HEAD that no branch has (a detached HEAD, a rebase): only the reflog of the
  // worktree has it, and `git worktree remove` deletes that reflog.
  const loose = await git(target.cwd, [
    "rev-list",
    "--count",
    "HEAD",
    "--not",
    "--branches",
    "--remotes",
  ]);
  if (loose.exitCode !== 0 || !Number.isSafeInteger(Number(loose.stdout))) {
    return item("kept", "git cannot tell the unpushed commits", target.cwd);
  }
  if (Number(loose.stdout) !== 0) return item("kept", "commits that no branch has", target.cwd);
  if (branch !== null && (await branchExists(repo, branch))) {
    const unpushed = await unpushedCommits(repo, branch);
    if (unpushed !== 0) {
      return item(
        "kept",
        unpushed < 0 ? "git cannot tell the unpushed commits" : "unpushed commits",
        target.cwd,
      );
    }
  }
  const byHost =
    (await deps.removeHostWorktree?.(target.host, { path: target.cwd, checkout: repo })) ?? false;
  if (!byHost) {
    const removed = await git(repo, ["worktree", "remove", target.cwd]);
    if (removed.exitCode !== 0) {
      return item("kept", `git worktree remove failed: ${removed.stderr}`, target.cwd);
    }
  }
  const reason = branch === null ? null : await deleteBranch(repo, branch);
  return item(reason === null ? "removed" : "kept", reason, target.cwd);
}

/** The text of the system comment for the kept items of a task, or null when AW kept nothing. */
export function keptComment(items: CleanupItem[]): string | null {
  const kept = items.filter((i) => i.result === "kept");
  if (kept.length === 0) return null;
  const lines = kept.map(
    (i) =>
      `${[i.path, i.branch].filter(Boolean).join(" on the branch ")}: kept (${i.reason ?? "kept"})`,
  );
  return `The project of this task was removed. AW kept on this device:\n${lines.join("\n")}`;
}
