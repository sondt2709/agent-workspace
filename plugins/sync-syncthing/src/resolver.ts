// The conflict resolver (docs/architecture.md 4.3.2, docs/phase-1.md 6.6). Syncthing keeps the
// newer file and renames the older one to a conflict copy whose name has the id of the WINNER.
// AW keeps the version of the device with the higher priority and leaves no copy.
import {
  NotRegularFileError,
  parseConflictCopy,
  readRegularFile,
  refuseLinkedFolders,
  writeFileAtomic,
  WriteRefusedError,
  type WorkspaceFiles,
} from "@aw/core";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { WriteJournal } from "./journal.ts";
import { sha256Hex } from "./journal.ts";
import type { SyncLogger } from "./supervisor.ts";

/** The files-layer operations that the resolver uses. */
export type ConflictFiles = Pick<
  WorkspaceFiles,
  "root" | "info" | "resolveConflictCopy" | "mergeLogCopy"
>;

/** A device that can be the author of a version. */
export interface Author {
  device: string;
  rank: number;
}

export interface ResolveContext {
  workspace: string;
  files: ConflictFiles;
  journal: WriteJournal;
  /** This device. */
  me: Author;
  /** Maps a 7-character short id to a device; null when unknown. */
  byShortId: (short: string) => Author | null;
  /** The devices that share the folder of the path, this device included. */
  folderDevices: (path: string) => Author[];
  /** The short id of the device that wrote the current original (engine `modifiedBy`). */
  originalModifiedBy: (path: string) => Promise<string | null>;
  /** True when this device is the highest-priority device online. */
  elected: () => boolean;
  /** The history store: `<AW_HOME>/history/<workspace>`. */
  historyDir: string;
  log: SyncLogger;
}

export type ResolveAction =
  | "kept_original"
  | "restored_copy"
  | "merged_log"
  | "removed_owned_copy"
  | "left_for_owner"
  | "left_not_elected"
  | "left_unknown_path"
  | "left_not_regular"
  | "gone";

export interface ResolveOutcome {
  copy: string;
  original: string;
  action: ResolveAction;
  reason: string;
}

/** The decision of the priority rule for a shared file. */
export function decideShared(input: { copyAuthor: Author | null; originalAuthor: Author | null }): {
  keep: "original" | "copy";
  reason: string;
} {
  const { copyAuthor, originalAuthor } = input;
  if (!copyAuthor)
    return { keep: "original", reason: "no author of the copy: the engine winner stays" };
  if (!originalAuthor) {
    return { keep: "original", reason: "no author of the original: the engine winner stays" };
  }
  if (copyAuthor.device === originalAuthor.device) {
    return {
      keep: "original",
      reason: `both versions are of ${copyAuthor.device}: the newer stays`,
    };
  }
  return copyAuthor.rank < originalAuthor.rank
    ? { keep: "copy", reason: `${copyAuthor.device} has priority over ${originalAuthor.device}` }
    : {
        keep: "original",
        reason: `${originalAuthor.device} has priority over ${copyAuthor.device}`,
      };
}

/**
 * The bytes of a regular file, or null when it is missing. A link gives NotRegularFileError: the
 * resolver never reads a file through a link that another device synced (final check fc1-2).
 */
async function bytesOf(path: string): Promise<Buffer | null> {
  return readRegularFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

/** Stores a version in the content-addressed history store (docs/phase-1.md 5.2). */
export async function storeHistory(dir: string, content: Uint8Array): Promise<string> {
  const sha = sha256Hex(content);
  const file = join(dir, sha);
  const present = await stat(file).then(
    () => true,
    () => false,
  );
  if (!present) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Atomic: a crash never leaves a cut version under the right hash.
    await writeFileAtomic(file, content, { mode: 0o600 });
  }
  return sha;
}

/** Resolves one conflict copy. `copyPath` is relative to the workspace root. */
export async function resolveCopy(copyPath: string, ctx: ResolveContext): Promise<ResolveOutcome> {
  const parsed = parseConflictCopy(copyPath);
  if (!parsed)
    return { copy: copyPath, original: copyPath, action: "gone", reason: "not a copy name" };
  const base = { copy: parsed.copy, original: parsed.original };
  let info;
  try {
    info = ctx.files.info(parsed.original);
  } catch {
    ctx.log.warn({ copy: parsed.copy }, "A conflict copy of a path outside the AW layout stays");
    return { ...base, action: "left_unknown_path", reason: "the original is not in the layout" };
  }
  const abs = (path: string) => join(ctx.files.root, ...path.split("/"));
  let copyBytes: Buffer | null;
  try {
    // A link in place of the copy, the original or a folder of their paths is never read.
    await refuseLinkedFolders(ctx.files.root, parsed.copy);
    await refuseLinkedFolders(ctx.files.root, parsed.original);
    copyBytes = await bytesOf(abs(parsed.copy));
    await bytesOf(abs(parsed.original));
  } catch (error) {
    if (!(error instanceof NotRegularFileError)) throw error;
    ctx.log.warn({ copy: parsed.copy }, "A conflict copy or its original is a link: AW leaves it");
    return { ...base, action: "left_not_regular", reason: "a link or not a regular file" };
  }
  if (copyBytes === null) return { ...base, action: "gone", reason: "the copy is gone" };

  // A device-owned file: only its owner acts; the guard of the files layer decides.
  if (info.writer.type !== "shared") {
    try {
      if (info.format.type === "log") {
        const added = await ctx.files.mergeLogCopy(parsed.copy);
        return { ...base, action: "merged_log", reason: `${added} lines added by event id` };
      }
      // The owner keeps the version that it wrote (its journal), else the engine winner. The other
      // version goes to the history store: a hand edit on another device is not lost.
      const originalBytes = await bytesOf(abs(parsed.original));
      const mine = (bytes: Buffer | null) =>
        bytes === null
          ? Promise.resolve(false)
          : ctx.journal.has(ctx.workspace, parsed.original, sha256Hex(bytes));
      const keepCopy = (await mine(copyBytes)) && !(await mine(originalBytes));
      const lost = await ctx.files.resolveConflictCopy(parsed.copy, keepCopy ? "copy" : "original");
      if (lost) await storeHistory(ctx.historyDir, lost);
      return keepCopy
        ? { ...base, action: "restored_copy", reason: "the owner wrote the copy" }
        : { ...base, action: "removed_owned_copy", reason: "the owner keeps its version" };
    } catch (error) {
      if (error instanceof WriteRefusedError) {
        return { ...base, action: "left_for_owner", reason: error.message };
      }
      throw error;
    }
  }

  if (!ctx.elected()) {
    return {
      ...base,
      action: "left_not_elected",
      reason: "a device with a higher priority is online",
    };
  }
  const originalBytes = await bytesOf(abs(parsed.original));
  const copySha = sha256Hex(copyBytes);
  const devices = ctx.folderDevices(parsed.original);

  let copyAuthor: Author | null = null;
  if (await ctx.journal.has(ctx.workspace, parsed.original, copySha)) copyAuthor = ctx.me;
  else if (devices.length === 2) {
    // With 2 devices, the copy is of the device that is not the winner of the name.
    const winner = ctx.byShortId(parsed.winner);
    if (winner) copyAuthor = devices.find((d) => d.device !== winner.device) ?? null;
  }
  let originalAuthor: Author | null;
  if (
    originalBytes !== null &&
    (await ctx.journal.has(ctx.workspace, parsed.original, sha256Hex(originalBytes)))
  ) {
    originalAuthor = ctx.me;
  } else {
    const short = await ctx.originalModifiedBy(parsed.original);
    originalAuthor = short ? ctx.byShortId(short) : null;
  }
  if (originalBytes === null) {
    // The original was deleted: the copy is the only content. Restore it.
    await ctx.files.resolveConflictCopy(parsed.copy, "copy");
    return { ...base, action: "restored_copy", reason: "the original is gone" };
  }
  const decision = decideShared({ copyAuthor, originalAuthor });
  const lost = await ctx.files.resolveConflictCopy(parsed.copy, decision.keep);
  if (lost) await storeHistory(ctx.historyDir, lost);
  return {
    ...base,
    action: decision.keep === "copy" ? "restored_copy" : "kept_original",
    reason: decision.reason,
  };
}
