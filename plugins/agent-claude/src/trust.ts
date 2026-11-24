// The trust entry of a worktree that AW created (docs/architecture.md 4.6.2). No hook reports the
// "trust this folder" screen, so aw-launch marks the worktree as trusted in the Claude Code state
// file, after a backup, and changes nothing else in the file.
import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export interface TrustResult {
  changed: boolean;
  /** The backup file, or null when nothing changed. */
  backup: string | null;
}

/** The backups of the state file that AW keeps. */
export const KEEP_BACKUPS = 5;
/** The tries when a running Claude Code writes the state file at the same time. */
const TRIES = 5;

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function same(a: Stats | null, b: Stats | null): boolean {
  if (a === null || b === null) return a === b;
  return a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/** Removes the oldest backups, so only the last `keep` stay. */
async function pruneBackups(dir: string, keep: number): Promise<void> {
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => /^claude-.*\.json$/.test(n))
    .sort();
  for (const name of names.slice(0, Math.max(0, names.length - keep))) {
    await rm(join(dir, name), { force: true });
  }
}

/**
 * The writes of each state file in this process, one at a time: 2 session starts at once must not
 * share a temp file or lose the entry of the other (ssc-1, same defect class as gfc-13).
 */
const queues = new Map<string, Promise<unknown>>();

function oneAtATime<T>(key: string, run: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  const next = before.then(run, run);
  const settled = next.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

/**
 * Sets `projects[<path>].hasTrustDialogAccepted = true` in the state file (`~/.claude.json`). The
 * backup is `<backupDir>/claude-<stamp>.json` with mode 0600, and only the last 5 backups stay. A
 * missing file gets a new file. A symlink keeps pointing at its target: AW writes the target.
 * Claude Code can write the file at the same time: AW reads it again just before the rename, and
 * starts again when it changed, so no change of Claude Code is lost.
 */
export async function trustWorktree(options: {
  stateFile: string;
  path: string;
  backupDir: string;
  stamp: string;
}): Promise<TrustResult> {
  let target: string;
  try {
    target = await realpath(options.stateFile);
  } catch (error) {
    if (!missing(error)) throw error;
    target = options.stateFile;
  }
  return oneAtATime(target, () => trustIn(target, options));
}

async function trustIn(
  target: string,
  options: { stateFile: string; path: string; backupDir: string; stamp: string },
): Promise<TrustResult> {
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const before = await statOrNull(target);
    let text: string | null = null;
    if (before !== null) {
      try {
        text = await readFile(target, "utf8");
      } catch (error) {
        if (!missing(error)) throw error;
        continue;
      }
    }
    const state = text === null ? {} : (JSON.parse(text) as Record<string, unknown>);
    const projects = (state.projects ?? {}) as Record<string, Record<string, unknown>>;
    if (projects[options.path]?.hasTrustDialogAccepted === true) {
      return { changed: false, backup: null };
    }
    let backup: string | null = null;
    if (text !== null) {
      await mkdir(options.backupDir, { recursive: true, mode: 0o700 });
      backup = join(options.backupDir, `claude-${options.stamp}.json`);
      await writeFile(backup, text, { mode: 0o600 });
      await chmod(backup, 0o600);
    }
    state.projects = {
      ...projects,
      [options.path]: { ...(projects[options.path] ?? {}), hasTrustDialogAccepted: true },
    };
    // A new temp name for each write ("wx": never an existing file or a link).
    const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
    const temp = join(dirname(target), `.claude.json.aw-${suffix}.tmp`);
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, {
      mode: before === null ? 0o600 : before.mode & 0o777,
      flag: "wx",
    });
    if (!same(before, await statOrNull(target))) {
      await rm(temp, { force: true });
      continue;
    }
    await rename(temp, target);
    await pruneBackups(options.backupDir, KEEP_BACKUPS);
    return { changed: true, backup };
  }
  throw new Error(`${options.stateFile} changed during each of ${TRIES} tries`);
}
