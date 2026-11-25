// Test plan 1: each merge case gives its expected view, for each read order of the files. The
// expected files are a contract for the Kotlin port (android-shared).
import { eventV1, taskV1, upgradeEvent } from "@aw/schema";
import {
  expectedPath,
  FIXTURE_TASK_ID,
  mergeCases,
  mergeCasesRoot,
  readFixtureText,
} from "@aw/schema/testing";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { toTaskDocument } from "./snapshot.ts";
import { expectedOf, mergeCaseIn, runMergeCase, seededRandom, shuffle } from "./testing.ts";

const cases = mergeCases();

describe("merge cases", () => {
  it("covers each case of the handoff and the rule cases", () => {
    expect(cases.map((c) => c.name)).toEqual([
      "base",
      "claim-epochs",
      "claim-not-assignee",
      "device-offline",
      "device-revoked",
      "far-future-hlc",
      "gate-answered-twice",
      "project-removed",
      "session-link",
      "session-options",
      "task-key-collision",
      "task-rules",
      "truncated-log-line",
      "workspace-rules",
    ]);
  });

  it.each(cases)("$name equals expected.json", async (item) => {
    const run = await runMergeCase(item);
    try {
      const expected: unknown = JSON.parse(readFileSync(expectedPath(item.name), "utf8"));
      expect(expectedOf(run.update)).toEqual(expected);
    } finally {
      await run.cleanup();
    }
  });

  it.each(cases)("$name gives the same view for 40 seeded read orders", async (item) => {
    const random = seededRandom(20261122);
    const expected: unknown = JSON.parse(readFileSync(expectedPath(item.name), "utf8"));
    const orders: ((paths: string[]) => string[])[] = [
      (paths) => [...paths].reverse(),
      ...Array.from({ length: 39 }, () => (paths: string[]) => shuffle(paths, random)),
    ];
    // One case folder for each order: the merge only reads it.
    const first = await runMergeCase(item, orders[0]);
    try {
      expect(expectedOf(first.update)).toEqual(expected);
      for (const order of orders.slice(1)) {
        const run = await mergeCaseIn(item, first.root, order);
        expect(expectedOf(run.update)).toEqual(expected);
      }
    } finally {
      await first.cleanup();
    }
  });

  it("gives the fixture task.yaml as the snapshot of the base case", async () => {
    const run = await runMergeCase(cases.find((c) => c.name === "base")!);
    try {
      const task = run.update.view.tasks.find((t) => t.id === FIXTURE_TASK_ID)!;
      const fixture = taskV1.parse(parse(readFixtureText(`tasks/${FIXTURE_TASK_ID}/task.yaml`)));
      expect(toTaskDocument(task)).toEqual(fixture);
    } finally {
      await run.cleanup();
    }
  });

  it("has valid case files, except the bad lines that the truncated case needs", () => {
    const bad: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    for (const file of walk(mergeCasesRoot).filter((f) => f.endsWith(".jsonl"))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (line === "") return;
          let ok: boolean;
          try {
            // A line of a case from before the rename is valid after the map of legacy.ts.
            ok = eventV1.safeParse(upgradeEvent(JSON.parse(line))).success;
          } catch {
            ok = false;
          }
          if (!ok) bad.push(`${file.slice(mergeCasesRoot.length + 1)}:${index + 1}`);
        });
    }
    expect(bad).toEqual([
      `truncated-log-line/files/tasks/${FIXTURE_TASK_ID}/log/macbook-pro.jsonl:3`,
      `truncated-log-line/files/tasks/${FIXTURE_TASK_ID}/log/ubuntu-01.jsonl:16`,
    ]);
  });
});

describe("merge case rules", () => {
  /** The device of the log file of an issue. */
  const devOf = (path: string) => path.split("/").at(-1)!.replace(".jsonl", "");

  async function view(name: string) {
    const run = await runMergeCase(cases.find((c) => c.name === name)!);
    await run.cleanup();
    return run.update;
  }

  it("gate-answered-twice: the answer that the session device used wins, the other is a comment", async () => {
    const { view: v } = await view("gate-answered-twice");
    const task = v.tasks.find((t) => t.key === "AW-8")!;
    const question = task.gates.find((g) => g.kind === "question")!;
    expect(question.state).toBe("resolved");
    expect(question.answer).toBe("1000/min");
    expect(question.answers.map((a) => [a.dev, a.use])).toEqual([
      ["macbook-pro", "comment"],
      ["pixel-9", "used"],
      ["macbook-pro", "comment"],
    ]);
    const proposal = task.gates.find((g) => g.kind === "approve_proposal")!;
    expect(proposal).toMatchObject({ state: "open", version: 2 });
    expect(task.needs_you).toEqual([proposal.gate]);
    expect(task.comments.map((c) => c.source)).toEqual([
      "late_answer",
      "late_answer",
      "late_answer",
    ]);
  });

  it("claim-epochs: the highest accepted epoch owns the task; state events of others do not count", async () => {
    const { view: v } = await view("claim-epochs");
    const task = v.tasks.find((t) => t.key === "AW-8")!;
    expect(task.assignee).toBe("claude@macbook-pro");
    expect(task.owner).toBe("macbook-pro");
    expect(task.claim).toMatchObject({ epoch: 3, device: "macbook-pro" });
    expect(task.moving_to).toBeNull();
    expect(task.stage).toBe("implement");
    expect(task.comments.map((c) => c.dev)).toEqual(["ubuntu-01"]);
    expect(v.issues.map((i) => [devOf(i.path), i.reason])).toEqual([
      ["macbook-pro", "stale_claim"],
      ["pixel-9", "claim_device_mismatch"],
      ["ubuntu-01", "not_owner"],
      ["ubuntu-01", "not_assignee_device"],
    ]);
  });

  it("claim-not-assignee: only the device of the assignee claims; AW never moves the task", async () => {
    const { view: v, presence } = await view("claim-not-assignee");
    const task = v.tasks.find((t) => t.key === "AW-30")!;
    expect(task).toMatchObject({
      assignee: "claude@macbook-pro",
      owner: "ubuntu-01",
      claim: { epoch: 2, device: "ubuntu-01" },
      moving_to: "macbook-pro",
      stage: "implement",
      gates: [],
      needs_you_reasons: [],
    });
    expect(task.comments.map((c) => [c.dev, c.source])).toEqual([
      ["pixel-9", "late_answer"],
      ["macbook-pro", "comment"],
    ]);
    expect(
      v.issues.filter((i) => i.task === task.id).map((i) => [devOf(i.path), i.line, i.reason]),
    ).toEqual([
      ["macbook-pro", 4, "not_owner"],
      ["macbook-pro", 5, "not_assignee_device"],
      ["macbook-pro", 7, "not_owner"],
      ["ubuntu-01", 1, "not_assignee_device"],
      ["ubuntu-01", 2, "not_assignee_device"],
      ["ubuntu-01", 3, "assignment_not_allowed"],
      ["ubuntu-01", 4, "not_owner"],
    ]);
    // ubuntu-01 is offline for more than 1 h: its task only waits.
    expect(presence.offline_tasks.find((t) => t.task === task.id)).toEqual({
      task: task.id,
      device: "ubuntu-01",
      cause: "device_offline",
      since: "2026-11-22T14:22:30.000Z",
    });
  });

  it("task-key-collision: the higher-priority device keeps the key", async () => {
    const { view: v } = await view("task-key-collision");
    const byTitle = (title: string) => v.tasks.find((t) => t.title === title)!;
    expect(byTitle("Show the invoice total in the email")).toMatchObject({
      key: "AW-8",
      key_state: "ok",
    });
    expect(byTitle("Fix the refund rounding")).toMatchObject({
      key: "AW-8",
      key_state: "duplicate",
      rekey_by: "pixel-9",
    });
    expect(byTitle("Add a test for the refund webhook")).toMatchObject({
      key: "AW-9",
      key_state: "ok",
      assignee: null,
    });
    expect(byTitle("Update the README of the billing API")).toMatchObject({
      key: "AW-10",
      key_state: "ok",
    });
  });

  it("device-offline: the task of the offline owner shows device_offline", async () => {
    const { presence } = await view("device-offline");
    expect(presence.devices.find((d) => d.device === "ubuntu-01")).toMatchObject({
      online: false,
      offline_since: "2026-11-22T14:22:30.000Z",
    });
    expect(presence.offline_tasks).toEqual([
      {
        task: FIXTURE_TASK_ID,
        device: "ubuntu-01",
        cause: "device_offline",
        since: "2026-11-22T14:22:30.000Z",
      },
    ]);
  });

  it("far-future-hlc: the line is held and the last HLC stays below it", async () => {
    const { view: v } = await view("far-future-hlc");
    expect(v.issues.map((i) => [i.code, i.line])).toEqual([["future_hlc", 4]]);
    expect(v.last_hlc).toBe("2026-11-22T14:23:00.000Z#0000");
    expect(v.tasks[0]!.includes["pixel-9"]).toBe(3);
  });

  it("truncated-log-line: the cut line is a bad line and the next line merges", async () => {
    const { view: v } = await view("truncated-log-line");
    expect(v.issues.map((i) => [i.code, i.line])).toEqual([
      ["partial_tail", 3],
      ["bad_line", 16],
    ]);
    expect(v.tasks[0]!.progress).toBe("Run the tests again");
  });
});
