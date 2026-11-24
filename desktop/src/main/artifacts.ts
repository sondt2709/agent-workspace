// "Open" of a task artifact (openspec gate-full-context, design decision 7): main opens an artifact
// file of a task in the default app of the system. Only a file in `artifacts/` of the task that the
// task files route lists, with its real path in the task folder. A synced file can be a program,
// and the default app of a program runs it: only document and image types open; main shows any
// other type in Finder and never opens it.
import { realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { OpenFileError, relativeParts, selectWorkspace } from "./files.ts";

/** The types that "Open" opens in the default app: images, PDF, text, logs and test reports. */
export const ARTIFACT_OPEN_TYPES = /\.(png|jpe?g|gif|webp|pdf|txt|md|log|json|xml|csv)$/i;

export interface ArtifactDeps {
  /** The workspaces of awd: the folder of the workspace. */
  workspaces(): Promise<{ id: string; name: string | null; path: string }[]>;
  /** The task files route: the task id and the file names inside the task folder. */
  taskFiles(
    ws: string,
    task: string,
  ): Promise<{ task: string; entries: { name: string; kind: "dir" | "file" }[] }>;
  /** Opens a checked absolute path in the default app; the result is an error text or "". */
  openPath(path: string): Promise<string>;
  /** Shows a checked absolute path in Finder. */
  showItem(path: string): void;
}

export interface OpenArtifactResult {
  /** `app`: opened in the default app; `folder`: shown in Finder. */
  opened: "app" | "folder";
  path: string;
}

/**
 * The absolute path of the artifact `path` (inside the task folder, for example
 * `artifacts/ubuntu-01/shot.png`), after the checks, or OpenFileError.
 */
export async function artifactPath(
  root: string,
  task: string,
  path: string,
  listed: readonly string[],
): Promise<string> {
  const parts = relativeParts(path);
  if (parts[0] !== "artifacts" || parts.length < 2) {
    throw new OpenFileError(`${path} is not an artifact of the task`);
  }
  if (!listed.includes(path)) throw new OpenFileError(`${path} is not a file of the task`);
  const folder = join(root, "tasks", task);
  const [realFile, realFolder] = await Promise.all([
    realpath(join(folder, ...parts)),
    realpath(folder),
  ]);
  if (!realFile.startsWith(realFolder + sep)) {
    throw new OpenFileError(`${path} leaves the task folder`);
  }
  return realFile;
}

/** Opens an artifact of a task: a document type in the default app, any other type in Finder. */
export async function openTaskArtifact(
  deps: ArtifactDeps,
  ws: string,
  task: string,
  path: string,
): Promise<OpenArtifactResult> {
  const workspace = selectWorkspace(await deps.workspaces(), ws);
  const files = await deps.taskFiles(ws, task);
  const listed = files.entries.filter((e) => e.kind === "file").map((e) => e.name);
  const file = await artifactPath(workspace.path, files.task, path, listed);
  if (!ARTIFACT_OPEN_TYPES.test(file)) {
    deps.showItem(file);
    return { opened: "folder", path };
  }
  const error = await deps.openPath(file);
  if (error) throw new OpenFileError(error);
  return { opened: "app", path };
}
