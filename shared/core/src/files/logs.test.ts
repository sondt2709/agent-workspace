import { FIXTURE_TASK_ID, readFixtureText } from "@aw/schema/testing";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeviceMismatchError, LineTooLongError, ParseError, SchemaError } from "./errors.ts";
import {
  appendLine,
  logAccepts,
  MAX_LINE_BYTES,
  MAX_LINE_DEPTH,
  parseLogText,
  serializeEvent,
} from "./logs.ts";
import { createRedactor } from "./redact.ts";

const PATH = `tasks/${FIXTURE_TASK_ID}/log/ubuntu-01.jsonl`;
const fixture = readFixtureText(PATH);
const fixtureLines = fixture.trimEnd().split("\n");

function event(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    id: "01a2038e-7f00-7000-8000-000000000001",
    hlc: "2026-11-22T14:30:00.000Z#0000",
    dev: "ubuntu-01",
    type: "task.progress",
    by: "claude@ubuntu-01",
    data: { text: "Run the tests" },
    ...overrides,
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aw-logs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseLogText", () => {
  it("reads each line of the fixture log", () => {
    const result = parseLogText(fixture, PATH, "ubuntu-01");
    expect(result.errors).toEqual([]);
    expect(result.partialTail).toBeNull();
    expect(result.events).toHaveLength(fixtureLines.length);
    expect(result.events[0]?.type).toBe("task.claimed");
  });

  it("skips a half-written last line and reports it as the partial tail", () => {
    const cut = fixtureLines[3]!.slice(0, 40);
    const text = `${fixtureLines.slice(0, 3).join("\n")}\n${cut}`;
    const result = parseLogText(text, PATH, "ubuntu-01");
    expect(result.events).toHaveLength(3);
    expect(result.errors).toEqual([]);
    expect(result.partialTail).toEqual({ line: 4, text: cut });
  });

  it("reports a bad line with its line number and reads the next lines", () => {
    const text = `${fixtureLines[0]}\n{"v":1,"id":\n${fixtureLines[1]}\n`;
    const result = parseLogText(text, PATH, "ubuntu-01");
    expect(result.events).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(ParseError);
    expect(result.errors[0]).toMatchObject({ code: "parse_error", path: PATH, line: 2 });
  });

  it("reports a line nested deeper than 64 levels as a bad line, and reads a line of 64", () => {
    // An unknown key of a newer minor version is kept, but its value may nest 64 levels at most
    // (the root object counts). The Kotlin reader has the same rule and the same message.
    const nested = (levels: number) =>
      JSON.parse(`${"[".repeat(levels)}${"]".repeat(levels)}`) as unknown;
    const ok = JSON.stringify(event({ data: { text: "x", x_deep: nested(MAX_LINE_DEPTH - 2) } }));
    const deep = JSON.stringify(event({ data: { text: "x", x_deep: nested(MAX_LINE_DEPTH - 1) } }));
    const huge = `{"v":1,"data":{"x":${"[".repeat(200_000)}${"]".repeat(200_000)}}}`;
    const result = parseLogText(`${ok}\n${deep}\n${huge}\n`, PATH, "ubuntu-01");
    expect(result.events).toHaveLength(1);
    expect(result.errors.map((e) => [e.code, e.line, e.message])).toEqual([
      ["parse_error", 2, `${PATH}:2: JSON nesting is deeper than 64 levels`],
      ["parse_error", 3, `${PATH}:3: JSON nesting is deeper than 64 levels`],
    ]);
  });

  it("rejects an event of another device and reports a sync problem", () => {
    const line = JSON.stringify(event({ dev: "pixel-9" }));
    const result = parseLogText(`${fixtureLines[0]}\n${line}\n`, PATH, "ubuntu-01");
    expect(result.events).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(DeviceMismatchError);
    expect(result.errors[0]).toMatchObject({ line: 2, expected: "ubuntu-01", found: "pixel-9" });
    expect(result.errors[0]?.message).toContain("sync problem");
  });

  it("keeps an event of an unknown type as unknown, and reports a schema error with the field", () => {
    const unknown = JSON.stringify(event({ type: "task.teleported", data: { to: "mars" } }));
    const bad = JSON.stringify(
      event({ type: "gate.opened", data: { kind: "question", version: 1 } }),
    );
    const result = parseLogText(`${unknown}\n${bad}\n`, PATH, "ubuntu-01");
    expect(result.unknown.map((e) => e.type)).toEqual(["task.teleported"]);
    expect(result.errors[0]).toBeInstanceOf(SchemaError);
    expect((result.errors[0] as SchemaError).issues[0]).toMatchObject({
      path: "data.gate",
      field: "gate",
    });
    expect(result.errors[0]).toMatchObject({ line: 2 });
  });

  it("reports an HLC with a date that does not exist as a bad line", () => {
    const line = JSON.stringify(event({ hlc: "2026-13-45T25:00:00.000Z#0000" }));
    const result = parseLogText(`${line}\n${fixtureLines[0]}\n`, PATH, "ubuntu-01");
    expect(result.events).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(SchemaError);
    expect((result.errors[0] as SchemaError).issues[0]).toMatchObject({
      field: "hlc",
      path: "hlc",
    });
  });

  it("with a scope, rejects an event of another task or of a type of another log", () => {
    const other = "01a2038e-7f00-7000-8000-0000000000aa";
    const lines = [
      JSON.stringify(event({ task: FIXTURE_TASK_ID })),
      JSON.stringify(event({ type: "task.done", task: other, data: {} })),
      JSON.stringify(
        event({ type: "device.heartbeat", data: { boot_time: "2026-11-19T03:12:00.000Z" } }),
      ),
    ];
    const result = parseLogText(`${lines.join("\n")}\n`, PATH, "ubuntu-01", {
      kind: "task",
      task: FIXTURE_TASK_ID,
    });
    expect(result.events).toHaveLength(1);
    expect(result.errors.map((e) => [e.line, (e as SchemaError).issues[0]?.field])).toEqual([
      [2, "task"],
      [3, "type"],
    ]);
  });

  it("knows which event types belong in each kind of log", () => {
    expect(logAccepts("heartbeat", "device.heartbeat")).toBe(true);
    expect(logAccepts("heartbeat", "gate.answered")).toBe(false);
    expect(logAccepts("knowledge", "knowledge.changed")).toBe(true);
    expect(logAccepts("knowledge", "slot.acquired")).toBe(false);
    expect(logAccepts("workspace", "slot.acquired")).toBe(true);
    expect(logAccepts("workspace", "credential.added")).toBe(true);
    expect(logAccepts("workspace", "task.done")).toBe(false);
    expect(logAccepts("task", "gate.answered")).toBe(true);
    expect(logAccepts("task", "slot.acquired")).toBe(false);
    expect(logAccepts("task", "knowledge.changed")).toBe(false);
  });

  it("reports a newer version of a known type", () => {
    const result = parseLogText(`${JSON.stringify(event({ v: 2 }))}\n`, PATH, "ubuntu-01");
    expect(result.errors[0]).toMatchObject({ code: "newer_version", version: 2 });
  });
});

describe("appendLine and serializeEvent", () => {
  it("appends one complete line per event", async () => {
    const file = join(dir, "log", "ubuntu-01.jsonl");
    await appendLine(file, serializeEvent(event(), PATH).line);
    await appendLine(
      file,
      serializeEvent(event({ hlc: "2026-11-22T14:30:00.000Z#0001" }), PATH).line,
    );
    const text = await readFile(file, "utf8");
    expect(text.split("\n")).toHaveLength(3);
    expect(parseLogText(text, PATH, "ubuntu-01").events).toHaveLength(2);
  });

  it("ends a cut last line before it appends, so the new event stays valid", async () => {
    const file = join(dir, "ubuntu-01.jsonl");
    const cut = fixtureLines[1]!.slice(0, 50);
    await writeFile(file, `${fixtureLines[0]}\n${cut}`);
    await appendLine(file, serializeEvent(event(), PATH).line);
    const text = await readFile(file, "utf8");
    expect(text).toBe(`${fixtureLines[0]}\n${cut}\n${serializeEvent(event(), PATH).line}\n`);
    const result = parseLogText(text, PATH, "ubuntu-01");
    expect(result.events.map((e) => e.type)).toEqual(["task.claimed", "task.progress"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "parse_error", line: 2 });
    expect(result.partialTail).toBeNull();
  });

  it("refuses a line larger than 64 KiB and writes nothing", () => {
    const big = event({ data: { text: "x".repeat(MAX_LINE_BYTES) } });
    expect(() => serializeEvent(big, PATH)).toThrow(LineTooLongError);
    const fits = event({ data: { text: "x".repeat(MAX_LINE_BYTES - 400) } });
    expect(Buffer.byteLength(serializeEvent(fits, PATH).line)).toBeLessThanOrEqual(MAX_LINE_BYTES);
  });

  it("refuses an invalid event and an unknown type", () => {
    expect(() => serializeEvent(event({ hlc: "yesterday" }), PATH)).toThrow(SchemaError);
    expect(() => serializeEvent(event({ type: "task.teleported" }), PATH)).toThrow(SchemaError);
  });

  it("redacts before it writes", () => {
    const redactor = createRedactor([{ name: "stripe-test", value: "fake-credential-value" }]);
    const { line } = serializeEvent(
      event({
        type: "message.agent",
        data: { text: "The key is fake-credential-value", session: null },
      }),
      PATH,
      redactor,
    );
    expect(line).toContain("The key is [redacted:stripe-test]");
    expect(line).not.toContain("fake-credential-value");
  });

  it("never changes the envelope or a formatted field when a short secret is in them", () => {
    // "2026" is in each HLC this year; "7000" and "0001" are parts of the event id.
    const redactor = createRedactor([
      { name: "pin", value: "2026" },
      { name: "hex", value: "7000" },
      { name: "tail", value: "0001" },
      { name: "host", value: "ubuntu" },
      { name: "kind", value: "progress" },
    ]);
    const original = event({ data: { text: "pin 2026 for ubuntu, progress 7000" } });
    const { line, event: written } = serializeEvent(original, PATH, redactor);
    expect(written).toEqual({
      ...original,
      data: { text: "pin [redacted:pin] for [redacted:host], [redacted:kind] [redacted:hex]" },
    });
    expect(parseLogText(`${line}\n`, PATH, "ubuntu-01").errors).toEqual([]);
  });

  it("keeps a secret out of the text of a schema error", () => {
    const redactor = createRedactor([{ name: "stripe-test", value: "fake-credential-value" }]);
    const bad = event({ type: "task.teleported-fake-credential-value" });
    expect(() => serializeEvent(bad, PATH, redactor)).toThrow("[redacted:stripe-test]");
  });

  it("refuses a line with a newline", async () => {
    await expect(appendLine(join(dir, "x.jsonl"), "a\nb")).rejects.toThrow("newline");
  });
});
