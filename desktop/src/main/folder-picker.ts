// The native folder picker (openspec create-flows, review F-5 and F-30). Only main shows the dialog,
// so the renderer gets a checkout path only from the folder that the person picked. Main reads one
// item of the picked folder: `.git` (a folder, or a file in a git worktree).
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

/** What the person picks the folder for. */
export type FolderPurpose = "checkout" | "workspace" | "session";

export interface ChooseFolderInput {
  purpose: FolderPurpose;
  /** An absolute folder where the dialog starts. */
  default_path?: string | undefined;
}

export interface ChooseFolderResult {
  /** The picked absolute folder, or null when the person canceled. */
  path: string | null;
  /** The base name of the folder (`billing-api` for `~/dev/example-org/billing-api`), or null. */
  name: string | null;
  /** True when the folder has `.git`: a git repository or a git worktree. */
  git: boolean;
}

/** The parts of Electron `OpenDialogOptions` that the picker sets. */
export interface FolderDialogOptions {
  title: string;
  message: string;
  buttonLabel: string;
  defaultPath?: string;
  properties: ("openDirectory" | "createDirectory")[];
}

export interface FolderPickerDeps {
  /** The native dialog (`dialog.showOpenDialog` in index.ts, a fake in tests). */
  showOpenDialog(options: FolderDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
  /** The start folder when the call gives none (`app.getPath("home")`). */
  home: string;
  /** True when `<folder>/.git` exists; default: a `stat` of it. */
  isGitRepo?: (folder: string) => Promise<boolean>;
}

const TEXT: Record<
  FolderPurpose,
  Pick<FolderDialogOptions, "title" | "message" | "buttonLabel">
> = {
  checkout: {
    title: "Choose the checkout folder",
    message: "Choose the git repository of the project on this device.",
    buttonLabel: "Choose",
  },
  workspace: {
    title: "Choose the location of the workspace",
    message:
      "AW makes the workspace folder in this folder. It can hold other files. Do not choose a code checkout.",
    buttonLabel: "Choose",
  },
  session: {
    title: "Choose the folder of the session",
    message: "The agent works in this folder as it is. AW makes no worktree and changes no branch.",
    buttonLabel: "Choose",
  },
};

/** The dialog options for a purpose. */
export function folderDialogOptions(input: ChooseFolderInput, home: string): FolderDialogOptions {
  return {
    ...TEXT[input.purpose],
    defaultPath: input.default_path ?? home,
    properties: ["openDirectory", "createDirectory"],
  };
}

/** True when `<folder>/.git` is a folder or a file. */
export async function hasGit(folder: string): Promise<boolean> {
  try {
    const info = await stat(join(folder, ".git"));
    return info.isDirectory() || info.isFile();
  } catch {
    return false;
  }
}

/** Shows the native folder dialog and describes the picked folder. */
export async function chooseFolder(
  deps: FolderPickerDeps,
  input: ChooseFolderInput,
): Promise<ChooseFolderResult> {
  const result = await deps.showOpenDialog(folderDialogOptions(input, deps.home));
  const path = result.canceled ? undefined : result.filePaths[0];
  if (!path) return { path: null, name: null, git: false };
  return { path, name: basename(path), git: await (deps.isGitRepo ?? hasGit)(path) };
}
