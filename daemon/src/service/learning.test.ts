// The learning step of a task (openspec agent-learning, spec task-learning): the service method
// through the real socket and in process, with real files.
import { AwApiError, type EventRow } from "@aw/client";
import { KnowledgeClient } from "@aw/client/knowledge";
import { FakeClock } from "@aw/core";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatThreadRows } from "../cli/format.ts";
import { formatLearnResult } from "../cli/kb.ts";
import { startTestDaemon, type TestDaemon } from "../testing.ts";
import { appliedLearning, recordLearning } from "./learning.ts";

let d: TestDaemon;
let kb: KnowledgeClient;
let task: string;
const clock = new FakeClock("2026-11-23T09:00:00.000Z");

beforeEach(async () => {
  d = await startTestDaemon({ workspace: true, clock });
  kb = new KnowledgeClient(d.client);
  const created = await d.client.createTask("-", {
    project: "billing-api",
    title: "Round the invoice total",
    first_message: "Fix the rounding in src/api/invoice.ts",
  });
  task = created.task.id;
});
afterEach(async () => {
  await d.close();
});

async function learnedRows(id = task): Promise<EventRow[]> {
  const thread = await d.client.thread("-", id, { limit: 1000 });
  return thread.events.filter((r) => r.type === "task.learned");
}

async function apiError(promise: Promise<unknown>): Promise<AwApiError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AwApiError);
  return error as AwApiError;
}

describe("the learning step", () => {
  it('records "Nothing new" as task.learned with no knowledge file', async () => {
    const result = await kb.learn("-", { task: "AW-1", nothing_new: true });
    expect(result).toMatchObject({ change: null, suggestion: null, unchanged: false });
    expect(result.task_event).toMatchObject({ applied: true, reason: null });
    const rows = await learnedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toMatchObject({
      id: result.task_event!.id,
      by: "human@macbook-pro",
      data: { nothing_new: true },
    });
    expect((await d.client.task("-", "AW-1")).learned).toBe(true);
    expect(await kb.list("-")).toEqual([]);
    expect(formatThreadRows(rows)[0]).toMatch(
      /human@macbook-pro task\.learned\n {2}Nothing new learned$/,
    );
  });

  it("writes task.learned with the path and the change of a learned item", async () => {
    const result = await kb.learn("-", {
      task: "AW-1",
      title: "Use cents",
      content: "Store money in integer cents.\n",
      author: "claude@macbook-pro",
    });
    const path = "projects/billing-api/learned/2026-11-23-use-cents.md";
    expect(result.change).toMatchObject({ path, kind: "learned" });
    const rows = await learnedRows();
    expect(rows.map((r) => r.event)).toMatchObject([
      {
        id: result.task_event!.id,
        by: "claude@macbook-pro",
        data: { nothing_new: false, path, change: result.change!.id, suggestion: null },
      },
    ]);
    await access(join(d.folder, "knowledge", ...path.split("/")));
    expect(formatThreadRows(rows)[0]).toMatch(/\n {2}Learned: projects\/billing-api\/learned\//);
  });

  it("names the suggestion of a shared item that waits for approval", async () => {
    const result = await kb.learn("-", {
      task: "AW-1",
      title: "Team rule",
      content: "Use the fake clock.\n",
      shared: true,
      author: "claude@macbook-pro",
    });
    expect(result.change).toBeNull();
    const rows = await learnedRows();
    expect(rows[0]!.event.data).toMatchObject({
      nothing_new: false,
      path: result.suggestion!.path,
      change: null,
      suggestion: result.suggestion!.id,
    });
    expect(formatThreadRows(rows)[0]).toContain("(waits for approval)");
  });

  it("refuses a mix, an empty step and a missing title, and writes nothing", async () => {
    for (const body of [
      { task: "AW-1", nothing_new: true, title: "x" },
      { task: "AW-1", nothing_new: true, shared: true },
      { task: "AW-1" },
      { task: "AW-1", content: "x" },
    ]) {
      expect(await apiError(kb.learn("-", body))).toMatchObject({
        status: 400,
        code: "invalid_input",
      });
    }
    expect(await learnedRows()).toEqual([]);
  });

  it("refuses a session caller of another task, and sets the agent of the session as the author", async () => {
    const service = d.server.daemon.workspace();
    const other = await d.client.createTask("-", {
      project: "billing-api",
      title: "Other",
      first_message: "Other work",
    });
    const caller = { agent: "claude@macbook-pro", session: "s-1", task };
    const refused = await recordLearning(
      service,
      { task: service.showTask(other.task.id), nothing_new: true },
      caller,
    ).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: "refused" });
    expect(await learnedRows(other.task.id)).toEqual([]);

    const mine = await recordLearning(
      service,
      { task: service.showTask(task), nothing_new: true },
      caller,
    );
    expect(mine.task_event?.applied).toBe(true);
    expect((await learnedRows())[0]!.event.by).toBe("claude@macbook-pro");
  });
});

describe("a learning step that the merge did not apply (review agent-learning lows 2 and 3)", () => {
  const notApplied = {
    change: null,
    suggestion: null,
    unchanged: false,
    task_event: { id: "01a206b8-f29e-7776-b986-0000000000e1", applied: false, reason: "not_owner" },
  };

  it("is an error for the agent (MCP) and is not 'Recorded' in the CLI", () => {
    expect(() => appliedLearning(notApplied)).toThrow(
      "the merge did not apply it: not_owner. The learning step is not recorded.",
    );
    expect(formatLearnResult("AW-7", notApplied)).toBe(
      "Not recorded: the learning step of AW-7 does not count",
    );
    const applied = { ...notApplied, task_event: { ...notApplied.task_event, applied: true } };
    expect(appliedLearning(applied)).toBe(applied);
    expect(formatLearnResult("AW-7", applied)).toBe("Recorded: nothing new learned on AW-7");
  });
});
