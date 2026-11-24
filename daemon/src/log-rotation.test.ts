// The rotation of awd.log (spec awd-service: logs, scenario "Large log").
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rotateLog } from "./log-rotation.ts";
import { tempDir } from "./testing.ts";

let dir: string;
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("rotateLog", () => {
  it("copies the end of a large file to .1, shifts the old files, keeps 3 and truncates the file", async () => {
    dir = await tempDir("awl-");
    const log = join(dir, "awd.log");
    // Only the last 100 bytes go to .1: the first copy of a 6 GB log must not fill the disk.
    await writeFile(log, `${"o".repeat(10)}${"x".repeat(100)}`);
    await writeFile(`${log}.1`, "one");
    await writeFile(`${log}.2`, "two");
    await writeFile(`${log}.3`, "three");
    expect(await rotateLog(log, 100)).toBe(true);
    expect((await stat(log)).size).toBe(0);
    expect(await readFile(`${log}.1`, "utf8")).toBe("x".repeat(100));
    expect(await readFile(`${log}.2`, "utf8")).toBe("one");
    expect(await readFile(`${log}.3`, "utf8")).toBe("two");
    await expect(stat(`${log}.4`)).rejects.toThrow(/ENOENT/);
  });

  it("does nothing for a small file or no file", async () => {
    dir = await tempDir("awl-");
    const log = join(dir, "awd.log");
    expect(await rotateLog(log, 100)).toBe(false);
    await writeFile(log, "short");
    expect(await rotateLog(log, 100)).toBe(false);
    expect(await readFile(log, "utf8")).toBe("short");
    await expect(stat(`${log}.1`)).rejects.toThrow(/ENOENT/);
  });

  it("truncates the file also when the copy fails, for example on a full disk", async () => {
    dir = await tempDir("awl-");
    const log = join(dir, "awd.log");
    await writeFile(log, "x".repeat(110));
    const full = () => Promise.reject(Object.assign(new Error("no space"), { code: "ENOSPC" }));
    await expect(rotateLog(log, 100, 3, full)).rejects.toThrow(/no space/);
    expect((await stat(log)).size).toBe(0);
    await expect(stat(`${log}.1`)).rejects.toThrow(/ENOENT/);
  });
});
