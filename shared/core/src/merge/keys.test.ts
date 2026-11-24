// The rekey plan (docs/architecture.md 4.3.3, openspec offline-task-keys). The Kotlin engine reads
// the same fixture file (android/shared MergeCasesTest).
import { mergeCases, mergeCasesRoot } from "@aw/schema/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.ts";
import { mergeWorkspace } from "./engine.ts";
import { rekeyPlan, type RekeyItem } from "./keys.ts";
import { at, createdData, event, runMergeCase, TestWorkspace } from "./testing.ts";

interface RekeysFile {
  prefix: string;
  plans: Record<string, RekeyItem[]>;
}

describe("rekeyPlan", () => {
  it("gives the plan of each device of the task-key-collision case (rekeys.json)", async () => {
    const file = JSON.parse(
      readFileSync(join(mergeCasesRoot, "task-key-collision", "rekeys.json"), "utf8"),
    ) as RekeysFile;
    const run = await runMergeCase(mergeCases().find((c) => c.name === "task-key-collision")!);
    await run.cleanup();
    const plans = Object.fromEntries(
      Object.keys(file.plans).map((device) => [
        device,
        rekeyPlan(run.update.view, file.prefix, device),
      ]),
    );
    expect(plans).toEqual(file.plans);
  });

  describe("in a workspace", () => {
    let ws: TestWorkspace;
    beforeEach(async () => {
      ws = await TestWorkspace.create();
    });
    afterEach(async () => {
      await ws.remove();
    });
    const clock = new FakeClock("2026-11-22T16:00:00.000Z");
    const human = (dev: string) => ({ by: `human@${dev}` });
    const ids = [
      "01a203c5-6d80-7000-8000-000000000001",
      "01a203c5-6d80-7000-8000-000000000002",
      "01a203c5-6d80-7000-8000-000000000003",
      "01a203c5-6d80-7000-8000-000000000004",
    ];

    it("gives 2 own duplicates 2 keys above each key, in the order of task.created", async () => {
      // The fixture task AW-7 is from macbook-pro (local). macbook-pro and ubuntu-01 both create
      // AW-20 and AW-21 offline; ubuntu-01 created AW-21 first.
      const created = (dev: string, key: string, time: string) =>
        event(dev, "task.created", at(time), createdData(key), human(dev));
      await ws.task(ids[0]!, created("macbook-pro", "AW-20", "15:00:00"));
      await ws.task(ids[1]!, created("macbook-pro", "AW-21", "15:00:01"));
      await ws.task(ids[2]!, created("ubuntu-01", "AW-21", "15:00:02"));
      await ws.task(ids[3]!, created("ubuntu-01", "AW-20", "15:00:03"));
      const { view } = await mergeWorkspace(ws.root, { clock });
      expect(rekeyPlan(view, "AW", "ubuntu-01")).toEqual([
        { task: ids[2], from: "AW-21", to: "AW-22" },
        { task: ids[3], from: "AW-20", to: "AW-23" },
      ]);
      expect(rekeyPlan(view, "AW", "macbook-pro")).toEqual([]);
    });

    it("gives an empty plan with no duplicate", async () => {
      await ws.task(
        ids[0]!,
        event("ubuntu-01", "task.created", at("15:00:00"), createdData("AW-8"), human("ubuntu-01")),
      );
      const { view } = await mergeWorkspace(ws.root, { clock });
      expect(rekeyPlan(view, "AW", "ubuntu-01")).toEqual([]);
    });
  });
});
