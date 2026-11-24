import { describe, expect, it } from "vitest";
import {
  agentChoices,
  boardLanes,
  commentRule,
  countdown,
  GROUP_LABEL,
  hlcMs,
  listGroups,
  needYouNav,
  pauseText,
  pendingAnswer,
  switchGroups,
  taskPageLayout,
  titleFromFirstMessage,
} from "./model.ts";
import { makeGate, makeTask, PROJECT } from "./testing.tsx";

const paused = {
  cause: "device_offline",
  since: "x",
  resumes_at: null,
  next_step: "Wait",
  needs_human: false,
};

describe("boardLanes", () => {
  it("puts a task with a Needs you reason in the Needs you row of its stage, and the others in their row", () => {
    const tasks = [
      makeTask({
        id: "a",
        stage: "discuss",
        needs_you_lane: true,
        needs_you_reasons: [{ reason: "gate" }],
      }),
      makeTask({ id: "b", stage: "implement", paused }),
      makeTask({ id: "c", stage: "done" }),
      makeTask({ id: "d", stage: "review", archived: true }),
    ];
    const { needsYou, rest } = boardLanes(tasks);
    expect(needsYou.discuss.map((t) => t.id)).toEqual(["a"]);
    expect(rest.discuss).toEqual([]);
    expect(needsYou.implement).toEqual([]);
    expect(rest.implement.map((t) => t.id)).toEqual(["b"]);
    expect(rest.done.map((t) => t.id)).toEqual(["c"]);
    expect(rest.review).toEqual([]);
  });
});

describe("listGroups", () => {
  it("groups Needs you, Running, Paused, Backlog and Done, and leaves out empty groups", () => {
    const groups = listGroups([
      makeTask({ id: "a", stage: "backlog" }),
      makeTask({ id: "b", stage: "implement", paused }),
      makeTask({ id: "c", stage: "review" }),
      makeTask({ id: "d", stage: "ready", needs_you_lane: true }),
    ]);
    expect(groups.map((g) => [g.id, g.tasks.map((t) => t.id)])).toEqual([
      ["needs_you", ["d"]],
      ["running", ["c"]],
      ["paused", ["b"]],
      ["backlog", ["a"]],
    ]);
  });

  it("puts each archived task in the last group Archived (openspec task-actions)", () => {
    const groups = listGroups([
      makeTask({ id: "x", stage: "implement", archived: true, needs_you_lane: true }),
      makeTask({ id: "c", stage: "done" }),
    ]);
    expect(groups.map((g) => [g.id, g.tasks.map((t) => t.id)])).toEqual([
      ["done", ["c"]],
      ["archived", ["x"]],
    ]);
    expect(GROUP_LABEL.archived).toBe("Archived");
  });

  it("puts a task that waits for a session in Queued, between Paused and Backlog", () => {
    const groups = listGroups(
      [
        makeTask({ id: "a", stage: "backlog" }),
        makeTask({ id: "q", stage: "backlog", assignee: "claude@ubuntu-01" }),
        makeTask({ id: "b", stage: "implement", paused }),
      ],
      new Set(["q"]),
    );
    expect(groups.map((g) => [g.id, g.tasks.map((t) => t.id)])).toEqual([
      ["paused", ["b"]],
      ["queued", ["q"]],
      ["backlog", ["a"]],
    ]);
    expect(GROUP_LABEL.queued).toBe("Queued");
  });
});

describe("pauseText", () => {
  it("gives the Paused chip a text for each pause cause of the continuity rules", () => {
    expect(
      [
        "usage_limit",
        "usage_limit_weekly",
        "continue_cap",
        "agent_error",
        "device_restart",
        "login_expired",
      ].map(pauseText),
    ).toEqual([
      "usage limit",
      "weekly usage limit",
      "continue limit",
      "agent error",
      "device restart",
      "login expired",
    ]);
  });
});

describe("titleFromFirstMessage", () => {
  it("takes the first line that is not empty", () => {
    expect(
      titleFromFirstMessage("\n  /my-team:implement Add a CSV export  \nKeep the order."),
    ).toBe("/my-team:implement Add a CSV export");
    expect(titleFromFirstMessage("   ")).toBe("");
    expect(titleFromFirstMessage("x".repeat(200))).toHaveLength(120);
  });
});

describe("countdown", () => {
  const opened = hlcMs("2026-11-23T10:00:00.000Z#0003");

  it("reads the time of an HLC", () => {
    expect(opened).toBe(Date.parse("2026-11-23T10:00:00.000Z"));
  });

  it("counts down from 120 s and then expires", () => {
    expect(countdown(opened, opened + 30_000)).toEqual({ left: 90, expired: false });
    expect(countdown(opened, opened + 119_500)).toEqual({ left: 1, expired: false });
    expect(countdown(opened, opened + 120_000)).toEqual({ left: 0, expired: true });
  });
});

describe("agentChoices", () => {
  it("gives the default agent on each device of the project, and extra values once", () => {
    expect(
      agentChoices([PROJECT], "billing-api", ["claude@ubuntu-01", "codex@mac-mini-lab", null]),
    ).toEqual(["claude@macbook-pro", "claude@ubuntu-01", "codex@mac-mini-lab"]);
    expect(agentChoices([PROJECT], "other")).toEqual([]);
  });
});

describe("gate rules", () => {
  it("needs a comment for Request changes, allows one for Deny", () => {
    expect(commentRule("Request changes")).toBe("required");
    expect(commentRule("Deny")).toBe("optional");
    expect(commentRule("Confirm")).toBe("none");
  });

  it("finds the pending answer of this device and of another device", () => {
    const answer = (dev: string, use: "pending" | "used") => ({
      event: dev,
      dev,
      hlc: "h",
      by: `human@${dev}`,
      version: 1,
      answer: "100/min",
      comment: null,
      use,
    });
    const gate = makeGate({
      answers: [answer("pixel-9", "pending"), answer("macbook-pro", "pending")],
    });
    expect(pendingAnswer(gate, "macbook-pro").mine?.dev).toBe("macbook-pro");
    expect(pendingAnswer(gate, "macbook-pro").other?.dev).toBe("pixel-9");
    expect(pendingAnswer(makeGate(), "macbook-pro")).toEqual({ mine: null, other: null });
  });
});

describe("task page (openspec task-review-layout)", () => {
  const tasks = [
    makeTask({ id: "a", needs_you_lane: true }),
    makeTask({ id: "b" }),
    makeTask({ id: "c", needs_you_lane: true }),
    makeTask({ id: "d", needs_you_lane: true, archived: true }),
  ];

  it("gives the place of a task that needs the person, in the Inbox order", () => {
    expect(needYouNav(tasks, "a")).toEqual({ text: "1 of 2 need you", prev: null, next: "c" });
    expect(needYouNav(tasks, "c")).toEqual({ text: "2 of 2 need you", prev: "a", next: null });
  });

  it("gives the count and the first task for another task", () => {
    expect(needYouNav(tasks, "b")).toEqual({ text: "2 need you", prev: null, next: "a" });
    expect(needYouNav([makeTask({ id: "x", needs_you_lane: true })], "y").text).toBe("1 needs you");
    expect(needYouNav([makeTask({ id: "b" })], "b")).toEqual({
      text: null,
      prev: null,
      next: null,
    });
  });

  it("shows the task list from 700 px and the Properties panel from 1,000 px without it", () => {
    expect(taskPageLayout(699, true, 1000)).toEqual({
      canList: false,
      list: false,
      propertiesPanel: false,
    });
    expect(taskPageLayout(1208, false, 1000)).toEqual({
      canList: true,
      list: false,
      propertiesPanel: true,
    });
    // 1208 - 300 = 908: the Properties tab comes back while the list shows.
    expect(taskPageLayout(1208, true, 1000)).toEqual({
      canList: true,
      list: true,
      propertiesPanel: false,
    });
  });

  it("lists the tasks that need the person first, then the working tasks", () => {
    const groups = switchGroups([
      makeTask({ id: "w", stage: "implement" }),
      makeTask({ id: "n", needs_you_lane: true }),
      makeTask({ id: "z", stage: "done" }),
    ]);
    expect(groups.map((g) => [g.id, g.tasks.map((t) => t.id)])).toEqual([
      ["needs_you", ["n"]],
      ["running", ["w"]],
    ]);
  });
});
