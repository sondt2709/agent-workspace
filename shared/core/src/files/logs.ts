// JSON Lines logs: one event per line, append only (docs/phase-1.md 3.3).
import {
  currentEventMajor,
  eventEnvelope,
  eventSchema,
  isEventType,
  versionStatus,
  type AwEvent,
  type EventEnvelope,
} from "@aw/schema";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DeviceMismatchError,
  LineTooLongError,
  NewerVersionError,
  ParseError,
  SchemaError,
  toSchemaIssues,
  UnsupportedVersionError,
  type AwFileError,
} from "./errors.ts";
import type { LogKind } from "./ownership.ts";
import { noRedaction, redactBySchema, type Redactor } from "./redact.ts";
import { appendRegularFile, NotRegularFileError } from "./regular.ts";

/** The maximum size of one line, without the newline (docs/phase-1.md 3.3.3). */
export const MAX_LINE_BYTES = 64 * 1024;

/**
 * The deepest nesting of objects and arrays in one line (docs/phase-1.md 3.3.3). A deeper line is a
 * bad line: JSON.stringify of a very deep value overflows the stack, and the Kotlin reader of the
 * phone (android/shared, JsonSyntax) has the same limit and the same message.
 */
export const MAX_LINE_DEPTH = 64;

/** The nesting depth of a JSON value, by a loop: 0 for a scalar, 1 for `{}` or `[1]`. */
function depthOf(value: unknown): number {
  let deepest = 0;
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length > 0) {
    const [item, depth] = stack.pop()!;
    if (item === null || typeof item !== "object") continue;
    const level = depth + 1;
    if (level > deepest) deepest = level;
    if (level > MAX_LINE_DEPTH) break;
    for (const child of Object.values(item)) stack.push([child, level]);
  }
  return deepest;
}

/** Validates one event value against the schema of its type and version. */
function validateEvent(value: unknown, path: string, line?: number): AwEvent | EventEnvelope {
  const details = { path, ...(line === undefined ? {} : { line }) };
  const envelope = eventEnvelope.safeParse(value);
  if (!envelope.success) throw new SchemaError(details, "event", toSchemaIssues(envelope.error));
  const { type, v } = envelope.data;
  if (!isEventType(type)) return envelope.data;
  const status = versionStatus(currentEventMajor[type], v);
  if (status === "newer") throw new NewerVersionError(details, type, v);
  const schema = eventSchema(type, v);
  if (status === "unsupported" || !schema) throw new UnsupportedVersionError(details, type, v);
  const result = schema.safeParse(value);
  if (!result.success)
    throw new SchemaError(details, `${type}.v${v}`, toSchemaIssues(result.error));
  return result.data as AwEvent;
}

/** The scope of a log file: its kind and the task of its folder (docs/phase-1.md 3.1). */
export interface LogScope {
  kind: LogKind;
  /** The task id of the folder of a task log. */
  task?: string;
}

const WORKSPACE_PREFIXES = ["slot.", "queue.", "credential.", "project."];

/** True when an event type belongs in a log of this kind. */
export function logAccepts(kind: LogKind, type: string): boolean {
  const workspace = WORKSPACE_PREFIXES.some((prefix) => type.startsWith(prefix));
  const knowledge = type.startsWith("knowledge.");
  const heartbeat = type === "device.heartbeat";
  switch (kind) {
    case "heartbeat":
      return heartbeat;
    case "knowledge":
      return knowledge;
    case "workspace":
      return workspace;
    case "task":
      return !workspace && !knowledge && !heartbeat;
  }
}

/** Why an event does not belong in a log of this scope (the field and a message), or null. */
export function scopeProblem(
  scope: LogScope,
  event: { type: string; task?: string | undefined },
): { field: "type" | "task"; message: string } | null {
  if (isEventType(event.type) && !logAccepts(scope.kind, event.type)) {
    const message = `An event of type ${event.type} does not belong in a ${scope.kind} log`;
    return { field: "type", message };
  }
  if (scope.task !== undefined && event.task !== undefined && event.task !== scope.task) {
    const message = `The event is of task ${event.task}, not of the task ${scope.task} of this folder`;
    return { field: "task", message };
  }
  return null;
}

/**
 * Makes the line of an event: validate, redact the free text, validate again, then
 * `JSON.stringify` (one line, no newline). The redaction never changes a field with a strict
 * format (envelope, ids, HLC, slugs, hashes, enums): see redactBySchema.
 * Throws SchemaError or LineTooLongError, and then nothing is written.
 */
export function serializeEvent(
  event: unknown,
  path: string,
  redactor: Redactor = noRedaction,
): { line: string; event: AwEvent } {
  const type = (event as { type?: unknown } | null)?.type;
  if (!isEventType(type)) {
    const name = redactor.redactText(JSON.stringify(type) ?? "undefined");
    throw new SchemaError({ path }, "event", [
      { path: "type", field: "type", message: `Unknown event type ${name}` },
    ]);
  }
  let parsed: AwEvent;
  try {
    parsed = validateEvent(event, path) as AwEvent;
  } catch (error) {
    // An issue text must not carry a secret either.
    if (!(error instanceof SchemaError)) throw error;
    throw new SchemaError(
      { path },
      error.schema,
      error.issues.map((issue) => ({
        path: redactor.redactText(issue.path),
        field: redactor.redactText(issue.field),
        message: redactor.redactText(issue.message),
      })),
    );
  }
  const schema = eventSchema(type, parsed.v);
  const redacted = schema ? redactBySchema(redactor, schema, parsed) : parsed;
  const valid = redacted === parsed ? parsed : validateEvent(redacted, path);
  const line = JSON.stringify(valid);
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > MAX_LINE_BYTES) throw new LineTooLongError({ path }, bytes, MAX_LINE_BYTES);
  return { line, event: valid as AwEvent };
}

/** True when the file is missing, empty or ends with a newline. */
async function endsWithNewline(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new NotRegularFileError(file);
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

/**
 * Appends one line to a log file. When a crash cut the last line, AW first writes a newline, so the
 * cut line stays a separate bad line and the new line is valid. AW never rewrites a line. AW never
 * appends through a symbolic link: a link that another device synced in place of a log gives
 * NotRegularFileError (final check fc1-1).
 */
export async function appendLine(file: string, line: string): Promise<void> {
  if (line.includes("\n")) throw new Error("A log line must not contain a newline");
  await mkdir(dirname(file), { recursive: true });
  const prefix = (await endsWithNewline(file)) ? "" : "\n";
  await appendRegularFile(file, `${prefix}${line}\n`, 0o644);
}

export interface LogReadResult {
  /** The valid events of known types, in file order. */
  events: AwEvent[];
  /** Valid envelopes of event types that this AW does not know (a newer minor version). */
  unknown: EventEnvelope[];
  /** One error for each bad line. The reader skips these lines. */
  errors: AwFileError[];
  /** A last line with no newline: a write that did not finish. The reader skips it. */
  partialTail: { line: number; text: string } | null;
}

/**
 * Reads the text of a log file. `device` is the device of the file name: `log/<device>.jsonl`.
 * With a scope, the reader also rejects an event of another task or of a type that does not belong
 * in this kind of log.
 */
export function parseLogText(
  text: string,
  path: string,
  device: string,
  scope?: LogScope,
): LogReadResult {
  const result: LogReadResult = { events: [], unknown: [], errors: [], partialTail: null };
  const parts = text.split("\n");
  const tail = parts.pop() ?? "";
  if (tail !== "") result.partialTail = { line: parts.length + 1, text: tail };
  parts.forEach((text, index) => {
    const line = index + 1;
    if (text.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      result.errors.push(new ParseError({ path, line }, (error as Error).message));
      return;
    }
    if (depthOf(value) > MAX_LINE_DEPTH) {
      result.errors.push(
        new ParseError({ path, line }, `JSON nesting is deeper than ${MAX_LINE_DEPTH} levels`),
      );
      return;
    }
    try {
      const event = validateEvent(value, path, line);
      const problem = scope ? scopeProblem(scope, event) : null;
      if (event.dev !== device) {
        result.errors.push(new DeviceMismatchError({ path, line }, device, event.dev));
      } else if (problem !== null) {
        result.errors.push(
          new SchemaError({ path, line }, `${event.type}.v${event.v}`, [
            { path: problem.field, field: problem.field, message: problem.message },
          ]),
        );
      } else if (isEventType(event.type)) {
        result.events.push(event as AwEvent);
      } else {
        result.unknown.push(event);
      }
    } catch (error) {
      result.errors.push(error as AwFileError);
    }
  });
  return result;
}
