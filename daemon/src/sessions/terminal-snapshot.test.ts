// Tests of the terminal snapshot (openspec task-terminal-view): the header, the cut after the
// redaction, the write rule, and the shared parse cases of contracts/fixtures/terminal.
import { createRedactor } from "@aw/core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cutScreen,
  newestSnapshot,
  parseSnapshot,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_LINES,
  SNAPSHOT_PERIOD_MS,
  snapshotText,
  TerminalSnapshots,
  type SnapshotInput,
} from "./terminal-snapshot.ts";

const VALUE = "stg_live_9f8e7d6c5b4a";
const redactor = createRedactor([{ name: "staging-api-key", value: VALUE }]);
const redact = (text: string) => redactor.redactText(text);
const HEADER = {
  device: "ubuntu-01",
  session: "01a2038e-8100-7000-8000-000000000001",
  host: "tmux",
  socket: "aw",
  window: "aw-01a2038e-7f00-70eb-b429-fa86d481c263",
  captured_at: "2026-11-23T14:20:05.000Z",
};

interface Cases {
  parse: { name: string; content: string; header: unknown; text: string }[];
  newest: {
    name: string;
    files: Record<string, string>;
    device: string | null;
    text: string | null;
  }[];
}
const cases = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../contracts/fixtures/terminal/cases.json", import.meta.url)),
    "utf8",
  ),
) as Cases;

describe("snapshot file (contracts/fixtures/terminal)", () => {
  it.each(cases.parse.map((c) => [c.name, c] as const))("parses: %s", (_name, c) => {
    const parsed = parseSnapshot(c.content);
    expect(parsed.header).toEqual(c.header);
    expect(parsed.text).toBe(c.text);
  });

  it.each(cases.newest.map((c) => [c.name, c] as const))("newest: %s", (_name, c) => {
    const newest = newestSnapshot(c.files);
    expect(newest?.device ?? null).toBe(c.device);
    expect(newest?.text ?? null).toBe(c.text);
  });

  it("writes one header line and the screen, and reads it back", () => {
    const text = snapshotText(HEADER, "$ make test   \nok\n\n\n", redact);
    expect(text.split("\n")[0]).toBe(JSON.stringify({ kind: "aw-terminal", v: 1, ...HEADER }));
    expect(parseSnapshot(text)).toEqual({
      header: { kind: "aw-terminal", v: 1, ...HEADER },
      text: "$ make test\nok",
    });
  });
});

describe("redaction before the cut (fix list 0-41)", () => {
  it("keeps no prefix of a value on the line of the 200-line cut", () => {
    // Line 1 of 201 lines is cut away; the value starts at its end and goes on in line 2 when a
    // writer cuts by characters. With a line cut and the redaction first, no prefix stays.
    const lines = [`${"a".repeat(10)}${VALUE}`, ...Array.from({ length: 200 }, (_, i) => `l${i}`)];
    const text = snapshotText(HEADER, lines.join("\n"), redact);
    expect(text).not.toContain(VALUE.slice(0, 5));
    expect(text.split("\n")).toHaveLength(1 + SNAPSHOT_MAX_LINES + 1);
  });

  it("redacts a value on one long line before the 64 KiB cut keeps its end", () => {
    // The 64 KiB cut falls 5 characters into the value.
    const line = `${"a".repeat(1000)}${VALUE}${"b".repeat(SNAPSHOT_MAX_BYTES - VALUE.length + 5)}`;
    const raw = cutScreen(line);
    expect(raw).toContain(VALUE.slice(5));
    const text = snapshotText(HEADER, line, redact);
    expect(text).not.toContain(VALUE.slice(5));
    expect(text).not.toContain(VALUE.slice(0, 5));
  });

  it("redacts a value that a TUI wraps over 2 screen lines (open issue 1)", () => {
    // Claude Code wraps a long word with a real line break, so `capture-pane -J` does not join it.
    const screen = [
      "● I called the API with the key stg_live_9f8",
      "  e7d6c5b4a and it answered 200.",
      "╭──────────────────────────────╮",
      '│ Bash(curl -H "X-Key: stg_liv │',
      '│ e_9f8e7d6c5b4a" example.com) │',
      "╰──────────────────────────────╯",
      "❯ ",
    ].join("\n");
    const text = snapshotText(HEADER, screen, redact);
    expect(text).not.toContain("stg_live_9f8");
    expect(text).not.toContain("e7d6c5b4a");
    expect(text).not.toContain("stg_liv ");
    expect(text).toContain("● I called the API with the key [redacted:staging-api-key] and it");
    expect(text).toContain('│ Bash(curl -H "X-Key: [redacted:staging-api-key]" example.com) │');
    expect(text).toContain("╰──────────────────────────────╯\n❯");
  });

  it("redacts a value over 3 screen lines and leaves the other lines as they are", () => {
    const screen = ["first line", "key stg_l", "ive_9f8e7", "d6c5b4a end", "", "last line"].join(
      "\n",
    );
    const text = snapshotText(HEADER, screen, redact);
    expect(parseSnapshot(text).text).toBe(
      ["first line", "key [redacted:staging-api-key] end", "", "last line"].join("\n"),
    );
  });

  it("keeps at most 64 KiB and cuts at the start of a line", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `${i}:${"x".repeat(1000)}`);
    const cut = cutScreen(lines.join("\n"));
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    expect(cut.startsWith(`${150 - cut.split("\n").length}:`)).toBe(true);
    expect(cut.endsWith(`149:${"x".repeat(1000)}`)).toBe(true);
  });
});

describe("write rule", () => {
  const input = (screen: string): SnapshotInput => ({
    task: "01a2038e-7f00-70eb-b429-fa86d481c263",
    session: HEADER.session,
    device: "ubuntu-01",
    host: "tmux",
    socket: "aw",
    window: HEADER.window,
    screen,
  });
  function setup() {
    const writes: { path: string; text: string }[] = [];
    const snapshots = new TerminalSnapshots({
      write: (path, text) => {
        writes.push({ path, text });
        return Promise.resolve();
      },
      redact,
    });
    return { writes, snapshots };
  }
  const t0 = Date.parse("2026-11-23T14:20:00.000Z");

  it("writes the first check, then only after 30 s and a screen change", async () => {
    const { writes, snapshots } = setup();
    expect(await snapshots.check(input("a"), t0)).toBe(true);
    expect(writes[0]!.path).toBe(
      "tasks/01a2038e-7f00-70eb-b429-fa86d481c263/terminal/ubuntu-01.txt",
    );
    // A change before 30 s: no write.
    expect(await snapshots.check(input("b"), t0 + SNAPSHOT_PERIOD_MS - 1)).toBe(false);
    // The same screen after 30 s: no write.
    expect(await snapshots.check(input("a"), t0 + SNAPSHOT_PERIOD_MS)).toBe(false);
    // A change after 30 s: a write.
    expect(await snapshots.check(input("b"), t0 + SNAPSHOT_PERIOD_MS)).toBe(true);
    expect(writes).toHaveLength(2);
    expect(parseSnapshot(writes[1]!.text).header!.captured_at).toBe("2026-11-23T14:20:30.000Z");
  });

  it("writes nothing when the capture failed, and keeps the last good screen", async () => {
    const { writes, snapshots } = setup();
    await snapshots.check(input("good screen"), t0);
    // A failed `capture-pane` gives no screen: no empty snapshot replaces the good one.
    expect(await snapshots.check({ ...input("x"), screen: null }, t0 + SNAPSHOT_PERIOD_MS)).toBe(
      false,
    );
    expect(writes).toHaveLength(1);
    expect(await snapshots.check(input("new"), t0 + SNAPSHOT_PERIOD_MS)).toBe(true);
  });

  it("writes at a gate at once, also with the same screen, and the 30 s count starts again", async () => {
    const { writes, snapshots } = setup();
    await snapshots.check(input(`key ${VALUE}`), t0);
    await snapshots.gate(input(`key ${VALUE}`), t0 + 5000);
    expect(writes).toHaveLength(2);
    expect(parseSnapshot(writes[1]!.text)).toMatchObject({
      header: { captured_at: "2026-11-23T14:20:05.000Z" },
      text: "key [redacted:staging-api-key]",
    });
    expect(await snapshots.check(input("c"), t0 + SNAPSHOT_PERIOD_MS)).toBe(false);
    expect(await snapshots.check(input("c"), t0 + 5000 + SNAPSHOT_PERIOD_MS)).toBe(true);
  });
});
