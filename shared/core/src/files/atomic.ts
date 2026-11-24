// Atomic file writes (docs/phase-1.md 3.2.1, docs/engineering-rules.md 5.4).
// Write a temp file `*.aw-tmp` in the same folder, then rename it over the target.
// The sync engine ignores `*.aw-tmp`, so a temp file never reaches another device.
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const TEMP_SUFFIX = ".aw-tmp";

/** The options of a write. Production code sets only `mode`; the hooks are for tests. */
export interface AtomicWriteHooks {
  /** The mode of a new file (default 0644). */
  mode?: number;
  /** Runs after the temp file is complete and before the rename. */
  beforeRename?: (tempPath: string) => Promise<void> | void;
}

export function isTempFile(name: string): boolean {
  return name.endsWith(TEMP_SUFFIX);
}

function tempPathFor(target: string): string {
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  return join(dirname(target), `${basename(target)}.${suffix}${TEMP_SUFFIX}`);
}

async function syncFolder(folder: string): Promise<void> {
  // Best effort: some systems do not allow fsync on a folder.
  try {
    const handle = await open(folder, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // The rename is still atomic; only the durability after a power loss is weaker.
  }
}

/** Writes the whole file, or nothing. A crash leaves the old file and maybe a temp file. */
export async function writeFileAtomic(
  target: string,
  content: string | Uint8Array,
  hooks: AtomicWriteHooks = {},
): Promise<void> {
  const folder = dirname(target);
  await mkdir(folder, { recursive: true });
  const temp = tempPathFor(target);
  try {
    const handle = await open(temp, "wx", hooks.mode ?? 0o644);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await hooks.beforeRename?.(temp);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await syncFolder(folder);
}

/**
 * Removes the temp files that a crash left in a folder tree. Returns their paths.
 * Call it only when no write runs, for example when awd starts.
 */
export async function removeStaleTempFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && isTempFile(entry.name)) {
      const path = join(entry.parentPath, entry.name);
      await rm(path, { force: true });
      removed.push(path);
    }
  }
  return removed.sort();
}
