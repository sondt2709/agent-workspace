import { describe, expect, it } from "vitest";
import { eventDataV1 } from "./events.ts";
import {
  currentDocumentMajor,
  documentKinds,
  documentSchema,
  isDocumentKind,
  isEventType,
  schemaEntries,
  versionStatus,
} from "./registry.ts";

describe("registry", () => {
  it("names each schema <type>.v<major> once", () => {
    const names = schemaEntries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z-]*\.v[1-9]\d*$/);
    for (const kind of documentKinds) {
      expect(names).toContain(`${kind}.v${currentDocumentMajor[kind]}`);
      expect(documentSchema(kind, currentDocumentMajor[kind])).toBeDefined();
    }
  });

  it("reads the current and the previous major version", () => {
    expect(versionStatus(2, 2)).toBe("current");
    expect(versionStatus(2, 1)).toBe("previous");
    expect(versionStatus(2, 3)).toBe("newer");
    expect(versionStatus(3, 1)).toBe("unsupported");
  });

  it("knows the kinds and the event types", () => {
    expect(isDocumentKind("task")).toBe(true);
    expect(isDocumentKind("toString")).toBe(false);
    expect(isEventType("gate.opened")).toBe(true);
    expect(isEventType("constructor")).toBe(false);
    // A move is a human task.assigned (docs/decisions/2026-11-23-manual-move.md).
    expect(isEventType("task.moved")).toBe(false);
    expect(documentSchema("task", 2)).toBeUndefined();
  });
});

describe("gate.opened questions (openspec gate-context)", () => {
  const schema = eventDataV1["gate.opened"];
  const gate = { gate: "01a20bf7-097e-712f-bcc7-b3d7d7d4eda6", kind: "question", version: 1 };

  it("reads an older event with no questions as []", () => {
    expect(schema.parse(gate).questions).toEqual([]);
  });

  it("fills the defaults of a question and refuses a question over the limits", () => {
    const parsed = schema.parse({
      ...gate,
      questions: [{ question: "Which?", options: [{ label: "A" }] }],
    });
    expect(parsed.questions).toEqual([
      {
        question: "Which?",
        header: null,
        multi_select: false,
        options: [{ label: "A", description: "" }],
      },
    ]);
    const tooMany = Array.from({ length: 11 }, () => ({ question: "Q", options: [] }));
    expect(schema.safeParse({ ...gate, questions: tooMany }).success).toBe(false);
    expect(
      schema.safeParse({ ...gate, questions: [{ question: "Q", header: "h".repeat(101) }] })
        .success,
    ).toBe(false);
  });
});
