// The Activity rule (openspec task-view-focus and phone-task-focus): each contract event type has a
// decision, the inputs of a session show only when the person typed them in the terminal, and a
// stopped or crashed session shows its cause. The phone runs the same shared cases.
import { describe, expect, it } from "vitest";
import casesJson from "../../../../contracts/fixtures/activity/cases.json?raw";
import samplesJson from "../../../../contracts/samples/schema-samples.json?raw";
import { ACTIVITY, CLAMP_LINES, activityLine, clampText, inActivity } from "./activity-model.ts";
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
  }[];
  clamp: { name: string; text: string; head: string; cut: boolean }[];
}
const fixture = JSON.parse(casesJson) as Fixture;

describe("the shared fixture contracts/fixtures/activity/cases.json", () => {
  it("has the same table as the desktop", () => {
    expect(ACTIVITY).toEqual(fixture.places);
  });

  it("gives the expected place and line for each case", () => {
    for (const c of fixture.cases) {
      const row = eventRow(c.type, c.data, 1, c.dev);
      row.event.by = c.by;
      expect({ name: c.name, in: inActivity(row), line: activityLine(row) }).toEqual({
        name: c.name,
        in: c.in_activity,
        line: c.line,
      });
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
