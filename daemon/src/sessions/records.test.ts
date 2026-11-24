// The private writes of the session folder (fix list gfc-13): 2 saves of one session record at the
// same time, for example a permission retry and a turn update, both succeed. Before the fix both
// used one temp file name, and the second rename failed with ENOENT (a 500 for the hook).
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../testing.ts";
import { writePrivate } from "./records.ts";

let dir: string | null = null;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe("writePrivate", () => {
  it("writes one file with mode 0600 from 20 writes at the same time, and leaves no temp file", async () => {
    dir = await tempDir("awr-");
    const path = join(dir, "record.json");
    const texts = Array.from({ length: 20 }, (_, i) => `${JSON.stringify({ n: i })}\n`);
    await Promise.all(texts.map((text) => writePrivate(path, text)));
    expect(texts).toContain(await readFile(path, "utf8"));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(["record.json"]);
  });
});
