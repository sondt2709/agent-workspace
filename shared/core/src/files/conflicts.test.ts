// Conflict copy names, the write hook and the 2 conflict-copy operations of the files layer
// (openspec add-syncthing-sync, workspace-files: write hook, write guard, conflict copy names).
import { compareHlc, newId } from "@aw/schema";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.ts";
import { parseConflictCopy } from "./conflicts.ts";
import { WriteRefusedError } from "./errors.ts";
import { openWorkspace, type WriteHook } from "./workspace.ts";

let root: string;
let clock: FakeClock;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-conflict-"));
  clock = new FakeClock("2026-11-23T10:00:00.000Z");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function open(device: string, onWrite?: WriteHook) {
  return openWorkspace({
    root,
    device,
    role: device === "macbook-pro" ? "local" : "remote",
    clock,
    ...(onWrite ? { onWrite } : {}),
  });
}

async function put(path: string, text: string): Promise<void> {
  const file = join(root, ...path.split("/"));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

const read = (path: string) => readFile(join(root, ...path.split("/")), "utf8");

describe("parseConflictCopy", () => {
  it("gives the original path and the short id of the winner", () => {
    // The name of a real copy made by Syncthing v2.1.7 on 2026-11-23.
    expect(
      parseConflictCopy("knowledge/shared/t.sync-conflict-20261123-032921-5NRSCRM.md"),
    ).toEqual({
      copy: "knowledge/shared/t.sync-conflict-20261123-032921-5NRSCRM.md",
      original: "knowledge/shared/t.md",
      stamp: "20261123-032921",
      winner: "5NRSCRM",
    });
  });

  it("handles a name with no extension and a name with 2 dots", () => {
    expect(
      parseConflictCopy("tasks/x/README.sync-conflict-20261123-032921-ABCDEFG")?.original,
    ).toBe("tasks/x/README");
    expect(
      parseConflictCopy("tasks/0193/log/macbook-pro.sync-conflict-20261123-032921-ABCDEFG.jsonl")
        ?.original,
    ).toBe("tasks/0193/log/macbook-pro.jsonl");
  });

  it("returns null for other names", () => {
    expect(parseConflictCopy("knowledge/shared/t.md")).toBeNull();
    expect(parseConflictCopy("knowledge/shared/t.sync-conflict-2026-032921-5NRSCRM.md")).toBeNull();
    expect(parseConflictCopy("knowledge/.sync-conflict-20261123-032921-5NRSCRM.md")).toBeNull();
  });
});

describe("write hook", () => {
  it("gets each write with its path and bytes", async () => {
    const calls: [string, string | null][] = [];
    const ws = open("macbook-pro", (path, content) =>
      calls.push([path, content === null ? null : Buffer.from(content).toString("utf8")]),
    );
    await ws.writeFile("knowledge/shared/testing.md", "# Testing\n");
    const task = newId(clock);
    const event = await ws.writeEvent(
      `tasks/${task}/log/macbook-pro.jsonl`,
      "comment.added",
      { text: "hi" },
      { task, by: "human@macbook-pro" },
    );
    await ws.writeDocument("tasks/projects/billing-api/project.yaml", {
      kind: "project",
      schema: 1,
      slug: "billing-api",
      name: "Billing API",
      devices: ["macbook-pro"],
      default_agent: "claude",
      test_servers: [],
      links: [],
      switches: { assign_new_subtasks_to_default_device: false },
    });
    expect(calls.map(([path]) => path)).toEqual([
      "knowledge/shared/testing.md",
      `tasks/${task}/log/macbook-pro.jsonl`,
      "tasks/projects/billing-api/project.yaml",
    ]);
    expect(calls[0]![1]).toBe("# Testing\n");
    expect(JSON.parse(calls[1]![1]!)).toMatchObject({ id: event.id });
    expect(calls[2]![1]).toBe(await read("tasks/projects/billing-api/project.yaml"));
  });

  it("does not fail a write when the hook throws", async () => {
    const ws = open("macbook-pro", () => {
      throw new Error("hook failed");
    });
    await ws.writeFile("knowledge/shared/a.md", "a");
    expect(await read("knowledge/shared/a.md")).toBe("a");
  });
});

describe("resolveConflictCopy", () => {
  const copy = "knowledge/shared/t.sync-conflict-20261123-032921-5NRSCRM.md";

  it("writes the copy over the original and removes the copy", async () => {
    await put("knowledge/shared/t.md", "remote version\n");
    await put(copy, "local version\n");
    const paths: string[] = [];
    const ws = open("macbook-pro", (path) => paths.push(path));
    const lost = await ws.resolveConflictCopy(copy, "copy");
    expect(Buffer.from(lost!).toString("utf8")).toBe("remote version\n");
    expect(await read("knowledge/shared/t.md")).toBe("local version\n");
    expect(await readdir(join(root, "knowledge", "shared"))).toEqual(["t.md"]);
    expect(paths).toEqual(["knowledge/shared/t.md", copy]);
  });

  it("keeps the original and removes the copy", async () => {
    await put("knowledge/shared/t.md", "local version\n");
    await put(copy, "remote version\n");
    const lost = await open("macbook-pro").resolveConflictCopy(copy, "original");
    expect(Buffer.from(lost!).toString("utf8")).toBe("remote version\n");
    expect(await read("knowledge/shared/t.md")).toBe("local version\n");
    expect(await readdir(join(root, "knowledge", "shared"))).toEqual(["t.md"]);
  });

  it("refuses a copy of a file that this device does not own", async () => {
    const other = "tasks/devices/ubuntu-01/health.sync-conflict-20261123-032921-5NRSCRM.yaml";
    await put(other, "kind: health\n");
    await expect(open("macbook-pro").resolveConflictCopy(other, "original")).rejects.toThrow(
      WriteRefusedError,
    );
    expect(await read(other)).toBe("kind: health\n");
  });

  it("refuses a path that is not a copy", async () => {
    await put("knowledge/shared/t.md", "x");
    await expect(
      open("macbook-pro").resolveConflictCopy("knowledge/shared/t.md", "original"),
    ).rejects.toThrow(WriteRefusedError);
    expect(await read("knowledge/shared/t.md")).toBe("x");
  });
});

describe("mergeLogCopy", () => {
  it("appends the events that the log does not have, once, and removes the copy", async () => {
    const task = newId(clock);
    const log = `tasks/${task}/log/macbook-pro.jsonl`;
    const ws = open("macbook-pro");
    const first = await ws.writeEvent(log, "comment.added", { text: "one" }, { task });
    clock.advance(1000);
    const second = await ws.writeEvent(log, "comment.added", { text: "two" }, { task });
    const lines = (await read(log)).split("\n").filter(Boolean);
    // The copy has the first line and a line that the log lost; the log has the first 2 lines.
    clock.advance(1000);
    const lostEvent = ws.newEvent("comment.added", { text: "lost" }, { task });
    const copy = `tasks/${task}/log/macbook-pro.sync-conflict-20261123-032921-ABCDEFG.jsonl`;
    await put(copy, `${lines[0]}\n${JSON.stringify(lostEvent)}\nnot json\n`);
    const added = await ws.mergeLogCopy(copy);
    expect(added).toBe(1);
    const ids = (await ws.readEvents(log)).events.map((e) => e.id);
    expect(ids).toEqual([first.id, second.id, lostEvent.id]);
    expect(await readdir(join(root, "tasks", task, "log"))).toEqual(["macbook-pro.jsonl"]);
  });

  it("gives the HLC of the merged events to the clock, as appendEvent does", async () => {
    // A state restore: this files layer starts with no HLC, and the copy has an event of a time
    // that is 1 h later than the clock (the clock of an earlier run was ahead).
    const task = newId(clock);
    const log = `tasks/${task}/log/macbook-pro.jsonl`;
    const ahead = openWorkspace({
      root,
      device: "macbook-pro",
      role: "local",
      clock: new FakeClock("2026-11-23T11:00:00.000Z"),
    });
    const lostEvent = ahead.newEvent("comment.added", { text: "lost" }, { task });
    const copy = `tasks/${task}/log/macbook-pro.sync-conflict-20261123-032921-ABCDEFG.jsonl`;
    await put(log, "");
    await put(copy, `${JSON.stringify(lostEvent)}\n`);
    const ws = open("macbook-pro");
    expect(await ws.mergeLogCopy(copy)).toBe(1);
    const next = ws.newEvent("comment.added", { text: "after the merge" }, { task });
    expect(compareHlc(next.hlc, lostEvent.hlc)).toBeGreaterThan(0);
  });

  it("refuses a copy of the log of another device", async () => {
    const task = newId(clock);
    const copy = `tasks/${task}/log/ubuntu-01.sync-conflict-20261123-032921-ABCDEFG.jsonl`;
    await put(copy, "");
    await expect(open("macbook-pro").mergeLogCopy(copy)).rejects.toThrow(WriteRefusedError);
    expect(await read(copy)).toBe("");
  });
});
