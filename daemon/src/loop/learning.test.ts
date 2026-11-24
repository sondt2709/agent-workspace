// The reminder of the learning step in the reply of `done` (openspec agent-learning, spec
// task-learning "Done with no learning step"). The host is a stub: markDone reads only the task,
// its rows and the device, and writes task.done.
import type { EventRow, TaskView } from "@aw/core";
import { describe, expect, it } from "vitest";
import { markDone, type AgentContext } from "./agent.ts";
import { hasLearningStep } from "./learning.ts";

function row(type: string, applied = true): EventRow {
  return { type, applied } as unknown as EventRow;
}

function context(rows: EventRow[]): { ctx: AgentContext; written: string[] } {
  const written: string[] = [];
  const task = {
    id: "01a20790-0000-7000-8000-000000000001",
    key: "AW-1",
    stage: "review",
    gates: [{ kind: "approve_result", state: "resolved", answer: "Approve" }],
  } as unknown as TaskView;
  const host = {
    me: "macbook-pro",
    rows: () => rows,
    write: (_task: string, type: string) => {
      written.push(type);
      return Promise.resolve({ event: { id: "e1" }, applied: true, reason: null });
    },
  };
  return { ctx: { task, host } as unknown as AgentContext, written };
}

describe("done and the learning step", () => {
  it("reminds the agent when the task has no learning step, and does not block done", async () => {
    const { ctx, written } = context([row("result.posted")]);
    const reply = await markDone(ctx);
    expect(written).toEqual(["task.done"]);
    expect(reply.next).toBe(
      "AW-1 is done. You recorded no learning step for AW-1: run learn for each thing you learned, or learn with nothing_new: true (`aw learn AW-1 --file <path> --title <title>` for each thing you learned, or `aw learn AW-1 --nothing-new`), before you end your turn. Then end your turn: AW then closes this session.",
    );
  });

  it("has no reminder after a learning step", async () => {
    const { ctx } = context([row("task.learned")]);
    expect((await markDone(ctx)).next).toBe(
      "AW-1 is done. End your turn now: AW then closes this session.",
    );
  });

  it("counts only an applied task.learned", () => {
    expect(hasLearningStep([row("task.learned", false)])).toBe(false);
    expect(hasLearningStep([row("task.learned")])).toBe(true);
  });
});
