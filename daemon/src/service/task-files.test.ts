// listTaskFiles while the sync engine writes (fix list 0-13): a temporary file of the engine can go
// away between readdir and lstat.
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listTaskFiles, readTaskFile } from "./task-files.ts";
import type { WorkspaceService } from "./workspace.ts";

const gone = new Set<string>();
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    lstat: (path: string) => {
      if ([...gone].some((name) => path.endsWith(name))) {
        return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }));
      }
      return fs.lstat(path);
    },
  };
});

let root: string;
const TASK = "0193a000-0000-7000-8000-0000000000aa";
const ws = (id = TASK) => ({ root, showTask: () => ({ id }) }) as unknown as WorkspaceService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-task-files-"));
  await mkdir(join(root, "tasks", TASK, "log"), { recursive: true });
  await writeFile(join(root, "tasks", TASK, "task.yaml"), "kind: task\n");
  await writeFile(join(root, "tasks", TASK, "log", "ubuntu-01.jsonl"), "{}\n");
});
afterEach(async () => {
  gone.clear();
  await rm(root, { recursive: true, force: true });
});

describe("listTaskFiles", () => {
  it("skips an entry that goes away before its lstat", async () => {
    await writeFile(join(root, "tasks", TASK, "log", "renamed.jsonl"), "{}\n");
    gone.add("renamed.jsonl");
    const reply = await listTaskFiles(ws(), TASK);
    expect(reply.entries.map((e) => e.name)).toEqual(["log", "log/ubuntu-01.jsonl", "task.yaml"]);
  });

  it("skips the temporary files of the sync engine", async () => {
    for (const name of [".syncthing.ubuntu-01.jsonl.tmp", "~syncthing~ubuntu-01.jsonl.tmp"]) {
      await writeFile(join(root, "tasks", TASK, "log", name), "{}\n");
    }
    const reply = await listTaskFiles(ws(), TASK);
    expect(reply.entries.map((e) => e.name)).toEqual(["log", "log/ubuntu-01.jsonl", "task.yaml"]);
  });

  it("refuses a task folder that is a symbolic link (devices-kb review 7)", async () => {
    const linked = "0193a000-0000-7000-8000-0000000000bb";
    await mkdir(join(root, "outside", ".ssh"), { recursive: true });
    await writeFile(join(root, "outside", ".ssh", "config"), "Host example.com\n");
    await symlink(join(root, "outside"), join(root, "tasks", linked));
    await expect(listTaskFiles(ws(linked), linked)).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      readTaskFile(ws(linked), linked, `tasks/${linked}/.ssh/config`),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
