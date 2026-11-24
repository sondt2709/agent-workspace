// The folder rule of a new or joined workspace (openspec workspace-folder,
// docs/decisions/2026-11-24-workspace-folder.md).
// The person gives a location (a folder that can hold other files); AW puts the workspace in
// `<location>/<name>`, or in `<name>-aw1`, `-aw2` when that name is in use. The safety checks keep a
// workspace out of the state folder, out of another workspace folder and out of a checkout.
import { constants } from "node:fs";
import { access, lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { parse } from "yaml";
import { ServiceError } from "./errors.ts";

/** The entries that a workspace folder may have before its `tasks/workspace.yaml` arrives. */
export const WORKSPACE_ENTRIES = new Set(["tasks", "knowledge", "secure", ".DS_Store"]);
/** The last suffix that the rule tries: `<name>-aw99`. */
export const MAX_SUFFIX = 99;

/** What this device knows when it chooses a folder. All paths are absolute. */
export interface FolderContext {
  /** The state folder (AW_HOME). */
  home: string;
  /** The registered workspace folders of this device (`config.yaml`). */
  registered: { id: string; path: string }[];
  /** The checkouts of this device, from its bindings in each open workspace. */
  checkouts: string[];
  /** The folders of the joins that run now, with the workspace id of each join. */
  reserved: { id: string; path: string }[];
}

/** The workspace that the folder is for: a join knows its id, a new workspace its name. */
export type FolderMatch = { id: string } | { name: string; key_prefix?: string | undefined };

export interface FolderChoice {
  /** The workspace folder, normalized as given (no symbolic link resolved). */
  root: string;
  /** One sentence when the rule skipped a taken name, else null. */
  note: string | null;
}

/**
 * A safe folder name from the free-text workspace name: no path separator, no dot segment, no
 * control character. It falls back to `fallback`.
 */
export function folderName(name: string, fallback: string): string {
  const clean = [...name]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || '/\\:*?"<>|'.includes(ch) ? "-" : ch))
    .join("")
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 100);
  return clean.length > 0 ? clean : fallback;
}

/** The fields of `<root>/tasks/workspace.yaml`: null when there is no file, `{}` when it is bad. */
export async function workspaceAt(
  root: string,
): Promise<{ id?: string; name?: string; key_prefix?: string } | null> {
  let text: string;
  try {
    text = await readFile(join(root, "tasks", "workspace.yaml"), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
  try {
    const doc = parse(text) as Record<string, unknown> | null;
    const field = (key: string) => (typeof doc?.[key] === "string" ? doc[key] : undefined);
    return {
      ...(field("id") === undefined ? {} : { id: field("id") }),
      ...(field("name") === undefined ? {} : { name: field("name") }),
      ...(field("key_prefix") === undefined ? {} : { key_prefix: field("key_prefix") }),
    };
  } catch {
    return {};
  }
}

function matches(
  doc: { id?: string; name?: string; key_prefix?: string },
  match: FolderMatch,
): boolean {
  if ("id" in match) return doc.id === match.id;
  return (
    doc.name === match.name &&
    (match.key_prefix === undefined || doc.key_prefix === match.key_prefix)
  );
}

/** True when `folder` is `root` or a folder inside it. Both paths are absolute. */
function isInside(folder: string, root: string): boolean {
  const rel = relative(root, folder);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The nearest folder on the path of `path` that exists (the path itself when it exists). */
async function nearestExisting(path: string): Promise<string> {
  let at = normalize(path);
  for (;;) {
    if ((await lstat(at).catch(() => null)) !== null) return at;
    const up = dirname(at);
    if (up === at) return at;
    at = up;
  }
}

/** The path with the symbolic links of its existing part resolved. */
export async function realOf(path: string): Promise<string> {
  const clean = normalize(path);
  const existing = await nearestExisting(clean);
  const real = await realpath(existing).catch(() => existing);
  return join(real, relative(existing, clean));
}

/** Why a candidate is taken, or null when it is free. */
type Taken =
  | "other files"
  | "another workspace"
  | "a file"
  | "a symbolic link"
  | "in use"
  | "AW cannot read it";

/** True when the error is a missing read permission. */
function denied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

/** The first entry of `list` whose real path is the real path `real`. */
async function samePlace<T extends { path: string }>(
  list: T[],
  real: string,
): Promise<T | undefined> {
  for (const item of list) if ((await realOf(item.path)) === real) return item;
  return undefined;
}

async function candidateState(
  root: string,
  match: FolderMatch,
  context: FolderContext,
): Promise<Taken | null> {
  // Compare real paths: a location behind a symbolic link must not reach the folder of another
  // join or of another registered workspace.
  const real = await realOf(root);
  if ((await samePlace(context.reserved, real)) !== undefined) return "in use";
  const info = await lstat(root).catch(() => null);
  const registered = await samePlace(context.registered, real);
  const otherRegistered =
    registered !== undefined && !("id" in match && registered.id === match.id);
  if (info === null) return otherRegistered ? "in use" : null;
  // A registered folder that is a symbolic link (the person made it): the same workspace again.
  const registeredLink = registered !== undefined && normalize(registered.path) === root;
  if (info.isSymbolicLink() && !registeredLink) return "a symbolic link";
  if (!info.isDirectory() && !info.isSymbolicLink()) return "a file";
  try {
    const doc = await workspaceAt(root);
    if (doc !== null) return matches(doc, match) ? null : "another workspace";
    if (otherRegistered) return "in use";
    const other = (await readdir(root)).filter((n) => !WORKSPACE_ENTRIES.has(n));
    return other.length > 0 ? "other files" : null;
  } catch (error) {
    if (denied(error)) return "AW cannot read it";
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") return "a file";
    throw error;
  }
}

/**
 * The safety checks of a workspace folder: not in the state folder and not holding it; not in a
 * registered workspace folder and not holding one (the folder of `own` is allowed); not the folder
 * of an open join of another workspace; not in a folder with `tasks/workspace.yaml`; not in a
 * checkout of this device and not holding one; the nearest existing folder is writable. Symbolic
 * links are resolved before each comparison.
 */
export async function checkFolderSafety(
  root: string,
  context: FolderContext,
  own: string | null = null,
): Promise<void> {
  const real = await realOf(root);
  const around = (other: string) => isInside(real, other) || isInside(other, real);
  const home = await realOf(context.home);
  if (around(home)) {
    throw new ServiceError(
      "conflict",
      `${root} is in the AW state folder ${context.home} or holds it: choose another folder`,
    );
  }
  for (const w of context.registered) {
    // Only the folder of the same workspace is allowed: a path text that differs (a symbolic link)
    // or a folder whose files did not arrive yet is still the folder of another workspace.
    if (own !== null && w.id === own) continue;
    if (around(await realOf(w.path))) {
      throw new ServiceError(
        "conflict",
        `${root} is in the workspace folder ${w.path} or holds it: choose a folder outside it`,
      );
    }
  }
  for (const r of context.reserved) {
    if (own !== null && r.id === own) continue;
    if (around(await realOf(r.path))) {
      throw new ServiceError(
        "conflict",
        `${root} is the folder of an open join (${r.path}) or holds it: wait for the join, or choose another folder`,
      );
    }
  }
  // A workspace folder that this device did not register (synced by another device, or removed).
  for (let at = dirname(real); ; at = dirname(at)) {
    if ((await workspaceAt(at).catch(() => null)) !== null) {
      throw new ServiceError(
        "conflict",
        `${root} is in the workspace folder ${at}: choose a folder outside it`,
      );
    }
    if (dirname(at) === at) break;
  }
  for (const checkout of context.checkouts) {
    if (around(await realOf(checkout))) {
      throw new ServiceError(
        "conflict",
        `${root} is in the project checkout ${checkout} or holds it: choose a folder outside it`,
      );
    }
  }
  const existing = await nearestExisting(root);
  const writable = await access(existing, constants.W_OK).then(
    () => true,
    () => false,
  );
  if (!writable) {
    throw new ServiceError("refused", `AW cannot write in ${existing}: choose another folder`);
  }
}

/**
 * The workspace folder in a location: `<parent>/<name>`, else `<name>-aw1` .. `<name>-aw99`. The
 * first free candidate wins; then the safety checks run on it.
 */
export async function chooseWorkspaceFolder(
  input: { parent: string; name: string; match: FolderMatch },
  context: FolderContext,
): Promise<FolderChoice> {
  if (!isAbsolute(input.parent)) {
    throw new ServiceError("invalid_input", `Give an absolute location, not ${input.parent}`);
  }
  const parent = normalize(input.parent);
  const parentInfo = await stat(parent).catch(() => null);
  if (parentInfo !== null && !parentInfo.isDirectory()) {
    throw new ServiceError(
      "conflict",
      `${parent} is not a folder: choose a folder as the location`,
    );
  }
  // The location is the folder of this workspace (a join again after `aw workspace remove`).
  const here = parentInfo === null ? null : await workspaceAt(parent);
  if (here !== null && matches(here, input.match)) {
    await checkFolderSafety(
      parent,
      context,
      "id" in input.match ? input.match.id : (here.id ?? null),
    );
    return { root: parent, note: `${parent} is the folder of this workspace, so AW uses it.` };
  }
  const skipped: string[] = [];
  for (let n = 0; n <= MAX_SUFFIX; n += 1) {
    const root = join(parent, n === 0 ? input.name : `${input.name}-aw${n}`);
    if (basename(root) !== (n === 0 ? input.name : `${input.name}-aw${n}`)) {
      throw new ServiceError("invalid_input", `${input.name} is not a folder name`);
    }
    const taken = await candidateState(root, input.match, context);
    if (taken !== null) {
      skipped.push(`${root} is in use (${taken})`);
      continue;
    }
    // A new workspace (init) that matched by name and key prefix is that workspace again.
    const own = "id" in input.match ? input.match.id : ((await workspaceAt(root))?.id ?? null);
    await checkFolderSafety(root, context, own);
    return {
      root,
      note: skipped.length === 0 ? null : `${skipped.join(", ")}, so AW uses ${root}.`,
    };
  }
  throw new ServiceError(
    "conflict",
    `${join(parent, input.name)} and its names up to -aw${MAX_SUFFIX} are in use: choose another location`,
  );
}

/**
 * The exact workspace folder of a join (`--path`): missing, empty (only the workspace entries) or
 * the folder of this workspace. A folder of another workspace, or a folder with other files, is
 * refused: the person chose this folder, so AW does not choose another one.
 */
export async function checkJoinFolder(
  root: string,
  workspace: string,
  context: FolderContext,
): Promise<void> {
  const info = await stat(root).catch((error: unknown) => {
    if (denied(error))
      throw new ServiceError("refused", `AW cannot read ${root}: choose another folder`);
    return null;
  });
  if (info !== null) {
    if (!info.isDirectory()) {
      throw new ServiceError(
        "conflict",
        `${root} is not a folder: give another path with --path, or a location with --in`,
      );
    }
    const unreadable = (error: unknown): never => {
      if (denied(error)) {
        throw new ServiceError("refused", `AW cannot read ${root}: choose another folder`);
      }
      throw error;
    };
    const doc = await workspaceAt(root).catch(unreadable);
    if (doc !== null && doc.id !== workspace) {
      throw new ServiceError(
        "conflict",
        `${root} is the folder of another workspace (${doc.id || "tasks/workspace.yaml has no id"}): give an empty folder with --path, or the folder that holds it with --in ${dirname(root)}`,
      );
    }
    if (doc === null) {
      const other = (await readdir(root).catch(unreadable)).filter(
        (name) => !WORKSPACE_ENTRIES.has(name),
      );
      if (other.length > 0) {
        throw new ServiceError(
          "conflict",
          `${root} is not empty and is not a workspace folder (${other.slice(0, 3).join(", ")}): give an empty folder with --path, or use it as the location with --in ${root}`,
        );
      }
    }
  }
  await checkFolderSafety(root, context, workspace);
}
