// The service of one workspace folder: the files layer, the merge engine and the index of
// shared/core, joined (design decisions 4, 5, 17 and 18). The local API and the CLI call only
// these methods (docs/engineering-rules.md 5.17).
import {
  compareOrder,
  indexPath,
  MergeEngine,
  nextFreeKey,
  openWorkspace,
  parseConflictCopy,
  readRegularFile,
  refuseLinkedFolders,
  removeStaleTempFiles,
  toTaskDocument,
  WorkspaceIndex,
  WriteRefusedError,
  type Clock,
  type EventRow,
  type GateView,
  type MergeNotice,
  type MergeUpdate,
  type PresenceView,
  type ProjectView,
  type TaskView,
  type WorkspaceFiles,
  type WorkspaceView,
  type WriteHook,
} from "@aw/core";
import {
  generatedSchemasDir,
  newId,
  type AwEvent,
  type BindingsDocument,
  type DeviceDocument,
  type DeviceRole,
  type DocumentInputOf,
  type DocumentKind,
  type EventData,
  type EventType,
  type PermissionMode,
  type ProjectDocument,
  type SessionOptions,
  type WorkIn,
} from "@aw/schema";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import PQueue from "p-queue";
import type { Logger } from "../log.ts";
import { invalid, notFound, ServiceError } from "./errors.ts";
import { KnowledgeService } from "./knowledge.ts";
import { removedCheckouts } from "./project-remove.ts";
import { rekeyDuplicates } from "./rekey.ts";

/** The days that awd keeps its own heartbeat files (docs/phase-1.md 3.1). */
export const HEARTBEAT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The wait after the first file event of a batch, on the clock module. */
export const WATCH_BATCH_MS = 100;

export interface DeviceInfo {
  slug: string;
  role: DeviceRole;
}

export interface WorkspaceServiceOptions {
  id: string;
  root: string;
  /**
   * This device. A function is read at each use: on a device without the master key, the own
   * signed device record can change the role after the open (awd keeps `config.yaml` equal to it).
   */
  device: DeviceInfo | (() => DeviceInfo);
  clock: Clock;
  /** The state folder: the index is `<stateDir>/index/<id>.sqlite`. */
  stateDir: string;
  log: Logger;
  /** Called after each refresh with a change. */
  onChange?: (change: WorkspaceChange) => void;
  /** Called after each write of the files layer: the targeted scan and the write journal. */
  onWrite?: WriteHook;
  /**
   * True when this device holds the master key: it may write device records. A function is read at
   * each write (the master key can arrive after the open: the first init).
   */
  hasMasterKey?: boolean | (() => boolean);
  /** The check of a device record (the master-key signature), for the merge. */
  verifyDeviceRecord?: (raw: unknown) => boolean;
}

export interface WorkspaceChange {
  workspace: string;
  tasks: string[];
  workspace_changed: boolean;
  documents_changed: boolean;
  full: boolean;
  notices: MergeNotice[];
}

/** A written event with the decision of the merge. */
export interface WriteResult {
  event: AwEvent;
  applied: boolean;
  reason: string | null;
}

/** An append of several events that stopped at one event: the events before it are on disk. */
export class AppendError extends Error {
  readonly written: number;
  override readonly cause: unknown;

  constructor(written: number, cause: unknown) {
    super(`${written} event(s) written, then: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "AppendError";
    this.written = written;
    this.cause = cause;
  }
}

export interface NoticeEntry extends MergeNotice {
  at: string;
}

export interface TaskFilter {
  project?: string;
  stage?: string;
  needs_you?: boolean;
  archived?: boolean;
}

export interface ThreadPage {
  task: { id: string; key: string | null; title: string | null };
  events: EventRow[];
  next: string | null;
  /** The cursor of the first event of the page when older events exist, else null (0-7). */
  prev: string | null;
}

/** The options of a thread page (design decision 10; gate-full-context decision 1). */
export interface ThreadOptions {
  after?: string | undefined;
  /** The `limit` events just before this cursor. */
  before?: string | undefined;
  /** The newest `limit` events, when no cursor is given. */
  newest?: boolean | undefined;
  /** Only the events of these types. */
  types?: readonly string[] | undefined;
  limit?: number | undefined;
  /** The offset of the first event (0 is the first), used when no cursor is given. */
  from?: number | undefined;
}

export interface GateEntry extends GateView {
  task: { id: string; key: string | null; title: string | null };
}

export interface CreateTaskInput {
  project: string;
  title: string;
  first_message: string;
  assignee?: string | null | undefined;
  parent?: string | null | undefined;
  depends_on?: string[] | undefined;
  test_server?: string | null | undefined;
  credentials?: string[] | undefined;
  links?: string[] | undefined;
  /** The session host that the person picked (add-orca-session-host). */
  session_host?: "tmux" | "orca" | undefined;
  /** The session options of a person (openspec session-options). */
  session_options?: SessionOptionsInput | undefined;
}

/** The session options of a request; a field that is left out takes its default. */
export interface SessionOptionsInput {
  permission_mode?: PermissionMode | null | undefined;
  agent_teams?: boolean | undefined;
  work_in?: WorkIn | undefined;
  folder?: string | null | undefined;
  switch_branch?: boolean | undefined;
}

/**
 * The full `session_options` of an event from a request: the defaults for the missing fields, and
 * the check that a folder comes only with `work_in: folder` (openspec session-options).
 */
export function sessionOptionsOf(input: SessionOptionsInput): SessionOptions {
  const workIn = input.work_in ?? (input.folder ? "folder" : "worktree");
  const folder = input.folder ?? null;
  if (workIn === "folder" && folder === null) {
    throw invalid("Give the absolute folder of the session with work_in folder", [
      { path: "session_options.folder", message: "required" },
    ]);
  }
  if (workIn !== "folder" && folder !== null) {
    throw invalid("A folder needs work_in folder", [
      { path: "session_options.work_in", message: "folder" },
    ]);
  }
  return {
    permission_mode: input.permission_mode ?? null,
    agent_teams: input.agent_teams ?? false,
    work_in: workIn,
    folder,
    switch_branch: input.switch_branch ?? true,
  };
}

export interface AddProjectInput {
  slug: string;
  name?: string | undefined;
  devices?: string[] | undefined;
  default_agent?: string | undefined;
  test_servers?: string[] | undefined;
  links?: string[] | undefined;
  /** Not set: `new_project_permission_mode` of the workspace (openspec permissions-default). */
  permission_mode?: PermissionMode | undefined;
}

/**
 * The `permission_mode` of a new project: the mode of the request, else the workspace default, else
 * `skip`, the product default (openspec permissions-default, polish-skip-default).
 */
export function newProjectMode(
  requested: PermissionMode | undefined,
  workspace: { new_project_permission_mode?: PermissionMode | undefined } | null | undefined,
): PermissionMode {
  return requested ?? workspace?.new_project_permission_mode ?? "skip";
}

/** The date of a heartbeat file name, or null. */
export function heartbeatDate(path: string): string | null {
  return /\/heartbeat\/(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(path)?.[1] ?? null;
}

/** True when a heartbeat file of this date is older than the retention at the time `now`. */
export function isExpiredHeartbeat(date: string, now: number): boolean {
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  return Date.parse(date) < today - HEARTBEAT_RETENTION_DAYS * DAY_MS;
}

const THREAD_CURSOR = /^(.+)~([a-z0-9-]+)~([0-9a-f-]{36})$/;

/** The cursor of a thread row: `<hlc>~<dev>~<id>`. */
export function threadCursor(row: Pick<EventRow, "hlc" | "dev" | "id">): string {
  return `${row.hlc}~${row.dev}~${row.id}`;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function taskRef(task: TaskView) {
  return { id: task.id, key: task.key, title: task.title };
}

export class WorkspaceService {
  readonly id: string;
  readonly root: string;
  readonly #device: () => DeviceInfo;
  readonly #clock: Clock;
  readonly #stateDir: string;
  readonly #log: Logger;
  readonly #onChange: ((change: WorkspaceChange) => void) | undefined;
  readonly #onWrite: WriteHook | undefined;
  readonly #hasMasterKey: boolean | (() => boolean);
  readonly #verifyDeviceRecord: ((raw: unknown) => boolean) | undefined;
  /** Writes and refreshes run one at a time (design decision 5). */
  readonly #queue = new PQueue({ concurrency: 1 });
  #index: WorkspaceIndex | null = null;
  #engine: MergeEngine | null = null;
  #files: WorkspaceFiles | null = null;
  /** The secrets of the redaction by source; kept, so an open gives them to the new layers. */
  readonly #secrets = new Map<string, { name: string; value: string }[]>();
  #knowledge: KnowledgeService | null = null;
  #notices: NoticeEntry[] = [];
  #watcher: { unsubscribe(): Promise<void> } | null = null;
  #batchPending = false;
  /** True while awd writes the rekeys of a merge: the merge after them writes none. */
  #rekeying = false;
  #closed = false;
  #lastError: string | null = null;
  /** The JSON of the last snapshot that this process wrote or read, per task. */
  #snapshots = new Map<string, string>();

  /** This device now (slug and role): the sessions, the logs and the credentials read it. */
  /** The clock of this service (the ids of the inbox events). */
  get clock(): Clock {
    return this.#clock;
  }

  get device(): DeviceInfo {
    return this.#device();
  }

  /** The logger of this workspace. */
  get log(): Logger {
    return this.#log;
  }

  constructor(options: WorkspaceServiceOptions) {
    this.id = options.id;
    this.root = options.root;
    const device = options.device;
    this.#device = typeof device === "function" ? device : () => device;
    this.#clock = options.clock;
    this.#stateDir = options.stateDir;
    this.#log = options.log.child({ workspace: options.id });
    this.#onChange = options.onChange;
    this.#onWrite = options.onWrite;
    this.#hasMasterKey = options.hasMasterKey ?? false;
    this.#verifyDeviceRecord = options.verifyDeviceRecord;
  }

  get ready(): boolean {
    return this.#index !== null && this.#engine?.view !== null;
  }

  get lastError(): string | null {
    return this.#lastError;
  }

  get notices(): readonly NoticeEntry[] {
    return this.#notices;
  }

  get view(): WorkspaceView {
    const view = this.#engine?.view;
    if (!view) throw new ServiceError("not_ready", `Workspace ${this.id} is not open yet`);
    return view;
  }

  get name(): string | null {
    return this.#engine?.view?.workspace?.name ?? null;
  }

  /** The presence of the devices (heartbeats), or null before the first merge. */
  get presence(): PresenceView | null {
    return this.#engine?.presence ?? null;
  }

  get index(): WorkspaceIndex {
    if (!this.#index) throw new ServiceError("not_ready", `Workspace ${this.id} is not open yet`);
    return this.#index;
  }

  get files(): WorkspaceFiles {
    if (!this.#files) throw new ServiceError("not_ready", `Workspace ${this.id} is not open yet`);
    return this.#files;
  }

  /** True after open() made the knowledge service. */
  get hasKnowledge(): boolean {
    return this.#knowledge !== null;
  }

  /** The knowledge store of the workspace (add-knowledge-store). */
  get knowledge(): KnowledgeService {
    if (!this.#knowledge) {
      throw new ServiceError("not_ready", `Workspace ${this.id} is not open yet`);
    }
    return this.#knowledge;
  }

  /**
   * The files-layer operations of the conflict resolver. Each write runs in the write queue (one
   * write or refresh at a time, design decision 5) and a refresh follows it, so a resolver write
   * never runs at the same time as an API write of the same file.
   */
  get conflictFiles(): Pick<
    WorkspaceFiles,
    "root" | "info" | "resolveConflictCopy" | "mergeLogCopy"
  > {
    const files = this.files;
    const afterWrite = async (copy: string) => {
      try {
        await this.#refreshNow();
      } catch (error) {
        // The write is on disk; the next batch merges it.
        this.#log.warn({ err: error, copy }, "The merge after a conflict copy write failed");
      }
    };
    return {
      root: files.root,
      info: (path) => files.info(path),
      resolveConflictCopy: (copy, keep) =>
        this.#queue.add(async () => {
          const knowledge = await this.#replaceKnowledge(copy, keep);
          // A knowledge file has the winner now: the files layer only removes the copy.
          const lost = await files.resolveConflictCopy(copy, knowledge ? "original" : keep);
          await afterWrite(copy);
          return knowledge ? knowledge.lost : lost;
        }),
      mergeLogCopy: (copy) =>
        this.#queue.add(async () => {
          const added = await files.mergeLogCopy(copy);
          await afterWrite(copy);
          return added;
        }),
    };
  }

  /**
   * A conflict copy of a knowledge file: the knowledge store writes the winner and logs a
   * `replaced` change, so each device explains the new version and Undo gives the losing one back
   * (docs/architecture.md 4.3.2). Returns the losing bytes, or null for another file (and when the
   * store refuses: then the files layer alone resolves the copy, as before).
   */
  async #replaceKnowledge(
    copy: string,
    keep: "original" | "copy",
  ): Promise<{ lost: Uint8Array | null } | null> {
    const parsed = parseConflictCopy(copy);
    const knowledge = this.#knowledge;
    if (!parsed || !knowledge) return null;
    let rule: string;
    try {
      rule = this.files.info(parsed.original).rule;
    } catch {
      return null;
    }
    if (rule !== "knowledge-file") return null;
    // Never through a synced link (final check fc1-2, review M2): a link reads as no file.
    const bytes = async (path: string) => {
      await refuseLinkedFolders(this.root, path);
      return readRegularFile(join(this.root, ...path.split("/"))).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
    };
    const [copyBytes, originalBytes] = [await bytes(parsed.copy), await bytes(parsed.original)];
    const [winner, loser] =
      keep === "copy" ? [copyBytes, originalBytes] : [originalBytes, copyBytes];
    if (winner === null) return null;
    try {
      await knowledge.replaced({
        path: parsed.original.slice("knowledge/".length),
        winner,
        loser,
      });
    } catch (error) {
      this.#log.warn({ err: error, copy }, "The knowledge store did not log the replaced change");
      return null;
    }
    return { lost: loser };
  }

  /** Opens the workspace: steps 1 to 4 of design decision 4. */
  async open(): Promise<void> {
    await removeStaleTempFiles(this.root);
    this.#index = new WorkspaceIndex(indexPath(this.#stateDir, this.id));
    const engine = new MergeEngine({
      root: this.root,
      clock: this.#clock,
      lastValid: this.#index.documents(),
      ...(this.#verifyDeviceRecord ? { verifyDeviceRecord: this.#verifyDeviceRecord } : {}),
    });
    this.#engine = engine;
    this.#files = openWorkspace({
      root: this.root,
      device: this.device.slug,
      role: this.device.role,
      hasMasterKey: this.#hasMasterKey,
      clock: this.#clock,
      taskOwner: (task) => engine.taskOwner(task),
      ...(this.#onWrite ? { onWrite: this.#onWrite } : {}),
    });
    this.#applySecrets();
    await this.#queue.add(async () => {
      // The refresh gives the merged HLC to the clock of the files layer (see #refreshNow).
      await this.#refreshNow();
      await this.#ensureOwnFiles();
    });
    const knowledge = new KnowledgeService({
      workspace: this.id,
      files: this.#files,
      device: this.device,
      clock: this.#clock,
      stateDir: this.#stateDir,
      log: this.#log,
      taskKey: (task) => this.#index?.find<TaskView>("tasks", { id: task })[0]?.key ?? null,
    });
    await knowledge.open();
    this.#knowledge = knowledge;
    this.#applySecrets();
  }

  /** Copies the schema files and writes the bindings of this device when they are missing. */
  async #ensureOwnFiles(): Promise<void> {
    await copySchemaFiles(this.files, this.root);
    const bindings = `tasks/devices/${this.device.slug}/bindings.yaml`;
    const exists = await readFile(join(this.root, ...bindings.split("/")), "utf8").then(
      () => true,
      () => false,
    );
    if (!exists) {
      await this.files.writeDocument(bindings, {
        kind: "bindings",
        schema: 1,
        device: this.device.slug,
        may_run: this.device.role !== "mobile",
      });
    }
  }

  /** Subscribes the file watcher on `<root>/tasks` (design decision 4.5). */
  async watch(): Promise<void> {
    const watcher = await import("@parcel/watcher");
    this.#watcher = await watcher.subscribe(
      join(this.root, "tasks"),
      (error) => {
        if (error) {
          this.#log.warn({ err: error }, "The file watcher reported an error");
        }
        this.#scheduleBatch();
      },
      { ignore: ["**/*.aw-tmp"] },
    );
    await this.#knowledge?.watch();
  }

  #scheduleBatch(): void {
    if (this.#batchPending || this.#closed) return;
    this.#batchPending = true;
    void this.#clock.sleep(WATCH_BATCH_MS).then(() => {
      this.#batchPending = false;
      if (this.#closed) return;
      this.refresh().catch((error: unknown) => {
        this.#log.error({ err: error }, "A refresh after file events failed");
      });
    });
  }

  /** Merges the new data of the files and writes the index. */
  refresh(): Promise<MergeUpdate | null> {
    return this.#queue.add(() => this.#refreshNow());
  }

  async #refreshNow(): Promise<MergeUpdate | null> {
    const update = await this.#mergeNow();
    if (update === null || this.#rekeying) return update;
    // The device of a duplicate task key writes task.rekeyed, then merges again (offline-task-keys).
    this.#rekeying = true;
    try {
      const engine = this.#engine!;
      const written = await rekeyDuplicates({
        view: update.view,
        device: this.device.slug,
        rows: (task) => engine.eventRows(task),
        write: async (item) => {
          await this.files.writeEvent(
            `tasks/${item.task}/log/${this.device.slug}.jsonl`,
            "task.rekeyed",
            { from: item.from, to: item.to },
            { task: item.task, by: `aw@${this.device.slug}` },
          );
        },
        log: this.#log,
      });
      if (written.length > 0) {
        // The view after the rekey (offline-task-keys review low 6). A failed second merge does
        // not fail the write that started this refresh: the rekey is on disk, and the next merge
        // reads it (low 5).
        try {
          return (await this.#mergeNow()) ?? update;
        } catch (error) {
          this.#log.warn({ err: error }, "The merge after a rekey failed");
        }
      }
    } finally {
      this.#rekeying = false;
    }
    return (await this.#dropRemovedCheckouts(update)) ?? update;
  }

  /**
   * Removes the checkouts of the removed projects from `bindings.yaml` of this device, then merges
   * again (openspec project-remove). Returns the new update, or null when nothing changed.
   */
  async #dropRemovedCheckouts(update: MergeUpdate): Promise<MergeUpdate | null> {
    if (update.view.removed_projects.length === 0 || this.device.role === "mobile") return null;
    const path = `tasks/devices/${this.device.slug}/bindings.yaml`;
    const entry = this.#engine?.documents().find((d) => d.path === path);
    const bindings = entry?.value as BindingsDocument | undefined;
    if (!bindings) return null;
    const drop = removedCheckouts(update.view, bindings);
    if (drop.length === 0) return null;
    try {
      const fresh = (await this.files.readDocument<"bindings">(path)).value;
      const next = {
        ...fresh,
        checkouts: fresh.checkouts.filter((c) => !drop.includes(c.project)),
      };
      await this.files.writeDocument(path, next);
      this.#log.info({ projects: drop }, "Removed the checkouts of removed projects");
      return await this.#mergeNow();
    } catch (error) {
      this.#log.warn({ err: error }, "The checkouts of removed projects were not removed");
      return null;
    }
  }

  async #mergeNow(): Promise<MergeUpdate | null> {
    const engine = this.#engine;
    const index = this.#index;
    if (!engine || !index) return null;
    let update: MergeUpdate;
    try {
      update = await engine.update();
      index.write(update, engine);
      this.#lastError = null;
      // Each new event of this device sorts after each merged event, also after an event of a
      // device whose clock runs ahead, and the HLC never goes back after a restart (merge-index
      // engine.lastHlc(), data-model handoff 1). Else a gate answer can sort before its gate.
      const last = engine.lastHlc();
      if (last !== null) this.#files?.hlc.observe(last);
    } catch (error) {
      // The next refresh reads all files again and replaces each table (merge-index 2 and 9).
      this.#lastError = (error as Error).message;
      this.#log.error({ err: error }, "The merge update or the index write failed");
      throw error;
    }
    this.#keepNotices(update.notices);
    await this.#writeSnapshots(update);
    const changed =
      update.changedTasks.length > 0 ||
      update.workspaceChanged ||
      update.documentsChanged ||
      update.full ||
      update.notices.length > 0;
    if (changed) {
      this.#onChange?.({
        workspace: this.id,
        tasks: update.changedTasks,
        workspace_changed: update.workspaceChanged,
        documents_changed: update.documentsChanged,
        full: update.full,
        notices: update.notices,
      });
    }
    return update;
  }

  /**
   * Keeps each merge notice as a Sync problem, except the removal of an expired heartbeat file:
   * that is the retention of a device (design decision 17).
   */
  #keepNotices(notices: MergeNotice[]): void {
    const now = this.#clock.now();
    for (const notice of notices) {
      const date = heartbeatDate(notice.path);
      if (notice.code === "removed" && date !== null && isExpiredHeartbeat(date, now)) {
        this.#log.debug({ notice }, "A heartbeat file was removed by its retention");
        continue;
      }
      this.#log.warn({ notice }, "Sync problem: a log file changed in a way that an append cannot");
      this.#notices.push({ ...notice, at: new Date(now).toISOString() });
    }
  }

  /** Writes `task.yaml` of each changed task that this device owns (design decision 18). */
  async #writeSnapshots(update: MergeUpdate): Promise<void> {
    const engine = this.#engine!;
    const tasks = update.full ? engine.taskIds() : update.changedTasks;
    const byId = new Map(update.view.tasks.map((task) => [task.id, task]));
    for (const id of tasks) {
      if (engine.taskOwner(id) !== this.device.slug) continue;
      const task = byId.get(id);
      const doc = task ? toTaskDocument(task) : null;
      if (!doc) continue;
      const path = `tasks/${id}/task.yaml`;
      const json = JSON.stringify(doc);
      if (this.#snapshots.get(id) === json) continue;
      if (!this.#snapshots.has(id)) {
        const old = await this.files.readDocument<"task">(path).catch(() => null);
        if (old && sameJson(old.value, doc)) {
          this.#snapshots.set(id, json);
          continue;
        }
      }
      try {
        await this.files.writeDocument(path, doc);
        this.#snapshots.set(id, json);
      } catch (error) {
        this.#log.warn({ err: error, task: id }, "The task snapshot was not written");
      }
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#knowledge?.close();
    await this.#watcher?.unsubscribe().catch(() => undefined);
    this.#watcher = null;
    await this.#queue.onIdle();
    this.#index?.close();
    this.#index = null;
  }

  // ---- Identity and credentials (openspec add-identity-and-pairing) -------------------------

  /** The device records that the merge kept (valid, highest `seq`), by slug. */
  deviceRecords(): DeviceDocument[] {
    return (this.#engine?.documents() ?? [])
      .filter((doc) => doc.kind === "device")
      .map((doc) => doc.value as DeviceDocument);
  }

  /** The events of the workspace log (`tasks/log/<device>.jsonl`) with the merge decisions. */
  workspaceEvents(): EventRow[] {
    return this.#engine?.eventRows(null) ?? [];
  }

  /**
   * Runs writes of the identity and credential services in the write queue, then merges. A
   * refused write is 403 `refused`.
   */
  write<T>(run: (files: WorkspaceFiles) => Promise<T>, label = "identity files"): Promise<T> {
    return this.#queue.add(async () => {
      let result: T;
      try {
        result = await run(this.files);
      } catch (error) {
        if (error instanceof WriteRefusedError) {
          throw new ServiceError("refused", error.message, { rule: error.rule });
        }
        throw error;
      }
      await this.#refreshAfterWrite(label, {});
      return result;
    });
  }

  /**
   * Gives the secrets of one source to the redaction of the files layer and of the knowledge
   * store: `credentials` (the credential values) or `sessions` (the session tokens, name
   * `mcp-token`). The redaction replaces the values of each source.
   */
  setSecrets(
    secrets: { name: string; value: string }[],
    source: "credentials" | "sessions" = "credentials",
  ): void {
    this.#secrets.set(source, secrets);
    this.#applySecrets();
  }

  #applySecrets(): void {
    const all = [...this.#secrets.values()].flat();
    this.#files?.setSecrets(all);
    this.#knowledge?.store.setSecrets(all);
  }

  // ---- Writes ------------------------------------------------------------------------------

  get #actor(): string {
    return `human@${this.device.slug}`;
  }

  /** Appends one event to the task log of this device, merges, and returns the decision. */
  async #writeTaskEvent<T extends EventType>(
    task: string,
    type: T,
    data: EventData<T>,
    by: string = this.#actor,
  ): Promise<WriteResult> {
    const path = `tasks/${task}/log/${this.device.slug}.jsonl`;
    let event: AwEvent;
    try {
      event = await this.files.writeEvent(path, type, data, { task, by });
    } catch (error) {
      if (error instanceof WriteRefusedError) {
        throw new ServiceError("refused", error.message, { rule: error.rule });
      }
      throw error;
    }
    await this.#refreshAfterWrite(path, { event: event.id, type: event.type });
    const row = this.#engine!.eventRows(task).find((r) => r.id === event.id);
    return { event, applied: row?.applied ?? false, reason: row?.reason ?? null };
  }

  /**
   * Merges after a write that is on disk. When the merge or the index write fails, the reply says
   * that the write is saved (`written_not_merged`), so a client does not write it again. The next
   * batch merges it.
   */
  async #refreshAfterWrite(path: string, written: Record<string, string>): Promise<void> {
    try {
      await this.#refreshNow();
    } catch (error) {
      throw new ServiceError(
        "written_not_merged",
        `awd wrote ${path}, but the merge after it failed: ${(error as Error).message}. Do not write it again: awd merges it at the next batch.`,
        { path, ...written },
      );
    }
  }

  addProject(input: AddProjectInput): Promise<ProjectView> {
    return this.#queue.add(async () => {
      if (this.view.projects.some((p) => p.slug === input.slug)) {
        throw new ServiceError("conflict", `The project ${input.slug} exists`);
      }
      // A slug of a removed project is free (openspec project-remove): the new file sorts after each
      // removal of the slug, so its old tasks stay removed.
      for (const removal of this.view.removed_projects) {
        if (removal.slug === input.slug) this.files.hlc.observe(removal.removed.hlc);
      }
      const doc: ProjectDocument = {
        kind: "project",
        schema: 1,
        slug: input.slug,
        name: input.name ?? input.slug,
        devices: input.devices ?? [this.device.slug],
        default_agent: input.default_agent ?? "claude",
        test_servers: input.test_servers ?? [],
        links: input.links ?? [],
        main_repo: null,
        switches: { assign_new_subtasks_to_default_device: false },
        archived: false,
        permission_mode: newProjectMode(input.permission_mode, this.view.workspace),
        added_at: this.files.hlc.now(),
      };
      const path = `tasks/projects/${input.slug}/project.yaml`;
      await this.files.writeDocument(path, doc);
      await this.#refreshAfterWrite(path, { project: input.slug });
      return this.view.projects.find((p) => p.slug === input.slug)!;
    });
  }

  /**
   * Creates a task. `by` is the person of this device, or the agent of a session for a subtask
   * (add-task-loop): the merge then accepts its assignee only with the project switch on.
   */
  createTask(
    input: CreateTaskInput,
    by: string = this.#actor,
  ): Promise<WriteResult & { task: TaskView }> {
    return this.#queue.add(async () => {
      const view = this.view;
      const project = view.projects.find((p) => p.slug === input.project);
      if (!project) {
        throw invalid(
          `The project ${input.project} does not exist. Add it with "aw project add".`,
          [{ path: "project", message: "unknown project" }],
        );
      }
      if (project.archived) {
        throw invalid(
          `The project ${input.project} is archived. Unarchive it with "aw project unarchive ${input.project}".`,
          [{ path: "project", message: "archived project" }],
        );
      }
      const prefix = view.workspace?.key_prefix;
      if (!prefix) throw new ServiceError("not_ready", "The workspace has no valid workspace.yaml");
      const parent = input.parent ? this.#resolveTask(input.parent).id : null;
      const dependsOn = (input.depends_on ?? []).map((ref) => this.#resolveTask(ref).id);
      const id = newId(this.#clock);
      const result = await this.#writeTaskEvent(
        id,
        "task.created",
        {
          key: nextFreeKey(view, prefix),
          project: input.project,
          title: input.title,
          first_message: input.first_message,
          assignee: input.assignee ?? null,
          parent,
          depends_on: dependsOn,
          test_server: input.test_server ?? null,
          credentials: input.credentials ?? [],
          links: input.links ?? [],
          ...(input.session_host ? { session_host: input.session_host } : {}),
          ...(input.session_options
            ? { session_options: sessionOptionsOf(input.session_options) }
            : {}),
        },
        by,
      );
      return { ...result, task: this.#task(id) };
    });
  }

  editTask(
    ref: string,
    fields: {
      title?: string | undefined;
      first_message?: string | undefined;
      priority?: string | undefined;
    },
  ): Promise<{ results: WriteResult[]; task: TaskView }> {
    return this.#queue.add(async () => {
      const task = this.#resolveTask(ref);
      const results: WriteResult[] = [];
      for (const field of ["title", "first_message", "priority"] as const) {
        const value = fields[field];
        if (value === undefined) continue;
        results.push(await this.#writeTaskEvent(task.id, "task.edited", { field, value }));
      }
      if (results.length === 0) {
        throw invalid("Give at least one field: title, first_message or priority");
      }
      return { results, task: this.#task(task.id) };
    });
  }

  assignTask(
    ref: string,
    assignee: string,
    sessionHost?: "tmux" | "orca",
    sessionOptions?: SessionOptionsInput,
  ): Promise<WriteResult & { task: TaskView }> {
    return this.#queue.add(async () => {
      const task = this.#resolveTask(ref);
      const result = await this.#writeTaskEvent(task.id, "task.assigned", {
        assignee,
        ...(sessionHost ? { session_host: sessionHost } : {}),
        ...(sessionOptions ? { session_options: sessionOptionsOf(sessionOptions) } : {}),
      });
      return { ...result, task: this.#task(task.id) };
    });
  }

  /**
   * Writes `message.sent` for the running session of the task (docs/workflow.md 4.3). The session
   * device delivers it as the next input. A task with no running session gives `conflict`.
   */
  sendMessage(ref: string, text: string): Promise<WriteResult & { task: TaskView }> {
    return this.#queue.add(async () => {
      const task = this.#resolveTask(ref);
      const session = task.session;
      if (session?.state !== "running") {
        throw new ServiceError(
          "conflict",
          `No session runs for ${task.key ?? task.id}. Assign the task to start a session.`,
          { task: task.id },
        );
      }
      const result = await this.#writeTaskEvent(task.id, "message.sent", {
        id: newId(this.#clock),
        text,
        to_session: session.session,
      });
      return { ...result, task: this.#task(task.id) };
    });
  }

  /**
   * Asks the session device to stop the running session of the task: the person event
   * `session.stop_requested {session}` (openspec task-actions). The session device stops it with
   * the reason `stopped`, also when it is this device. AW starts no new session until a person
   * starts one.
   */
  stopTaskSession(ref: string): Promise<WriteResult & { task: TaskView }> {
    return this.#queue.add(async () => {
      const task = this.#resolveTask(ref);
      const session = task.session;
      if (session?.state !== "running") {
        throw new ServiceError("conflict", `No session runs for ${task.key ?? task.id}.`, {
          task: task.id,
        });
      }
      const result = await this.#writeTaskEvent(task.id, "session.stop_requested", {
        session: session.session,
      });
      return { ...result, task: this.#task(task.id) };
    });
  }

  /**
   * Archives the task (`task.archived`). A running session needs `stop`: then the stop request goes
   * first, and the session device stops the session (openspec task-actions).
   */
  archiveTask(
    ref: string,
    options: { stop?: boolean | undefined } = {},
  ): Promise<WriteResult & { task: TaskView }> {
    return this.#queue.add(async () => {
      const task = this.#resolveTask(ref);
      const label = task.key ?? task.id;
      if (task.archived) {
        throw new ServiceError("conflict", `The task ${label} is already archived.`, {
          task: task.id,
        });
      }
      const session = task.session;
      if (session?.state === "running") {
        if (options.stop !== true) {
          throw new ServiceError(
            "conflict",
            `A session runs for ${label} on ${session.device}. Stop it first, or archive with --stop: "aw task archive ${label} --stop".`,
            { task: task.id, session: session.session, device: session.device },
          );
        }
        await this.#writeTaskEvent(task.id, "session.stop_requested", {
          session: session.session,
        });
      }
      const result = await this.#writeTaskEvent(task.id, "task.archived", {});
      return { ...result, task: this.#task(task.id) };
    });
  }

  /** Makes an archived task active again (`task.unarchived`, openspec task-actions). */
  unarchiveTask(ref: string): Promise<WriteResult & { task: TaskView }> {
    return this.#queue.add(async () => {
      const task = this.#resolveTask(ref);
      if (!task.archived) {
        throw new ServiceError("conflict", `The task ${task.key ?? task.id} is not archived.`, {
          task: task.id,
        });
      }
      const result = await this.#writeTaskEvent(task.id, "task.unarchived", {});
      return { ...result, task: this.#task(task.id) };
    });
  }

  answerGate(
    ref: string,
    input: { answer: string; comment?: string | null | undefined; version?: number | undefined },
  ): Promise<WriteResult & { gate: GateEntry }> {
    return this.#queue.add(async () => {
      const found = this.#resolveGate(ref);
      if (found.state !== "open") {
        throw new ServiceError(
          "gate_not_open",
          `The gate ${found.gate} is resolved with the answer ${JSON.stringify(found.answer)}`,
          // answer_event null: AW closed the gate, no person answered it (openspec stale-gates).
          { gate: found.gate, answer: found.answer, answer_event: found.answer_event },
        );
      }
      const result = await this.#writeTaskEvent(found.task.id, "gate.answered", {
        gate: found.gate,
        version: input.version ?? found.version,
        answer: input.answer,
        comment: input.comment ?? null,
      });
      return { ...result, gate: this.#gate(found.task.id, found.gate) };
    });
  }

  /** Writes `task.learned` by `by` to the task log of this device (agent-learning, learning.ts). */
  writeLearned(task: string, data: EventData<"task.learned">, by: string): Promise<WriteResult> {
    return this.#queue.add(() => this.#writeTaskEvent(task, "task.learned", data, by));
  }

  // ---- Session events (add-claude-sessions-tmux) -------------------------------------------

  /**
   * Builds an event of this device with its id and HLC now, for the session log buffer. The
   * session manager writes it later with `appendTaskEvents`.
   */
  newTaskEvent<T extends EventType>(task: string, type: T, data: EventData<T>, by: string) {
    return this.files.newEvent(type, data, { task, by });
  }

  /**
   * Appends events of one task to the log of this device in one queue step, then merges. When an
   * event fails, the events before it are on disk: the error is an AppendError with their count.
   */
  appendTaskEvents(task: string, events: unknown[]): Promise<WriteResult[]> {
    return this.#queue.add(async () => {
      const path = `tasks/${task}/log/${this.device.slug}.jsonl`;
      const written: AwEvent[] = [];
      let failure: unknown = null;
      for (const event of events) {
        try {
          written.push(await this.files.appendEvent(path, event));
        } catch (error) {
          failure =
            error instanceof WriteRefusedError
              ? new ServiceError("refused", error.message, { rule: error.rule })
              : error;
          break;
        }
      }
      if (written.length > 0) {
        try {
          await this.#refreshAfterWrite(path, {
            event: written[0]!.id,
            type: written[0]!.type,
          });
        } catch (error) {
          if (failure === null) throw error;
        }
      }
      if (failure !== null) throw new AppendError(written.length, failure);
      const rows = new Map(this.#engine!.eventRows(task).map((row) => [row.id, row]));
      return written.map((event) => ({
        event,
        applied: rows.get(event.id)?.applied ?? false,
        reason: rows.get(event.id)?.reason ?? null,
      }));
    });
  }

  /** Writes a document of this device (for example its bindings), then merges. */
  writeOwnDocument<K extends DocumentKind>(path: string, doc: DocumentInputOf[K]): Promise<void> {
    return this.#queue.add(async () => {
      await this.files.writeDocument(path, doc);
      await this.#refreshAfterWrite(path, { path });
    });
  }

  /**
   * Writes a file of a task folder (an approach version, an artifact) as this device. A text file is
   * redacted (docs/phase-1.md 3.3.5); returns the written content.
   */
  writeTaskFile(path: string, content: string | Uint8Array): Promise<string | Uint8Array> {
    return this.#queue.add(() => this.files.writeFile(path, content));
  }

  /** Appends a heartbeat to the file of the UTC date (design decision 17). */
  heartbeat(bootTime: string): Promise<AwEvent> {
    return this.#queue.add(async () => {
      const date = new Date(this.#clock.now()).toISOString().slice(0, 10);
      return this.files.writeEvent(
        `tasks/devices/${this.device.slug}/heartbeat/${date}.jsonl`,
        "device.heartbeat",
        { boot_time: bootTime },
        { by: `aw@${this.device.slug}` },
      );
    });
  }

  /** Removes the heartbeat files of this device older than the retention. Returns their paths. */
  removeExpiredHeartbeats(): Promise<string[]> {
    return this.#queue.add(async () => {
      const folder = `tasks/devices/${this.device.slug}/heartbeat`;
      let names: string[];
      try {
        names = await readdir(join(this.root, ...folder.split("/")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const now = this.#clock.now();
      const removed: string[] = [];
      for (const name of names.sort()) {
        const path = `${folder}/${name}`;
        const date = heartbeatDate(path);
        if (date === null || !isExpiredHeartbeat(date, now)) continue;
        await this.files.removeHeartbeatLog(path);
        removed.push(path);
      }
      return removed;
    });
  }

  // ---- Reads -------------------------------------------------------------------------------

  #task(id: string): TaskView {
    const [task] = this.index.find<TaskView>("tasks", { id });
    if (!task) throw notFound(`Task ${id}`);
    return task;
  }

  /** Finds a task by its id, its key (any letter case) or a unique id prefix of 8+ characters. */
  #resolveTask(ref: string): TaskView {
    const value = ref.trim();
    const byId = this.index.find<TaskView>("tasks", { id: value.toLowerCase() });
    if (byId.length === 1) return byId[0]!;
    const byKey = this.index.find<TaskView>("tasks", { key: value.toUpperCase() });
    if (byKey.length === 1) return byKey[0]!;
    if (byKey.length > 1) {
      throw new ServiceError(
        "ambiguous",
        `${byKey.length} tasks have the key ${value.toUpperCase()}`,
        {
          ids: byKey.map((task) => task.id),
        },
      );
    }
    if (/^[0-9a-f-]{8,}$/i.test(value)) {
      const prefix = value.toLowerCase();
      const matches = this.index.find<TaskView>("tasks").filter((t) => t.id.startsWith(prefix));
      if (matches.length === 1) return matches[0]!;
      if (matches.length > 1) {
        throw new ServiceError("ambiguous", `${matches.length} task ids start with ${prefix}`, {
          ids: matches.map((task) => task.id),
        });
      }
    }
    throw notFound(`Task ${value}`);
  }

  /**
   * A task of the view, or else a task of a removed project (openspec project-remove), for the
   * reads only: `task show`, the thread and the ancestry. A write to a removed task gives 404.
   */
  #resolveReadable(ref: string): TaskView {
    try {
      return this.#resolveTask(ref);
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "not_found") throw error;
      const value = ref.trim();
      const removed = this.view.removed_tasks;
      const id = removed.find((t) => t.id === value.toLowerCase());
      if (id) return id;
      const byKey = removed.filter((t) => t.key === value.toUpperCase());
      if (byKey.length === 1) return byKey[0]!;
      if (/^[0-9a-f-]{8,}$/i.test(value)) {
        const prefix = value.toLowerCase();
        const matches = removed.filter((t) => t.id.startsWith(prefix));
        if (matches.length === 1) return matches[0]!;
      }
      throw error;
    }
  }

  #gate(task: string, gate: string): GateEntry {
    const view = this.#task(task);
    const found = view.gates.find((g) => g.gate === gate);
    if (!found) throw notFound(`Gate ${gate}`);
    return { ...found, task: taskRef(view) };
  }

  #resolveGate(ref: string): GateEntry {
    const value = ref.trim().toLowerCase();
    if (!/^[0-9a-f-]{8,}$/.test(value)) {
      throw invalid(`${ref} is not a gate id. Give the id or its first 8 or more characters.`);
    }
    const matches = this.gates({ state: "all" }).filter((g) => g.gate.startsWith(value));
    const exact = matches.filter((g) => g.gate === value);
    if (exact.length === 1) return exact[0]!;
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new ServiceError("ambiguous", `${matches.length} gate ids start with ${value}`, {
        ids: matches.map((g) => g.gate),
      });
    }
    throw notFound(`Gate ${ref}`);
  }

  /** A task of the view or of a removed project (a read: openspec project-remove). */
  showTask(ref: string): TaskView {
    return this.#resolveReadable(ref);
  }

  /** A task of the view: a write gives 404 for a task of a removed project. */
  liveTask(ref: string): TaskView {
    return this.#resolveTask(ref);
  }

  listTasks(filter: TaskFilter = {}): TaskView[] {
    const query: Record<string, unknown> = {};
    if (filter.project !== undefined) query.project = filter.project;
    if (filter.stage !== undefined) query.stage = filter.stage;
    if (filter.needs_you !== undefined) query.needs_you_lane = filter.needs_you;
    if (filter.archived !== undefined) query.archived = filter.archived;
    return this.index.find<TaskView>("tasks", query).sort((a, b) => {
      const x = a.created;
      const y = b.created;
      if (!x || !y) return a.id < b.id ? -1 : 1;
      return compareOrder(
        { hlc: x.hlc, dev: x.dev, id: x.event },
        { hlc: y.hlc, dev: y.dev, id: y.event },
      );
    });
  }

  listProjects(): ProjectView[] {
    return this.index.find<ProjectView>("projects", {}, { sort: { slug: 1 } });
  }

  gates(
    filter: { task?: string | undefined; state?: "open" | "resolved" | "all" | undefined } = {},
  ): GateEntry[] {
    const tasks = filter.task ? [this.#resolveTask(filter.task)] : this.listTasks();
    const state = filter.state ?? "open";
    const result: GateEntry[] = [];
    for (const task of tasks) {
      for (const gate of task.gates) {
        if (state !== "all" && gate.state !== state) continue;
        result.push({ ...gate, task: taskRef(task) });
      }
    }
    return result;
  }

  /**
   * The events of a task in merge order, after the cursor (design decision 10): or the page before
   * a cursor, or the newest page (gate-full-context decision 1). Each page is oldest first.
   */
  thread(ref: string, options: ThreadOptions = {}): ThreadPage {
    const task = this.#resolveReadable(ref);
    const limit = options.limit ?? 200;
    const types = options.types && options.types.length > 0 ? new Set(options.types) : null;
    const rows = this.index
      .find<EventRow>("events", { task: task.id })
      .filter((row) => types === null || types.has(row.type))
      .sort((a, b) => compareOrder(a, b));
    const place = (cursor: string) => {
      const match = THREAD_CURSOR.exec(cursor);
      if (!match) throw invalid(`The cursor ${cursor} is not <hlc>~<device>~<id>`);
      return { hlc: match[1]!, dev: match[2]!, id: match[3]! };
    };
    let start = Math.max(0, options.from ?? 0);
    let end: number | null = null;
    if (options.after) {
      const key = place(options.after);
      start = rows.findIndex((row) => compareOrder(row, key) > 0);
      if (start < 0) start = rows.length;
    } else if (options.before) {
      const key = place(options.before);
      const at = rows.findIndex((row) => compareOrder(row, key) >= 0);
      end = at < 0 ? rows.length : at;
      start = Math.max(0, end - limit);
    } else if (options.newest) {
      start = Math.max(0, rows.length - limit);
    }
    const stop = Math.min(end ?? rows.length, start + limit);
    const events = rows.slice(start, stop);
    const more = stop < rows.length;
    return {
      task: taskRef(task),
      events,
      next: more && events.length > 0 ? threadCursor(events[events.length - 1]!) : null,
      prev: start > 0 && events.length > 0 ? threadCursor(events[0]!) : null,
    };
  }

  /** The task and its parents, from the oldest parent to the task. */
  ancestry(ref: string): TaskView[] {
    const chain: TaskView[] = [];
    let current: TaskView | undefined = this.#resolveReadable(ref);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.unshift(current);
      current = current.parent
        ? this.index.find<TaskView>("tasks", { id: current.parent })[0]
        : undefined;
    }
    return chain;
  }

  issues() {
    return this.view.issues;
  }

  /**
   * The presence of the devices for the presence route (add-desktop-devices-knowledge): the
   * `presence` getter of the work loop, and `not_ready` before the first merge.
   */
  presenceView(): PresenceView {
    const presence = this.presence;
    if (!presence) throw new ServiceError("not_ready", `Workspace ${this.id} is not open yet`);
    return presence;
  }

  /** The last valid bindings of each device, sorted by path (the session hosts of the desktop). */
  bindings(): BindingsDocument[] {
    return (this.#engine?.documents() ?? [])
      .filter((d) => d.kind === "bindings")
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((d) => d.value as BindingsDocument);
  }

  /** The last valid value that the merge kept for a document, or null (add-desktop-devices-knowledge). */
  lastValidDocument(path: string): { kind: string; value: unknown } | null {
    const doc = (this.#engine?.documents() ?? []).find((d) => d.path === path);
    return doc ? { kind: doc.kind, value: doc.value } : null;
  }

  summary() {
    const view = this.#engine?.view ?? null;
    return {
      id: this.id,
      name: view?.workspace?.name ?? null,
      path: this.root,
      ready: this.ready,
      error: this.#lastError,
      tasks: view?.tasks.filter((t) => !t.archived).length ?? 0,
      open_gates:
        view?.tasks.reduce((n, t) => n + t.gates.filter((g) => g.state === "open").length, 0) ?? 0,
      issues: view?.issues.length ?? 0,
      notices: [...this.#notices],
      last_hlc: view?.last_hlc ?? null,
      new_project_permission_mode: view?.workspace?.new_project_permission_mode ?? null,
    };
  }
}

/**
 * Copies each generated JSON Schema to `tasks/schemas/` when it is missing. The file name has the
 * schema version (`event.v1.schema.json`), so a new version is a new file. awd never replaces a
 * file that is there: 2 synced devices with different AW versions would write a shared file back
 * and forth at each start, and that can make sync conflict copies.
 */
export async function copySchemaFiles(files: WorkspaceFiles, root: string): Promise<string[]> {
  const copied: string[] = [];
  for (const name of (await readdir(generatedSchemasDir))
    .filter((n) => n.endsWith(".schema.json"))
    .sort()) {
    const target = `tasks/schemas/${name}`;
    const exists = await stat(join(root, "tasks", "schemas", name)).then(
      () => true,
      () => false,
    );
    if (exists) continue;
    const text = await readFile(join(generatedSchemasDir, name), "utf8");
    await files.writeFile(target, text);
    copied.push(target);
  }
  return copied;
}
