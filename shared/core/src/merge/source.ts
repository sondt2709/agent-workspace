// The sources of the merge: the log files and the documents of the `tasks` folder
// (docs/phase-1.md 3.1). A log source reads only the new bytes of a file that grew.
import type { AwEvent, EventEnvelope } from "@aw/schema";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseLogText, type LogScope } from "../files/logs.ts";
import { classifyPath, type PathInfo } from "../files/ownership.ts";
import type { MergeIssue } from "./view.ts";

/** One event of a log file, with its place. */
export interface LogLine {
  event: AwEvent | EventEnvelope;
  /** False for an event of a type that this AW does not know. */
  known: boolean;
  path: string;
  line: number;
}

export type SourceKind =
  { type: "log"; scope: LogScope; device: string } | { type: "document"; kind: string };

export interface SourceFile {
  /** The path relative to the workspace root. */
  path: string;
  info: PathInfo;
}

const LOG_RULES = new Set(["workspace-log", "task-log", "device-heartbeat"]);
const DOCUMENT_RULES = new Set([
  "workspace",
  "project",
  "device-record",
  "device-health",
  "device-bindings",
]);

/**
 * The entries of a folder. A link is neither a folder nor a file: the merge never follows a link
 * that another device synced, and a folder with the name of a log is no source (final check fc1-4).
 */
async function list(dir: string): Promise<{ name: string; dir: boolean; file: boolean }[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      dir: entry.isDirectory(),
      file: entry.isFile(),
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Finds the merge sources under `<root>/tasks`: the workspace log, the task logs, the heartbeat
 * logs and the documents. It reads only the folders of the layout, never the artifacts. The result
 * is sorted by path.
 */
export async function findSources(
  root: string,
): Promise<{ logs: SourceFile[]; documents: SourceFile[] }> {
  const paths: string[] = [];
  const tasks = join(root, "tasks");
  for (const top of await list(tasks)) {
    if (top.file) {
      paths.push(`tasks/${top.name}`);
    } else if (!top.dir) {
      continue;
    } else if (top.name === "log") {
      for (const file of await list(join(tasks, "log"))) {
        if (file.file) paths.push(`tasks/log/${file.name}`);
      }
    } else if (top.name === "projects") {
      for (const project of await list(join(tasks, "projects"))) {
        if (project.dir) paths.push(`tasks/projects/${project.name}/project.yaml`);
      }
    } else if (top.name === "devices") {
      for (const device of await list(join(tasks, "devices"))) {
        if (!device.dir) continue;
        const base = `tasks/devices/${device.name}`;
        for (const file of await list(join(tasks, "devices", device.name))) {
          if (file.file) paths.push(`${base}/${file.name}`);
          else if (file.dir && file.name === "heartbeat") {
            for (const beat of await list(join(tasks, "devices", device.name, "heartbeat"))) {
              if (beat.file) paths.push(`${base}/heartbeat/${beat.name}`);
            }
          }
        }
      }
    } else {
      for (const file of await list(join(tasks, top.name, "log"))) {
        if (file.file) paths.push(`tasks/${top.name}/log/${file.name}`);
      }
    }
  }
  const logs: SourceFile[] = [];
  const documents: SourceFile[] = [];
  for (const path of paths.sort()) {
    const info = classifyPath(path);
    if ("reason" in info) continue;
    if (LOG_RULES.has(info.rule)) logs.push({ path, info });
    else if (DOCUMENT_RULES.has(info.rule)) documents.push({ path, info });
  }
  // A missing project.yaml is not a source.
  const present = await Promise.all(
    documents.map((doc) =>
      lstat(join(root, doc.path)).then(
        (info) => info.isFile(),
        () => false,
      ),
    ),
  );
  return { logs, documents: documents.filter((_, index) => present[index]) };
}

/** The size of the head and tail checks of a log source. */
const CHECK_BYTES = 256;

export interface LogSourceRead {
  /** True when the file became shorter or its read bytes changed: the caller reads all again. */
  reset: "truncated" | "replaced" | null;
  /** The new complete lines. */
  lines: LogLine[];
}

/**
 * Reads one log file incrementally. It keeps the byte offset after the last complete line, the
 * first and the last read bytes, the line count and the errors of the read lines. Syncthing
 * replaces a file with a rename at each change, so the inode is no check (design decision 12).
 */
export class LogSource {
  readonly path: string;
  readonly device: string;
  readonly scope: LogScope;
  readonly #abs: string;
  #offset = 0;
  #lines = 0;
  #head: Buffer = Buffer.alloc(0);
  #tail: Buffer = Buffer.alloc(0);
  /** The issues of the read lines: bad lines. */
  issues: MergeIssue[] = [];
  /** A last part with no newline, or null. */
  partial: { line: number; bytes: number } | null = null;

  constructor(root: string, file: SourceFile) {
    if (file.info.format.type !== "log") throw new Error(`${file.path} is not a log file`);
    this.path = file.path;
    this.device = file.info.format.device;
    this.scope = {
      kind: file.info.format.log,
      ...(file.info.task === undefined ? {} : { task: file.info.task }),
    };
    this.#abs = join(root, ...file.path.split("/"));
  }

  /** The count of complete lines that this source read. */
  get lines(): number {
    return this.#lines;
  }

  #clear(): void {
    this.#offset = 0;
    this.#lines = 0;
    this.#head = Buffer.alloc(0);
    this.#tail = Buffer.alloc(0);
    this.issues = [];
    this.partial = null;
  }

  /** Reads the new complete lines. A missing file reads as an empty file. */
  async read(): Promise<LogSourceRead> {
    let handle;
    try {
      // A link that replaced the file after the listing reads as a missing file.
      handle = await open(
        this.#abs,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      if (!(await handle.stat()).isFile()) {
        await handle.close();
        handle = undefined;
        throw Object.assign(new Error(`${this.path} is not a regular file`), { code: "ENOENT" });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ELOOP") throw error;
      const reset = this.#offset > 0 ? "truncated" : null;
      this.#clear();
      return { reset, lines: [] };
    }
    try {
      const { size } = await handle.stat();
      let reset: LogSourceRead["reset"] = null;
      if (size < this.#offset) reset = "truncated";
      else if (this.#offset > 0) {
        const head = Buffer.alloc(this.#head.length);
        await handle.read(head, 0, head.length, 0);
        const tail = Buffer.alloc(this.#tail.length);
        await handle.read(tail, 0, tail.length, this.#offset - tail.length);
        if (!head.equals(this.#head) || !tail.equals(this.#tail)) reset = "replaced";
      }
      if (reset) this.#clear();
      const length = size - this.#offset;
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(buffer, read, length - read, this.#offset + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      const data = buffer.subarray(0, read);
      const end = data.lastIndexOf(0x0a);
      const complete = end === -1 ? Buffer.alloc(0) : data.subarray(0, end + 1);
      const rest = data.length - complete.length;
      const lines = complete.length > 0 ? this.#parse(complete) : [];
      this.#advance(complete);
      this.partial = rest > 0 ? { line: this.#lines + 1, bytes: rest } : null;
      return { reset, lines };
    } finally {
      await handle.close();
    }
  }

  #advance(complete: Buffer): void {
    if (complete.length === 0) return;
    if (this.#head.length < CHECK_BYTES) {
      const need = CHECK_BYTES - this.#head.length;
      this.#head = Buffer.concat([this.#head, complete.subarray(0, need)]);
    }
    const joined = Buffer.concat([this.#tail, complete]);
    this.#tail = joined.subarray(Math.max(0, joined.length - CHECK_BYTES));
    this.#offset += complete.length;
    let count = 0;
    for (const byte of complete) if (byte === 0x0a) count++;
    this.#lines += count;
  }

  #parse(complete: Buffer): LogLine[] {
    const texts = complete.toString("utf8").split("\n");
    texts.pop(); // the part after the last newline is empty
    const lines: LogLine[] = [];
    texts.forEach((text, index) => {
      const line = this.#lines + index + 1;
      if (text.trim() === "") return;
      // One line at a time, so each event keeps its own line number.
      const result = parseLogText(`${text}\n`, this.path, this.device, this.scope);
      for (const error of result.errors) {
        this.issues.push({
          code: "bad_line",
          path: this.path,
          line,
          event: null,
          task: this.scope.task ?? null,
          reason: error.code,
          // The reader parses one line at a time, so "line 1" of a JSON error is not the file line.
          message: withoutPlace(error.message, this.path).replace(
            / \(line 1 column (\d+)\)/,
            " (column $1)",
          ),
        });
      }
      for (const event of result.events) lines.push({ event, known: true, path: this.path, line });
      for (const event of result.unknown)
        lines.push({ event, known: false, path: this.path, line });
    });
    return lines;
  }
}

/** Removes the leading `<path>` or `<path>:<line>` and ": " of an error message. */
function withoutPlace(message: string, path: string): string {
  if (!message.startsWith(path)) return message;
  return message.slice(path.length).replace(/^(?::\d+)?: /, "");
}
