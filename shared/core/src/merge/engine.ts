// The merge engine: it reads the sources, holds far-future events back, folds each task and the
// workspace log, and assembles the view (design of openspec change add-merge-and-index).
import type {
  BindingsDocument,
  DeviceDocument,
  DeviceRole,
  HealthDocument,
  ProjectDocument,
  WorkspaceDocument,
} from "@aw/schema";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Clock } from "../clock.ts";
import { parseDocumentText } from "../files/documents.ts";
import { AwFileError } from "../files/errors.ts";
import { NotRegularFileError, readRegularText } from "../files/regular.ts";
import { markDuplicateKeys } from "./keys.ts";
import { compareOrder, compareText, hlcMs, type OrderKey } from "./order.ts";
import { presenceOf, updateReceipts, type Receipt } from "./presence.ts";
import { priorityRank } from "./priority.ts";
import { findSources, LogSource, type LogLine, type SourceFile } from "./source.ts";
import { TaskFold, type Decision, type TaskContext } from "./task.ts";
import type {
  DeviceView,
  MergeIssue,
  PresenceView,
  ProjectView,
  RemovedProjectView,
  TaskView,
  WorkspaceView,
} from "./view.ts";
import { foldWorkspace, type WorkspaceFold } from "./workspace.ts";

/** The default bound for a remote HLC: 24 h ahead of the local clock (design decision 10). */
export const DEFAULT_MAX_SKEW_MS = 24 * 60 * 60 * 1000;

export interface MergeEngineOptions {
  /** The workspace folder: it holds `tasks/`. */
  root: string;
  clock: Clock;
  /** An event more than this many ms ahead of the local clock is held back. */
  maxSkewMs?: number;
  /** Changes the read order of the log files. Tests use it to show that the order does not matter. */
  readOrder?: (paths: string[]) => string[];
  /**
   * The last valid value of each document from an earlier process, for example
   * `WorkspaceIndex.documents()`. A document that now fails its schema keeps this value.
   */
  lastValid?: readonly LastValidDocument[];
  /**
   * The check of a device record: the raw YAML value of `devices/<device>/device.yaml` (not the
   * schema value, so a default of a newer version does not change the signed bytes). It returns
   * true for a record with a valid master-key signature. Without it, each record that passes its
   * schema counts (design of add-identity-and-pairing, decision 7).
   */
  verifyDeviceRecord?: (raw: unknown) => boolean;
}

/** A device record that the check refused, or an older sequence number than the kept record. */
class RecordRefusedError extends Error {
  readonly reason: "bad_signature" | "old_sequence";
  constructor(reason: "bad_signature" | "old_sequence", message: string) {
    super(message);
    this.reason = reason;
  }
}

/** The last valid value of a document. */
export interface LastValidDocument {
  path: string;
  kind: string;
  value: unknown;
}

export interface MergeNotice {
  code: "truncated" | "replaced" | "removed";
  path: string;
}

export interface MergeUpdate {
  view: WorkspaceView;
  presence: PresenceView;
  /** True when the engine read all files again (first read, or a truncated, replaced or removed log). */
  full: boolean;
  notices: MergeNotice[];
  /** The tasks that the update folded. */
  changedTasks: string[];
  workspaceChanged: boolean;
  documentsChanged: boolean;
}

/** One event row for the index: the event, its place and the merge decision. */
export interface EventRow {
  id: string;
  task: string | null;
  hlc: string;
  dev: string;
  type: string;
  path: string;
  line: number;
  applied: boolean;
  reason: string | null;
  event: unknown;
}

interface DocumentEntry {
  path: string;
  kind: string;
  /** The text of the last read, or null when the file was not read yet (a kept value only). */
  text: string | null;
  /** The last valid value. */
  value: unknown;
  issue: MergeIssue | null;
}

interface HeartbeatAggregate {
  device: string;
  count: number;
  last: LogLine | null;
}

function isSameLine(a: LogLine, b: LogLine): boolean {
  return a.path === b.path && a.line === b.line;
}

function keyOf(line: LogLine): OrderKey {
  return { hlc: line.event.hlc, dev: line.event.dev, id: line.event.id };
}

function byOrder(a: LogLine, b: LogLine): number {
  return compareOrder(keyOf(a), keyOf(b));
}

/** The place of a line: a line with a smaller path, then a smaller line number, wins a duplicate id. */
function comparePlace(a: LogLine, b: LogLine): number {
  return compareText(a.path, b.path) || a.line - b.line;
}

function withoutPlace(message: string, path: string): string {
  if (!message.startsWith(path)) return message;
  return message.slice(path.length).replace(/^(?::\d+)?: /, "");
}

export class MergeEngine {
  readonly root: string;
  readonly #clock: Clock;
  readonly #maxSkewMs: number;
  readonly #readOrder: (paths: string[]) => string[];
  readonly #verifyDeviceRecord: ((raw: unknown) => boolean) | undefined;

  #sources = new Map<string, LogSource>();
  /**
   * The logs whose last read failed (EACCES, EIO): the issue `read_error`, as on the phone. One
   * file that cannot be read does not stop the merge (final check review M1).
   */
  #readErrors = new Map<string, MergeIssue>();
  /** True when a read of this update failed: the next update reads all files again. */
  #readFailed = false;
  #documents = new Map<string, DocumentEntry>();
  /** The line of each merged event id (the winner of a duplicate id). */
  #byId = new Map<string, LogLine>();
  #duplicates: LogLine[] = [];
  /** Held far-future lines, by `<path>:<line>`. */
  #held = new Map<string, LogLine>();
  #taskLines = new Map<string, LogLine[]>();
  #workspaceLines: LogLine[] = [];
  #heartbeats = new Map<string, HeartbeatAggregate>();
  /** The line of each heartbeat id (the winner of a duplicate id). */
  #heartbeatIds = new Map<string, LogLine>();
  #folds = new Map<string, TaskFold>();
  /** Tasks that lost a duplicate line to another scope: they fold again. */
  #pendingRefold = new Set<string>();
  /** True when a duplicate line removed a line of the workspace log: the workspace folds again. */
  #workspaceLost = false;
  #workspace: WorkspaceFold = foldWorkspace([], { resources: () => undefined });
  #receipts = new Map<string, Receipt>();
  #lastHlc: string | null = null;
  #view: WorkspaceView | null = null;
  #presence: PresenceView | null = null;
  /** True when the next update reads all files: the first update, a rebuild, a failed update. */
  #mustReadAll = true;
  /** The last queued call: `update()` and `rebuild()` run one at a time. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: MergeEngineOptions) {
    this.root = options.root;
    this.#clock = options.clock;
    this.#maxSkewMs = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
    this.#readOrder = options.readOrder ?? ((paths) => paths);
    this.#verifyDeviceRecord = options.verifyDeviceRecord;
    for (const doc of options.lastValid ?? []) {
      this.#documents.set(doc.path, { ...doc, text: null, issue: null });
    }
  }

  /** The last view, or null before the first update. A failed update keeps the last view. */
  get view(): WorkspaceView | null {
    return this.#view;
  }

  get presence(): PresenceView | null {
    return this.#presence;
  }

  /** The highest merged HLC, for `HybridLogicalClock.observe()` and `openWorkspace({lastHlc})`. */
  lastHlc(): string | null {
    return this.#lastHlc;
  }

  /** The owner device of a task, for `openWorkspace({taskOwner})`. */
  taskOwner(task: string): string | undefined {
    return this.#folds.get(task)?.owner ?? undefined;
  }

  /** The ids of the tasks that have events. */
  taskIds(): string[] {
    return [...this.#taskLines.keys()].sort(compareText);
  }

  /** The events of a task (or of the workspace log when `task` is null), in merge order. */
  eventRows(task: string | null): EventRow[] {
    const lines = task === null ? this.#workspaceLines : (this.#taskLines.get(task) ?? []);
    const decisions =
      task === null
        ? this.#workspace.decisions
        : (this.#folds.get(task)?.decisions ?? new Map<string, Decision>());
    return [...lines].sort(byOrder).map((line) => {
      const decision: Decision | undefined = decisions.get(line.event.id);
      return {
        id: line.event.id,
        task,
        hlc: line.event.hlc,
        dev: line.event.dev,
        type: line.event.type,
        path: line.path,
        line: line.line,
        applied: decision?.applied ?? false,
        reason: decision?.reason ?? null,
        event: line.event,
      };
    });
  }

  /** Each document entry: the path, the kind and the last valid value. */
  documents(): { path: string; kind: string; value: unknown }[] {
    return [...this.#documents.values()]
      .filter((doc) => doc.value !== undefined)
      .map((doc) => ({ path: doc.path, kind: doc.kind, value: doc.value }));
  }

  /** The log sources: the path, the read lines and the bad lines. */
  files(): { path: string; lines: number; errors: number }[] {
    return [...this.#sources.values()]
      .map((s) => ({ path: s.path, lines: s.lines, errors: s.issues.length + (s.partial ? 1 : 0) }))
      .sort((a, b) => compareText(a.path, b.path));
  }

  #clearEvents(): void {
    this.#sources = new Map();
    this.#byId = new Map();
    this.#duplicates = [];
    this.#held = new Map();
    this.#taskLines = new Map();
    this.#workspaceLines = [];
    this.#heartbeats = new Map();
    this.#heartbeatIds = new Map();
    this.#folds = new Map();
    this.#pendingRefold = new Set();
    this.#workspaceLost = false;
    this.#lastHlc = null;
  }

  /**
   * Forgets each read event and the text of each document, so the next update reads all files
   * from the start. Each document keeps its last valid value, so a document that fails its schema
   * has the same value as before.
   */
  #forgetReads(): void {
    this.#clearEvents();
    this.#documents = new Map(
      [...this.#documents.values()]
        .filter((doc) => doc.value !== undefined)
        .map((doc) => [doc.path, { ...doc, text: null, issue: null }]),
    );
    this.#mustReadAll = true;
  }

  /** Runs the calls one at a time, so 2 overlapping calls never read the same new bytes. */
  #serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Reads all files again from the start. The presence receipts start again too, so the first
   * receive time of each device is the earlier of the local time and the HLC time
   * (docs/phase-1.md 9.6.3).
   */
  rebuild(): Promise<MergeUpdate> {
    return this.#serial(() => {
      this.#forgetReads();
      this.#receipts = new Map();
      return this.#update();
    });
  }

  /**
   * Reads the new data of each file and updates the view. The calls run one at a time. An update
   * is all or nothing: when a read fails, the engine forgets each read and the next update reads
   * all files again, so no event is lost (the error goes to the caller).
   */
  update(): Promise<MergeUpdate> {
    return this.#serial(() => this.#update());
  }

  async #update(): Promise<MergeUpdate> {
    try {
      this.#readFailed = false;
      const update = await this.#read();
      this.#mustReadAll = false;
      if (this.#readFailed) this.#forgetReads();
      return update;
    } catch (error) {
      this.#forgetReads();
      throw error;
    }
  }

  async #read(): Promise<MergeUpdate> {
    const now = this.#clock.now();
    let full = this.#mustReadAll;
    const notices: MergeNotice[] = [];
    const { logs, documents } = await findSources(this.root);

    const changedKinds = await this.#readDocuments(documents);
    const documentsChanged = changedKinds.size > 0;

    const paths = this.#readOrder(logs.map((log) => log.path));
    const files = new Map(logs.map((log) => [log.path, log]));
    for (const path of this.#sources.keys()) {
      if (!files.has(path)) notices.push({ code: "removed", path });
    }
    let lines = await this.#readLogs(paths, files, notices);
    if (notices.length > 0 && !full) {
      // A log changed in a way that an append cannot: read each file again from the start.
      full = true;
      this.#clearEvents();
      lines = await this.#readLogs(paths, files, []);
    }

    for (const [place, line] of this.#held) {
      if (!this.#isFuture(line, now)) {
        this.#held.delete(place);
        lines.push(line);
      }
    }

    const appended = new Map<string, LogLine[]>();
    const refold = new Set<string>();
    // Only the bindings (resources) change the fold of the workspace log, and only the projects
    // (the subtask switch) change the folds of the tasks. The view assembly reads each document.
    // A device record (a revoke) changes the folds of the tasks and of the workspace log.
    const devicesChanged = changedKinds.has("device");
    let workspaceChanged = full || changedKinds.has("bindings") || devicesChanged;
    for (const line of lines) {
      if (this.#isFuture(line, now)) {
        this.#held.set(`${line.path}:${line.line}`, line);
        continue;
      }
      const source = this.#sources.get(line.path)!;
      if (source.scope.kind === "heartbeat") {
        this.#admitHeartbeat(line, source.device);
        continue;
      }
      const task = source.scope.kind === "task" ? source.scope.task! : null;
      const result = this.#admit(line, task);
      if (result === "rejected") continue;
      if (task === null) workspaceChanged = true;
      else if (result === "replaced") refold.add(task);
      else {
        const list = appended.get(task) ?? [];
        list.push(line);
        appended.set(task, list);
      }
    }
    if (this.#workspaceLost) {
      workspaceChanged = true;
      this.#workspaceLost = false;
    }

    const changedTasks = this.#foldTasks(
      appended,
      refold,
      full || changedKinds.has("project") || devicesChanged,
    );
    if (workspaceChanged) {
      const bindings = this.#documentsOf<BindingsDocument>("bindings");
      this.#workspace = foldWorkspace([...this.#workspaceLines].sort(byOrder), {
        resources: (device) => bindings.find((b) => b.device === device)?.resources,
        revokedAt: this.#revokedAt(),
      });
    }

    this.#lastHlc = this.#highestHlc();
    const view = this.#assemble(now);
    const last = new Map<string, string>();
    for (const aggregate of this.#heartbeats.values()) {
      const hlc = aggregate.last?.event.hlc;
      const old = last.get(aggregate.device);
      if (hlc !== undefined && (old === undefined || hlc > old)) last.set(aggregate.device, hlc);
    }
    updateReceipts(this.#receipts, last, now);
    const presence = presenceOf(view, this.#receipts, now, this.#revokedAt());
    this.#view = view;
    this.#presence = presence;
    return {
      view,
      presence,
      full,
      notices,
      changedTasks: [...changedTasks].sort(compareText),
      workspaceChanged,
      documentsChanged,
    };
  }

  #isFuture(line: LogLine, now: number): boolean {
    return hlcMs(line.event.hlc) - now > this.#maxSkewMs;
  }

  async #readLogs(
    paths: string[],
    files: Map<string, SourceFile>,
    notices: MergeNotice[],
  ): Promise<LogLine[]> {
    for (const path of [...this.#sources.keys()]) {
      if (!files.has(path)) this.#sources.delete(path);
    }
    for (const path of [...this.#readErrors.keys()]) {
      if (!files.has(path)) this.#readErrors.delete(path);
    }
    const lines: LogLine[] = [];
    for (const path of paths) {
      let source = this.#sources.get(path);
      if (!source) {
        source = new LogSource(this.root, files.get(path)!);
        this.#sources.set(path, source);
      }
      let result;
      try {
        result = await source.read();
      } catch (error) {
        // The source keeps its last read; the next update reads all files again, so no event is
        // lost and no line counts twice.
        this.#readErrors.set(path, {
          code: "read_error",
          path,
          line: null,
          event: null,
          task: source.scope.task ?? null,
          reason: null,
          message: `The log cannot be read: ${(error as Error).message}`,
        });
        this.#readFailed = true;
        continue;
      }
      this.#readErrors.delete(path);
      if (result.reset) notices.push({ code: result.reset, path });
      lines.push(...result.lines);
    }
    return lines;
  }

  /**
   * Reads each document whose text changed. Returns the kinds of the changed documents. A document
   * that fails its schema keeps its last valid value: from this process, from the last rebuild, or
   * from `lastValid`.
   */
  async #readDocuments(documents: SourceFile[]): Promise<Set<string>> {
    const changed = new Set<string>();
    const present = new Set(documents.map((d) => d.path));
    for (const [path, doc] of [...this.#documents]) {
      if (present.has(path)) continue;
      if (this.#isStickyRevoke(doc)) {
        // A revoke stays when its file is removed (a revoked device must not undo it).
        if (doc.issue?.reason !== "revoke_removed") {
          // No text: the file that comes back is read and checked again.
          doc.text = null;
          doc.issue = {
            code: "bad_document",
            path,
            line: null,
            event: null,
            task: null,
            reason: "revoke_removed",
            message: "the revoke record was removed; the revoke stays",
          };
          changed.add(doc.kind);
        }
        continue;
      }
      this.#documents.delete(path);
      changed.add(doc.kind);
    }
    for (const doc of documents) {
      let text: string;
      try {
        text = await readRegularText(join(this.root, ...doc.path.split("/")));
      } catch (error) {
        // A link that replaced the document after the listing: no source (final check fc1-4).
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        if (error instanceof NotRegularFileError) continue;
        // A document that cannot be read keeps its last value, with the issue read_error (as on
        // the phone); the next update reads it again (final check review M1).
        const old = this.#documents.get(doc.path);
        const kind = doc.info.format.type === "document" ? doc.info.format.kind : "";
        this.#documents.set(doc.path, {
          path: doc.path,
          kind,
          text: null,
          value: old?.value,
          issue: {
            code: "read_error",
            path: doc.path,
            line: null,
            event: null,
            task: null,
            reason: null,
            message: `The document cannot be read: ${(error as Error).message}`,
          },
        });
        continue;
      }
      const old = this.#documents.get(doc.path);
      if (old?.text === text) continue;
      const kind = doc.info.format.type === "document" ? doc.info.format.kind : "";
      changed.add(kind);
      const entry: DocumentEntry = { path: doc.path, kind, text, value: old?.value, issue: null };
      try {
        const parsed = parseDocumentText(text, doc.path, kind as never);
        const identity = doc.info.identity;
        const found = identity ? (parsed.value as Record<string, unknown>)[identity.field] : null;
        if (identity && found !== identity.value) {
          throw new Error(
            `${identity.field} is ${JSON.stringify(found)}, not ${identity.value} (the name of the folder)`,
          );
        }
        if (kind === "device" && this.#verifyDeviceRecord) {
          this.#checkRecord(text, parsed.value, old?.value as DeviceDocument);
        }
        entry.value = parsed.value;
      } catch (error) {
        const message = error instanceof AwFileError ? error.message : (error as Error).message;
        entry.issue = {
          code: "bad_document",
          path: doc.path,
          line: error instanceof AwFileError ? (error.line ?? null) : null,
          event: null,
          task: null,
          reason:
            error instanceof AwFileError
              ? error.code
              : error instanceof RecordRefusedError
                ? error.reason
                : "schema_error",
          message: withoutPlace(message, doc.path),
        };
      }
      this.#documents.set(doc.path, entry);
    }
    return changed;
  }

  /** True for a kept revoke record when the device records are checked (it never goes away). */
  #isStickyRevoke(doc: DocumentEntry): boolean {
    if (doc.kind !== "device" || !this.#verifyDeviceRecord) return false;
    return (doc.value as DeviceDocument | undefined)?.revoked === true;
  }

  /** Throws RecordRefusedError for a record that the check refuses or that has an older `seq`. */
  #checkRecord(text: string, record: DeviceDocument, kept: DeviceDocument | undefined): void {
    if (!this.#verifyDeviceRecord!(parseYaml(text))) {
      throw new RecordRefusedError(
        "bad_signature",
        "the record has no valid signature of the master key; the last valid record stays",
      );
    }
    if (kept?.revoked && !record.revoked) {
      // A revoke is final: a valid record never makes a revoked device valid again.
      throw new RecordRefusedError(
        "old_sequence",
        `the device was revoked at seq ${kept.seq}; a record without the revoke does not count`,
      );
    }
    if (kept && kept.seq > record.seq) {
      throw new RecordRefusedError(
        "old_sequence",
        `the record has seq ${record.seq}, lower than the kept seq ${kept.seq}`,
      );
    }
  }

  /** The `revoked_at` HLC of each revoked device of the kept device records. */
  #revokedAt(): (device: string) => string | undefined {
    const revoked = new Map<string, string>();
    for (const record of this.#documentsOf<DeviceDocument>("device")) {
      if (record.revoked && record.revoked_at) revoked.set(record.slug, record.revoked_at);
    }
    return (device) => revoked.get(device);
  }

  #documentsOf<T>(kind: string): T[] {
    return [...this.#documents.values()]
      .filter((doc) => doc.kind === kind && doc.value !== undefined)
      .sort((a, b) => compareText(a.path, b.path))
      .map((doc) => doc.value as T);
  }

  /**
   * Adds a heartbeat line to the count and the last heartbeat of its file. A second line with the
   * same id is a duplicate, as for the other events: the line with the smaller place wins.
   */
  #admitHeartbeat(line: LogLine, device: string): void {
    const existing = this.#heartbeatIds.get(line.event.id);
    if (existing !== undefined) {
      if (isSameLine(line, existing)) return;
      if (comparePlace(line, existing) > 0) {
        this.#duplicates.push(line);
        return;
      }
      this.#duplicates.push(existing);
      this.#removeHeartbeat(existing);
    }
    this.#heartbeatIds.set(line.event.id, line);
    const aggregate = this.#heartbeats.get(line.path) ?? { device, count: 0, last: null };
    aggregate.count++;
    if (aggregate.last === null || byOrder(aggregate.last, line) < 0) aggregate.last = line;
    this.#heartbeats.set(line.path, aggregate);
  }

  /** Removes a heartbeat line that lost a duplicate id from the aggregate of its file. */
  #removeHeartbeat(line: LogLine): void {
    const aggregate = this.#heartbeats.get(line.path);
    if (!aggregate) return;
    aggregate.count--;
    if (aggregate.last !== line) return;
    aggregate.last = null;
    for (const other of this.#heartbeatIds.values()) {
      if (other === line || other.path !== line.path) continue;
      if (aggregate.last === null || byOrder(aggregate.last, other) < 0) aggregate.last = other;
    }
  }

  /**
   * The highest HLC of the merged lines (the winners of duplicate ids) and of the heartbeats. It
   * reads only settled lines, so a dropped duplicate never counts, whatever the read order.
   */
  #highestHlc(): string | null {
    let highest: string | null = null;
    const observe = (hlc: string) => {
      if (highest === null || hlc > highest) highest = hlc;
    };
    for (const line of this.#byId.values()) observe(line.event.hlc);
    for (const aggregate of this.#heartbeats.values()) {
      if (aggregate.last) observe(aggregate.last.event.hlc);
    }
    return highest;
  }

  /**
   * Adds a line to its scope. A second line with the same id is a duplicate: the line with the
   * smaller place wins, so the result does not depend on the read order.
   */
  #admit(line: LogLine, task: string | null): "added" | "replaced" | "rejected" {
    const existing = this.#byId.get(line.event.id);
    if (existing === undefined) {
      this.#byId.set(line.event.id, line);
      this.#list(task).push(line);
      return "added";
    }
    // The same line again is no duplicate. The serial calls prevent it; this is a second guard.
    if (isSameLine(line, existing)) return "rejected";
    if (comparePlace(line, existing) > 0) {
      this.#duplicates.push(line);
      return "rejected";
    }
    // The new line wins: remove the old one from its scope.
    const oldTask = this.#scopeTask(existing);
    const oldList = this.#list(oldTask);
    oldList.splice(oldList.indexOf(existing), 1);
    this.#duplicates.push(existing);
    this.#byId.set(line.event.id, line);
    this.#list(task).push(line);
    if (oldTask === null) this.#workspaceLost = true;
    else if (oldTask !== task) this.#pendingRefold.add(oldTask);
    return "replaced";
  }

  #scopeTask(line: LogLine): string | null {
    const source = this.#sources.get(line.path);
    return source?.scope.kind === "task" ? source.scope.task! : null;
  }

  #list(task: string | null): LogLine[] {
    if (task === null) return this.#workspaceLines;
    let list = this.#taskLines.get(task);
    if (!list) {
      list = [];
      this.#taskLines.set(task, list);
    }
    return list;
  }

  /** The parent of a task from its fold, or from its first `task.created` line. */
  #parentOf(task: string): string | null {
    const fold = this.#folds.get(task);
    if (fold?.created) return fold.parent;
    const created = (this.#taskLines.get(task) ?? [])
      .filter((line) => line.known && line.event.type === "task.created")
      .sort(byOrder)[0];
    const parent = (created?.event.data as { parent?: unknown } | undefined)?.parent;
    return typeof parent === "string" ? parent : null;
  }

  /**
   * Folds the tasks that changed. A task continues its saved fold when each new event sorts after
   * its last event; else it folds again from the start. The descendants of a changed task fold
   * again, because the assignment rule reads the owner of the parent.
   */
  #foldTasks(
    appended: Map<string, LogLine[]>,
    refold: Set<string>,
    everything: boolean,
  ): Set<string> {
    for (const task of this.#pendingRefold) refold.add(task);
    this.#pendingRefold.clear();
    const all = [...this.#taskLines.keys()];
    const changed = new Set<string>(everything ? all : [...appended.keys(), ...refold]);
    const full = new Set<string>(everything ? all : refold);

    const children = new Map<string, string[]>();
    const parents = new Map<string, string | null>();
    for (const task of all) {
      const parent = this.#parentOf(task);
      parents.set(task, parent);
      if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), task]);
    }
    const queue = [...changed];
    while (queue.length > 0) {
      for (const child of children.get(queue.shift()!) ?? []) {
        if (!full.has(child)) {
          full.add(child);
          changed.add(child);
          queue.push(child);
        }
      }
    }
    const depth = (task: string): number => {
      let count = 0;
      let current = parents.get(task) ?? null;
      while (current !== null && count < all.length) {
        count++;
        current = parents.get(current) ?? null;
      }
      return count;
    };
    const ordered = [...changed].sort((a, b) => depth(a) - depth(b) || compareText(a, b));

    const context: TaskContext = {
      project: (slug) =>
        this.#documentsOf<ProjectDocument>("project").find((project) => project.slug === slug),
      ownerAt: (task, key) => this.#folds.get(task)?.ownerAt(key),
      revokedAt: this.#revokedAt(),
    };
    for (const task of ordered) {
      const fold = this.#folds.get(task);
      const added = [...(appended.get(task) ?? [])].sort(byOrder);
      if (fold && !full.has(task) && added.length > 0 && fold.canAppend(added[0]!)) {
        for (const line of added) fold.apply(line, context);
        continue;
      }
      const next = new TaskFold(task);
      for (const line of [...(this.#taskLines.get(task) ?? [])].sort(byOrder)) {
        next.apply(line, context);
      }
      this.#folds.set(task, next);
    }
    return changed;
  }

  #assemble(now: number): WorkspaceView {
    const workspace = this.#documentsOf<WorkspaceDocument>("workspace")[0] ?? null;
    const records = this.#documentsOf<DeviceDocument>("device");
    const bindings = this.#documentsOf<BindingsDocument>("bindings");
    const health = this.#documentsOf<HealthDocument>("health");
    const projects = this.#documentsOf<ProjectDocument>("project");

    const slugs = new Set<string>();
    for (const record of records) slugs.add(record.slug);
    for (const doc of [...bindings, ...health]) slugs.add(doc.device);
    for (const source of this.#sources.values()) slugs.add(source.device);
    const roles = new Map<string, DeviceRole>(records.map((r) => [r.slug, r.role]));
    const priority = { roles, order: workspace?.device_order ?? [] };
    const rank = priorityRank(slugs, priority);

    const all: TaskView[] = [...this.#folds.values()]
      .map((fold) => fold.toView())
      .sort((a, b) => compareText(a.id, b.id));
    // Before the split: a live task never keeps the key of a removed task (openspec project-remove).
    markDuplicateKeys(all, rank);
    const removedSlugs = new Map<string, RemovedProjectView>();
    for (const removal of this.#workspace.removals) removedSlugs.set(removal.slug, removal);
    const live = projects.filter((project) =>
      isLiveProject(project, removedSlugs.get(project.slug)),
    );
    const liveSlugs = new Set(live.map((project) => project.slug));
    const isRemoved = (task: TaskView): boolean => {
      if (task.project === null || task.created === null) return false;
      const removal = removedSlugs.get(task.project);
      if (!removal) return false;
      if (!liveSlugs.has(task.project)) return true;
      const created = { hlc: task.created.hlc, dev: task.created.dev, id: task.created.event };
      const removed = {
        hlc: removal.removed.hlc,
        dev: removal.removed.dev,
        id: removal.removed.event,
      };
      return compareOrder(created, removed) < 0;
    };
    const tasks = all.filter((task) => !isRemoved(task));
    const removedTasks = all.filter(isRemoved);
    const removedIds = new Set(removedTasks.map((task) => task.id));
    const byTask = new Map(all.map((task) => [task.id, task]));
    const includes = this.#includes();
    for (const task of all) {
      task.includes = includes.get(task.id) ?? {};
      if (task.parent !== null) byTask.get(task.parent)?.subtasks.push(task.id);
    }
    for (const task of all) {
      task.subtasks.sort((a, b) => {
        const x = byTask.get(a)!.created;
        const y = byTask.get(b)!.created;
        if (!x || !y) return compareText(a, b);
        return compareOrder(
          { hlc: x.hlc, dev: x.dev, id: x.event },
          { hlc: y.hlc, dev: y.dev, id: y.event },
        );
      });
      // A task of a removed project is not an open dependency: no person can finish it.
      task.open_dependencies = task.depends_on.filter(
        (id) => !removedIds.has(id) && byTask.get(id)?.stage !== "done",
      );
    }

    const projectViews: ProjectView[] = live.map((project) => ({
      ...structuredClone(project),
      tasks: tasks.filter((task) => task.project === project.slug).map((task) => task.id),
    }));

    const beats = new Map<string, { last: LogLine; count: number }>();
    for (const aggregate of this.#heartbeats.values()) {
      if (!aggregate.last) continue;
      const old = beats.get(aggregate.device);
      const last = old && byOrder(old.last, aggregate.last) > 0 ? old.last : aggregate.last;
      beats.set(aggregate.device, { last, count: (old?.count ?? 0) + aggregate.count });
    }
    const devices: DeviceView[] = [...slugs]
      .map((slug) => {
        const record = records.find((r) => r.slug === slug);
        const binding = bindings.find((b) => b.device === slug);
        const healthDoc = health.find((h) => h.device === slug);
        const beat = beats.get(slug);
        const bootTime = (beat?.last.event.data as { boot_time?: string } | undefined)?.boot_time;
        return {
          slug,
          name: record?.name ?? null,
          role: record?.role ?? null,
          revoked: record?.revoked ?? false,
          priority: rank(slug),
          may_run: binding?.may_run ?? null,
          resources: { ...(binding?.resources ?? {}) },
          health: healthDoc
            ? {
                updated: healthDoc.updated,
                boot_time: healthDoc.boot_time,
                disk_used_percentage: healthDoc.disk.used_percentage,
              }
            : null,
          heartbeat: beat
            ? { last_hlc: beat.last.event.hlc, boot_time: bootTime ?? "", count: beat.count }
            : null,
        };
      })
      .sort((a, b) => a.priority - b.priority);

    return {
      workspace: workspace ? structuredClone(workspace) : null,
      credentials: structuredClone(this.#workspace.credentials),
      projects: projectViews,
      tasks,
      removed_projects: structuredClone(this.#workspace.removals),
      removed_tasks: removedTasks,
      devices,
      queues: structuredClone(this.#workspace.queues),
      slots: structuredClone(this.#workspace.slots),
      sources: structuredClone(this.#workspace.sources),
      cards: structuredClone(this.#workspace.cards),
      issues: this.#issues(now),
      last_hlc: this.#lastHlc,
    };
  }

  /** The lines of each device log of each task, up to the first held line of the log. */
  #includes(): Map<string, Record<string, number>> {
    const firstHeld = new Map<string, number>();
    for (const line of this.#held.values()) {
      firstHeld.set(line.path, Math.min(firstHeld.get(line.path) ?? line.line, line.line));
    }
    const result = new Map<string, Record<string, number>>();
    for (const source of [...this.#sources.values()].sort((a, b) => compareText(a.path, b.path))) {
      if (source.scope.kind !== "task") continue;
      const task = source.scope.task!;
      const entry = result.get(task) ?? {};
      const held = firstHeld.get(source.path);
      entry[source.device] = held === undefined ? source.lines : Math.min(source.lines, held - 1);
      result.set(task, entry);
    }
    return result;
  }

  #issues(now: number): MergeIssue[] {
    const issues: MergeIssue[] = [];
    for (const doc of this.#documents.values()) if (doc.issue) issues.push(doc.issue);
    issues.push(...this.#readErrors.values());
    for (const source of this.#sources.values()) {
      issues.push(...source.issues);
      if (source.partial) {
        issues.push({
          code: "partial_tail",
          path: source.path,
          line: source.partial.line,
          event: null,
          task: source.scope.task ?? null,
          reason: null,
          message: `The last line has no newline (${source.partial.bytes} bytes): a write that did not finish`,
        });
      }
    }
    const lineIssue = (
      line: LogLine,
      code: MergeIssue["code"],
      reason: string | null,
      message: string,
    ): MergeIssue => ({
      code,
      path: line.path,
      line: line.line,
      event: line.event.id,
      task: this.#scopeTask(line),
      reason,
      message,
    });
    for (const line of this.#held.values()) {
      const ahead = Math.round((hlcMs(line.event.hlc) - now) / 1000);
      issues.push(
        lineIssue(
          line,
          "future_hlc",
          null,
          `The HLC ${line.event.hlc} is ${ahead} s ahead of the local clock; the event waits`,
        ),
      );
    }
    for (const line of this.#duplicates) {
      issues.push(
        lineIssue(line, "duplicate_event", null, `A second event with the id ${line.event.id}`),
      );
    }
    const decided = (lines: LogLine[], decisions: Map<string, Decision>) => {
      for (const line of lines) {
        const decision = decisions.get(line.event.id);
        if (!decision) continue;
        if (decision.reason === "unknown_type") {
          issues.push(
            lineIssue(
              line,
              "unknown_type",
              "unknown_type",
              `Unknown event type ${line.event.type}`,
            ),
          );
        } else if (decision.reason === "assignee_ignored") {
          issues.push(
            lineIssue(
              line,
              "ignored",
              decision.reason,
              `The assignee of ${line.event.type} of ${line.event.dev} is ignored: only a human assigns a task`,
            ),
          );
        } else if (!decision.applied) {
          issues.push(
            lineIssue(
              line,
              "ignored",
              decision.reason,
              `${line.event.type} of ${line.event.dev} not applied: ${decision.reason}`,
            ),
          );
        }
      }
    };
    for (const [task, lines] of this.#taskLines) {
      decided(lines, this.#folds.get(task)?.decisions ?? new Map<string, Decision>());
    }
    decided(this.#workspaceLines, this.#workspace.decisions);
    return issues.sort(
      (a, b) =>
        compareText(a.path, b.path) ||
        (a.line ?? 0) - (b.line ?? 0) ||
        compareText(a.code, b.code) ||
        compareText(a.event ?? "", b.event ?? ""),
    );
  }
}

export interface MergeOptions {
  clock: Clock;
  maxSkewMs?: number;
  readOrder?: (paths: string[]) => string[];
}

/** Merges a workspace folder once: a full read of each file. */
export async function mergeWorkspace(root: string, options: MergeOptions): Promise<MergeUpdate> {
  const engine = new MergeEngine({ root, ...options });
  return engine.update();
}

/**
 * True when the project is live (openspec project-remove): no person removed its slug, or a person
 * added it again after the newest removal (`added_at` sorts after the HLC of the removal).
 */
export function isLiveProject(
  project: Pick<ProjectDocument, "added_at">,
  removal: Pick<RemovedProjectView, "removed"> | undefined,
): boolean {
  if (!removal) return true;
  return project.added_at !== null && compareText(project.added_at, removal.removed.hlc) > 0;
}
