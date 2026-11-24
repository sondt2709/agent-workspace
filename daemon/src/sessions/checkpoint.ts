// The checkpoint branch of a task (decision D10, docs/architecture.md 4.6 item 8 and 4.3.4,
// openspec move-paused-task): before a new worktree, awd bases the task branch on `origin`; at
// each Stop of the session with the highest claim epoch, awd pushes it. A move by the human then
// continues from the last pushed commit. AW never drops a local commit and never replaces a remote
// commit that it did not see.
import type { TaskView } from "@aw/core";
import {
  commitOf,
  fetchBranch,
  git,
  gitError,
  isAncestor,
  pushBranch,
  REMOTE,
} from "../continuity/git-branch.ts";

/**
 * The checkpoint branch: the branch of the first session (`task.branch`), else `aw/<key>`. After a
 * rekey, 2 tasks can have the branch `aw/AW-1`; the task whose key is no longer AW-1 then uses
 * `aw/<own key>` (offline-task-keys open issue 1).
 */
export function checkpointBranch(
  task: Pick<TaskView, "id" | "key" | "branch" | "project">,
  tasks: readonly Pick<TaskView, "id" | "key" | "project">[],
): string {
  const own = `aw/${task.key ?? task.id}`;
  const branch = task.branch ?? own;
  if (branch === own) return branch;
  // The branch comes from a synced session.started: AW pushes only a branch under aw/, never
  // main or another branch of the person (review move-paused-task finding 9).
  if (!/^aw\/[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) return own;
  const taken = tasks.some(
    (other) =>
      other.id !== task.id &&
      other.project === task.project &&
      other.key !== null &&
      `aw/${other.key}` === branch,
  );
  return taken ? own : branch;
}

/**
 * True when a session pushes the checkpoint branch at its Stop: it runs, has a branch, and holds
 * the highest claim epoch of the task (an older session after a move never pushes).
 */
export function pushesCheckpoint(
  session: { state: string; branch: string | null; epoch: number },
  highestEpoch: number,
): boolean {
  return session.state === "running" && session.branch !== null && session.epoch >= highestEpoch;
}

export interface PrepareInput {
  /** The checkout (the main worktree) of the project on this device. */
  checkout: string;
  /** The local task branch. */
  local: string;
  /** The checkpoint branch on `origin`. */
  remote: string;
  /** The folder where the local branch is checked out, or null. */
  folder: string | null;
  device: string;
}

export interface PrepareResult {
  /** The remote commit that the local branch has, or null (no remote branch, or not based on it). */
  base: string | null;
  /** A thread comment for the person, or null. */
  comment: string | null;
}

/**
 * Bases the local task branch on the checkpoint branch of `origin` before a session starts: a
 * missing local branch starts at the remote commit, a stale one moves forward. A local branch with
 * own commits stays; when those commits are on another branch too (a wake branch), it moves to the
 * remote commit.
 */
export async function prepareBranch(input: PrepareInput): Promise<PrepareResult> {
  const fetched = await fetchBranch(input.checkout, input.remote);
  if (fetched.kind === "no_remote" || fetched.kind === "no_branch") {
    return { base: null, comment: null };
  }
  if (fetched.kind === "failed") {
    return {
      base: null,
      comment: `AW could not fetch ${input.remote} from ${REMOTE} (${fetched.error}). The session on ${input.device} starts from the local branch ${input.local}.`,
    };
  }
  const remote = fetched.commit;
  const local = await commitOf(input.checkout, `refs/heads/${input.local}`);
  const ref = `${REMOTE}/${input.remote}`;
  if (local === null) {
    const made = await git(input.checkout, ["branch", input.local, remote]);
    if (made.exitCode === 0) return { base: remote, comment: null };
    return {
      base: null,
      comment: `AW could not make the branch ${input.local} from ${ref} (${gitError(made)}). The session on ${input.device} starts from HEAD.`,
    };
  }
  if (local === remote || (await isAncestor(input.checkout, remote, local))) {
    return { base: remote, comment: null };
  }
  if (await isAncestor(input.checkout, local, remote)) {
    return moveTo(input, remote, ["merge", "--ff-only", "--quiet", remote]);
  }
  // Diverged. The local commits that no other branch and no remote has would be lost by a move.
  const own = await git(input.checkout, [
    "rev-list",
    local,
    "--not",
    `--exclude=${input.local}`,
    "--branches",
    "--remotes",
  ]);
  if (own.exitCode === 0 && own.stdout.length === 0) {
    return moveTo(input, remote, ["reset", "--keep", "--quiet", remote]);
  }
  return {
    base: null,
    comment: `${input.local} on ${input.device} has commits that ${ref} does not have, and ${ref} has commits that ${input.local} does not have. AW keeps the local branch and does not push it. Merge ${ref} into ${input.local} by hand.`,
  };
}

/** Moves the local branch to the remote commit: in the folder that has it, else the branch ref. */
async function moveTo(
  input: PrepareInput,
  remote: string,
  inFolder: string[],
): Promise<PrepareResult> {
  const moved =
    input.folder !== null
      ? await git(input.folder, inFolder)
      : await git(input.checkout, ["branch", "--force", input.local, remote]);
  if (moved.exitCode === 0) return { base: remote, comment: null };
  return {
    base: null,
    comment: `AW could not move ${input.local} on ${input.device} to ${REMOTE}/${input.remote} (${gitError(moved)}). The session starts from the local branch.`,
  };
}

/** The session fields that the push reads and writes. */
export interface PushTarget {
  id: string;
  task: string;
  cwd: string;
  branch: string | null;
  /** The remote commit that this session last based on or pushed. */
  checkpoint?: string | null;
}

export type CheckpointOutcome =
  | { kind: "pushed"; commit: string }
  | { kind: "up_to_date"; commit: string | null }
  | { kind: "no_remote" }
  | { kind: "failed"; cause: string; text: string };

/** One push of the local branch of a session to its checkpoint branch (the lease rule). */
export async function pushCheckpoint(
  target: PushTarget,
  remote: string,
): Promise<CheckpointOutcome> {
  const local = target.branch;
  if (local === null) return { kind: "up_to_date", commit: null };
  const fetched = await fetchBranch(target.cwd, remote);
  if (fetched.kind === "no_remote") return { kind: "no_remote" };
  if (fetched.kind === "failed") {
    return { kind: "failed", cause: "fetch", text: `the fetch failed (${fetched.error})` };
  }
  const head = await commitOf(target.cwd, `refs/heads/${local}`);
  if (head === null) {
    return { kind: "failed", cause: "no_branch", text: `the local branch ${local} does not exist` };
  }
  const seen = fetched.kind === "fetched" ? fetched.commit : null;
  if (seen === head) return { kind: "up_to_date", commit: head };
  const allowed =
    seen === null ||
    seen === (target.checkpoint ?? null) ||
    (await isAncestor(target.cwd, seen, head));
  if (!allowed) {
    return {
      kind: "failed",
      cause: "diverged",
      text: `${REMOTE}/${remote} has commits that ${local} does not have`,
    };
  }
  const pushed = await pushBranch({ cwd: target.cwd, local, remote, lease: seen });
  switch (pushed.kind) {
    case "pushed":
      return { kind: "pushed", commit: pushed.commit };
    case "no_remote":
      return { kind: "no_remote" };
    case "rejected":
      return {
        kind: "failed",
        cause: "rejected",
        text: `${REMOTE} has a commit on ${remote} that this session did not see (${pushed.error})`,
      };
    case "hook":
      return {
        kind: "failed",
        cause: `hook:${pushed.hook}`,
        text: `the ${pushed.hook} hook refused the push (${pushed.error})`,
      };
    case "failed":
      return { kind: "failed", cause: "git", text: pushed.error };
  }
}

export interface CheckpointPusherDeps {
  /** Writes a thread comment of AW on the task. */
  comment(task: string, text: string): Promise<void>;
  /** Saves the session record after `checkpoint` changed. */
  save(target: PushTarget): Promise<void>;
  log: {
    info(data: object, message: string): void;
    warn(data: object, message: string): void;
  };
}

/**
 * Runs the checkpoint pushes outside the manager queue, one at a time per session: a Stop during a
 * push runs one more push after it. A failure writes one comment per cause until a push succeeds.
 */
export class CheckpointPusher {
  readonly #deps: CheckpointPusherDeps;
  readonly #running = new Map<string, Promise<void>>();
  readonly #again = new Map<string, string>();
  readonly #cause = new Map<string, string>();

  constructor(deps: CheckpointPusherDeps) {
    this.#deps = deps;
  }

  /** Starts a push of the session, or marks one more after the running one. */
  push(target: PushTarget, remote: string): Promise<void> {
    const running = this.#running.get(target.id);
    if (running) {
      this.#again.set(target.id, remote);
      return running;
    }
    const run = (async () => {
      let next: string | undefined = remote;
      while (next !== undefined) {
        this.#again.delete(target.id);
        await this.#once(target, next);
        next = this.#again.get(target.id);
      }
    })().finally(() => this.#running.delete(target.id));
    this.#running.set(target.id, run);
    return run;
  }

  /** Waits for the running pushes (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.all([...this.#running.values()]);
  }

  async #once(target: PushTarget, remote: string): Promise<void> {
    let outcome: CheckpointOutcome;
    try {
      outcome = await pushCheckpoint(target, remote);
    } catch (error) {
      outcome = { kind: "failed", cause: "error", text: (error as Error).message.slice(0, 300) };
    }
    if (outcome.kind === "pushed") {
      target.checkpoint = outcome.commit;
      this.#cause.delete(target.id);
      this.#deps.log.info({ session: target.id, branch: remote }, "Checkpoint branch pushed");
      await this.#deps.save(target);
      return;
    }
    if (outcome.kind === "no_remote") {
      this.#deps.log.info({ session: target.id }, "No remote origin: no checkpoint push");
      return;
    }
    if (outcome.kind === "up_to_date") {
      this.#cause.delete(target.id);
      if (outcome.commit !== null && target.checkpoint !== outcome.commit) {
        target.checkpoint = outcome.commit;
        await this.#deps.save(target);
      }
      return;
    }
    this.#deps.log.warn({ session: target.id, branch: remote, cause: outcome.cause }, outcome.text);
    if (this.#cause.get(target.id) === outcome.cause) return;
    this.#cause.set(target.id, outcome.cause);
    await this.#deps.comment(
      target.task,
      `AW could not push ${target.branch ?? remote} to ${remote} on ${REMOTE}: ${outcome.text}. A move to another device starts from the last pushed commit.`,
    );
  }
}
