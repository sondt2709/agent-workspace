// The task paths of a session (openspec agent-learning): the paths that the confirmed approach
// names, and the files that the work branch changed in the session worktree. The knowledge context
// puts a `files` knowledge file whose glob matches one of them under "Read now"
// (docs/phase-1.md 5.9). The paths that the title and the first message name come from the context
// builder itself (kb-files `namedPaths`).
import { namedPaths } from "@aw/kb-files";
import { execa } from "execa";
import { trackGitPid } from "../continuity/git-branch.ts";

/** The most changed files that a session context gets. */
export const CHANGED_PATHS_LIMIT = 500;
/** The longest wait for one git command. */
const GIT_TIMEOUT_MS = 5_000;

async function git(cwd: string, args: string[]): Promise<string | null> {
  const child = execa("git", ["-C", cwd, ...args], {
    reject: false,
    timeout: GIT_TIMEOUT_MS,
    stripFinalNewline: false,
  });
  // Tracked as each git command of awd: a `core.fsmonitor` command of the repository runs under it,
  // and it never acts as the person (final check fc1-6).
  const untrack = child.pid === undefined ? () => false : trackGitPid(child.pid);
  const result = await child.finally(untrack);
  return result.exitCode === 0 ? String(result.stdout ?? "") : null;
}

/** The paths of `git status --porcelain -z`: each entry, and the old path of a rename. */
function statusPaths(text: string): string[] {
  const out: string[] = [];
  const parts = text.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    out.push(entry.slice(3));
    // A rename or a copy has the source path as the next NUL field.
    if (entry[0] === "R" || entry[0] === "C") i += 1;
  }
  return out;
}

/**
 * The files that the work in `cwd` changed: the uncommitted and untracked files, and the files of
 * the commits since the HEAD of the checkout. At most `CHANGED_PATHS_LIMIT`. A git failure gives
 * the paths found so far (a session context never fails on it).
 */
export async function changedPaths(cwd: string, checkout: string | null): Promise<string[]> {
  const out = new Set<string>();
  const status = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status !== null) for (const path of statusPaths(status)) out.add(path);
  const base = checkout ? (await git(checkout, ["rev-parse", "HEAD"]))?.trim() : undefined;
  if (base) {
    const diff = await git(cwd, ["diff", "--name-only", "-z", `${base}...HEAD`]);
    if (diff !== null) for (const path of diff.split("\0")) if (path) out.add(path);
  }
  return [...out].slice(0, CHANGED_PATHS_LIMIT);
}

/** The task paths of a session: the paths named in the confirmed approach and the changed files. */
export async function taskPaths(input: {
  approach: string | null;
  cwd: string | null;
  checkout: string | null;
}): Promise<string[]> {
  const named = input.approach ? namedPaths(input.approach) : [];
  const changed = input.cwd ? await changedPaths(input.cwd, input.checkout) : [];
  return [...new Set([...named, ...changed])];
}
