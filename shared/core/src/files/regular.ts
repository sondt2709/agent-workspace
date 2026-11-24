// Reads and appends of workspace files that never follow a symbolic link (final check fc1-1, fc1-3).
// The sync engine copies a link of another device as a link. A link in place of a log, a document
// or a folder of the layout would make AW read or write a file outside the workspace: for example
// an event line in a shell start file, or a private file in the first message of an agent.
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const APPEND_FLAGS =
  constants.O_WRONLY |
  constants.O_APPEND |
  constants.O_CREAT |
  constants.O_NOFOLLOW |
  constants.O_NONBLOCK;

/** The path is a symbolic link, or a folder, FIFO or device in place of a regular file. */
export class NotRegularFileError extends Error {
  readonly code = "ENOTREG";
  readonly file: string;
  constructor(file: string) {
    super(`${file} is a link or not a regular file: AW does not read or write it`);
    this.file = file;
    this.name = "NotRegularFileError";
  }
}

function linkError(error: unknown, file: string): unknown {
  const code = (error as NodeJS.ErrnoException).code;
  // O_NOFOLLOW gives ELOOP on Linux and macOS (EMLINK on some BSDs).
  return code === "ELOOP" || code === "EMLINK" ? new NotRegularFileError(file) : error;
}

/**
 * Refuses a path whose folders below `root` contain a symbolic link. The root itself can be under
 * a link (for example /tmp on macOS). A missing folder ends the check: the caller makes it.
 */
export async function refuseLinkedFolders(root: string, relative: string): Promise<void> {
  const parts = relative.split("/").filter((p) => p !== "");
  let folder = root;
  for (const part of parts.slice(0, -1)) {
    folder = join(folder, part);
    let info;
    try {
      info = await lstat(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!info.isDirectory()) throw new NotRegularFileError(folder);
  }
}

/** Reads a regular file. A link or another file type gives NotRegularFileError; ENOENT stays. */
export async function readRegularFile(file: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(file, READ_FLAGS);
  } catch (error) {
    throw linkError(error, file);
  }
  try {
    if (!(await handle.stat()).isFile()) throw new NotRegularFileError(file);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Reads a regular file as UTF-8 text (see readRegularFile). */
export async function readRegularText(file: string): Promise<string> {
  return (await readRegularFile(file)).toString("utf8");
}

/** Appends text to a regular file, and makes it when it is missing. Never writes through a link. */
export async function appendRegularFile(file: string, text: string, mode = 0o644): Promise<void> {
  let handle;
  try {
    handle = await open(file, APPEND_FLAGS, mode);
  } catch (error) {
    throw linkError(error, file);
  }
  try {
    if (!(await handle.stat()).isFile()) throw new NotRegularFileError(file);
    await handle.appendFile(text, "utf8");
  } finally {
    await handle.close();
  }
}
