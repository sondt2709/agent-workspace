// The sync wiring of awd (docs/phase-1.md 6, openspec add-syncthing-sync): one SyncthingTransport
// per computer, the 3 folders of each workspace, the write hook of the files layer (targeted scan
// and write journal), Sync now, the status and the peers. The local API and the CLI call only these
// methods.
import type { Clock, WriteHook } from "@aw/core";
import type { PeerRecord, SyncDeviceRole, SyncEvent } from "@aw/plugin-api";
import {
  describePeer,
  folderId,
  PeerInputError,
  shortId,
  SYNC_NOW_TIMEOUT_MS,
  SyncthingTransport,
  type EngineState,
} from "@aw/sync-syncthing";
import { access, constants } from "node:fs/promises";
import PQueue from "p-queue";
import type { Logger } from "../log.ts";
import type { Settings } from "../settings.ts";
import { invalid, notFound, ServiceError } from "./errors.ts";
import type { WorkspaceService } from "./workspace.ts";

export type SyncState = EngineState | "not_installed";

/**
 * The check of a missing engine binary: awd starts the engine when `aw engine install` placed it,
 * with no restart (fix list 0-23).
 */
export const ENGINE_CHECK_MS = 5000;

export interface SyncServiceOptions {
  settings: Settings;
  log: Logger;
  clock: Clock;
  device: { slug: string; role: SyncDeviceRole };
  /**
   * "Use community discovery and relay servers" at the engine start (gap-setup): the value of
   * `config.yaml`, else `settings.sync.community`. `AW_SYNC_COMMUNITY` wins (awd passes it then).
   */
  community?: boolean;
}

export interface AddPeerInput {
  device_id: string;
  addresses: string[];
  name?: string | undefined;
  role?: SyncDeviceRole | undefined;
}

export class SyncService {
  readonly #o: SyncServiceOptions;
  #transport: SyncthingTransport | null = null;
  /** null until start() checked the binary. */
  #installed: boolean | null = null;
  #stopped = false;
  #events: AsyncIterator<SyncEvent> | null = null;
  readonly #workspaces = new Map<string, WorkspaceService>();
  #device: { slug: string; role: SyncDeviceRole };
  /** The peers from the signed device records (awd gives them, design decision 9). */
  #recordPeers: PeerRecord[] = [];
  /** The peers of the test path `POST /v1/sync/peers`, in memory only. */
  #testPeers: PeerRecord[] = [];
  /** Each change of the peers runs alone, so an older peer list never replaces a newer one. */
  readonly #peerQueue = new PQueue({ concurrency: 1 });
  #community: boolean;

  constructor(options: SyncServiceOptions) {
    this.#o = options;
    this.#device = { ...options.device };
    this.#community = options.community ?? options.settings.sync.community;
  }

  /** "Use community discovery and relay servers" now. */
  get community(): boolean {
    return this.#community;
  }

  /**
   * Changes the community switch (gap-setup). Returns `now` when the running engine has the new
   * options, `next_start` when the engine applies them at its next start.
   */
  async setCommunity(on: boolean): Promise<"now" | "next_start"> {
    this.#community = on;
    const applied = (await this.#transport?.setCommunity(on)) ?? false;
    return applied ? "now" : "next_start";
  }

  get #peers(): PeerRecord[] {
    const records = this.#recordPeers.filter(
      (r) => !this.#testPeers.some((t) => t.sync_id === r.sync_id || t.device === r.device),
    );
    return [...records, ...this.#testPeers];
  }

  /** Sets the peers from the signed device records. */
  setPeers(peers: PeerRecord[]): Promise<void> {
    return this.#peerQueue.add(async () => {
      this.#recordPeers = peers;
      await this.#transport?.setPeers(this.#peers);
    });
  }

  /**
   * Waits until the engine of the peer has the newest version of a path (openspec revoke-device).
   * False with no running engine.
   */
  waitDelivered(device: string, workspace: string, path: string, timeoutMs: number) {
    return (
      this.#transport?.waitDelivered(device, workspace, path, timeoutMs) ?? Promise.resolve(false)
    );
  }

  /** Changes the slug or the role of this device (pairing). */
  async setDevice(device: { slug: string; role: SyncDeviceRole }): Promise<void> {
    this.#device = { ...device };
    await this.#transport?.setDevice(device);
  }

  /** Adds the 3 folders of a workspace that is not registered yet (the end of a pairing). */
  async addFolders(workspace: string, root: string): Promise<void> {
    await this.#running().addWorkspace(workspace, root);
  }

  /** Removes the 3 folders of a workspace that is not registered (a pairing that failed). */
  async removeFolders(workspace: string): Promise<void> {
    if (this.#workspaces.has(workspace)) return;
    await this.#transport?.removeWorkspace(workspace);
  }

  get state(): SyncState {
    if (this.#installed === null) return this.#stopped ? "stopped" : "starting";
    if (!this.#installed) return "not_installed";
    return this.#transport?.state ?? "stopped";
  }

  get transport(): SyncthingTransport | null {
    return this.#transport;
  }

  /**
   * Starts the engine when its binary exists. Without it, sync is off (design decision 2), and awd
   * checks for the binary every ENGINE_CHECK_MS: when it appears, awd starts the engine and calls
   * `onLateStart` (the own records need the engine device id).
   */
  async start(onLateStart?: () => Promise<void>): Promise<void> {
    const { settings, log } = this.#o;
    this.#installed = await this.#binaryExists();
    if (!this.#installed) {
      const level = settings.sync.engineFromEnv ? "error" : "info";
      log[level]({ engine: settings.sync.engine }, "No sync engine binary: sync is off");
      void this.#watchBinary(onLateStart).catch((error: unknown) => {
        log.error({ err: error }, "The sync engine did not start");
      });
      return;
    }
    await this.#startEngine();
  }

  #binaryExists(): Promise<boolean> {
    return access(this.#o.settings.sync.engine, constants.X_OK).then(
      () => true,
      () => false,
    );
  }

  async #watchBinary(onLateStart?: () => Promise<void>): Promise<void> {
    while (!this.#stopped) {
      await this.#o.clock.sleep(ENGINE_CHECK_MS);
      if (this.#stopped) return;
      if (!(await this.#binaryExists())) continue;
      this.#o.log.info({ engine: this.#o.settings.sync.engine }, "The sync engine binary is there");
      // The state leaves not_installed only now: a start that waits shows "starting".
      this.#installed = true;
      await this.#startEngine();
      await onLateStart?.();
      return;
    }
  }

  async #startEngine(): Promise<void> {
    const { settings, log, clock } = this.#o;
    const device = this.#device;
    if (this.#stopped) return;
    this.#transport = new SyncthingTransport({
      binary: settings.sync.engine,
      home: settings.home,
      device,
      listen: settings.sync.listen,
      community: this.#community,
      clock,
      log: log.child({ module: "sync" }),
      files: (ws) => {
        const service = this.#workspaces.get(ws);
        // Through the write queue of the workspace, with a refresh after each write.
        return service?.ready ? service.conflictFiles : undefined;
      },
      // awd gives the peers from the signed device records: no peers file.
      persistPeers: false,
      deviceOrder: (ws) => {
        const service = this.#workspaces.get(ws);
        return (service?.ready ? service.view.workspace?.device_order : undefined) ?? [];
      },
    });
    this.#listen(this.#transport);
    await this.#transport.setPeers(this.#peers);
    // The folders first: the first engine start applies them with the options and the peers.
    for (const service of this.#workspaces.values()) await this.#addFolders(service);
    await this.#transport.start();
    if (this.#stopped) {
      // awd stopped during the start: stop what the start made.
      await this.#transport.stop();
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#events?.return?.();
    await this.#transport?.stop();
  }

  /** Reads the events of the transport until the stop. */
  #listen(transport: SyncthingTransport): void {
    const events = transport.events()[Symbol.asyncIterator]();
    this.#events = events;
    void (async () => {
      for (;;) {
        const next = await events.next();
        if (next.done || this.#stopped) return;
        this.onEvent(next.value);
      }
    })().catch((error: unknown) => {
      this.#o.log.error({ err: error }, "The sync event loop stopped");
    });
  }

  /**
   * Handles one event of the transport. A remote change in the knowledge folder of a workspace
   * (a file or a log of another device) makes its knowledge store reconcile (add-knowledge-store
   * open issue 1).
   */
  onEvent(event: SyncEvent): void {
    if (event.type !== "changed" || event.local || !event.path.startsWith("knowledge/")) return;
    for (const service of this.#workspaces.values()) {
      if (folderId(service.id, "knowledge") !== event.folder) continue;
      // Before the end of open() there is no store yet; open() reconciles at its end.
      if (service.hasKnowledge) service.knowledge.remoteChanged();
    }
  }

  /** Registers an open workspace and shares its 3 folders. */
  async addWorkspace(service: WorkspaceService): Promise<void> {
    this.#workspaces.set(service.id, service);
    if (this.#transport) await this.#addFolders(service);
  }

  /** Stops the sync of an unregistered workspace: its 3 engine folders go (gap-setup). */
  async unregister(workspace: string): Promise<void> {
    this.#workspaces.delete(workspace);
    await this.#transport?.removeWorkspace(workspace);
  }

  async #addFolders(service: WorkspaceService): Promise<void> {
    try {
      await this.#transport!.addWorkspace(service.id, service.root);
    } catch (error) {
      this.#o.log.error({ err: error, workspace: service.id }, "The sync folders were not added");
    }
  }

  /** The write hook of a workspace: bound late, because the engine starts after the open. */
  writeHook(workspace: string): WriteHook {
    return (path, content) => this.#transport?.writeHook(workspace)(path, content);
  }

  /** The transport when the engine runs, else 503 `not_ready`. */
  running(): SyncthingTransport {
    return this.#running();
  }

  #running(): SyncthingTransport {
    const transport = this.#transport;
    if (!transport || transport.state !== "running") {
      throw new ServiceError("not_ready", `The sync engine is not running (state ${this.state})`, {
        state: this.state,
      });
    }
    return transport;
  }

  async status() {
    const transport = this.#transport;
    const base = {
      engine: this.state,
      device: this.#device.slug,
      sync_id: transport?.syncId ?? null,
      paused: transport?.paused ?? false,
      pids: transport?.pids ?? [],
    };
    if (!transport || transport.state !== "running") return { ...base, peers: [] };
    const now = this.#o.clock.now();
    const peers = await transport.status();
    return { ...base, peers: peers.map((peer) => ({ ...peer, text: describePeer(peer, now) })) };
  }

  async syncNow(timeoutMs = SYNC_NOW_TIMEOUT_MS) {
    const result = await this.#running().syncNow({ timeoutMs });
    return { ...result, status: await this.status() };
  }

  async pause() {
    await this.#running().pause();
    return this.status();
  }

  async resume() {
    await this.#running().resume();
    return this.status();
  }

  /**
   * Adds a peer by its device id: the test path of `POST /v1/sync/peers`. It shares each folder,
   * `secure` too, with a device that has no signed device record, so awd refuses it unless
   * `AW_SYNC_TEST_PEERS=on`. The peer stays in memory until the next awd start; pairing gives the
   * peers from the signed records (`setPeers`).
   */
  async addTestPeer(input: AddPeerInput) {
    if (!this.#o.settings.sync.testPeers) {
      throw new ServiceError(
        "refused",
        "Adding a peer by its device id is a test path: it shares the secure folder with a device that has no signed record. Pair the device with 'aw device add' and 'aw pair', or start awd with AW_SYNC_TEST_PEERS=on for a test.",
        { setting: "AW_SYNC_TEST_PEERS" },
      );
    }
    return this.addPeer(input);
  }

  async addPeer(input: AddPeerInput) {
    const transport = this.#running();
    const record: PeerRecord = {
      device: input.name ?? `peer-${shortId(input.device_id).toLowerCase()}`,
      sync_id: input.device_id,
      role: input.role ?? "remote",
      addresses: input.addresses,
    };
    try {
      await this.#peerQueue.add(async () => {
        await transport.addPeer(record);
        this.#testPeers = [
          ...this.#testPeers.filter(
            (p) => p.sync_id !== record.sync_id && p.device !== record.device,
          ),
          record,
        ];
      });
    } catch (error) {
      // Only a bad record is bad input; an engine failure stays an error of awd.
      if (error instanceof PeerInputError) throw invalid(error.message);
      throw error;
    }
    return this.status();
  }

  async removePeer(device: string) {
    const transport = this.#running();
    if (!transport.peers.some((p) => p.device === device || p.sync_id === device)) {
      throw notFound(`Peer ${device}`);
    }
    await this.#peerQueue.add(async () => {
      this.#testPeers = this.#testPeers.filter((p) => p.device !== device && p.sync_id !== device);
      this.#recordPeers = this.#recordPeers.filter(
        (p) => p.device !== device && p.sync_id !== device,
      );
      await transport.removePeer(device);
    });
    return this.status();
  }
}
