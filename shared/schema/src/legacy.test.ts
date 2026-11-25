// The map of the old names (openspec proposal-and-discussion), against the fixture that the Kotlin
// port tests too.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventV1 } from "./events.ts";
import { upgradeEvent, upgradeTaskDocument } from "./legacy.ts";

interface Case {
  name: string;
  input: unknown;
  expected: unknown;
}
const FIXTURE = JSON.parse(
  readFileSync(new URL("../../../contracts/fixtures/legacy/names.json", import.meta.url), "utf8"),
) as { events: Case[]; tasks: Case[] };

describe("legacy names", () => {
  it.each(FIXTURE.events)("event: $name", ({ input, expected }) => {
    const upgraded = upgradeEvent(input);
    expect(upgraded).toEqual(expected);
    // The upgraded line is a valid event of the current schema.
    expect(eventV1.safeParse(upgraded).success).toBe(true);
  });

  it.each(FIXTURE.tasks)("task: $name", ({ input, expected }) => {
    expect(upgradeTaskDocument(input)).toEqual(expected);
  });

  it("keeps the same object when nothing changes", () => {
    const line = { type: "message.agent", data: { text: "x" } };
    expect(upgradeEvent(line)).toBe(line);
  });
});
