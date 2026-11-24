// The git adapter of the branch pushes (openspec move-paused-task): the fetch of one branch and the
// push of one branch to `origin`, for the checkpoint branch `aw/<key>` (docs/architecture.md 4.6
// item 8) and the wake branch (docs/decisions/2026-11-23-manual-move.md item 5). The hooks of the
// repository run: AW never passes `--no-verify`. git never asks for a password (the push of AW has
// no terminal), and each network call stops after 60 s.
import { execa } from "execa";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const GIT_TIMEOUT_MS = 60_000;
/**
 * The limit of a local git command that checks out files: `worktree add`, `checkout`, `switch`.
 * Its hooks (post-checkout) and filters (git-lfs downloads) run with it, inside the manager queue,
 * so a slow one must not block each claim, gate and delivery for ever (final check fc1-7).
 */
export const LOCAL_GIT_TIMEOUT_MS = 300_000;
export const REMOTE = "origin";

/**
 * The git processes that awd runs now. A hook of the repository runs as their child, and the
 * agent can write that hook: the caller rule never takes such a process as the person (final
 * check fc1-6).
 */
const runningGit = new Set<number>();

/** The process ids of the git commands that awd runs now. */
export function runningGitPids(): number[] {
  return [...runningGit];
}

/** Adds a git process id while it runs; the result removes it. Exported for tests. */
export function trackGitPid(pid: number): () => void {
  runningGit.add(pid);
  return () => runningGit.delete(pid);
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs git in `cwd` with no prompt. Never throws for a git error. With a time limit, git runs in
 * its own process group, and the limit stops the whole group: a hook and its children (for example
 * a typecheck of a pre-push hook) stop with git (fix list 0-0e).
 */
export async function git(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<GitResult> {
  const child = execa("git", ["-C", cwd, ...args], {
    reject: false,
    detached: options.timeoutMs !== undefined,
    // No terminal prompt and no sign-in window of Git Credential Manager (review move-paused-task
    // finding 7). AW keeps the SSH command of the person (core.sshCommand): awd as a service has
    // no terminal, so ssh cannot ask there.
    env: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  const untrack = child.pid === undefined ? () => false : trackGitPid(child.pid);
  let timedOut = false;
  const timer =
    options.timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            // The group ended already.
          }
        }, options.timeoutMs);
  const result = await child.finally(untrack);
  if (timer) clearTimeout(timer);
  return {
    exitCode: result.exitCode ?? 1,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
    timedOut,
  };
}

/** The commit of a ref, or null. */
export async function commitOf(cwd: string, ref: string): Promise<string | null> {
  const result = await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return result.exitCode === 0 && result.stdout ? result.stdout : null;
}

/** True when `ancestor` is an ancestor of `of` (or the same commit). */
export async function isAncestor(cwd: string, ancestor: string, of: string): Promise<boolean> {
  return (await git(cwd, ["merge-base", "--is-ancestor", ancestor, of])).exitCode === 0;
}

/** True when the repository has the remote `origin`. */
export async function hasRemote(cwd: string): Promise<boolean> {
  return (await git(cwd, ["remote", "get-url", REMOTE])).exitCode === 0;
}

/** Removes the user and the password of each URL: a comment syncs to each device. */
export function scrubUrls(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1");
}

/**
 * The last useful line of a git error, at most 300 characters, with no credential of a URL. The
 * line "failed to push some refs to <url>" says nothing more than the exit code.
 */
export function gitError(result: GitResult): string {
  if (result.timedOut) return `no answer from ${REMOTE} after ${GIT_TIMEOUT_MS / 1000} s`;
  const lines = result.stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) => l.length > 0 && !l.startsWith("hint:") && !l.startsWith("error: failed to push"),
    );
  const line = lines.find((l) => l.startsWith("fatal:")) ?? lines.at(-1) ?? "git failed";
  return scrubUrls(line).slice(0, 300);
}

/**
 * The hook file of the repository when it exists (`core.hooksPath` counts), else null. git runs
 * only an executable hook; a refusal of a hook has no own error line.
 */
export async function hookFile(cwd: string, hook: string): Promise<string | null> {
  const result = await git(cwd, ["rev-parse", "--git-path", `hooks/${hook}`]);
  if (result.exitCode !== 0 || !result.stdout) return null;
  const path = isAbsolute(result.stdout) ? result.stdout : join(cwd, result.stdout);
  const info = await stat(path).catch(() => null);
  return info?.isFile() && (info.mode & 0o111) !== 0 ? path : null;
}

export type FetchResult =
  | { kind: "fetched"; commit: string }
  | { kind: "no_remote" }
  | { kind: "no_branch" }
  | { kind: "failed"; error: string };

/**
 * Fetches `refs/heads/<branch>` of `origin` into `refs/remotes/origin/<branch>`. A missing remote
 * and a missing branch are results, not errors.
 */
export async function fetchBranch(cwd: string, branch: string): Promise<FetchResult> {
  if (!(await hasRemote(cwd))) return { kind: "no_remote" };
  const result = await git(
    cwd,
    [
      "fetch",
      "--quiet",
      "--no-tags",
      REMOTE,
      `+refs/heads/${branch}:refs/remotes/${REMOTE}/${branch}`,
    ],
    { timeoutMs: GIT_TIMEOUT_MS },
  );
  if (result.exitCode === 0) {
    const commit = await commitOf(cwd, `refs/remotes/${REMOTE}/${branch}`);
    return commit
      ? { kind: "fetched", commit }
      : { kind: "failed", error: "no commit after fetch" };
  }
  if (/couldn't find remote ref/i.test(result.stderr)) {
    // The remote has no such branch (any more): forget the old remote-tracking ref.
    await git(cwd, ["update-ref", "-d", `refs/remotes/${REMOTE}/${branch}`]);
    return { kind: "no_branch" };
  }
  return { kind: "failed", error: gitError(result) };
}

export interface PushInput {
  cwd: string;
  /** The local branch. */
  local: string;
  /** The branch on `origin`. */
  remote: string;
  /** The commit that the remote branch must have, or null: the remote branch must not exist. */
  lease: string | null;
  /** The time limit of the push with its hook. Default GIT_TIMEOUT_MS (tests give a short one). */
  timeoutMs?: number;
}

export type PushResult =
  | { kind: "pushed"; commit: string }
  | { kind: "no_remote" }
  | { kind: "rejected"; error: string }
  | { kind: "hook"; hook: string; error: string }
  | { kind: "failed"; error: string };

/**
 * Pushes `refs/heads/<local>` to `refs/heads/<remote>` of `origin` with an explicit lease: the push
 * never replaces a remote commit that AW did not see. The hooks run. After a push the
 * remote-tracking ref has the pushed commit.
 */
export async function pushBranch(input: PushInput): Promise<PushResult> {
  if (!(await hasRemote(input.cwd))) return { kind: "no_remote" };
  const commit = await commitOf(input.cwd, `refs/heads/${input.local}`);
  if (commit === null) return { kind: "failed", error: `no local branch ${input.local}` };
  const result = await git(
    input.cwd,
    [
      "push",
      "--porcelain",
      `--force-with-lease=refs/heads/${input.remote}:${input.lease ?? ""}`,
      REMOTE,
      `${commit}:refs/heads/${input.remote}`,
    ],
    { timeoutMs: input.timeoutMs ?? GIT_TIMEOUT_MS },
  );
  if (result.exitCode === 0 && !result.timedOut) {
    await git(input.cwd, ["update-ref", `refs/remotes/${REMOTE}/${input.remote}`, commit]);
    return { kind: "pushed", commit };
  }
  // The limit counts the pre-push hook too: with a hook, a time-out is no proof that origin did
  // not answer, so AW names the hook (fix list 0-0e).
  if (result.timedOut && (await hookFile(input.cwd, "pre-push")) !== null) {
    const seconds = Math.round((input.timeoutMs ?? GIT_TIMEOUT_MS) / 1000);
    return {
      kind: "hook",
      hook: "pre-push",
      error: `git push with its pre-push hook did not end in ${seconds} s`,
    };
  }
  const text = `${result.stdout}\n${result.stderr}`;
  if (/\[rejected\]|stale info|non-fast-forward|\[remote rejected\]/.test(text)) {
    const line = text.split("\n").find((l) => /rejected|stale info/.test(l)) ?? "rejected";
    return { kind: "rejected", error: scrubUrls(line.trim()).slice(0, 300) };
  }
  if (!result.timedOut && !/^fatal:/m.test(result.stderr)) {
    const hook = await hookFile(input.cwd, "pre-push");
    // Only the exit code: the output of a hook (a secret scanner prints what it found) must not
    // go into a comment that syncs to each device (review move-paused-task finding 5).
    if (hook !== null)
      return { kind: "hook", hook: "pre-push", error: `exit code ${result.exitCode}` };
  }
  return { kind: "failed", error: gitError(result) };
}
