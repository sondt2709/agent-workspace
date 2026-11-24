import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseFolder,
  folderDialogOptions,
  hasGit,
  type FolderPickerDeps,
} from "./folder-picker.ts";

const HOME = "/Users/example";

function deps(pick: string | null, git = true) {
  const showOpenDialog = vi.fn<FolderPickerDeps["showOpenDialog"]>(() =>
    Promise.resolve(
      pick === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [pick] },
    ),
  );
  const isGitRepo = vi.fn(() => Promise.resolve(git));
  return { showOpenDialog, isGitRepo, home: HOME };
}

describe("chooseFolder", () => {
  it("returns the picked folder, its name and the git state", async () => {
    const d = deps("/Users/example/dev/example-org/billing-api");
    expect(await chooseFolder(d, { purpose: "checkout" })).toEqual({
      path: "/Users/example/dev/example-org/billing-api",
      name: "billing-api",
      git: true,
    });
    expect(d.isGitRepo).toHaveBeenCalledWith("/Users/example/dev/example-org/billing-api");
  });

  it("returns git false for a folder with no .git", async () => {
    const d = deps("/Users/example/notes", false);
    expect(await chooseFolder(d, { purpose: "checkout" })).toMatchObject({ git: false });
  });

  it("returns path null on cancel and reads no folder", async () => {
    const d = deps(null);
    expect(await chooseFolder(d, { purpose: "checkout" })).toEqual({
      path: null,
      name: null,
      git: false,
    });
    expect(d.isGitRepo).not.toHaveBeenCalled();
  });

  it("starts in the home folder, or in default_path", async () => {
    const d = deps(null);
    await chooseFolder(d, { purpose: "checkout" });
    await chooseFolder(d, { purpose: "workspace", default_path: "/Users/example/AW" });
    expect(d.showOpenDialog.mock.calls[0]![0]).toMatchObject({
      defaultPath: HOME,
      title: "Choose the checkout folder",
      properties: ["openDirectory", "createDirectory"],
    });
    expect(d.showOpenDialog.mock.calls[1]![0]).toMatchObject({
      defaultPath: "/Users/example/AW",
      title: "Choose the location of the workspace",
    });
  });

  it("names the purpose in the dialog text", () => {
    expect(folderDialogOptions({ purpose: "workspace" }, HOME).message).toContain(
      "Do not choose a code checkout",
    );
  });
});

describe("hasGit", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "aw-picker-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds a .git folder, a .git file of a worktree, and no .git", async () => {
    await mkdir(join(root, "repo", ".git"), { recursive: true });
    await mkdir(join(root, "worktree"));
    await writeFile(join(root, "worktree", ".git"), "gitdir: /elsewhere\n");
    await mkdir(join(root, "plain"));
    expect(await hasGit(join(root, "repo"))).toBe(true);
    expect(await hasGit(join(root, "worktree"))).toBe(true);
    expect(await hasGit(join(root, "plain"))).toBe(false);
    expect(await hasGit(join(root, "missing"))).toBe(false);
  });
});
