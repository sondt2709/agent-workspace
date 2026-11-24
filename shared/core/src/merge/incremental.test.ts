// Test plan 2: the incremental path equals a full rebuild after random appends (fixed seeds), and a
// truncated or replaced log makes the engine read all files again.
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../clock.ts";
import { MergeEngine, mergeWorkspace, type MergeUpdate } from "./engine.ts";
import { appendRandomRound, RandomEvents } from "./random-events.ts";
import { LogSource } from "./source.ts";
import { at, event, FIXTURE_TASK, seededRandom, sortKeys, TestWorkspace } from "./testing.ts";

let ws: TestWorkspace;
beforeEach(async () => {
  ws = await TestWorkspace.create();
});
afterEach(async () => {
  await ws.remove();
});

/** The view without the presence layer, with sorted keys. */
function viewOf(update: MergeUpdate): unknown {
  return sortKeys(update.view);
}

async function randomRun(
  seed: number,
  rounds: number,
): Promise<{ fullUpdates: number; last: MergeUpdate }> {
  const random = seededRandom(seed);
  const clock = new FakeClock("2026-11-22T14:30:00.000Z");
  const gen = new RandomEvents(random, clock);
  const engine = new MergeEngine({ root: ws.root, clock });
  await engine.update();
  /** The rest of a half-written line of each file. */
  const pending = new Map<string, string>();
  let fullUpdates = 0;
  let last: MergeUpdate | null = null;
  for (let round = 0; round < rounds; round++) {
    await appendRandomRound(ws, gen, random, pending, clock);
    const incremental = await engine.update();
    last = incremental;
    if (incremental.full) fullUpdates++;
    // A full rebuild reads each file again and costs 3/4 of the test. A wrong fold stays in the
    // engine state, so a compare at each 4th round and at the last round finds it too (final
    // check sac-11: 60 rebuilds took more than 5 s on a busy computer).
    if (round % 4 === 3 || round === rounds - 1) {
      const full = await mergeWorkspace(ws.root, { clock });
      expect(viewOf(incremental), `seed ${seed}, round ${round}`).toEqual(viewOf(full));
    }
  }
  return { fullUpdates, last: last! };
}

describe("incremental update", () => {
  it.each([20261122, 7, 4242])(
    "equals a full rebuild after random appends (seed %i)",
    async (seed) => {
      const { fullUpdates, last } = await randomRun(seed, 60);
      // Appends never need a full read.
      expect(fullUpdates).toBe(0);
      // The random events reach the rules: many tasks, and each kind of issue.
      expect(last.view.tasks.length).toBeGreaterThan(10);
      const codes = new Set(last.view.issues.map((i) => i.code));
      for (const code of ["ignored", "unknown_type", "bad_line", "duplicate_event"]) {
        expect(codes, code).toContain(code);
      }
      expect(last.view.tasks.some((t) => t.key_state === "duplicate")).toBe(true);
      expect(last.view.tasks.some((t) => t.gates.some((g) => g.answers.length > 0))).toBe(true);
    },
  );

  it("continues a saved fold and reads only the new bytes", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    await ws.task(
      FIXTURE_TASK,
      event(
        "pixel-9",
        "comment.added",
        "2026-11-22T14:25:00.000Z#0000",
        { text: "new" },
        { by: "human@pixel-9" },
      ),
    );
    const update = await engine.update();
    expect(update).toMatchObject({
      full: false,
      changedTasks: [FIXTURE_TASK],
      workspaceChanged: false,
    });
    expect(
      engine.files().find((f) => f.path.endsWith(`${FIXTURE_TASK}/log/pixel-9.jsonl`))!.lines,
    ).toBe(4);
  });

  it("folds the tasks again only for a project change, and the workspace log only for bindings", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    const edit = async (path: string, from: string, to: string) => {
      const file = join(ws.root, ...path.split("/"));
      await writeFile(file, (await readFile(file, "utf8")).replace(from, to));
    };
    await edit("tasks/devices/ubuntu-01/health.yaml", "used_percentage: 48", "used_percentage: 49");
    let update = await engine.update();
    expect(update).toMatchObject({
      documentsChanged: true,
      workspaceChanged: false,
      changedTasks: [],
    });
    expect(update.view.devices.find((d) => d.slug === "ubuntu-01")!.health).toMatchObject({
      disk_used_percentage: 49,
    });
    await edit("tasks/projects/billing-api/project.yaml", "name: Billing API", "name: Billing");
    update = await engine.update();
    expect(update).toMatchObject({ workspaceChanged: false, changedTasks: [FIXTURE_TASK] });
    const bindings = join(ws.root, "tasks/devices/ubuntu-01/bindings.yaml");
    await writeFile(bindings, `${await readFile(bindings, "utf8")}# changed\n`);
    update = await engine.update();
    expect(update).toMatchObject({ workspaceChanged: true, changedTasks: [] });
    expect(viewOf(update)).toEqual(viewOf(await mergeWorkspace(ws.root, { clock })));
  });

  it("completes a half-written line on the next update", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    const path = `tasks/${FIXTURE_TASK}/log/pixel-9.jsonl`;
    const text = `${JSON.stringify({ ...event("pixel-9", "comment.added", "2026-11-22T14:25:00.000Z#0000", { text: "half" }), task: FIXTURE_TASK })}\n`;
    await ws.appendText(path, text.slice(0, 40));
    let update = await engine.update();
    expect(update.view.issues.map((i) => [i.code, i.line])).toEqual([["partial_tail", 4]]);
    await ws.appendText(path, text.slice(40));
    update = await engine.update();
    expect(update.view.issues).toEqual([]);
    expect(update.view.tasks[0]!.comments.at(-1)!.text).toBe("half");
  });

  it("reads all files again when a log becomes shorter", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    const path = join(ws.root, "tasks", FIXTURE_TASK, "log", "pixel-9.jsonl");
    const lines = (await readFile(path, "utf8")).split("\n");
    await writeFile(path, `${lines.slice(0, 2).join("\n")}\n`);
    const update = await engine.update();
    expect(update.full).toBe(true);
    expect(update.notices).toEqual([
      { code: "truncated", path: `tasks/${FIXTURE_TASK}/log/pixel-9.jsonl` },
    ]);
    expect(update.view.tasks[0]!.comments).toEqual([]);
    expect(viewOf(update)).toEqual(viewOf(await mergeWorkspace(ws.root, { clock })));
  });

  it("reads all files again when the read bytes of a log changed", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    const path = join(ws.root, "tasks", FIXTURE_TASK, "log", "pixel-9.jsonl");
    const text = await readFile(path, "utf8");
    // The same length, another comment text: a replaced file.
    await writeFile(
      path,
      text.replace("Also check the refund test, please.", "Also check the refund test, PLEASE."),
    );
    const update = await engine.update();
    expect(update.notices.map((n) => n.code)).toEqual(["replaced"]);
    expect(update.view.tasks[0]!.comments[0]!.text).toBe("Also check the refund test, PLEASE.");
  });

  it("loses no event when a read fails: the update goes on with read_error, the next one equals a full merge", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    // New lines in 2 logs and a project change. The engine reads macbook-pro first, then the
    // read of ubuntu-01 fails once (for example EIO).
    await ws.task(
      FIXTURE_TASK,
      event(
        "macbook-pro",
        "comment.added",
        at("14:25:00"),
        { text: "first" },
        { by: "human@macbook-pro" },
      ),
      event("ubuntu-01", "task.progress", at("14:26:00"), { text: "second" }),
    );
    const project = join(ws.root, "tasks/projects/billing-api/project.yaml");
    await writeFile(
      project,
      (await readFile(project, "utf8")).replace("name: Billing API", "name: Billing"),
    );
    const failing = `tasks/${FIXTURE_TASK}/log/ubuntu-01.jsonl`;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with `.call(this)` below
    const read = LogSource.prototype.read;
    const spy = vi.spyOn(LogSource.prototype, "read").mockImplementation(function (
      this: LogSource,
    ) {
      if (this.path === failing) {
        spy.mockRestore();
        return Promise.reject(Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" }));
      }
      return read.call(this);
    });
    // One file that cannot be read does not stop the merge (final check review M1, as the phone).
    const failed = await engine.update();
    expect(failed.view.issues.map((i) => [i.code, i.path])).toContainEqual(["read_error", failing]);
    expect(failed.view.tasks.find((t) => t.id === FIXTURE_TASK)!.comments.at(-1)!.text).toBe(
      "first",
    );
    const update = await engine.update();
    expect(update.full).toBe(true);
    expect(update.view.issues.map((i) => i.code)).not.toContain("read_error");
    expect(viewOf(update)).toEqual(viewOf(await mergeWorkspace(ws.root, { clock })));
    const task = update.view.tasks.find((t) => t.id === FIXTURE_TASK)!;
    expect(task.comments.at(-1)!.text).toBe("first");
    expect(task.progress).toBe("second");
    expect(update.view.projects[0]!.name).toBe("Billing");
  });

  it("runs 2 overlapping updates one at a time", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    await ws.task(
      FIXTURE_TASK,
      event("pixel-9", "comment.added", at("14:25:00"), { text: "new" }, { by: "human@pixel-9" }),
    );
    const [first, second] = await Promise.all([engine.update(), engine.update()]);
    for (const update of [first, second]) {
      expect(update.full).toBe(false);
      expect(update.notices).toEqual([]);
      expect(update.view.issues).toEqual([]);
    }
    expect(first.changedTasks).toEqual([FIXTURE_TASK]);
    expect(second.changedTasks).toEqual([]);
    expect(viewOf(second)).toEqual(viewOf(await mergeWorkspace(ws.root, { clock })));
    // Each log offset stays at the end of its file: the next update finds no truncation.
    const third = await engine.update();
    expect(third).toMatchObject({ full: false, notices: [], changedTasks: [] });
    // A rebuild waits for the update before it.
    const [, rebuilt] = await Promise.all([engine.update(), engine.rebuild()]);
    expect(rebuilt.full).toBe(true);
    expect(viewOf(rebuilt)).toEqual(viewOf(second));
  });

  it("reads all files again when a log is removed", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    await rm(join(ws.root, "tasks", FIXTURE_TASK, "log", "pixel-9.jsonl"));
    const update = await engine.update();
    expect(update.full).toBe(true);
    expect(update.notices).toEqual([
      { code: "removed", path: `tasks/${FIXTURE_TASK}/log/pixel-9.jsonl` },
    ]);
    expect(viewOf(update)).toEqual(viewOf(await mergeWorkspace(ws.root, { clock })));
  });
});

describe("synced folders and links (final check fc1-4)", () => {
  it("skips a folder or a link in place of a log or a document, and goes on", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    // A folder with the name of a log: before the fix each update failed with EISDIR.
    await mkdir(join(ws.root, "tasks", "log", "pixel-9.jsonl"), { recursive: true });
    // A link in place of a task log and of a document: the merge must not read the targets.
    const outside = `${ws.root}-outside`;
    await mkdir(outside, { recursive: true });
    const line = JSON.stringify({
      ...event("mac-mini-lab", "comment.added", at("14:27:00"), { text: "from outside" }),
      task: FIXTURE_TASK,
    });
    await writeFile(join(outside, "log.jsonl"), `${line}\n`);
    await symlink(
      join(outside, "log.jsonl"),
      join(ws.root, "tasks", FIXTURE_TASK, "log", "mac-mini-lab.jsonl"),
    );
    const project = join(ws.root, "tasks/projects/billing-api/project.yaml");
    await writeFile(
      join(outside, "project.yaml"),
      (await readFile(project, "utf8")).replace("name: Billing API", "name: Outside"),
    );
    await rm(project);
    await symlink(join(outside, "project.yaml"), project);
    const update = await engine.update();
    const task = update.view.tasks.find((t) => t.id === FIXTURE_TASK)!;
    expect(task.comments.map((c) => c.text)).not.toContain("from outside");
    expect(update.view.projects.map((p) => p.name)).not.toContain("Outside");
    expect(viewOf(await engine.update())).toEqual(viewOf(await mergeWorkspace(ws.root, { clock })));
    await rm(outside, { recursive: true, force: true });
  });

  it("goes on with read_error when a log or a document has no read permission (review M1)", async () => {
    const clock = new FakeClock("2026-11-22T14:30:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    await engine.update();
    const log = join(ws.root, "tasks", FIXTURE_TASK, "log", "pixel-9.jsonl");
    const project = join(ws.root, "tasks/projects/billing-api/project.yaml");
    await chmod(log, 0o000);
    await writeFile(
      project,
      (await readFile(project, "utf8")).replace("name: Billing API", "name: Billing"),
    );
    await chmod(project, 0o000);
    try {
      const update = await engine.update();
      const codes = update.view.issues.map((i) => [i.code, i.path]);
      expect(codes).toContainEqual(["read_error", `tasks/${FIXTURE_TASK}/log/pixel-9.jsonl`]);
      expect(codes).toContainEqual(["read_error", "tasks/projects/billing-api/project.yaml"]);
      expect(update.view.projects[0]!.name).toBe("Billing API");
    } finally {
      await chmod(log, 0o644);
      await chmod(project, 0o644);
    }
    const next = await engine.update();
    expect(next.view.issues.map((i) => i.code)).not.toContain("read_error");
    expect(next.view.projects[0]!.name).toBe("Billing");
  });
});
