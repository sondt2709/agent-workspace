import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeStaleTempFiles, TEMP_SUFFIX, writeFileAtomic } from "./atomic.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aw-atomic-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes a new file and creates its folder", async () => {
    const target = join(dir, "tasks", "workspace.yaml");
    await writeFileAtomic(target, "kind: workspace\n");
    expect(await readFile(target, "utf8")).toBe("kind: workspace\n");
    expect(await readdir(join(dir, "tasks"))).toEqual(["workspace.yaml"]);
  });

  it("keeps the old file and removes the temp file when the write fails before the rename", async () => {
    const target = join(dir, "task.yaml");
    await writeFile(target, "old\n");
    let temp = "";
    await expect(
      writeFileAtomic(target, "new\n", {
        beforeRename: (path) => {
          temp = path;
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(temp.endsWith(TEMP_SUFFIX)).toBe(true);
    expect(temp.startsWith(join(dir, "task.yaml."))).toBe(true);
    expect(await readFile(target, "utf8")).toBe("old\n");
    expect(await readdir(dir)).toEqual(["task.yaml"]);
  });

  it("keeps the old file when the process is killed with SIGKILL before the rename", async () => {
    const target = join(dir, "task.yaml");
    await writeFile(target, "old\n");
    const child = fileURLToPath(new URL("./testing/crash-writer.ts", import.meta.url));
    const run = spawnSync(process.execPath, [child, target, "new content\n"], { encoding: "utf8" });
    expect(run.signal).toBe("SIGKILL");
    expect(await readFile(target, "utf8")).toBe("old\n");
    const names = await readdir(dir);
    const temps = names.filter((n) => n.endsWith(TEMP_SUFFIX));
    expect(names.sort()).toEqual(["task.yaml", ...temps].sort());
    expect(temps).toHaveLength(1);
    // The temp file is complete, and only a rename was missing.
    expect(await readFile(join(dir, temps[0]!), "utf8")).toBe("new content\n");

    expect(await removeStaleTempFiles(dir)).toEqual([join(dir, temps[0]!)]);
    expect(await readdir(dir)).toEqual(["task.yaml"]);
  });

  it("replaces the file with the full new content", async () => {
    const target = join(dir, "health.yaml");
    await writeFile(target, "x".repeat(10_000));
    await writeFileAtomic(target, "short\n");
    expect(await readFile(target, "utf8")).toBe("short\n");
  });
});
