// Read-only access to the folder of a task, and the restore of the last valid version of a document
// (openspec add-desktop-devices-knowledge). The desktop Files view and the Inbox card "Fix a file"
// use them. awd is the only reader of the workspace files (docs/architecture.md 6.3).
import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { ServiceError } from "./errors.ts";
import type { WorkspaceService } from "./workspace.ts";

/** The list stops after this many entries (`truncated: true`). */
export const MAX_TASK_FILES = 5000;
/** A larger file is not returned as text (`reason: "too_large"`). */
export const MAX_TEXT_BYTES = 1024 * 1024;

export interface TaskFileEntry {
  path: string;
  name: string;
  kind: "dir" | "file";
  size: number;
  modified: string;
}

/** A temporary file of AW (`*.aw-tmp`) or of the sync engine (`.syncthing.*.tmp`, `~syncthing~*.tmp`). */
function isTemp(name: string): boolean {
  return (
    name.endsWith(".aw-tmp") ||
    (name.endsWith(".tmp") && (name.startsWith(".syncthing.") || name.startsWith("~syncthing~")))
  );
}

function invalidPath(path: string, why: string): ServiceError {
  return new ServiceError("invalid_input", `The path ${path} ${why}`, { path });
}

/**
 * The real path of `tasks/<task id>/`, or `invalid_input` when the folder (or `tasks`) is a symbolic
 * link: a synced link would show the files of another folder (devices-kb review 7). Null when the
 * folder does not exist.
 */
async function realTaskFolder(ws: WorkspaceService, taskId: string): Promise<string | null> {
  const expected = join(await realpath(ws.root), "tasks", taskId);
  let real: string;
  try {
    real = await realpath(join(ws.root, "tasks", taskId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (real !== expected) {
    throw new ServiceError("invalid_input", `The folder tasks/${taskId} is a symbolic link`, {
      path: `tasks/${taskId}`,
    });
  }
  return real;
}

/** Lists `tasks/<task id>/`: files and folders, no symbolic link, no temporary file. */
export async function listTaskFiles(ws: WorkspaceService, ref: string) {
  const task = ws.showTask(ref);
  const root = `tasks/${task.id}`;
  await realTaskFolder(ws, task.id);
  const entries: TaskFileEntry[] = [];
  let truncated = false;
  const walk = async (rel: string): Promise<void> => {
    let items: Dirent[];
    try {
      items = await readdir(join(ws.root, ...`${root}${rel}`.split("/")), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const item of items) {
      if (truncated) return;
      if (isTemp(item.name) || item.isSymbolicLink()) continue;
      if (!item.isDirectory() && !item.isFile()) continue;
      if (entries.length >= MAX_TASK_FILES) {
        truncated = true;
        return;
      }
      const name = `${rel}/${item.name}`.slice(1);
      let stat: Stats;
      try {
        stat = await lstat(join(ws.root, ...`${root}/${name}`.split("/")));
      } catch (error) {
        // The sync engine renamed or removed the entry after readdir (fix list 0-13).
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      entries.push({
        path: `${root}/${name}`,
        name,
        kind: item.isDirectory() ? "dir" : "file",
        size: item.isDirectory() ? 0 : stat.size,
        modified: stat.mtime.toISOString(),
      });
      if (item.isDirectory()) await walk(`${rel}/${item.name}`);
    }
  };
  await walk("");
  return { task: task.id, root, entries, truncated };
}

/** The parts of a path inside the folder of a task, or an `invalid_input` error. */
export function taskFileParts(path: string, taskId: string): string[] {
  const prefix = `tasks/${taskId}/`;
  if (!path.startsWith(prefix)) throw invalidPath(path, `is not in the folder ${prefix}`);
  const parts = path.slice(prefix.length).split("/");
  if (path.includes("\\") || path.includes("\0")) throw invalidPath(path, "has a bad character");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw invalidPath(path, "has an empty, . or .. part");
  }
  return parts;
}

/** Reads one file of the folder of a task as UTF-8 text. */
export async function readTaskFile(ws: WorkspaceService, ref: string, path: string) {
  const task = ws.showTask(ref);
  const parts = taskFileParts(path, task.id);
  const folder = join(ws.root, "tasks", task.id);
  const file = join(folder, ...parts);
  let real: string;
  let realFolder: string | null;
  try {
    [real, realFolder] = await Promise.all([realpath(file), realTaskFolder(ws, task.id)]);
    if (realFolder === null) throw Object.assign(new Error("no folder"), { code: "ENOENT" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ServiceError("not_found", `${path} not found`, { path });
    }
    throw error;
  }
  if (!real.startsWith(realFolder + sep)) throw invalidPath(path, "leaves the folder of the task");
  const stat = await lstat(real);
  if (!stat.isFile()) throw invalidPath(path, "is not a file");
  const base = { path, size: stat.size, modified: stat.mtime.toISOString() };
  if (stat.size > MAX_TEXT_BYTES) return { ...base, text: null, reason: "too_large" as const };
  const bytes = await readFile(real);
  if (bytes.includes(0)) return { ...base, text: null, reason: "binary" as const };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ...base, text, reason: null };
  } catch {
    return { ...base, text: null, reason: "binary" as const };
  }
}

/**
 * Writes the last valid value of a document that has a `bad_document` issue, through the files
 * layer (the ownership rules apply), and merges.
 */
export async function restoreDocument(ws: WorkspaceService, path: string) {
  const issue = ws.issues().find((i) => i.code === "bad_document" && i.path === path);
  if (!issue) {
    throw new ServiceError("conflict", `${path} has no schema error to fix`, { path });
  }
  const last = ws.lastValidDocument(path);
  if (!last || last.value === undefined) {
    throw new ServiceError(
      "not_found",
      `This device never read a valid version of ${path}. Fix the file by hand.`,
      { path },
    );
  }
  await ws.write((files) => files.writeDocument(path, last.value as never));
  return { path, kind: last.kind, restored: true };
}
