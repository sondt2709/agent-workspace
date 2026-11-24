// The 1-second log buffer of session events (docs/phase-1.md 3.3.2, design decision 6). Agent
// text, progress lines, artifacts, handoffs and resume texts wait at most 1 s; a gate, a claim, a
// session start or end, a stage change and a human message are written at once, after the waiting
// events of the same task (a failed waiting event never stops it). Each event gets its HLC when it
// enters the buffer.
//
// A text that does not fit in a log line (docs/phase-1.md 3.3.3: at most 64 KiB) goes to
// `artifacts/<device>/text-<id>.md`, and the event keeps the start of it and the file name. A write
// that fails keeps its events in the buffer for the next try; after 3 tries the event is dropped
// with a comment on the task, so the thread shows the loss (principle 8).
import type { Clock } from "@aw/core";
import { newId, type EventData, type EventType } from "@aw/schema";
import type { Logger } from "../log.ts";
import { ServiceError } from "../service/errors.ts";
import { AppendError, type WorkspaceService, type WriteResult } from "../service/workspace.ts";

export const BUFFER_MS = 1000;
/** The longest text in an event, as JSON. A log line is at most 64 KiB with the envelope. */
export const MAX_TEXT_BYTES = 32 * 1024;
/** The start of a long text that stays in the event. */
export const PREVIEW_CHARS = 2000;
/** The tries of one event before AW drops it with a comment. */
export const MAX_TRIES = 3;

type BuiltEvent = ReturnType<WorkspaceService["newTaskEvent"]>;

/** The hook after an event of `now()` is on disk. */
export type AfterWrite = (task: string, type: EventType) => Promise<void> | void;

interface Entry {
  event: BuiltEvent;
  /** The full text of a long text, written before the event. */
  file: { path: string; text: string } | null;
  tries: number;
}

function writtenCount(error: unknown): number | "all" {
  if (error instanceof ServiceError && error.code === "written_not_merged") return "all";
  return error instanceof AppendError ? error.written : 0;
}

export class EventBuffer {
  readonly #service: WorkspaceService;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #waiting = new Map<string, Entry[]>();
  readonly #scheduled = new Set<Promise<void>>();
  /** The comments about dropped events that are not on disk yet. */
  readonly #comments = new Set<Promise<void>>();
  #closed = false;
  readonly #afterWrite: AfterWrite | undefined;

  /**
   * `afterWrite` runs after each event of `now()` is on disk (the terminal snapshot at a gate,
   * openspec task-terminal-view). Its error is logged and never fails the event.
   */
  constructor(service: WorkspaceService, clock: Clock, log: Logger, afterWrite?: AfterWrite) {
    this.#service = service;
    this.#clock = clock;
    this.#log = log;
    this.#afterWrite = afterWrite;
  }

  /** Puts an event in the buffer of its task. It is on disk within 1 s. */
  later<T extends EventType>(task: string, type: T, data: EventData<T>, by: string): BuiltEvent {
    const entry = this.#entry(task, type, data, by);
    const list = this.#waiting.get(task);
    if (list) list.push(entry);
    else {
      this.#waiting.set(task, [entry]);
      this.#schedule(task);
    }
    return entry.event;
  }

  /**
   * Writes the waiting events of the task, then this event. A failed waiting event stays in the
   * buffer (logged) and never stops this event: only a failure of this event throws. `id` gives
   * the event a fixed id (a hook step, see hookEventId).
   */
  async now<T extends EventType>(
    task: string,
    type: T,
    data: EventData<T>,
    by: string,
    options: { id?: string } = {},
  ): Promise<WriteResult> {
    await this.flush(task);
    const entry = this.#entry(task, type, data, by, options.id);
    let result: WriteResult;
    try {
      result = (await this.#write(task, [entry]))[0]!;
    } catch (error) {
      throw error instanceof AppendError ? error.cause : error;
    }
    if (this.#afterWrite) {
      try {
        await this.#afterWrite(task, type);
      } catch (error) {
        this.#log.error({ err: error, task, type }, "The hook after a session event failed");
      }
    }
    return result;
  }

  /** Writes the waiting events of one task, or of each task. A failed write stays in the buffer. */
  async flush(task?: string): Promise<void> {
    const tasks = task === undefined ? [...this.#waiting.keys()] : [task];
    for (const id of tasks) {
      const waiting = this.#take(id);
      if (waiting.length === 0) continue;
      try {
        await this.#write(id, waiting);
      } catch (error) {
        const written = writtenCount(error);
        if (written === "all") continue;
        this.#log.error({ err: error, task: id }, "The session log buffer did not write");
        this.#putBack(id, waiting, written, error);
      }
    }
  }

  /** The count of waiting events. */
  get size(): number {
    let n = 0;
    for (const list of this.#waiting.values()) n += list.length;
    return n;
  }

  async close(): Promise<void> {
    await this.flush();
    this.#closed = true;
  }

  /**
   * Resolves when each flush scheduled before this call ended (tests wait for it instead of a
   * sleep). A flush that a failed write schedules again waits for its own 1 s.
   */
  async settled(): Promise<void> {
    await Promise.all([...this.#scheduled]);
    await Promise.all([...this.#comments]);
  }

  #schedule(task: string): void {
    const flush: Promise<void> = this.#clock
      .sleep(BUFFER_MS)
      .then(() => (this.#closed ? undefined : this.flush(task)))
      .finally(() => this.#scheduled.delete(flush));
    this.#scheduled.add(flush);
  }

  #entry<T extends EventType>(
    task: string,
    type: T,
    data: EventData<T>,
    by: string,
    id?: string,
  ): Entry {
    const text = (data as { text?: unknown }).text;
    let file: Entry["file"] = null;
    let fitted = data;
    if (typeof text === "string" && Buffer.byteLength(JSON.stringify(text)) > MAX_TEXT_BYTES) {
      const path = `artifacts/${this.#service.device.slug}/text-${newId(this.#clock)}.md`;
      file = { path: `tasks/${task}/${path}`, text };
      // Redact the full text first, then cut it: a value across the cut keeps no prefix (0-41).
      const shown = this.#service.files.redactText(text);
      fitted = {
        ...data,
        text: `${shown.slice(0, PREVIEW_CHARS)}\n\n[AW: the full text (${text.length} characters) is in ${path}]`,
      };
    }
    const event = this.#service.newTaskEvent(task, type, fitted, by);
    return { event: id === undefined ? event : { ...event, id }, file, tries: 0 };
  }

  async #write(task: string, entries: Entry[]): Promise<WriteResult[]> {
    for (const entry of entries) {
      if (!entry.file) continue;
      await this.#service.writeTaskFile(entry.file.path, entry.file.text);
      entry.file = null;
    }
    return this.#service.appendTaskEvents(
      task,
      entries.map((e) => e.event),
    );
  }

  /** Puts the entries that are not on disk back at the front of the buffer of the task. */
  #putBack(task: string, entries: Entry[], written: number, error: unknown): void {
    const rest = entries.slice(written);
    if (rest.length === 0) return;
    const failed = rest[0]!;
    failed.tries++;
    if (failed.tries >= MAX_TRIES) {
      rest.shift();
      const comment: Promise<void> = this.#lost(task, failed, error).finally(() =>
        this.#comments.delete(comment),
      );
      this.#comments.add(comment);
    }
    if (rest.length === 0) return;
    const list = this.#waiting.get(task);
    if (list) list.unshift(...rest);
    else {
      this.#waiting.set(task, rest);
      this.#schedule(task);
    }
  }

  /** Drops an event that failed 3 times, and says so in the thread. */
  async #lost(task: string, entry: Entry, error: unknown): Promise<void> {
    const cause = error instanceof AppendError ? error.cause : error;
    const reason = (cause as Error)?.message ?? String(cause);
    this.#log.error(
      { err: cause, task, event: entry.event.id, type: entry.event.type },
      "A session event was dropped after 3 failed writes",
    );
    try {
      await this.#service.appendTaskEvents(task, [
        this.#service.newTaskEvent(
          task,
          "comment.added",
          {
            text: `AW could not write a session event (${entry.event.type}) after ${MAX_TRIES} tries: ${reason.slice(0, 1000)}`,
          },
          `aw@${this.#service.device.slug}`,
        ),
      ]);
    } catch (second) {
      this.#log.error({ err: second, task }, "The comment about a dropped event was not written");
    }
  }

  #take(task: string): Entry[] {
    const list = this.#waiting.get(task) ?? [];
    this.#waiting.delete(task);
    return list;
  }
}
