// The terminal snapshot of a session (openspec task-terminal-view; docs/phase-1.md 3.1): the session
// device writes the visible screen of a tmux session to `tasks/<task>/terminal/<device>.txt` at most
// once per 30 s when the screen changed, and at once after each gate. The file is one JSON header
// line and the screen. The writer redacts the full screen first and cuts it after (fix list 0-41),
// so a value across the cut keeps no prefix. AW never reads the screen of an Orca session.
import { createHash } from "node:crypto";

/** The shortest time between 2 periodic writes of one session. */
export const SNAPSHOT_PERIOD_MS = 30_000;
/** The snapshot keeps the last lines of the screen. */
export const SNAPSHOT_MAX_LINES = 200;
/** The largest snapshot text (UTF-8 bytes, without the header line). */
export const SNAPSHOT_MAX_BYTES = 64 * 1024;

export interface SnapshotHeader {
  kind: "aw-terminal";
  v: 1;
  device: string;
  session: string;
  host: string;
  /** The tmux socket name (`tmux -L <socket>`), or null. */
  socket: string | null;
  /** The tmux window name, `aw-<task>`, or null. */
  window: string | null;
  /** The ISO time of the capture, from the clock module. */
  captured_at: string;
}

export interface ParsedSnapshot {
  /** Null when the first line is not a valid header: the reader shows the text with no time. */
  header: SnapshotHeader | null;
  text: string;
}

/** The workspace path of the snapshot of a device. */
export function snapshotPath(task: string, device: string): string {
  return `tasks/${task}/terminal/${device}.txt`;
}

/** The most screen lines that one wrapped credential value can span. */
export const MAX_WRAP_LINES = 8;

/** The frame at the start and the end of a screen line: spaces and box drawing (U+2500 to U+259F). */
const FRAME_START = /^[\s─-▟]+/;
const FRAME_END = /[\s─-▟]+$/;

/**
 * The redaction of a screen. A TUI (Claude Code) wraps a long word with a real line break, so
 * `capture-pane -J` does not join it and a value can span 2 or more screen lines. For each line,
 * this joins the next lines without their frame and spaces; when the joined text has a value, the
 * lines become one redacted line. The other lines stay as they are.
 */
export function redactScreen(screen: string, redact: (text: string) => string): string {
  const lines = redact(screen).split("\n");
  const inner = (line: string) => line.replace(FRAME_START, "").replace(FRAME_END, "");
  /** The end of a wrapped value that starts on line `start`: the last line, or -1. */
  const valueEnd = (start: number): number => {
    let joined = lines[start]!.replace(FRAME_END, "");
    for (let j = start + 1; j < Math.min(lines.length, start + MAX_WRAP_LINES); j++) {
      const part = inner(lines[j]!);
      // An empty line ends a wrapped text.
      if (part === "") return -1;
      joined += part;
      if (redact(joined) !== joined) return j;
    }
    return -1;
  };
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const end = valueEnd(i);
    // The value starts on a later line when the lines from i + 1 to `end` have it too.
    if (end < 0 || (end > i + 1 && valueEnd(i + 1) === end)) {
      out.push(lines[i]!);
      i += 1;
      continue;
    }
    let joined = lines[i]!.replace(FRAME_END, "");
    for (let k = i + 1; k <= end; k++) joined += inner(lines[k]!);
    // Keep the frame at the end of the last line (for example the right border of a box).
    out.push(redact(joined) + (FRAME_END.exec(lines[end]!)?.[0] ?? ""));
    i = end + 1;
  }
  return out.join("\n");
}

/** The screen with no trailing spaces on each line and no empty lines at the end. */
function tidy(screen: string): string {
  const lines = screen.split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}

/**
 * The last SNAPSHOT_MAX_LINES lines of a text, and at most SNAPSHOT_MAX_BYTES. It cuts at the start
 * of a line; one longer line keeps its end. Call it only on a redacted text.
 */
export function cutScreen(text: string): string {
  let lines = text.split("\n").slice(-SNAPSHOT_MAX_LINES);
  let size = Buffer.byteLength(lines.join("\n"));
  while (size > SNAPSHOT_MAX_BYTES && lines.length > 1) {
    size -= Buffer.byteLength(lines[0]!) + 1;
    lines = lines.slice(1);
  }
  if (size > SNAPSHOT_MAX_BYTES) {
    const bytes = Buffer.from(lines[0]!, "utf8");
    lines = [bytes.subarray(bytes.length - SNAPSHOT_MAX_BYTES).toString("utf8")];
  }
  return lines.join("\n");
}

/** The file text: the header line, then the redacted and cut screen. */
export function snapshotText(
  header: Omit<SnapshotHeader, "kind" | "v">,
  screen: string,
  redact: (text: string) => string,
): string {
  // Redact first, also a value that wraps over screen lines, then cut (fix list 0-41).
  const body = cutScreen(tidy(redactScreen(screen, redact)));
  const line = JSON.stringify({ kind: "aw-terminal", v: 1, ...header });
  return `${line}\n${body}\n`;
}

/**
 * The form of a tmux socket name (`AW_TMUX_SOCKET`). The socket of a synced header goes into the
 * ssh command of another device, whose shell reads each word again: so it has no shell character.
 */
const SOCKET = /^[A-Za-z0-9_-]{1,64}$/;

/** The file name of a snapshot: `<device slug>.txt` (the `task-terminal` rule of the files layer). */
export const SNAPSHOT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.txt$/;

/** The time form of `toISOString()`: the Kotlin reader parses only this form. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isHeader(value: unknown): value is SnapshotHeader {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  const optional = (x: unknown) => x === null || typeof x === "string";
  return (
    h.kind === "aw-terminal" &&
    h.v === 1 &&
    typeof h.device === "string" &&
    typeof h.session === "string" &&
    typeof h.host === "string" &&
    (h.socket === null || (typeof h.socket === "string" && SOCKET.test(h.socket))) &&
    optional(h.window) &&
    typeof h.captured_at === "string" &&
    ISO_TIME.test(h.captured_at) &&
    // The round trip refuses a date that does not exist (2026-02-31), as the phone does (fc1-14).
    Number.isFinite(Date.parse(h.captured_at)) &&
    new Date(Date.parse(h.captured_at)).toISOString() === h.captured_at
  );
}

/** Parses a snapshot file. A file with no valid header line is all text. */
export function parseSnapshot(content: string): ParsedSnapshot {
  const end = content.indexOf("\n");
  const first = end < 0 ? content : content.slice(0, end);
  let value: unknown;
  try {
    value = JSON.parse(first);
  } catch {
    value = null;
  }
  if (!isHeader(value)) return { header: null, text: content };
  const h = value;
  const header: SnapshotHeader = {
    kind: "aw-terminal",
    v: 1,
    device: h.device,
    session: h.session,
    host: h.host,
    socket: h.socket ?? null,
    window: h.window ?? null,
    captured_at: h.captured_at,
  };
  const text = end < 0 ? "" : content.slice(end + 1).replace(/\n$/, "");
  return { header, text };
}

/** One capture of a session screen, with the fields of the header. */
export interface SnapshotInput {
  task: string;
  session: string;
  device: string;
  host: string;
  socket: string | null;
  window: string | null;
  screen: string;
}

export interface TerminalSnapshotsOptions {
  /** Writes a task file through the files layer (it redacts again). */
  write: (path: string, text: string) => Promise<unknown>;
  /** The redaction of the files layer. */
  redact: (text: string) => string;
}

/** The write rule of the snapshots of one device: the last write of each session. */
export class TerminalSnapshots {
  readonly #options: TerminalSnapshotsOptions;
  readonly #last = new Map<string, { hash: string; at: number }>();

  constructor(options: TerminalSnapshotsOptions) {
    this.#options = options;
  }

  /**
   * The periodic write: only when the screen hash changed since the last write and the last write
   * is SNAPSHOT_PERIOD_MS old or more. A null screen (the capture failed) writes nothing, so the
   * last good screen stays. Returns true when it wrote.
   */
  async check(
    input: Omit<SnapshotInput, "screen"> & { screen: string | null },
    now: number,
  ): Promise<boolean> {
    const screen = input.screen;
    if (screen === null) return false;
    const hash = createHash("sha256").update(screen).digest("hex");
    const last = this.#last.get(input.session);
    if (last && (last.hash === hash || now - last.at < SNAPSHOT_PERIOD_MS)) return false;
    await this.#write({ ...input, screen }, hash, now);
    return true;
  }

  /** The write at a gate open: at once, also with the same screen. */
  async gate(input: SnapshotInput, now: number): Promise<void> {
    const hash = createHash("sha256").update(input.screen).digest("hex");
    await this.#write(input, hash, now);
  }

  /** Forgets a session that ended. */
  forget(session: string): void {
    this.#last.delete(session);
  }

  async #write(input: SnapshotInput, hash: string, now: number): Promise<void> {
    const text = snapshotText(
      {
        device: input.device,
        session: input.session,
        host: input.host,
        socket: input.socket,
        window: input.window,
        captured_at: new Date(now).toISOString(),
      },
      input.screen,
      this.#options.redact,
    );
    await this.#options.write(snapshotPath(input.task, input.device), text);
    this.#last.set(input.session, { hash, at: now });
  }
}

/** One snapshot file of a task: the device from the file name, and its parse. */
export interface SnapshotFile extends ParsedSnapshot {
  device: string;
}

/**
 * The newest snapshot of a task from its files (`<device>.txt` → content): the latest `captured_at`
 * of a file with a header (a tie goes to the device name order), else the first file by name.
 */
export function newestSnapshot(files: Record<string, string>): SnapshotFile | null {
  const parsed = Object.keys(files)
    // A conflict copy or a temp file of the sync engine is not a snapshot of a device.
    .filter((name) => SNAPSHOT_NAME.test(name))
    .sort()
    .map((name) => ({ device: name.slice(0, -4), ...parseSnapshot(files[name]!) }));
  let best: SnapshotFile | null = null;
  for (const file of parsed) {
    if (!file.header) continue;
    if (!best || Date.parse(file.header.captured_at) > Date.parse(best.header!.captured_at)) {
      best = file;
    }
  }
  return best ?? parsed[0] ?? null;
}
