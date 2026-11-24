// The knowledge service of one workspace: the kb-files store, the watcher on `knowledge/` and the
// actor rules of the local API (docs/phase-1.md 5, design decision 14 of add-knowledge-store).
// The local API and the CLI call only these methods (docs/engineering-rules.md 5.17).
import { WriteRefusedError, type Clock, type TaskView, type WorkspaceFiles } from "@aw/core";
import {
  FileKnowledgeStore,
  isRule,
  KnowledgeError,
  parseKnowledgePath,
  type ReconcileResult,
} from "@aw/kb-files";
import type {
  ChangeResult,
  Digest,
  HistoryEntry,
  KnowledgeFile,
  KnowledgeScope,
  KnowledgeVersion,
  SearchHit,
  SessionContext,
  Suggestion,
} from "@aw/plugin-api";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../log.ts";
import { ServiceError, type ErrorCode } from "./errors.ts";
import type { DeviceInfo } from "./workspace.ts";

/** The wait after the first file event of a batch, on the clock module. */
export const KNOWLEDGE_BATCH_MS = 100;

export interface KnowledgeServiceOptions {
  workspace: string;
  files: WorkspaceFiles;
  device: DeviceInfo;
  clock: Clock;
  /** The state folder: the history is `<stateDir>/history/<workspace>`. */
  stateDir: string;
  log: Logger;
  /** The key of a task id, for the labels ("Learned by … on AW-7"). */
  taskKey: (task: string) => string | null;
}

const CODES: Record<KnowledgeError["code"], ErrorCode> = {
  conflict: "conflict",
  not_found: "not_found",
  refused: "refused",
  invalid: "invalid_input",
  ambiguous: "ambiguous",
};

/** Maps an error of the store or of the files layer to the error of the service layer. */
async function mapped<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof KnowledgeError) {
      throw new ServiceError(CODES[error.code], error.message, error.details);
    }
    if (error instanceof WriteRefusedError) {
      throw new ServiceError("refused", error.message, { rule: error.rule });
    }
    throw error;
  }
}

/**
 * The caller of a knowledge action: null for a person (the socket belongs to the person), or the
 * agent of a running session of this device (the CLI sends the session token; the session routes
 * check it). The same agent-vs-human rule as the person commands of the CLI (HUMAN_COMMANDS).
 */
export type KnowledgeCaller = {
  /** The agent actor of the session, for example `claude@macbook-pro`. */
  agent: string;
  session: string;
  /** The task id of the session. */
  task: string;
  /**
   * The project of the session task. A session caller writes only the knowledge of this project;
   * when it is not given, each project write is refused (fix list 0-0b).
   */
  project?: string | null | undefined;
} | null;

/** The refusal of a person-only action for a session caller (principle 4). */
function personOnly(what: string, caller: NonNullable<KnowledgeCaller>): ServiceError {
  return new ServiceError(
    "refused",
    `${what} is an action of a person, and this caller is the agent session ${caller.session} (${caller.agent}). Ask the human with aw ask.`,
    { session: caller.session, agent: caller.agent },
  );
}

export interface LearnRequest {
  task: TaskView;
  title: string;
  content: string;
  shared?: boolean | undefined;
  author?: string | undefined;
  from_person?: string | undefined;
}

export class KnowledgeService {
  readonly store: FileKnowledgeStore;
  readonly #files: WorkspaceFiles;
  readonly #device: DeviceInfo;
  readonly #clock: Clock;
  readonly #log: Logger;
  #watcher: { unsubscribe(): Promise<void> } | null = null;
  /** The clock time of the next planned reconcile, or null. */
  #due: number | null = null;
  #closed = false;

  constructor(options: KnowledgeServiceOptions) {
    this.#files = options.files;
    this.#device = options.device;
    this.#clock = options.clock;
    this.#log = options.log;
    this.store = new FileKnowledgeStore({
      files: options.files,
      historyDir: join(options.stateDir, "history", options.workspace),
      clock: options.clock,
      taskKey: options.taskKey,
    });
  }

  get #human(): string {
    return `human@${this.#device.slug}`;
  }

  /** Makes the knowledge folder and finds the edits made while awd was stopped. */
  async open(): Promise<void> {
    await mkdir(this.store.folder, { recursive: true });
    await this.reconcile();
  }

  /** Subscribes the file watcher on `<root>/knowledge`. */
  async watch(): Promise<void> {
    const watcher = await import("@parcel/watcher");
    this.#watcher = await watcher.subscribe(
      this.store.folder,
      (error) => {
        if (error) this.#log.warn({ err: error }, "The knowledge watcher reported an error");
        this.#schedule(KNOWLEDGE_BATCH_MS);
      },
      { ignore: ["**/*.aw-tmp"] },
    );
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#watcher?.unsubscribe().catch(() => undefined);
    this.#watcher = null;
  }

  #schedule(delay: number): void {
    if (this.#closed) return;
    const due = this.#clock.now() + Math.max(0, delay);
    if (this.#due !== null && this.#due <= due) return;
    this.#due = due;
    void this.#clock.sleep(Math.max(0, delay)).then(() => {
      if (this.#due !== due || this.#closed) return;
      this.#due = null;
      this.reconcile().catch((error: unknown) => {
        this.#log.error({ err: error }, "The knowledge reconcile failed");
      });
    });
  }

  /**
   * The sync engine reported a remote change in `knowledge/` (a file or a log of another device):
   * reconcile after the batch wait, also when the watcher missed the change.
   */
  remoteChanged(): void {
    this.#schedule(KNOWLEDGE_BATCH_MS);
  }

  /**
   * The conflict resolver keeps `winner` for a knowledge file: the store writes it when the file
   * differs and logs a `replaced` change by `aw@<device>` from the losing version.
   */
  replaced(input: { path: string; winner: Uint8Array; loser: Uint8Array | null }) {
    return mapped(() => this.store.replace({ ...input, by: `aw@${this.#device.slug}` }));
  }

  /** Logs the direct edits and stores the sync versions; plans the next run for a waiting path. */
  async reconcile(): Promise<ReconcileResult> {
    const result = await this.store.reconcile();
    for (const change of result.changes) {
      this.#log.info({ path: change.path, kind: change.kind, change: change.id }, change.label);
    }
    if (result.next_check_at !== null) {
      this.#schedule(result.next_check_at - this.#clock.now());
    }
    return result;
  }

  list(scope: KnowledgeScope): Promise<KnowledgeFile[]> {
    return mapped(() => this.store.list(scope));
  }

  read(path: string, version?: string): Promise<KnowledgeVersion> {
    return mapped(() => this.store.read(path, version));
  }

  /**
   * An edit through awd (`aw kb write`): by the human of this device, or by the agent of a session.
   * A session caller cannot write a shared file or a rule: only a person changes those. It writes
   * only the knowledge of the project of its task (fix list 0-0b).
   */
  write(
    input: { path: string; content: string; base?: string | null },
    caller: KnowledgeCaller = null,
  ): Promise<ChangeResult> {
    if (caller) {
      const parts = parseKnowledgePath(input.path);
      if (parts && (parts.scope === "shared" || isRule(parts))) {
        throw personOnly(
          `A write to ${parts.scope === "shared" ? "shared knowledge" : "a rule"} (${input.path})`,
          caller,
        );
      }
      if (parts && parts.scope === "project" && parts.project !== caller.project) {
        throw new ServiceError(
          "refused",
          `${input.path} is knowledge of the project ${parts.project}, and the session ${caller.session} runs a task of ${caller.project ?? "no project"}. An agent writes only the knowledge of its own project: ask the human with aw ask.`,
          { session: caller.session, project: caller.project ?? null },
        );
      }
    }
    return mapped(() =>
      this.store.write({
        path: input.path,
        content: input.content,
        ...(input.base !== undefined ? { base: input.base } : {}),
        author: caller?.agent ?? this.#human,
        kind: "edit",
      }),
    );
  }

  history(path: string): Promise<HistoryEntry[]> {
    return mapped(() => this.store.history(path));
  }

  /** Undo by the human, or by the agent of a session (the approval rules apply to the agent). */
  undo(change: string, caller: KnowledgeCaller = null): Promise<ChangeResult> {
    return mapped(() => this.store.undo(change, caller?.agent ?? this.#human));
  }

  search(q: string, scope: KnowledgeScope, limit?: number): Promise<SearchHit[]> {
    return mapped(() => this.store.search(q, { scope, ...(limit ? { limit } : {}) }));
  }

  /**
   * A learned item. The author is the human of this device, or an agent of this device. For a
   * session caller, the author is always the agent of the session, and the task is its task.
   */
  learn(input: LearnRequest, caller: KnowledgeCaller = null): Promise<ChangeResult> {
    const author = this.learner(input.task, input.author, caller);
    if (!input.task.project) {
      throw new ServiceError(
        "invalid_input",
        `The task ${input.task.key ?? input.task.id} has no project`,
      );
    }
    return mapped(() =>
      this.store.learn({
        project: input.task.project!,
        task: input.task.id,
        title: input.title,
        content: input.content,
        author,
        shared: input.shared ?? false,
        from_person: input.from_person ?? null,
      }),
    );
  }

  /**
   * The author of a learning step of a task. For a session caller, the task must be the task of
   * the session, and the author is always the agent of the session. Else the author is the human of
   * this device, or an agent of this device.
   */
  learner(task: TaskView, requested: string | undefined, caller: KnowledgeCaller = null): string {
    if (caller) {
      if (task.id !== caller.task) {
        throw new ServiceError(
          "refused",
          `Session ${caller.session} runs another task, not ${task.key ?? task.id}`,
          { session_task: caller.task },
        );
      }
      if (requested !== undefined && requested !== caller.agent) {
        throw new ServiceError(
          "refused",
          `The author of a learned item of the session ${caller.session} is ${caller.agent}, not ${requested}`,
          { session: caller.session, agent: caller.agent },
        );
      }
    }
    const author = caller?.agent ?? requested ?? this.#human;
    const device = author.slice(author.indexOf("@") + 1);
    if (device !== this.#device.slug || author.startsWith("aw@")) {
      throw new ServiceError(
        "invalid_input",
        `The author must be human@${this.#device.slug} or an agent of this device (<agent>@${this.#device.slug}), not ${author}`,
        [{ path: "author", message: "not an actor of this device" }],
      );
    }
    return author;
  }

  suggestions(state: "pending" | "all" = "pending"): Promise<Suggestion[]> {
    return mapped(() => this.store.suggestions(state));
  }

  /** Only a person accepts a suggestion: a session caller is refused. */
  accept(
    ref: string,
    options: { force?: boolean; comment?: string },
    caller: KnowledgeCaller = null,
  ): Promise<ChangeResult> {
    if (caller) throw personOnly("Accept of a knowledge suggestion", caller);
    return mapped(() =>
      this.store.accept(ref, {
        by: this.#human,
        force: options.force ?? false,
        comment: options.comment ?? null,
      }),
    );
  }

  /** Only a person rejects a suggestion: a session caller is refused. */
  reject(
    ref: string,
    options: { comment?: string },
    caller: KnowledgeCaller = null,
  ): Promise<Suggestion> {
    if (caller) throw personOnly("Reject of a knowledge suggestion", caller);
    return mapped(() =>
      this.store.reject(ref, { by: this.#human, comment: options.comment ?? null }),
    );
  }

  digest(date?: string): Promise<Digest> {
    return mapped(() => this.store.digest(date));
  }

  context(
    task: TaskView,
    options: { paths?: string[] | undefined; load_limit?: number | undefined },
  ): Promise<SessionContext> {
    if (!task.project) {
      throw new ServiceError("invalid_input", `The task ${task.key ?? task.id} has no project`);
    }
    return mapped(() =>
      this.store.context(
        {
          id: task.id,
          key: task.key,
          project: task.project!,
          title: task.title ?? "",
          first_message: task.first_message ?? "",
          ...(options.paths ? { paths: options.paths } : {}),
        },
        options.load_limit ? { load_limit: options.load_limit } : {},
      ),
    );
  }

  /** The files layer of the workspace (for tests and the sync resolver). */
  get files(): WorkspaceFiles {
    return this.#files;
  }
}
