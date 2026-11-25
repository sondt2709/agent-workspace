// The files API of one workspace folder on one device (docs/engineering-rules.md 5.3: write
// workspace files only through this module). It joins the write guard, the atomic writes, the YAML
// documents, the JSON Lines logs, the redaction, the HLC and the ids.
import {
  HybridLogicalClock,
  newId,
  type AwEvent,
  type DeviceRole,
  type DocumentInputOf,
  type DocumentKind,
  type DocumentOf,
  type EventData,
  type EventType,
} from "@aw/schema";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../clock.ts";
import { writeFileAtomic } from "./atomic.ts";
import { parseConflictCopy, type ConflictCopy } from "./conflicts.ts";
import {
  parseDocumentText,
  refuseNewerDocument,
  renderDocumentText,
  validateDocument,
  type ParsedDocument,
} from "./documents.ts";
import { ParseError, SchemaError, WriteRefusedError } from "./errors.ts";
import {
  appendLine,
  parseLogText,
  scopeProblem,
  serializeEvent,
  type LogReadResult,
} from "./logs.ts";
import { checkWrite, classifyPath, type PathInfo, type WriterContext } from "./ownership.ts";
import { createRedactor, textEncodingOf, textOf, type Redactor, type Secret } from "./redact.ts";
import {
  NotRegularFileError,
  readRegularFile,
  readRegularText,
  refuseLinkedFolders,
} from "./regular.ts";

export interface WorkspaceOptions {
  /** The workspace folder, for example `~/AW/<workspace>`. It holds `tasks/`, `knowledge/`, `secure/`. */
  root: string;
  /** The slug of this device. */
  device: string;
  role: DeviceRole;
  /** True when this device holds the master key; a function is read at each write. */
  hasMasterKey?: boolean | (() => boolean);
  clock: Clock;
  /** The owner device of a task. merge-index gives it from the merged logs. */
  taskOwner?: (task: string) => string | undefined;
  /** The credential values of the session and the MCP token, for the redaction of each event. */
  secrets?: Secret[];
  /** The last HLC that this device stored, so its HLC never goes back after a restart. */
  lastHlc?: string | null;
  /**
   * Called after each successful write with the workspace-relative path and the written bytes
   * (the appended line for a log, null for a removal). awd uses it for the targeted scan of the
   * sync engine and for the write journal (docs/phase-1.md 6.3, 6.6).
   */
  onWrite?: WriteHook;
}

/**
 * The layout rules of the text files of a task: AW redacts them before they sync (docs/phase-1.md
 * 3.3.5). An artifact is redacted only when its content is text.
 */
const REDACTED_RULES = new Set([
  "task-terminal",
  "task-proposal",
  "task-approach",
  "task-artifact",
]);

export type WriteHook = (path: string, content: string | Uint8Array | null) => void;

export interface NewEventOptions {
  task?: string;
  by?: string;
}

/** The value of the identity field of a document when it differs from its path, else null. */
function identityMismatch(
  info: PathInfo,
  value: unknown,
): { field: string; found: unknown } | null {
  if (!info.identity) return null;
  const found = (value as Record<string, unknown>)[info.identity.field];
  return found === info.identity.value ? null : { field: info.identity.field, found };
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

export class WorkspaceFiles {
  readonly root: string;
  readonly device: string;
  readonly hlc: HybridLogicalClock;
  readonly #clock: Clock;
  readonly #context: WriterContext;
  readonly #onWrite: WriteHook | undefined;
  #redactor: Redactor;

  constructor(options: WorkspaceOptions) {
    this.root = options.root;
    this.device = options.device;
    this.#clock = options.clock;
    this.hlc = new HybridLogicalClock(options.clock, options.lastHlc ?? null);
    this.#redactor = createRedactor(options.secrets ?? []);
    this.#onWrite = options.onWrite;
    const hasMasterKey = options.hasMasterKey ?? false;
    this.#context = {
      device: options.device,
      role: options.role,
      get hasMasterKey() {
        return typeof hasMasterKey === "function" ? hasMasterKey() : hasMasterKey;
      },
      ...(options.taskOwner ? { taskOwner: options.taskOwner } : {}),
    };
  }

  /** Sets the secrets that the redaction replaces in each later event. */
  setSecrets(secrets: Secret[]): void {
    this.#redactor = createRedactor(secrets);
  }

  /** Returns the path info of a path in the layout, or throws WriteRefusedError for another path. */
  info(path: string): PathInfo {
    const info = classifyPath(path);
    if ("reason" in info) throw new WriteRefusedError({ path: info.path }, info.reason);
    return info;
  }

  #abs(info: PathInfo): string {
    return join(this.root, ...info.path.split("/"));
  }

  /** The path info of a read. A folder of the path that is a link gives NotRegularFileError. */
  async #readable(path: string): Promise<PathInfo> {
    const info = this.info(path);
    await refuseLinkedFolders(this.root, info.path);
    return info;
  }

  async #guard(path: string): Promise<PathInfo> {
    const info = this.info(path);
    // A synced link in place of a folder of the layout would move the write out of the workspace.
    await refuseLinkedFolders(this.root, info.path);
    return checkWrite(path, this.#context, { exists: await exists(this.#abs(info)) });
  }

  /** Makes a new UUIDv7 from the clock. */
  newId(): string {
    return newId(this.#clock);
  }

  /** Reads and validates a YAML document. The kind must match the path. */
  async readDocument<K extends DocumentKind>(path: string): Promise<ParsedDocument<K>> {
    const info = await this.#readable(path);
    if (info.format.type !== "document") {
      throw new ParseError({ path: info.path }, "this path is not a YAML document");
    }
    const text = await readRegularText(this.#abs(info));
    const parsed = parseDocumentText(text, info.path, info.format.kind as K);
    const mismatch = identityMismatch(info, parsed.value);
    if (mismatch) {
      throw new SchemaError({ path: info.path }, `${parsed.kind}.v${parsed.version}`, [
        {
          path: mismatch.field,
          field: mismatch.field,
          message: `Expected ${info.identity!.value} (the name of the folder), found ${JSON.stringify(mismatch.found)}`,
        },
      ]);
    }
    return parsed;
  }

  /** Validates and writes a YAML document atomically. Keeps the comments of the old file. */
  async writeDocument<K extends DocumentKind>(
    path: string,
    value: DocumentInputOf[K],
  ): Promise<DocumentOf[K]> {
    const info = await this.#guard(path);
    if (info.format.type !== "document") {
      throw new WriteRefusedError({ path: info.path }, "this path is not a YAML document");
    }
    const valid = validateDocument(value, info.path, info.format.kind as K);
    const mismatch = identityMismatch(info, valid.value);
    if (mismatch) {
      throw new WriteRefusedError(
        { path: info.path },
        `the ${mismatch.field} ${JSON.stringify(mismatch.found)} is not ${info.identity!.value}, the name of the folder`,
      );
    }
    const file = this.#abs(info);
    // A link in place of the document is replaced by the rename: its target is never read.
    const oldText = await readRegularText(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error instanceof NotRegularFileError) return undefined;
      throw error;
    });
    if (oldText !== undefined) refuseNewerDocument(oldText, info.path, info.format.kind);
    const text = renderDocumentText(valid.value, oldText);
    await writeFileAtomic(file, text);
    this.#wrote(info.path, text);
    return valid.value;
  }

  /** Reads a log file. Bad lines are in `errors`; the reader never stops at a bad line. */
  async readEvents(path: string): Promise<LogReadResult> {
    const info = await this.#readable(path);
    if (info.format.type !== "log")
      throw new ParseError({ path: info.path }, "this path is not a log file");
    const text = await readRegularText(this.#abs(info)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return parseLogText(text, info.path, info.format.device, {
      kind: info.format.log,
      ...(info.task === undefined ? {} : { task: info.task }),
    });
  }

  /** Builds a new event of this device with a new id and HLC. */
  newEvent<T extends EventType>(type: T, data: EventData<T>, options: NewEventOptions = {}) {
    return {
      v: 1,
      id: this.newId(),
      hlc: this.hlc.now(),
      dev: this.device,
      type,
      ...(options.task ? { task: options.task } : {}),
      ...(options.by ? { by: options.by } : {}),
      data,
    };
  }

  /** Redacts, validates and appends one event to a log file of this device. */
  async appendEvent(path: string, event: unknown): Promise<AwEvent> {
    const info = await this.#guard(path);
    if (info.format.type !== "log")
      throw new WriteRefusedError({ path: info.path }, "this path is not a log file");
    const { line, event: written } = serializeEvent(event, info.path, this.#redactor);
    if (written.dev !== info.format.device) {
      throw new WriteRefusedError(
        { path: info.path },
        `the event dev ${written.dev} is not the device of the log`,
      );
    }
    const problem = scopeProblem(
      { kind: info.format.log, ...(info.task === undefined ? {} : { task: info.task }) },
      written,
    );
    if (problem) throw new WriteRefusedError({ path: info.path }, problem.message);
    this.hlc.observe(written.hlc);
    await appendLine(this.#abs(info), line);
    this.#wrote(info.path, `${line}\n`);
    return written;
  }

  /** Builds a new event and appends it. */
  async writeEvent<T extends EventType>(
    path: string,
    type: T,
    data: EventData<T>,
    options: NewEventOptions = {},
  ): Promise<AwEvent> {
    return this.appendEvent(path, this.newEvent(type, data, options));
  }

  /**
   * Writes another file of the layout atomically: a proposal version, an artifact, knowledge.
   * AW redacts the credential values and the session tokens in each text file of a task first: the
   * terminal snapshot, the proposal versions and the artifacts (docs/phase-1.md 3.3.5). A string is
   * text; bytes are text when they are strict UTF-8 with no NUL byte. A binary file and each other
   * file (sealed, credential, schema) are written as they are. Returns the written content, so a
   * caller hashes the file that syncs (`artifact.added`).
   */
  async writeFile(path: string, content: string | Uint8Array): Promise<string | Uint8Array> {
    const info = await this.#guard(path);
    if (info.format.type !== "file") {
      throw new WriteRefusedError(
        { path: info.path },
        "use writeDocument or appendEvent for this path",
      );
    }
    const output = REDACTED_RULES.has(info.rule)
      ? this.#redactFile(content, info.rule === "task-terminal")
      : content;
    await writeFileAtomic(this.#abs(info), output);
    this.#wrote(info.path, output);
    return output;
  }

  /** The redaction of the text files, for a compare with a file on disk. */
  redactText(text: string): string {
    return this.#redactor.redactText(text);
  }

  /**
   * The redacted content of a text file in the type of the input; the input when nothing changes.
   * A terminal snapshot is always text: its bytes are decoded with replacement characters, so a
   * byte that is not UTF-8 never turns off the redaction (review of credential-redaction, item 4).
   */
  #redactFile(content: string | Uint8Array, alwaysText = false): string | Uint8Array {
    if (alwaysText && typeof content !== "string") {
      const decoded = Buffer.from(content).toString("utf8");
      return Buffer.from(this.#redactor.redactText(decoded), "utf8");
    }
    const text = textOf(content);
    if (text === null) {
      // Not strict UTF-8 (only bytes reach here): a text in another form is redacted in its bytes.
      const bytes = content as Uint8Array;
      const encoding = textEncodingOf(bytes);
      return encoding === null ? content : this.#redactor.redactBytes(bytes, encoding);
    }
    const redacted = this.#redactor.redactText(text);
    if (redacted === text) return content;
    return typeof content === "string" ? redacted : Buffer.from(redacted, "utf8");
  }

  /**
   * Removes a knowledge file (a shared file of the rule `knowledge-file`): the Undo of a learned
   * file and a delete of the knowledge store (docs/phase-1.md 5). The store copies the content to
   * its history before the call. Each other path, also a knowledge log, is refused.
   */
  async removeKnowledgeFile(path: string): Promise<void> {
    const info = await this.#guard(path);
    if (info.rule !== "knowledge-file") {
      throw new WriteRefusedError(
        { path: info.path },
        `only a knowledge file is removed here, not a file of the rule ${info.rule}`,
      );
    }
    await rm(this.#abs(info), { force: true });
    // As each other write: the targeted scan sends the delete at once.
    this.#wrote(info.path, null);
  }

  /**
   * Removes a credential file `secure/credentials/<name>.age` (`aw credential remove`). Each other
   * path, also a sealed credential key, is refused.
   */
  async removeCredentialFile(path: string): Promise<void> {
    const info = await this.#guard(path);
    if (info.rule !== "credential") {
      throw new WriteRefusedError(
        { path: info.path },
        `only a credential file is removed here, not a file of the rule ${info.rule}`,
      );
    }
    await rm(this.#abs(info), { force: true });
    this.#wrote(info.path, null);
  }

  /**
   * Removes a heartbeat log of this device: the retention of awd (docs/phase-1.md 3.1). With
   * removeKnowledgeFile, it is one of the 2 deletes of the files layer. Each other path, also a
   * heartbeat log of another device, is refused, because a log line is never deleted
   * (docs/engineering-rules.md 5.4).
   */
  async removeHeartbeatLog(path: string): Promise<void> {
    const info = await this.#guard(path);
    if (info.rule !== "device-heartbeat") {
      throw new WriteRefusedError(
        { path: info.path },
        `only a heartbeat log is removed, not a file of the rule ${info.rule}`,
      );
    }
    await rm(this.#abs(info), { force: true });
    this.#wrote(info.path, null);
  }

  /** Calls the write hook. A hook error never fails the write that is on disk. */
  #wrote(path: string, content: string | Uint8Array | null): void {
    try {
      this.#onWrite?.(path, content);
    } catch {
      // The hook is a notice (scan, journal). The engine watcher finds the change anyway.
    }
  }

  /** Parses a conflict copy path in the layout, or throws WriteRefusedError. */
  #copy(path: string): ConflictCopy & { info: PathInfo } {
    const copy = parseConflictCopy(path);
    if (!copy) throw new WriteRefusedError({ path }, "the path is not a conflict copy name");
    const info = this.info(copy.original);
    return { ...copy, info };
  }

  /**
   * Resolves a conflict copy (docs/architecture.md 4.3.2): with `keep: "copy"` it writes the copy
   * bytes over the original, then it removes the copy. This device must be allowed to write the
   * original. It returns the bytes of the version that lost.
   */
  async resolveConflictCopy(path: string, keep: "original" | "copy"): Promise<Uint8Array | null> {
    const copy = this.#copy(path);
    const original = this.#abs(copy.info);
    const copyFile = join(this.root, ...copy.copy.split("/"));
    checkWrite(copy.info.path, this.#context, {
      exists: keep === "copy" ? await exists(original) : false,
    });
    await refuseLinkedFolders(this.root, copy.copy);
    const copyBytes = await readRegularFile(copyFile);
    let lost: Uint8Array | null = copyBytes;
    if (keep === "copy") {
      lost = await readRegularFile(original).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error instanceof NotRegularFileError) return null;
        throw error;
      });
      await writeFileAtomic(original, copyBytes);
      this.#wrote(copy.info.path, copyBytes);
    }
    await rm(copyFile, { force: true });
    this.#wrote(copy.copy, null);
    return lost;
  }

  /**
   * Merges a conflict copy of a log of this device into the log by event id (the duplicate-id
   * rule): it appends each valid line of the copy whose id the log does not have, then removes
   * the copy. It returns the count of appended lines.
   */
  async mergeLogCopy(path: string): Promise<number> {
    const copy = this.#copy(path);
    const info = checkWrite(copy.info.path, this.#context, { exists: true });
    if (info.format.type !== "log") {
      throw new WriteRefusedError(
        { path: copy.copy },
        "the original of the copy is not a log file",
      );
    }
    const scope = {
      kind: info.format.log,
      ...(info.task === undefined ? {} : { task: info.task }),
    };
    const copyFile = join(this.root, ...copy.copy.split("/"));
    await refuseLinkedFolders(this.root, copy.copy);
    const copyText = await readRegularText(copyFile);
    const own = await this.readEvents(info.path);
    const known = new Set([...own.events, ...own.unknown].map((event) => event.id));
    const parsed = parseLogText(copyText, info.path, info.format.device, scope);
    // Only the lines that the reader accepts (valid envelope, the device of the log, its scope).
    const valid = new Map(
      [...parsed.events, ...parsed.unknown].map((event) => [event.id, event.hlc] as const),
    );
    let added = 0;
    for (const line of copyText.split("\n")) {
      if (line.trim() === "") continue;
      let id: unknown;
      try {
        id = (JSON.parse(line) as { id?: unknown }).id;
      } catch {
        continue;
      }
      if (typeof id !== "string" || !valid.has(id) || known.has(id)) continue;
      // As appendEvent: each new event of this device sorts after the merged ones.
      this.hlc.observe(valid.get(id)!);
      await appendLine(this.#abs(info), line);
      known.add(id);
      this.#wrote(info.path, `${line}\n`);
      added += 1;
    }
    await rm(copyFile, { force: true });
    this.#wrote(copy.copy, null);
    return added;
  }

  /** Reads a text file of the layout. A link gives NotRegularFileError (final check fc1-3). */
  async readText(path: string): Promise<string> {
    return readRegularText(this.#abs(await this.#readable(path)));
  }
}

/** Opens the files API of a workspace folder for one device. */
export function openWorkspace(options: WorkspaceOptions): WorkspaceFiles {
  return new WorkspaceFiles(options);
}
