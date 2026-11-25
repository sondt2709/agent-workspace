// The task paths of a session (openspec agent-learning) with a real git checkout and worktree.
import { execa } from "execa";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedPaths, taskPaths } from "./task-paths.ts";

let root: string;
let checkout: string;
let worktree: string;

const git = (cwd: string, ...args: string[]) =>
  execa("git", ["-C", cwd, "-c", "user.name=AW", "-c", "user.email=test@example.com", ...args]);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-paths-"));
  checkout = join(root, "repo");
  worktree = join(root, "wt");
  await mkdir(join(checkout, "src", "api"), { recursive: true });
  await writeFile(join(checkout, "src", "api", "invoice.ts"), "export {};\n");
  await writeFile(join(checkout, "README.md"), "demo\n");
  await git(checkout, "init", "-q", "-b", "main");
  await git(checkout, "add", ".");
  await git(checkout, "commit", "-qm", "init");
  await git(checkout, "worktree", "add", "-q", "-b", "aw/AW-1", worktree, "HEAD");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("changedPaths", () => {
  it("has no path in a new worktree", async () => {
    expect(await changedPaths(worktree, checkout)).toEqual([]);
  });

  it("lists the committed, the changed, the renamed and the untracked files of the work", async () => {
    await writeFile(join(worktree, "src", "api", "tax.ts"), "export {};\n");
    await git(worktree, "add", ".");
    await git(worktree, "commit", "-qm", "tax");
    await writeFile(join(worktree, "src", "api", "invoice.ts"), "export const x = 1;\n");
    await git(worktree, "mv", "README.md", "NOTES.md");
    await mkdir(join(worktree, "web"));
    await writeFile(join(worktree, "web", "new file.tsx"), "x\n");
    expect((await changedPaths(worktree, checkout)).sort()).toEqual(
      ["NOTES.md", "src/api/invoice.ts", "src/api/tax.ts", "web/new file.tsx"].sort(),
    );
  });

  it("gives no path for a folder that is not a git repository", async () => {
    expect(await changedPaths(root, null)).toEqual([]);
  });
});

describe("taskPaths", () => {
  it("joins the paths of the proposal and the changed files, each once", async () => {
    await writeFile(join(worktree, "src", "api", "tax.ts"), "export {};\n");
    const paths = await taskPaths({
      proposal: "# Plan\n\nChange `src/api/tax.ts` and src/api/rates.ts.",
      cwd: worktree,
      checkout,
    });
    expect(paths).toEqual(["src/api/tax.ts", "src/api/rates.ts"]);
  });
});
