// The wake branch (docs/decisions/2026-11-23-manual-move.md item 5, design of add-continuity
// decision 16): a laptop that wakes after a person moved its task pushes the unpushed work of its
// worktree as `aw/<key>-<device>-<HHMM>` and never drops it. The hooks of the repository run, and
// AW commits only the changes of tracked files: an untracked file can hold a secret, so it stays
// in the worktree and the comment names it (openspec move-paused-task, review finding 3).
import { stat } from "node:fs/promises";
import {
  commitOf,
  git,
  GIT_TIMEOUT_MS,
  gitError,
  hookFile,
  pushBranch,
  REMOTE,
  type GitResult,
} from "./git-branch.ts";

export interface WakeInput {
  cwd: string;
  key: string;
  /** The task branch of the session. AW commits only when the folder has this branch checked out. */
  branch: string | null;
  device: string;
  now: number;
  /** The offset of the local time zone of the device from UTC in minutes (UTC+7: 420). Default 0. */
  utcOffsetMinutes?: number;
}

/** The untracked files that stay in the worktree: at most 5 names, and the count. */
export interface Untracked {
  names: string[];
  count: number;
}

export type WakeResult =
  | { kind: "nothing"; untracked: Untracked; commitError?: string }
  | {
      kind: "other_branch";
      head: string;
      branch: string | null;
      untracked: Untracked;
      commitError?: undefined;
    }
  | { kind: "pushed"; branch: string; untracked: Untracked; commitError?: string }
  | { kind: "local"; branch: string; error: string; untracked: Untracked; commitError?: string };

const NO_UNTRACKED: Untracked = { names: [], count: 0 };

/**
 * The branch name: `aw/<key>-<device>-<HHMM>` in the local time of the device, the time that the
 * person sees on that device (verify-journeys finding 20).
 */
export function wakeBranchName(
  key: string,
  device: string,
  now: number,
  utcOffsetMinutes = 0,
): string {
  const time = new Date(now + utcOffsetMinutes * 60_000)
    .toISOString()
    .slice(11, 16)
    .replace(":", "");
  return `aw/${key}-${device}-${time}`;
}

async function untrackedFiles(cwd: string): Promise<Untracked> {
  const list = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  const names = list.exitCode === 0 && list.stdout ? list.stdout.split("\n") : [];
  return { names: names.slice(0, 5), count: names.length };
}

/**
 * The text of a refused commit. With commit hooks, it names each hook that exists (git does not say
 * which one refused) and gives only the exit code: the output of a hook can hold the secret that it
 * found, and the comment syncs to each device (review move-paused-task findings 5 and 6).
 */
async function commitRefusal(cwd: string, result: GitResult): Promise<string> {
  if (result.timedOut) return `git commit with its hooks did not end in ${GIT_TIMEOUT_MS / 1000} s`;
  const hooks: string[] = [];
  for (const hook of ["pre-commit", "commit-msg"]) {
    if ((await hookFile(cwd, hook)) !== null) hooks.push(hook);
  }
  if (hooks.length > 0) {
    return `the ${hooks.join(" or ")} hook refused the commit (exit code ${result.exitCode})`;
  }
  return `git commit failed (${gitError(result)})`;
}

export async function pushUnpushedWork(input: WakeInput): Promise<WakeResult> {
  const exists = await stat(input.cwd).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!exists) return { kind: "nothing", untracked: NO_UNTRACKED };
  if ((await git(input.cwd, ["rev-parse", "--is-inside-work-tree"])).exitCode !== 0)
    return { kind: "nothing", untracked: NO_UNTRACKED };
  // Only the task branch: in a project checkout the person can have gone back to an own branch
  // (main) with own edits, and AW must not commit or push them (final check fc1-5).
  // The full ref: `--short` gives `heads/<b>` when a tag has the same name as the branch.
  const current = await git(input.cwd, ["symbolic-ref", "--quiet", "HEAD"]);
  const head =
    current.exitCode === 0 ? current.stdout.replace(/^refs\/heads\//, "") : "a detached HEAD";
  if (input.branch === null || current.exitCode !== 0 || head !== input.branch) {
    return { kind: "other_branch", head, branch: input.branch, untracked: NO_UNTRACKED };
  }
  const untracked = await untrackedFiles(input.cwd);
  let commitError: string | undefined;
  const changed = await git(input.cwd, ["diff", "--quiet", "HEAD", "--"]);
  if (changed.exitCode === 1) {
    await git(input.cwd, ["add", "-u"]);
    // The commit hooks run with the time limit of a network call (fix list 0-0e).
    const commit = await git(
      input.cwd,
      [
        "-c",
        "user.name=AW",
        "-c",
        "user.email=aw@localhost",
        "commit",
        "-m",
        `AW: unpushed work of ${input.key} on ${input.device}`,
      ],
      { timeoutMs: GIT_TIMEOUT_MS },
    );
    if (commit.exitCode !== 0) {
      // The changes stay in the worktree; the commits of the session still get their branch.
      commitError = await commitRefusal(input.cwd, commit);
    }
  }
  const extra = commitError === undefined ? {} : { commitError };
  // Unpushed: commits of HEAD that no remote and no other local branch has (the task branch
  // itself does not count; with no remote, the commits of the checkout branch are not the task's).
  const exclude = [`--exclude=${head}`];
  const unpushed = await git(input.cwd, [
    "rev-list",
    "HEAD",
    "--not",
    ...exclude,
    "--branches",
    "--remotes",
  ]);
  if (unpushed.exitCode !== 0 || unpushed.stdout.length === 0) {
    return { kind: "nothing", untracked, ...extra };
  }
  const name = wakeBranchName(input.key, input.device, input.now, input.utcOffsetMinutes);
  let branch = name;
  for (let n = 2; (await commitOf(input.cwd, `refs/heads/${branch}`)) !== null; n++) {
    branch = `${name}-${n}`;
  }
  const created = await git(input.cwd, ["branch", branch, "HEAD"]);
  if (created.exitCode !== 0) {
    return {
      kind: "local",
      branch: "HEAD",
      error: `git branch failed: ${gitError(created)}`,
      untracked,
      ...extra,
    };
  }
  const push = await pushBranch({ cwd: input.cwd, local: branch, remote: branch, lease: null });
  if (push.kind === "pushed") return { kind: "pushed", branch, untracked, ...extra };
  const error =
    push.kind === "no_remote"
      ? `no remote ${REMOTE}`
      : push.kind === "hook"
        ? `the ${push.hook} hook refused the push: ${push.error}`
        : push.error;
  return { kind: "local", branch, error, untracked, ...extra };
}

function untrackedText(untracked: Untracked, device: string): string {
  if (untracked.count === 0) return "";
  const more = untracked.count > untracked.names.length ? ", …" : "";
  const files =
    untracked.count === 1 ? "1 untracked file stays" : `${untracked.count} untracked files stay`;
  return ` ${files} in the worktree on ${device}: ${untracked.names.join(", ")}${more}.`;
}

/** The system comment of a wake branch, or null when nothing was unpushed. */
export function wakeComment(
  result: WakeResult,
  device: string,
  movedTo: string | null,
): string | null {
  const to = movedTo ? `Moved to ${movedTo}. ` : "";
  const files = untrackedText(result.untracked, device);
  const refused = result.commitError
    ? ` The changes of tracked files stay in the worktree on ${device}: ${result.commitError}.`
    : "";
  if (result.kind === "nothing") {
    return files || refused ? `${to}${(refused + files).trim()}` : null;
  }
  if (result.kind === "other_branch") {
    const not = result.branch ? `, not ${result.branch}` : "";
    return `${to}AW saved no unpushed work on ${device}: the folder has ${result.head} checked out${not}.`;
  }
  if (result.kind === "pushed")
    return `${to}Unpushed work of ${device} is on ${result.branch}.${refused}${files}`;
  return `${to}Unpushed work of ${device} is on the local branch ${result.branch} of ${device}: the push failed (${result.error}).${refused}${files}`;
}
