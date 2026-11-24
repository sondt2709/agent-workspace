// "Open" of a task artifact (openspec gate-full-context, design decision 7): only an artifact file of
// the task opens; a document type opens in the default app, any other type shows in Finder.
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTaskArtifact, type ArtifactDeps } from "./artifacts.ts";
import { OpenFileError, selectWorkspace } from "./files.ts";

const TASK = "01a20800-0000-7000-8000-000000000001";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-artifacts-"));
  const dir = join(root, "tasks", TASK, "artifacts", "ubuntu-01");
  await mkdir(dir, { recursive: true });
  await mkdir(join(root, "tasks", TASK, "log"), { recursive: true });
  await writeFile(join(dir, "shot.png"), "png");
  await writeFile(join(dir, "run.command"), "#!/bin/sh\n");
  await writeFile(join(root, "tasks", TASK, "log", "ubuntu-01.jsonl"), "{}\n");
  await writeFile(join(root, "secret.txt"), "x");
  await symlink(join(root, "secret.txt"), join(dir, "link.txt"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function deps(names: string[]) {
  const openPath = vi.fn(() => Promise.resolve(""));
  const showItem = vi.fn();
  const d: ArtifactDeps = {
    workspaces: () => Promise.resolve([{ id: "ws-1", name: "Personal", path: root }]),
    taskFiles: () =>
      Promise.resolve({
        task: TASK,
        entries: names.map((name) => ({ name, kind: "file" as const })),
      }),
    openPath,
    showItem,
  };
  return { d, openPath, showItem };
}

const ALL = [
  "artifacts/ubuntu-01/shot.png",
  "artifacts/ubuntu-01/run.command",
  "artifacts/ubuntu-01/link.txt",
  "log/ubuntu-01.jsonl",
];

describe("openTaskArtifact", () => {
  it("opens an image in the default app", async () => {
    const { d, openPath, showItem } = deps(ALL);
    await expect(openTaskArtifact(d, "ws-1", "AW-12", ALL[0]!)).resolves.toEqual({
      opened: "app",
      path: ALL[0],
    });
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(String((openPath.mock.calls[0] as unknown[])[0])).toMatch(
      /artifacts\/ubuntu-01\/shot\.png$/,
    );
    expect(showItem).not.toHaveBeenCalled();
  });

  it("shows a program in Finder and never opens it", async () => {
    const { d, openPath, showItem } = deps(ALL);
    await expect(openTaskArtifact(d, "ws-1", "AW-12", ALL[1]!)).resolves.toMatchObject({
      opened: "folder",
    });
    expect(showItem).toHaveBeenCalledTimes(1);
    expect(openPath).not.toHaveBeenCalled();
  });

  it.each([
    ["a file outside the artifacts", "log/ubuntu-01.jsonl"],
    ["a .. path", "artifacts/../log/ubuntu-01.jsonl"],
    ["an absolute path", "/etc/hosts"],
    ["a file that the task files route does not list", "artifacts/ubuntu-01/other.png"],
    ["a link that leaves the task folder", "artifacts/ubuntu-01/link.txt"],
  ])("refuses %s", async (_name, path) => {
    const { d, openPath, showItem } = deps(ALL);
    await expect(openTaskArtifact(d, "ws-1", "AW-12", path)).rejects.toBeInstanceOf(OpenFileError);
    expect(openPath).not.toHaveBeenCalled();
    expect(showItem).not.toHaveBeenCalled();
  });

  it("names the cause of a refused workspace selector as awd does (gfc-9)", () => {
    const two = [
      { id: "w1", name: "Personal" },
      { id: "w2", name: "Acme" },
    ];
    expect(selectWorkspace(two, "Acme")).toBe(two[1]);
    expect(selectWorkspace(two.slice(0, 1), "-")).toBe(two[0]);
    expect(() => selectWorkspace(two, "-")).toThrow("More than one workspace exists");
    expect(() => selectWorkspace([], "-")).toThrow("No workspace exists");
    expect(() => selectWorkspace(two, "w9")).toThrow("No workspace w9");
  });
});
