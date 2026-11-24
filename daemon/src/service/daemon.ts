// The awd service of one computer: the workspaces of `config.yaml`, the heartbeat loop and the
// event bus of the local API (docs/architecture.md 3.2, 3.3).
import { assigneeDevice, openWorkspace, systemClock, type Clock } from "@aw/core";
import { newId } from "@aw/schema";
import { EventEmitter } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { uptime } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import PQueue from "p-queue";
import { HEALTHY_AFTER_MS, markStarted } from "../continuity/update.ts";
import type { Logger } from "../log.ts";
import { syncCheck } from "../loop/sync-check.ts";
import { SessionService } from "../sessions/service.ts";
import type { Settings } from "../settings.ts";
import {
  loadConfig,
  prepareStateFolders,
  saveConfig,
  type AwdConfig,
  type WorkspaceEntry,
} from "../state.ts";
import { AW_VERSION } from "../version.ts";
import { CredentialService } from "./credentials.ts";
import { DeviceService } from "./devices.ts";
import { invalid, notFound, ServiceError } from "./errors.ts";
import { IdentityService } from "./identity.ts";
import { PairingService } from "./pairing.ts";
import { readBindings } from "./setup.ts";
import { SyncService } from "./sync.ts";
import {
  checkFolderSafety,
  chooseWorkspaceFolder,
  folderName,
  workspaceAt,
  type FolderContext,
} from "./workspace-folder.ts";
import { copySchemaFiles, WorkspaceService, type WorkspaceChange } from "./workspace.ts";

/** The heartbeat period (docs/phase-1.md 3.1: 1 line per 30 s). */
export const HEARTBEAT_MS = 30_000;
/** The wait before awd tries again to open a workspace that did not open (awd-service spec). */
export const OPEN_RETRY_MS = 10_000;
/** The name of the default workspace (prd WS-01): `aw workspace init` with no path. */
export const DEFAULT_WORKSPACE_NAME = "Personal";

function notOpen(id: string, error: string): ServiceError {
  return new ServiceError(
    "not_ready",
    `The workspace ${id} is registered, but it did not open: ${error}. awd tries again every ${OPEN_RETRY_MS / 1000} s.`,
    { id, error },
  );
}

export interface DaemonOptions {
  settings: Settings;
  log: Logger;
  clock?: Clock;
  /** Watch the files with `@parcel/watcher`. Default true. */
  watch?: boolean;
  /** Run the heartbeat loop. Default true. */
  heartbeat?: boolean;
  /** The boot time of the computer. Default: the clock minus the OS uptime. */
  bootTime?: string;
  /** Run the agent sessions of this device (add-claude-sessions-tmux). Default true. */
  sessions?: boolean;
  /** The wait of the permission hook. Default 120 s. */
  permissionTimeoutMs?: number;
  /** The wait before a new try of a failed session start. Default 60 s. */
  startRetryMs?: number;
  /** The wait before AW looks again for tmux and the agent. Default 60 s. */
  prepareRetryMs?: number;
  /** The wait before a session host notice on the task (a host that does not answer). Default 120 s. */
  hostNoticeMs?: number;
}

export type BusMessage =
  | ({ type: "changed" } & Omit<WorkspaceChange, "notices">)
  | { type: "notice"; workspace: string; notices: WorkspaceChange["notices"] };

interface WorkspaceSlot {
  entry: WorkspaceEntry;
  service: WorkspaceService;
  error: string | null;
  /** The open attempt that runs now: one at a time per slot. */
  opening: Promise<boolean> | null;
  retrying: boolean;
}

export interface InitWorkspaceInput {
  /** The workspace folder itself. Leave it out for a location (openspec workspace-folder). */
  path?: string | undefined;
  /**
   * The location that holds the workspace folder: `<parent>/<name>`, or `<name>-aw1` when that name
   * is in use. With no path and no parent, the location is `<user home>/AW` (gap-setup).
   */
  parent?: string | undefined;
  name?: string | undefined;
  key_prefix?: string | undefined;
}

export interface InitWorkspaceResult {
  created: boolean;
  workspace: ReturnType<WorkspaceService["summary"]>;
  /** One sentence when the folder rule skipped a taken name, else null. */
  folder_note: string | null;
}

export class Daemon {
  readonly settings: Settings;
  readonly log: Logger;
  readonly clock: Clock;
  readonly bus = new EventEmitter<{ message: [BusMessage] }>();
  readonly startedAt: number;
  readonly bootTime: string;
  /** The agent sessions, or null when they are off. */
  readonly sessions: SessionService | null;
  #config: AwdConfig | null = null;
  #sync: SyncService | null = null;
  #identity: IdentityService | null = null;
  #credentials: CredentialService | null = null;
  #devices: DeviceService | null = null;
  #pairing: PairingService | null = null;
  /** The engine start: awd does not wait for it (the engine state never changes the readiness). */
  #syncStart: Promise<void> | null = null;
  #slots = new Map<string, WorkspaceSlot>();
  #started = false;
  #stopped = false;
  readonly #watch: boolean;
  readonly #heartbeat: boolean;
  #lastRetentionDay: string | null = null;
  /** Workspace init runs one at a time, so 2 inits of one new folder make one id. */
  readonly #initQueue = new PQueue({ concurrency: 1 });

  constructor(options: DaemonOptions) {
    this.settings = options.settings;
    this.log = options.log;
    this.clock = options.clock ?? systemClock;
    this.#watch = options.watch ?? true;
    this.#heartbeat = options.heartbeat ?? true;
    this.startedAt = this.clock.now();
    const boot = Math.floor((this.clock.now() - uptime() * 1000) / 1000) * 1000;
    this.bootTime = options.bootTime ?? new Date(boot).toISOString();
    const bootTime = this.bootTime;
    this.bus.setMaxListeners(0);
    this.sessions =
      (options.sessions ?? true)
        ? new SessionService({
            settings: this.settings,
            log: this.log,
            clock: this.clock,
            ...(options.permissionTimeoutMs === undefined
              ? {}
              : { permissionTimeoutMs: options.permissionTimeoutMs }),
            ...(options.startRetryMs === undefined ? {} : { startRetryMs: options.startRetryMs }),
            ...(options.prepareRetryMs === undefined
              ? {}
              : { prepareRetryMs: options.prepareRetryMs }),
            // The ready checks wait for the knowledge and secure folders (add-task-loop).
            sync: (workspace) => syncCheck(this.#sync, workspace),
            // The credential values of a session start: the credential service (identity-pairing).
            credentials: {
              values: (workspace, names) => this.#sessionCredentials(workspace, names),
            },
            ...(options.hostNoticeMs === undefined ? {} : { hostNoticeMs: options.hostNoticeMs }),
            // The restart comment and the slot revoke after a reboot (add-continuity).
            bootTime,
          })
        : null;
  }

  get config(): AwdConfig {
    if (!this.#config) throw new ServiceError("not_ready", "awd is starting");
    return this.#config;
  }

  /** True when awd opened each workspace or recorded its error. */
  get ready(): boolean {
    return this.#started && [...this.#slots.values()].every((s) => s.service.ready || s.error);
  }

  get device() {
    return this.config.device;
  }

  /** True after `start()` made the sync service. */
  get started(): boolean {
    return this.#sync !== null;
  }

  /** Resolves when the engine start of `start()` ended: running, failed, or no engine. */
  get syncStarted(): Promise<void> {
    return this.#syncStart ?? Promise.resolve();
  }

  /** The sync service (docs/phase-1.md 6). */
  get sync(): SyncService {
    if (!this.#sync) throw new ServiceError("not_ready", "awd is starting");
    return this.#sync;
  }

  /** The identity, devices, pairing and credentials (openspec add-identity-and-pairing). */
  get identity(): IdentityService {
    if (!this.#identity) throw new ServiceError("not_ready", "awd is starting");
    return this.#identity;
  }

  get credentials(): CredentialService {
    if (!this.#credentials) throw new ServiceError("not_ready", "awd is starting");
    return this.#credentials;
  }

  get devices(): DeviceService {
    if (!this.#devices) throw new ServiceError("not_ready", "awd is starting");
    return this.#devices;
  }

  get pairing(): PairingService {
    if (!this.#pairing) throw new ServiceError("not_ready", "awd is starting");
    return this.#pairing;
  }

  /** Makes the identity services; one wiring point for add-identity-and-pairing. */
  async #startIdentity(): Promise<void> {
    const identity = new IdentityService({ settings: this.settings, log: this.log });
    await identity.load();
    const credentials = new CredentialService({ identity, log: this.log, clock: this.clock });
    const open = () =>
      [...this.#slots.values()].filter((s) => s.error === null).map((s) => s.service);
    const device = () => this.config.device;
    const devices = new DeviceService({
      identity,
      credentials,
      sync: () => this.sync,
      clock: this.clock,
      log: this.log.child({ module: "devices" }),
      device,
      workspaces: open,
      setDevice: (next) => this.#setDevice(next),
    });
    this.#pairing = new PairingService({
      identity,
      credentials,
      sync: () => this.sync,
      clock: this.clock,
      log: this.log.child({ module: "pairing" }),
      home: this.settings.home,
      userHome: this.settings.userHome,
      listen: this.settings.sync.listen,
      device,
      workspace: (selector) => this.workspace(selector),
      registered: () => this.config.workspaces.map((w) => w.id),
      folderContext: () => this.folderContext(),
      exclusive: (fn) => this.#initQueue.add(fn),
      register: async (root) => {
        await this.initWorkspace({ path: root });
      },
      setDevice: (next) => this.#setDevice(next),
      refreshPeers: (extra) => devices.refreshPeers(extra),
    });
    this.#identity = identity;
    this.#credentials = credentials;
    this.#devices = devices;
    // A change of the device records: the own record and the peers again.
    this.bus.on("message", (message) => {
      if (message.type !== "changed") return;
      const slot = this.#slots.get(message.workspace);
      if (!slot || slot.error !== null) return;
      if (message.documents_changed) void devices.reconcile(slot.service);
      // The phone outbox after each merge change, and every 10 s (devices.loop).
      void credentials.importSealed(slot.service).catch((error: unknown) => {
        this.log.warn(
          { err: error, workspace: message.workspace },
          "The phone outbox check failed",
        );
      });
    });
  }

  /** Saves the device of a pairing in `config.yaml` and gives it to the sync engine. */
  async #setDevice(next: { slug: string; name: string; role: AwdConfig["device"]["role"] }) {
    const config = this.config;
    config.device = { ...next };
    await saveConfig(this.settings, config);
    await this.#sync?.setDevice({ slug: next.slug, role: next.role });
  }

  /**
   * The credential values of a session start (add-task-loop, docs/workflow.md 4.8.5): each file of
   * `secure/credentials/` opened with the credential key of this device. A name with no value is
   * not in the map, and the session manager comments it.
   */
  async #sessionCredentials(workspace: string, names: string[]): Promise<Map<string, string>> {
    const slot = this.#slots.get(workspace);
    if (!this.#credentials || !slot || slot.error !== null || names.length === 0) return new Map();
    return this.#credentials.sessionValues(slot.service, names);
  }

  /** After an open: the own record, the credential key, the secrets and the peers. */
  async #afterOpen(service: WorkspaceService): Promise<void> {
    try {
      await this.#devices?.reconcile(service);
      await this.#credentials?.ensureKey(service);
      await this.#credentials?.refreshSecrets(service);
    } catch (error) {
      this.log.error(
        { err: error, workspace: service.id },
        "The identity step after the open failed",
      );
    }
  }

  /** Prepares the state folders, reads `config.yaml` and opens each workspace. */
  async start(): Promise<void> {
    await prepareStateFolders(this.settings);
    this.#config = await loadConfig(this.settings);
    await this.#startIdentity();
    this.log.info(
      { device: this.#config.device.slug, workspaces: this.#config.workspaces.length },
      "awd starts",
    );
    this.#sync = new SyncService({
      settings: this.settings,
      log: this.log,
      clock: this.clock,
      device: { slug: this.#config.device.slug, role: this.#config.device.role },
      community: this.communitySetting().community,
    });
    for (const entry of this.#config.workspaces) await this.#open(entry);
    // After the open: the engine shares only folders of open workspaces. awd does not wait for
    // the engine: a slow or broken engine must not keep /readyz at 503 or stop the heartbeat.
    this.#syncStart = this.#sync
      // An engine that `aw engine install` places later starts with no restart (fix list 0-23).
      .start(() => this.#devices?.reconcile() ?? Promise.resolve())
      .catch((error: unknown) => {
        this.log.error({ err: error }, "The sync engine did not start");
      })
      // The own records need the engine device id.
      .then(() => this.#devices?.reconcile());
    this.#devices?.loop();
    this.#started = true;
    if (this.#heartbeat) void this.#heartbeatLoop();
    void this.#markStarted();
  }

  #newService(entry: WorkspaceEntry): WorkspaceService {
    return new WorkspaceService({
      id: entry.id,
      root: entry.path,
      // Read at each use: the sessions and the logs of this device follow the own signed record
      // (DeviceService keeps config.yaml equal to it on a device without the master key).
      device: () => ({ slug: this.config.device.slug, role: this.config.device.role }),
      clock: this.clock,
      stateDir: this.settings.home,
      log: this.log,
      onChange: (change) => this.#publish(change),
      ...(this.#sync ? { onWrite: this.#sync.writeHook(entry.id) } : {}),
      // Read at each use: createMaster() and adopt() change the identity of open workspaces too.
      ...(this.#identity ? this.#identityOptions(this.#identity) : {}),
    });
  }

  #identityOptions(identity: IdentityService) {
    return {
      hasMasterKey: () => identity.hasMaster,
      // Before this device knows the master public key, each record that passes its schema counts
      // (an unpaired device, design decision 7).
      verifyDeviceRecord: (raw: unknown) => identity.masterPublic === null || identity.verify(raw),
    };
  }

  /** Opens a workspace. A failed open is recorded, and awd tries again every OPEN_RETRY_MS. */
  async #open(entry: WorkspaceEntry): Promise<WorkspaceSlot> {
    const slot: WorkspaceSlot = {
      entry,
      service: this.#newService(entry),
      error: null,
      opening: null,
      retrying: false,
    };
    this.#slots.set(entry.id, slot);
    if (!(await this.#tryOpen(slot, false))) this.#scheduleRetry(slot);
    return slot;
  }

  /**
   * One open attempt of a slot, with a new service after a failed attempt. It returns true when
   * the workspace is open. Two callers at the same time share one attempt.
   */
  #tryOpen(slot: WorkspaceSlot, fresh: boolean): Promise<boolean> {
    if (slot.opening) return slot.opening;
    const attempt = (async () => {
      if (fresh) slot.service = this.#newService(slot.entry);
      const service = slot.service;
      try {
        await service.open();
        if (this.#watch) await service.watch();
      } catch (error) {
        slot.error = (error as Error).message;
        this.log.error({ err: error, workspace: slot.entry.id }, "The workspace did not open");
        await service.close().catch(() => undefined);
        return false;
      }
      if (slot.error !== null) {
        this.log.info({ workspace: slot.entry.id }, "The workspace opened after a failed open");
      }
      slot.error = null;
      await this.#sync?.addWorkspace(service);
      await this.#afterOpen(service);
      await this.sessions?.attach(service).catch((error: unknown) => {
        this.log.error({ err: error, workspace: slot.entry.id }, "The sessions did not start");
      });
      if (this.#heartbeat && this.#started) {
        await this.#beat(service).catch((error: unknown) => {
          this.log.error({ err: error, workspace: slot.entry.id }, "The heartbeat failed");
        });
      }
      return true;
    })();
    slot.opening = attempt;
    return attempt.finally(() => {
      slot.opening = null;
    });
  }

  /** Tries the open again on the clock until it works, awd stops or the slot is gone. */
  #scheduleRetry(slot: WorkspaceSlot): void {
    if (slot.retrying) return;
    slot.retrying = true;
    const active = () => !this.#stopped && this.#slots.get(slot.entry.id) === slot;
    void (async () => {
      try {
        while (active() && slot.error !== null) {
          await this.clock.sleep(OPEN_RETRY_MS);
          if (!active() || slot.error === null) break;
          await this.#tryOpen(slot, true);
        }
      } finally {
        slot.retrying = false;
      }
    })();
  }

  #publish(change: WorkspaceChange): void {
    const { notices, ...rest } = change;
    this.bus.emit("message", { type: "changed", ...rest });
    this.sessions?.changed(change.workspace);
    if (notices.length > 0) {
      this.bus.emit("message", { type: "notice", workspace: change.workspace, notices });
    }
  }

  async #beat(service: WorkspaceService): Promise<void> {
    if (!service.ready) return;
    await service.heartbeat(this.bootTime);
  }

  /** One heartbeat for each workspace, and the retention once per UTC day. */
  async heartbeatOnce(): Promise<void> {
    const day = new Date(this.clock.now()).toISOString().slice(0, 10);
    const retention = this.#lastRetentionDay !== day;
    for (const slot of this.#slots.values()) {
      try {
        await this.#beat(slot.service);
        if (retention && slot.service.ready) {
          const removed = await slot.service.removeExpiredHeartbeats();
          if (removed.length > 0) this.log.info({ removed }, "Old heartbeat files removed");
        }
      } catch (error) {
        this.log.error({ err: error, workspace: slot.entry.id }, "The heartbeat failed");
      }
    }
    if (retention) this.#lastRetentionDay = day;
  }

  /**
   * The self-update launcher counts each start; a start that stays ready for 60 s is good, so the
   * count goes back to 0 (add-continuity, decision 18). Short sleeps: a stop does not wait.
   */
  async #markStarted(): Promise<void> {
    const until = this.clock.now() + HEALTHY_AFTER_MS;
    while (!this.#stopped && this.clock.now() < until) {
      await this.clock.sleep(Math.min(5000, until - this.clock.now()));
    }
    if (this.#stopped || !this.ready) return;
    await markStarted(this.settings.home).catch((error: unknown) => {
      this.log.warn({ err: error }, "The start count of the launcher was not reset");
    });
  }

  async #heartbeatLoop(): Promise<void> {
    while (!this.#stopped) {
      await this.heartbeatOnce();
      await this.clock.sleep(HEARTBEAT_MS);
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#devices?.stop();
    await this.#pairing?.stop().catch((error: unknown) => {
      this.log.error({ err: error }, "The pairing stop failed");
    });
    await this.#sync?.stop().catch((error: unknown) => {
      this.log.error({ err: error }, "The sync engine stop failed");
    });
    // A start that runs now sees the stop and stops what it started.
    await this.#syncStart;
    // The sessions keep running in tmux; only their managers stop.
    await this.sessions?.close();
    for (const slot of this.#slots.values()) await slot.service.close();
    this.#slots.clear();
    this.log.info("awd stopped");
  }

  // ---- Workspaces --------------------------------------------------------------------------

  /** Selects a workspace by id or name. With no selector, the only workspace. */
  workspace(selector?: string): WorkspaceService {
    const slot = this.#slot(selector);
    if (slot.error) {
      throw new ServiceError("not_ready", `Workspace ${slot.entry.id} did not open: ${slot.error}`);
    }
    return slot.service;
  }

  /** The slot of a workspace by id or name, also a slot that did not open. */
  #slot(selector?: string): WorkspaceSlot {
    const slots = [...this.#slots.values()];
    let slot: WorkspaceSlot | undefined;
    if (selector === undefined || selector === "") {
      if (slots.length === 0) {
        throw invalid('No workspace exists. Create one with "aw workspace init".');
      }
      if (slots.length > 1) {
        throw invalid("More than one workspace exists. Select one with --workspace <name or id>.", {
          workspaces: slots.map((s) => ({ id: s.entry.id, name: s.service.name })),
        });
      }
      slot = slots[0];
    } else {
      slot = this.#slots.get(selector);
      if (!slot) {
        const named = slots.filter((s) => s.service.name === selector);
        if (named.length > 1) {
          throw new ServiceError(
            "ambiguous",
            `${named.length} workspaces have the name ${selector}. Select one by its id.`,
            { ids: named.map((s) => s.entry.id) },
          );
        }
        slot = named[0];
      }
    }
    if (!slot) throw notFound(`Workspace ${selector}`);
    return slot;
  }

  workspaces() {
    return [...this.#slots.values()].map((slot) => {
      const summary = slot.service.summary();
      // During a new open attempt the service can be ready before the attempt ends: the slot
      // is ready only when the attempt cleared its error.
      return {
        ...summary,
        ready: summary.ready && slot.error === null,
        error: slot.error ?? slot.service.lastError,
      };
    });
  }

  /**
   * Initializes a workspace folder, or registers a folder that has `tasks/workspace.yaml` already
   * (design decision 3).
   */
  initWorkspace(input: InitWorkspaceInput): Promise<InitWorkspaceResult> {
    // One at a time: the next init reads tasks/workspace.yaml that the last one wrote.
    return this.#initQueue.add(() => this.#initWorkspace(input));
  }

  /**
   * What the folder rule must know (openspec workspace-folder): the state folder, the registered
   * folders, the checkouts of this device in each open workspace and the folders of open joins.
   */
  async folderContext(): Promise<FolderContext> {
    const checkouts: string[] = [];
    for (const slot of this.#slots.values()) {
      if (slot.error !== null || this.config.device.role === "mobile") continue;
      const bindings = await readBindings(slot.service).catch(() => null);
      for (const c of bindings?.checkouts ?? []) checkouts.push(c.path);
    }
    return {
      home: this.settings.home,
      registered: this.config.workspaces.map((w) => ({ id: w.id, path: w.path })),
      checkouts,
      reserved: this.#pairing?.reservedFolders() ?? [],
    };
  }

  async #initWorkspace(input: InitWorkspaceInput): Promise<InitWorkspaceResult> {
    if (input.path !== undefined && input.parent !== undefined) {
      throw invalid("Give a path or a location (parent), not both", [
        { path: "parent", message: "with path" },
      ]);
    }
    let note: string | null = null;
    if (input.path === undefined) {
      // A location (openspec workspace-folder): the default is `~/AW` (prd WS-01), the same rule as
      // a pairing join. A folder of the same name and key prefix is registered again (gap-setup L2).
      const name = input.name ?? DEFAULT_WORKSPACE_NAME;
      const parent = input.parent ?? join(this.settings.userHome, "AW");
      if (!isAbsolute(parent)) throw invalid(`Give an absolute location, not ${parent}`);
      // A location that is a workspace folder (synced by another device): register it, as the
      // path form does. A new workspace is never made inside a workspace folder.
      const here = await workspaceAt(resolve(parent)).catch(() => null);
      if (here !== null) {
        note = `${resolve(parent)} is the folder of the workspace ${here.name ?? here.id ?? "with no name"}, so AW registers it.`;
        input = { ...input, path: resolve(parent) };
      } else {
        const choice = await chooseWorkspaceFolder(
          {
            parent,
            name: folderName(name, DEFAULT_WORKSPACE_NAME),
            match: { name, key_prefix: input.key_prefix },
          },
          await this.folderContext(),
        );
        note = choice.note;
        input = { ...input, name, path: choice.root };
      }
    }
    const path = input.path!;
    if (!isAbsolute(path)) throw invalid(`Give an absolute path, not ${path}`);
    const root = resolve(path);
    const known = this.#config!.workspaces.find((w) => w.path === root);
    // The folder of the same workspace is allowed: the registered one, or the id in its file.
    const own = known?.id ?? (await workspaceAt(root).catch(() => null))?.id ?? null;
    await checkFolderSafety(root, await this.folderContext(), own);
    const device = this.config.device;
    const existingText = await readFile(join(root, "tasks", "workspace.yaml"), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    let id: string;
    let created = false;
    if (existingText !== null) {
      const files = openWorkspace({
        root,
        device: device.slug,
        role: device.role,
        clock: this.clock,
      });
      const doc = await files
        .readDocument<"workspace">("tasks/workspace.yaml")
        .catch((error: Error) => {
          throw invalid(
            `The folder has a tasks/workspace.yaml that is not valid: ${error.message}`,
          );
        });
      // A location never gives a folder of another workspace here: the rule skipped it (gap-setup
      // L2). A path registers the workspace of the folder.
      id = doc.value.id;
    } else {
      if (known) id = known.id;
      else {
        if (!input.name)
          throw invalid("Give a name for the new workspace", [
            { path: "name", message: "required" },
          ]);
        // The first new workspace of a device with no identity makes the master key: this device
        // is the local device (design decision 5 of add-identity-and-pairing).
        if (device.role !== "mobile" && this.identity.user === null) {
          await this.identity.createMaster();
        }
        id = newId(this.clock);
        await mkdir(join(root, "tasks"), { recursive: true });
        const files = openWorkspace({
          root,
          device: device.slug,
          role: device.role,
          clock: this.clock,
        });
        await files.writeDocument("tasks/workspace.yaml", {
          kind: "workspace",
          schema: 1,
          id,
          name: input.name,
          key_prefix: input.key_prefix ?? "AW",
          device_order: [device.slug],
        });
        await mkdir(join(root, "knowledge"), { recursive: true });
        if (device.role !== "mobile") await mkdir(join(root, "secure"), { recursive: true });
        await copySchemaFiles(files, root);
        created = true;
      }
    }
    const existing = this.#slots.get(id);
    if (existing) {
      if (existing.entry.path !== root) {
        throw new ServiceError(
          "conflict",
          `The workspace ${id} is registered at ${existing.entry.path}`,
        );
      }
      // A workspace that did not open: try again now, and report the error when it still fails.
      if (existing.error !== null && !(await this.#tryOpen(existing, true))) {
        this.#scheduleRetry(existing);
        throw notOpen(id, existing.error);
      }
      return { created: false, workspace: existing.service.summary(), folder_note: note };
    }
    const entry = { id, path: root };
    const config = this.config;
    config.workspaces = [...config.workspaces.filter((w) => w.id !== id), entry];
    await saveConfig(this.settings, config);
    const slot = await this.#open(entry);
    if (slot.error !== null) throw notOpen(id, slot.error);
    this.log.info({ workspace: id, root, created }, "Workspace registered");
    return { created, workspace: slot.service.summary(), folder_note: note };
  }

  /**
   * Unregisters a workspace on this device (gap-setup): the entry of `config.yaml`, the open
   * workspace, its session manager and its engine folders. The files stay in the folder.
   */
  removeWorkspace(selector: string): Promise<{
    id: string;
    name: string | null;
    path: string;
    files_kept: true;
    /** The keys of the open tasks that stay assigned to an agent of this device. */
    tasks: string[];
    message: string;
  }> {
    return this.#initQueue.add(async () => {
      const slot = this.#slot(selector);
      const id = slot.entry.id;
      // An open retry that runs now ends first: it attaches the sessions and adds the engine folders
      // (gap-setup L1).
      await slot.opening?.catch(() => false);
      // The manager stops first: a session start in its queue ends before the check (fix list 0-14).
      const running = (await this.sessions?.detach(id)) ?? [];
      if (running.length > 0) {
        if (slot.opening === null && slot.error === null) {
          await this.sessions?.attach(slot.service);
        }
        throw new ServiceError(
          "conflict",
          `${running.length} session(s) of the workspace run on this device. Stop them with 'aw session stop <id>' first.`,
          { sessions: running },
        );
      }
      const name = slot.service.name;
      // The open tasks of this device stay assigned to it: the person must know (gap-setup
      // workflow 1). A closed workspace has no view, so read it before the close.
      const me = this.config.device.slug;
      const tasks = slot.error
        ? []
        : slot.service.view.tasks
            .filter((t) => !t.archived && t.stage !== "done" && assigneeDevice(t.assignee) === me)
            .map((t) => t.key ?? t.id);
      const config = this.config;
      config.workspaces = config.workspaces.filter((w) => w.id !== id);
      await saveConfig(this.settings, config);
      this.#slots.delete(id);
      await slot.service.close().catch((error: unknown) => {
        this.log.warn({ err: error, workspace: id }, "The workspace close failed");
      });
      await this.#sync?.unregister(id).catch((error: unknown) => {
        this.log.warn({ err: error, workspace: id }, "The engine folders were not removed");
      });
      this.log.info({ workspace: id, root: slot.entry.path }, "Workspace unregistered");
      const path = slot.entry.path;
      const message = [
        `The workspace ${name ?? id} is not registered on this device now. Its files stay in ${path}. Register it again with: aw workspace init ${path}`,
        tasks.length > 0
          ? `These tasks stay assigned to ${me}, which runs no session for them now: ${tasks.join(", ")}. Assign them to another device.`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      return { id, name, path, files_kept: true, tasks, message };
    });
  }

  /**
   * "Use community discovery and relay servers" (gap-setup, decision D18): `AW_SYNC_COMMUNITY`
   * when it is set, else `sync.community` of `config.yaml`, else on.
   */
  communitySetting(): { community: boolean; source: "env" | "config" | "default" } {
    const sync = this.settings.sync;
    if (sync.communityFromEnv) return { community: sync.community, source: "env" };
    const saved = this.config.sync?.community;
    if (saved !== undefined) return { community: saved, source: "config" };
    return { community: true, source: "default" };
  }

  /** Saves the community switch in `config.yaml` and gives it to the engine. */
  async setCommunity(on: boolean): Promise<"now" | "next_start"> {
    if (this.settings.sync.communityFromEnv) {
      throw new ServiceError(
        "conflict",
        "AW_SYNC_COMMUNITY sets the community switch on this device. Remove the variable from the awd environment to use the switch.",
        { setting: "AW_SYNC_COMMUNITY" },
      );
    }
    const config = this.config;
    config.sync = { ...config.sync, community: on };
    await saveConfig(this.settings, config);
    return this.sync.setCommunity(on);
  }

  status() {
    return {
      version: AW_VERSION,
      device: this.config.device,
      pid: process.pid,
      started_at: new Date(this.startedAt).toISOString(),
      uptime_s: Math.round((this.clock.now() - this.startedAt) / 1000),
      socket: this.settings.socketPath,
      ready: this.ready,
      workspaces: this.workspaces(),
    };
  }
}
