// Test plan 3 and 4 of merge-index: MongoDB-style queries equal plain filters of the view, the
// incremental index equals a rebuilt index, and the speed of 10,000 events.
import { mergeCases } from "@aw/schema/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../clock.ts";
import { MergeEngine } from "../merge/engine.ts";
import { appendRandomRound, RandomEvents } from "../merge/random-events.ts";
import {
  at,
  createdData,
  event,
  FIXTURE_TASK,
  runMergeCase,
  seededRandom,
  TestWorkspace,
} from "../merge/testing.ts";
import type { TaskView } from "../merge/view.ts";
import { toSqlFilter } from "./query.ts";
import { collections, indexPath, PRESENCE_COLLECTIONS, WorkspaceIndex } from "./sqlite.ts";

describe("indexPath", () => {
  it("puts the index in the index folder of the state folder", () => {
    expect(indexPath("/opt/aw-state", "01a2038e-7f00-721a-b230-e03772a58aff")).toBe(
      "/opt/aw-state/index/01a2038e-7f00-721a-b230-e03772a58aff.sqlite",
    );
  });
});

describe("toSqlFilter", () => {
  const columns = { stage: "text", archived: "bool", project: "text" } as const;

  it("moves exact conditions on columns to SQL", () => {
    expect(toSqlFilter({ stage: "implement", archived: false }, columns)).toEqual({
      where: `"stage" = ? AND "archived" = ?`,
      params: ["implement", 0],
      complete: true,
    });
    expect(
      toSqlFilter(
        { $and: [{ stage: { $in: ["ready", null] } }, { project: { $eq: null } }] },
        columns,
      ),
    ).toEqual({
      where: `("stage" IN (?) OR "stage" IS NULL) AND "project" IS NULL`,
      params: ["ready"],
      complete: true,
    });
  });

  it("leaves other conditions to sift", () => {
    expect(
      toSqlFilter({ stage: { $ne: "done" }, "claim.device": "ubuntu-01", $or: [] }, columns),
    ).toEqual({
      where: "",
      params: [],
      complete: false,
    });
  });
});

describe("queries", () => {
  let index: WorkspaceIndex;
  let tasks: TaskView[];
  const cleanups: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    // A workspace with the tasks of 3 merge cases.
    const ws = await TestWorkspace.create();
    cleanups.push(() => ws.remove());
    for (const name of ["gate-answered-twice", "task-key-collision", "claim-epochs"]) {
      const run = await runMergeCase(mergeCases().find((c) => c.name === name)!);
      cleanups.push(run.cleanup);
      for (const task of run.update.view.tasks) {
        const { readdir, cp } = await import("node:fs/promises");
        const dir = join(run.root, "tasks", task.id);
        if ((await readdir(dir).catch(() => null)) !== null) {
          await cp(dir, join(ws.root, "tasks", task.id), { recursive: true, force: false });
        }
      }
    }
    const clock = new FakeClock("2026-11-22T16:00:00.000Z");
    const engine = new MergeEngine({ root: ws.root, clock });
    const update = await engine.update();
    tasks = update.view.tasks;
    index = new WorkspaceIndex(":memory:");
    index.write(update, engine);
  });
  afterEach(async () => {
    index.close();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  const byId = (a: TaskView, b: TaskView) => (a.id < b.id ? -1 : 1);
  const ids = (rows: TaskView[]) => rows.map((t) => t.id);

  it.each([
    ["stage", { stage: "backlog" }, (t: TaskView) => t.stage === "backlog"],
    [
      "stage $in",
      { stage: { $in: ["discuss", "ready"] } },
      (t: TaskView) => ["discuss", "ready"].includes(t.stage),
    ],
    [
      "assignee",
      { assignee: "claude@ubuntu-01" },
      (t: TaskView) => t.assignee === "claude@ubuntu-01",
    ],
    ["no assignee", { assignee: null }, (t: TaskView) => t.assignee === null],
    ["project", { project: "billing-api" }, (t: TaskView) => t.project === "billing-api"],
    ["needs you", { needs_you_lane: true }, (t: TaskView) => t.needs_you_lane],
    [
      "needs you to assign",
      { "needs_you_reasons.reason": "assign" },
      (t: TaskView) => t.needs_you_reasons.some((r) => r.reason === "assign"),
    ],
    [
      "claim device",
      { "claim.device": "ubuntu-01" },
      (t: TaskView) => t.claim?.device === "ubuntu-01",
    ],
    ["duplicate key", { key_state: "duplicate" }, (t: TaskView) => t.key_state === "duplicate"],
    [
      "stage and $or",
      { project: "billing-api", $or: [{ stage: "implement" }, { owner: "pixel-9" }] },
      (t: TaskView) =>
        t.project === "billing-api" && (t.stage === "implement" || t.owner === "pixel-9"),
    ],
    ["open gate", { needs_you: { $size: 1 } }, (t: TaskView) => t.needs_you.length === 1],
  ] as const)("%s", (_name, query, filter) => {
    const expected = tasks.filter(filter).sort(byId);
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(index.find<TaskView>("tasks", query))).toEqual(ids(expected));
  });

  it("returns nothing when no task matches", () => {
    expect(index.find("tasks", { stage: "review" })).toEqual([]);
  });

  it("refuses a limit that is not an integer of 0 or more, on the SQL and the sift path", () => {
    const sql = { stage: "backlog" };
    const sift = { "claim.device": "ubuntu-01" };
    for (const query of [sql, sift]) {
      for (const limit of [-1, 1.5, Number.NaN]) {
        expect(() => index.find("tasks", query, { limit }), `${limit}`).toThrow(RangeError);
      }
      expect(index.find("tasks", query, { limit: 0 })).toEqual([]);
    }
  });

  it("does not take a name of the object prototype as a column", () => {
    expect(toSqlFilter({ constructor: "x" }, { stage: "text" }).complete).toBe(false);
    expect(index.find("tasks", { constructor: "x" })).toEqual([]);
    const sort = Object.fromEntries([
      ["constructor", 1],
      ["id", 1],
    ]) as Record<string, 1>;
    expect(ids(index.find<TaskView>("tasks", {}, { sort }))).toEqual(ids([...tasks].sort(byId)));
  });

  it("sorts and limits in SQL and after sift with the same result", () => {
    const sql = index.find<TaskView>(
      "tasks",
      { project: "billing-api" },
      { sort: { stage: 1, key: -1 }, limit: 3 },
    );
    const sift = index.find<TaskView>(
      "tasks",
      { "created.dev": { $exists: true } },
      { sort: { stage: 1, key: -1 }, limit: 3 },
    );
    expect(ids(sql)).toEqual(ids(sift));
    expect(sql.map((t) => t.stage)).toEqual([...sql.map((t) => t.stage)].sort());
  });

  it("finds the events of a task that were not applied", () => {
    const rows = index.find<{ reason: string }>("events", {
      applied: false,
      type: "task.stage_changed",
    });
    // claim-epochs: the stage change of ubuntu-01 after the move.
    expect(rows.map((r) => r.reason)).toEqual(["not_owner"]);
  });
});

describe("incremental index", () => {
  it.each([20261122, 99])(
    "has the same rows as a rebuilt index after random appends (seed %i)",
    async (seed) => {
      const ws = await TestWorkspace.create();
      const dir = await mkdtemp(join(tmpdir(), "aw-index-"));
      try {
        const random = seededRandom(seed);
        const clock = new FakeClock("2026-11-22T14:30:00.000Z");
        const gen = new RandomEvents(random, clock);
        const engine = new MergeEngine({ root: ws.root, clock });
        const index = new WorkspaceIndex(join(dir, "incremental.sqlite"));
        index.write(await engine.update(), engine);
        const pending = new Map<string, string>();
        for (let round = 0; round < 30; round++) {
          await appendRandomRound(ws, gen, random, pending, clock);
          index.write(await engine.update(), engine);
          const fresh = new MergeEngine({ root: ws.root, clock });
          const rebuilt = new WorkspaceIndex(":memory:");
          rebuilt.rebuild(await fresh.update(), fresh);
          const a = index.dump();
          const b = rebuilt.dump();
          for (const name of collections) {
            if (PRESENCE_COLLECTIONS.includes(name)) continue;
            expect(a[name], `${name}, round ${round}`).toEqual(b[name]);
          }
          rebuilt.close();
        }
        // A new process opens the same file: the first write replaces each table.
        index.close();
        const reopened = new WorkspaceIndex(join(dir, "incremental.sqlite"));
        expect(reopened.find("tasks").length).toBeGreaterThan(1);
        reopened.close();
      } finally {
        await ws.remove();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("failures and restarts", () => {
  let ws: TestWorkspace;
  let dir: string;
  const clock = new FakeClock("2026-11-22T14:30:00.000Z");
  beforeEach(async () => {
    ws = await TestWorkspace.create();
    dir = await mkdtemp(join(tmpdir(), "aw-index-"));
  });
  afterEach(async () => {
    await ws.remove();
    await rm(dir, { recursive: true, force: true });
  });

  const withoutPresence = (index: WorkspaceIndex) => {
    const dump: Partial<ReturnType<WorkspaceIndex["dump"]>> = index.dump();
    for (const name of PRESENCE_COLLECTIONS) delete dump[name];
    return dump;
  };

  it("replaces each table on the next write after a failed write", async () => {
    const engine = new MergeEngine({ root: ws.root, clock });
    const index = new WorkspaceIndex(":memory:");
    index.write(await engine.update(), engine);
    await ws.task(
      FIXTURE_TASK,
      event(
        "pixel-9",
        "task.edited",
        at("14:25:00"),
        { field: "title", value: "NEW TITLE" },
        { by: "human@pixel-9" },
      ),
    );
    const update = await engine.update();
    const spy = vi.spyOn(engine, "eventRows").mockImplementationOnce(() => {
      throw new Error("database or disk is full");
    });
    expect(() => index.write(update, engine)).toThrow("database or disk is full");
    spy.mockRestore();
    // No new event: the next update changes nothing, but the write must still repair the index.
    index.write(await engine.update(), engine);
    expect(index.find<TaskView>("tasks", { id: FIXTURE_TASK })[0]!.title).toBe("NEW TITLE");
    const rebuilt = new WorkspaceIndex(":memory:");
    const fresh = new MergeEngine({ root: ws.root, clock });
    rebuilt.rebuild(await fresh.update(), fresh);
    expect(withoutPresence(index)).toEqual(withoutPresence(rebuilt));
    index.close();
    rebuilt.close();
  });

  it("keeps the last valid value of a bad document after a rebuild and after a restart", async () => {
    const path = join(dir, "restart.sqlite");
    const engine = new MergeEngine({ root: ws.root, clock });
    let index = new WorkspaceIndex(path);
    index.write(await engine.update(), engine);
    const valid = engine.view!.workspace;
    expect(valid?.device_order).toEqual(["macbook-pro", "ubuntu-01", "pixel-9"]);
    await ws.write(
      "tasks/workspace.yaml",
      "kind: workspace\nschema: 1\nid: 01a2038e-7f00-721a-b230-e03772a58aff\nname: Bad\ndevice_order: 5\n",
    );
    let update = await engine.update();
    index.write(update, engine);
    expect(update.view.workspace).toEqual(valid);
    expect(update.view.issues.map((i) => [i.code, i.path])).toEqual([
      ["bad_document", "tasks/workspace.yaml"],
    ]);
    const incremental = withoutPresence(index);

    // An index rebuild in the same process.
    update = await engine.rebuild();
    expect(update.view.workspace).toEqual(valid);
    index.rebuild(update, engine);
    expect(withoutPresence(index)).toEqual(incremental);

    // A restart: awd gives the documents of the index to the new engine.
    index.close();
    index = new WorkspaceIndex(path);
    const restarted = new MergeEngine({ root: ws.root, clock, lastValid: index.documents() });
    update = await restarted.update();
    expect(update.view.workspace).toEqual(valid);
    index.write(update, restarted);
    expect(withoutPresence(index)).toEqual(incremental);
    index.close();

    // A device that never read a valid version has none, and shows the same issue.
    const never = await new MergeEngine({ root: ws.root, clock }).update();
    expect(never.view.workspace).toBeNull();
    expect(never.view.issues).toEqual(update.view.issues);
  });
});

describe("speed", () => {
  it("merges and indexes 10,000 events in less than 2 s", async () => {
    const ws = await TestWorkspace.create({ fixture: true });
    const dir = await mkdtemp(join(tmpdir(), "aw-speed-"));
    try {
      const devices = ["macbook-pro", "ubuntu-01", "pixel-9"];
      let count = 0;
      // 100 tasks with 98 events each, and 200 workspace events: 10,000 events.
      for (let t = 0; t < 100; t++) {
        const task = `01a2038e-7f00-7${String(t).padStart(3, "0")}-8000-000000000000`;
        const lines = new Map<string, string[]>();
        const add = (dev: string, e: object) => {
          lines.set(dev, [...(lines.get(dev) ?? []), JSON.stringify({ ...e, task })]);
          count++;
        };
        add(
          "macbook-pro",
          event(
            "macbook-pro",
            "task.created",
            at("10:00:00"),
            createdData(`AW-${100 + t}`, { assignee: "claude@ubuntu-01" }),
            { by: "human@macbook-pro" },
          ),
        );
        add(
          "ubuntu-01",
          event("ubuntu-01", "task.claimed", at("10:00:01"), {
            epoch: 1,
            device: "ubuntu-01",
            session: "01a2038e-7f00-7000-8000-000000000001",
            based_on: null,
          }),
        );
        for (let i = 0; i < 96; i++) {
          const dev = devices[i % 3]!;
          const hlc = at(
            `11:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`,
            t % 10,
          );
          add(
            dev,
            i % 3 === 1
              ? event(dev, "task.progress", hlc, { text: `Step ${i}` })
              : event(dev, "comment.added", hlc, { text: `Comment ${i}` }, { by: `human@${dev}` }),
          );
        }
        for (const [dev, text] of lines)
          await ws.write(`tasks/${task}/log/${dev}.jsonl`, `${text.join("\n")}\n`);
      }
      const workspace: string[] = [];
      for (let i = 0; i < 200; i++) {
        workspace.push(
          JSON.stringify(
            event(
              "macbook-pro",
              "queue.reordered",
              at(`12:00:${String(i % 60).padStart(2, "0")}`, i),
              { agent: "claude@ubuntu-01", tasks: [] },
              { by: "human@macbook-pro" },
            ),
          ),
        );
        count++;
      }
      await ws.write("tasks/log/macbook-pro.jsonl", `${workspace.join("\n")}\n`);
      expect(count).toBe(10_000);

      const clock = new FakeClock("2026-11-22T16:00:00.000Z");
      const start = performance.now();
      const engine = new MergeEngine({ root: ws.root, clock });
      const update = await engine.update();
      const index = new WorkspaceIndex(join(dir, "speed.sqlite"));
      index.write(update, engine);
      const ms = performance.now() - start;
      index.close();
      console.log(`merge and index of ${count} events: ${ms.toFixed(0)} ms`);
      expect(update.view.tasks.length).toBe(101);
      expect(ms).toBeLessThan(2000);
    } finally {
      await ws.remove();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
