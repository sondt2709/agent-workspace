// The Activity rule (openspec task-view-focus, phone-task-focus and proposal-and-discussion): each
// contract event type has a decision, the inputs of a session show only when the person typed them
// in the terminal, a stopped or crashed session shows its cause, and each row has one of the 3 row
// styles. The phone runs the same shared cases and threads.
import { describe, expect, it } from "vitest";
import casesJson from "../../../../contracts/fixtures/activity/cases.json?raw";
import samplesJson from "../../../../contracts/samples/schema-samples.json?raw";
import type { EventRow } from "../../shared/channels.ts";
import {
  ACTIVITY,
  CLAMP_LINES,
  activityLine,
  activityRows,
  clampText,
  inActivity,
  needsPerson,
  rowStyle,
} from "./activity-model.ts";
import { eventRow } from "./testing.tsx";

const samples = JSON.parse(samplesJson) as { event_types: { type: string }[] };
const contractTypes = samples.event_types.map((e) => e.type);

interface Fixture {
  clamp_lines: number;
  places: Record<string, string>;
  cases: {
    name: string;
    type: string;
    dev: string;
    by: string;
    data: Record<string, unknown>;
    in_activity: boolean;
    line: string | null;
    style: "message" | "line" | null;
    author: "agent" | "person" | null;
  }[];
  clamp: { name: string; text: string; head: string; cut: boolean }[];
  threads: {
    name: string;
    rows: {
      id: string;
      type: string;
      dev: string;
      by: string;
      hlc: string;
      data: Record<string, unknown>;
    }[];
    expected: ({ event: string } & Record<string, unknown>)[];
  }[];
}
const fixture = JSON.parse(casesJson) as Fixture;

/** A thread row of the shared fixture as an event row of the desktop. */
function threadRow(r: Fixture["threads"][number]["rows"][number]): EventRow {
  return {
    id: r.id,
    task: "t",
    hlc: r.hlc,
    dev: r.dev,
    type: r.type,
    path: `tasks/t/log/${r.dev}.jsonl`,
    line: 1,
    applied: true,
    reason: null,
    event: { v: 1, id: r.id, hlc: r.hlc, dev: r.dev, type: r.type, by: r.by, data: r.data },
  };
}

const thread = (name: string) =>
  fixture.threads.find((t) => t.name.startsWith(name))!.rows.map(threadRow);

describe("the shared fixture contracts/fixtures/activity/cases.json", () => {
  it("has the same table as the desktop", () => {
    expect(ACTIVITY).toEqual(fixture.places);
  });

  it("gives the expected place and line for each case", () => {
    for (const c of fixture.cases) {
      const row = eventRow(c.type, c.data, 1, c.dev);
      row.event.by = c.by;
      expect({
        name: c.name,
        in: inActivity(row),
        line: activityLine(row),
        ...rowStyle(row),
      }).toEqual({
        name: c.name,
        in: c.in_activity,
        line: c.line,
        style: c.style,
        author: c.author,
      });
    }
  });

  it("gives the expected Activity rows for each thread", () => {
    expect(fixture.threads.length).toBeGreaterThanOrEqual(5);
    for (const t of fixture.threads) {
      const rows = t.rows.map(threadRow);
      const got = activityRows(rows).map((r) => {
        const { row, ...rest } = r;
        expect(row.id).toBe(r.event);
        return rest;
      });
      expect({ name: t.name, rows: got }).toMatchObject({ name: t.name, rows: t.expected });
      // The same rows, no more: toMatchObject checks the length of an array too.
      expect(got.map((r) => r.event)).toEqual(t.expected.map((e) => e.event));
    }
  });

  it("cuts a long agent message as the phone does", () => {
    expect(CLAMP_LINES).toBe(fixture.clamp_lines);
    for (const c of fixture.clamp) {
      expect({ name: c.name, ...clampText(c.text) }).toEqual({
        name: c.name,
        head: c.head,
        cut: c.cut,
      });
    }
  });
});

describe("ACTIVITY", () => {
  it("has a decision for each event type of the contract, and no other type", () => {
    expect(contractTypes.length).toBeGreaterThan(30);
    expect(Object.keys(ACTIVITY).sort()).toEqual([...contractTypes].sort());
  });

  it("keeps the session detail out of Activity", () => {
    for (const type of ["task.claimed", "session.started", "session.ended", "gate.resolved"]) {
      expect(inActivity(eventRow(type, {}, 1))).toBe(false);
    }
  });

  it("shows the task changes and the conversation", () => {
    for (const type of ["task.stage_changed", "message.agent", "message.sent", "gate.opened"]) {
      expect(inActivity(eventRow(type, {}, 1))).toBe(true);
    }
  });

  it("hides an unknown event type", () => {
    expect(inActivity(eventRow("task.teleported", {}, 1))).toBe(false);
  });
});

describe("inActivity of message.human", () => {
  const human = (source: string, delivery: string | null) =>
    inActivity(
      eventRow("message.human", { text: "x", source, session: "s", delivery_id: delivery }, 1),
    );

  it("shows text typed in the terminal", () => {
    expect(human("typed", null)).toBe(true);
    expect(human("phone", null)).toBe(true);
  });

  it("hides an input that repeats a message, an answer, a notice or the first message", () => {
    expect(human("typed", "01a20a1c-0000-7000-8000-000000000001")).toBe(false);
    expect(human("phone", "01a20a1c-0000-7000-8000-000000000001")).toBe(false);
    expect(human("answer", "01a20a1c-0000-7000-8000-000000000002")).toBe(false);
    expect(human("notice", "01a20a1c-0000-7000-8000-000000000003")).toBe(false);
    expect(human("first", null)).toBe(false);
  });
});

describe("clampText", () => {
  it("keeps 6 lines", () => {
    expect(clampText("1\n2\n3\n4\n5\n6")).toEqual({ head: "1\n2\n3\n4\n5\n6", cut: false });
    expect(clampText("1\n2\n3\n4\n5\n6\n7")).toEqual({ head: "1\n2\n3\n4\n5\n6", cut: true });
  });
});

describe("activityRows (proposal-and-discussion)", () => {
  it("marks only the open question, the open proposal and a gate card as needing the person", () => {
    const question = activityRows(thread("question, answer"));
    expect(question.filter(needsPerson).map((r) => r.event)).toEqual(["e7"]);
    expect(activityRows(thread("an open proposal waits")).filter(needsPerson)).toHaveLength(1);
    expect(activityRows(thread("one proposal:")).filter(needsPerson)).toEqual([]);
    expect(activityRows(thread("an open gate of another kind")).filter(needsPerson)).toHaveLength(
      1,
    );
  });

  it("closes the buttons of a question that has an answer that waits for its resolution", () => {
    const rows = thread("question, answer").slice(0, 3);
    const [, question] = activityRows(rows);
    expect(question).toMatchObject({ kind: "question", open: false, options: [], note: null });
  });

  it("approves a proposal with the old answer Confirm, and shows no row for its gate", () => {
    const rows = thread("one proposal:").map((r) =>
      r.type === "gate.answered" || r.type === "gate.resolved"
        ? { ...r, event: { ...r.event, data: { ...r.event.data, answer: "Confirm" } } }
        : r,
    );
    const out = activityRows(rows);
    expect(out.find((r) => r.style === "proposal")).toMatchObject({ state: "approved" });
    expect(out.at(-1)).toMatchObject({ line: "Proposal v2 approved by human@macbook-pro" });
    expect(out.some((r) => r.row.type === "gate.opened")).toBe(false);
  });

  it("shows no row for the Assign gate: the Assign card stays at the top", () => {
    const [opened] = thread("an open gate of another kind");
    const assign = {
      ...opened!,
      event: { ...opened!.event, data: { ...opened!.event.data, kind: "assign" } },
    };
    expect(activityRows([assign])).toEqual([]);
  });

  it("shows an answer whose gate is older than the page as a person message", () => {
    const answered = thread("question, answer")[2]!;
    expect(activityRows([answered])).toMatchObject([
      {
        style: "message",
        author: "person",
        kind: "answer",
        text: "Redis\n\nUse the **session** Redis.",
      },
    ]);
  });
});
