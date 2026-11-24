// "Open file" of the Inbox card "Fix a file" (add-desktop-devices-knowledge): main opens a file of
// the workspace in the default app of the system. Only the path of a current schema issue, with a
// text extension, inside the workspace folder: a synced file can be a program, and the default app
// of a program runs it.
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, sep } from "node:path";

/** The extensions that "Open file" accepts: the documents and logs of the workspace. */
export const OPENABLE_EXTENSION = /\.(ya?ml|jsonl?|md|txt)$/i;

export class OpenFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenFileError";
  }
}

/**
 * The workspace of a selector as awd selects it: the id or the name; `-` only when exactly one
 * workspace exists (gfc-9). Else OpenFileError with the text of awd.
 */
export function selectWorkspace<W extends { id: string; name: string | null }>(
  workspaces: readonly W[],
  selector: string,
): W {
  if (selector === "-") {
    if (workspaces.length === 1) return workspaces[0]!;
    throw new OpenFileError(
      workspaces.length === 0
        ? "No workspace exists"
        : "More than one workspace exists: select one",
    );
  }
  const found = workspaces.find((w) => w.id === selector || w.name === selector);
  if (!found) throw new OpenFileError(`No workspace ${selector}`);
  return found;
}

/** The parts of a relative path, or OpenFileError for a path that can leave its folder. */
export function relativeParts(path: string): string[] {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new OpenFileError(`${path} is not a relative path of the workspace`);
  }
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new OpenFileError(`${path} has an empty, . or .. part`);
  }
  return parts;
}

/**
 * The absolute path of `path` in the workspace folder `root`, after the checks: `path` is one of
 * `allowed` and has a text extension; it is a regular file, not a symbolic link, and no folder of
 * the path is a link. A synced link can point to a program, and the default app of a program runs
 * it (fix list 0-10), so the app opens only the file that has the checked name.
 */
export async function openablePath(
  root: string,
  path: string,
  allowed: readonly string[],
): Promise<string> {
  if (!allowed.includes(path)) {
    throw new OpenFileError(`${path} is not a file with a schema error`);
  }
  if (!OPENABLE_EXTENSION.test(path)) {
    throw new OpenFileError(`${path} is not a document or a log file`);
  }
  const parts = relativeParts(path);
  const realRoot = await realpath(root);
  const file = join(realRoot, ...parts);
  const info = await lstat(file).catch(() => null);
  if (info === null) throw new OpenFileError(`${path} is not on this computer`);
  if (info.isSymbolicLink()) throw new OpenFileError(`${path} is a link, not a file`);
  if (!info.isFile()) throw new OpenFileError(`${path} is not a file`);
  const realFile = await realpath(file);
  if (realFile !== file || !realFile.startsWith(realRoot + sep)) {
    throw new OpenFileError(`${path} is in a linked folder`);
  }
  return realFile;
}

/** The extensions of the macOS bundles: Finder starts or installs such a folder, it does not show it. */
export const BUNDLE_EXTENSION =
  /\.(app|appex|bundle|component|dext|framework|kext|mdimporter|mpkg|pkg|plugin|prefpane|qlgenerator|saver|systemextension|wdgt|workflow|xpc)$/i;

/**
 * The real path of the session folder `path` that "Open" shows in Finder (fc1-d4). It must be a
 * folder and not a macOS bundle: with `work_in: folder` a session can work in `/Applications/X.app`,
 * and `shell.openPath` of a bundle starts the app. A bundle with no extension has
 * `Contents/Info.plist`.
 */
export async function openableFolder(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new OpenFileError(`${path} is not an absolute path`);
  const real = await realpath(path).catch(() => null);
  if (real === null) throw new OpenFileError(`${path} is not on this computer`);
  const info = await stat(real);
  if (!info.isDirectory()) throw new OpenFileError(`${path} is not a folder`);
  const plist = await lstat(join(real, "Contents", "Info.plist")).catch(() => null);
  if (BUNDLE_EXTENSION.test(basename(real)) || plist !== null) {
    throw new OpenFileError(`${path} is an app or a bundle. AW does not open it.`);
  }
  return real;
}
