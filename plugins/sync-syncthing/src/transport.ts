// SyncthingTransport: the SyncTransport of phase 1 (docs/architecture.md 4.4, 6.1; docs/phase-1.md
// 6). awd owns the engine: the config before the first start, then REST only.
import { isConflictCopy, parseConflictCopy, type Clock, type WriteHook } from "@aw/core";
import type {
  FolderPeerStatus,
  FolderSpec,
  PeerRecord,
  PeerStatus,
  SyncDeviceRole,
  SyncEvent,
  SyncFolderKind,
  SyncResult,
  SyncTransport,
} from "@aw/plugin-api";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import PQueue from "p-queue";
import { sha256Hex, WriteJournal } from "./journal.ts";
import {
  isElected,
  PeerInputError,
  peerRecordSchema,
  rankOf,
  readPeers,
  shortId,
  writePeers,
} from "./peers.ts";
import { resolveCopy, type Author, type ConflictFiles, type ResolveOutcome } from "./resolver.ts";
import type { EngineEvent, EngineFolderConfig, EngineRest } from "./rest.ts";
import { folderStatus, lastSyncedAfterPoll, peerStatus, pendingOf } from "./status.ts";
import { EngineSupervisor, type EngineState, type SyncLogger } from "./supervisor.ts";

/** The reconnect interval while a new peer is not connected yet, and after (docs/phase-1.md 6.2). */
export const PAIRING_RECONNECT_S = 5;
export const NORMAL_RECONNECT_S = 60;
/** A connection that lasts this long ends the short interval (a peer that does not know this
 * device yet, or a paused peer, closes the connection at once). */
export const PAIRING_STABLE_MS = 5000;
/** The pairing interval ends after this time at the latest. */
export const PAIRING_MAX_MS = 10 * 60_000;
/** The Sync now poll period and the default timeout on a computer. */
export const SYNC_NOW_POLL_MS = 250;
export const SYNC_NOW_TIMEOUT_MS = 20_000;
/** The simple file versioning: versions kept per file. */
export const VERSIONS_KEEP = 10;
/** The ignore pattern of each folder on each device (docs/phase-1.md 6.2). */
export const DEFAULT_IGNORES = ["*.aw-tmp"];

/**
 * The engine options of the switch "Use community discovery and relay servers" (decision D18).
 * Local discovery stays on in both cases.
 */
export function communityOptions(on: boolean): Record<string, boolean> {
  return {
    localAnnounceEnabled: true,
    globalAnnounceEnabled: on,
    relaysEnabled: on,
    announceLANAddresses: on,
  };
}

/** The engine folder id of a workspace folder (docs/phase-1.md 3.1). */
export function folderId(workspace: string, kind: SyncFolderKind): string {
  return `aw-${workspace}-${kind}`;
}

const KINDS: readonly SyncFolderKind[] = ["tasks", "knowledge", "secure"];
/** The id of a workspace folder (folderId), not of a pairing folder `aw-pair-<nonce>`. */
const WORKSPACE_FOLDER = /^aw-(?!pair-).+-(tasks|knowledge|secure)$/;

/** A string field of an engine event, or "". */
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export interface SyncthingTransportOptions {
  /** The engine binary. */
  binary: string;
  /** The AW state folder (`AW_HOME`). */
  home: string;
  /** This device. */
  device: { slug: string; role: SyncDeviceRole };
  /** The listen address, for example `tcp://0.0.0.0:22300`. */
  listen: string;
  /** "Use community discovery and relay servers" (decision D18). */
  community: boolean;
  clock: Clock;
  log: SyncLogger;
  /** The files layer of a workspace, for the conflict resolver. */
  files?: (workspace: string) => ConflictFiles | undefined;
  /** The device order of a workspace (`workspace.yaml`), for the priority rule. */
  deviceOrder?: (workspace: string) => string[];
  /**
   * Keep the peers in `<home>/sync-peers.json` (default true, for the plugin tests). awd sets it
   * false and gives the peers from the signed device records with `setPeers()`.
   */
  persistPeers?: boolean;
}

interface FolderEntry extends FolderSpec {
  id: string;
}

type Listener = (event: SyncEvent) => void;

export class SyncthingTransport implements SyncTransport {
  readonly id = "syncthing";
  readonly #o: SyncthingTransportOptions;
  readonly #supervisor: EngineSupervisor;
  readonly #journal: WriteJournal;
  readonly #folders = new Map<string, FolderEntry>();
  readonly #listeners = new Set<Listener>();
  readonly #scans = new PQueue({ concurrency: 4 });
  readonly #pendingScans = new Set<string>();
  readonly #resolving = new Map<string, PQueue>();
  readonly #lastSynced = new Map<string, string>();
  /** `<workspace>\n<path>` of each original that the resolver writes now. */
  readonly #resolverWrites = new Set<string>();
  /** The sha256 of the last version that the resolver wrote at a path (another device wrote it). */
  readonly #foreignWrites = new Map<string, string>();
  #peers: PeerRecord[] = [];
  /** The engine devices of an open pairing: no workspace folder (docs/phase-1.md 7). */
  readonly #pairingDevices = new Set<string>();
  #device: { slug: string; role: SyncDeviceRole };
  #pairing = new Map<string, number>();
  #connected = new Set<string>();
  #paused = false;
  #community: boolean;
  #stopped = true;
  #pumps: Promise<void>[] = [];

  constructor(options: SyncthingTransportOptions) {
    this.#o = options;
    this.#device = { ...options.device };
    this.#community = options.community;
    this.#journal = new WriteJournal(join(options.home, "journal"), () => options.clock.now());
    this.#supervisor = new EngineSupervisor({
      binary: options.binary,
      config: {
        home: join(options.home, "sync"),
        socket: join(options.home, "run", "sync.sock"),
        name: options.device.slug,
        listen: options.listen,
      },
      logFile: join(options.home, "logs", "sync-engine.log"),
      clock: options.clock,
      log: options.log,
      onStart: (rest) => this.#onEngineStart(rest),
      onState: (state) => this.#emit({ type: "engine", state, at: this.#now() }),
    });
  }

  get state(): EngineState {
    return this.#supervisor.state;
  }

  /** The device id of this engine. */
  get syncId(): string | null {
    return this.#supervisor.deviceId;
  }

  get pids(): number[] {
    return this.#supervisor.pids;
  }

  get peers(): PeerRecord[] {
    return [...this.#peers];
  }

  get paused(): boolean {
    return this.#paused;
  }

  /** "Use community discovery and relay servers" now. */
  get community(): boolean {
    return this.#community;
  }

  /**
   * Changes the community switch (gap-setup). A running engine gets the options through its REST
   * API at once; else the next engine start applies them. Returns true when the engine has them now.
   */
  async setCommunity(on: boolean): Promise<boolean> {
    this.#community = on;
    const rest = this.#supervisor.restOrNull;
    if (!rest) return false;
    try {
      await rest.patchOptions(communityOptions(on));
      // The options apply at once in the pinned engine; when it asks for a restart, the value
      // applies at the next engine start (gap-setup open issue 2).
      if (await rest.restartRequired()) {
        this.#o.log.warn(
          { community: on },
          "The engine applies the community switch at its next start",
        );
        return false;
      }
    } catch (error) {
      // config.yaml has the value: the next engine start applies it (gap-setup L5).
      this.#o.log.warn(
        { err: error, community: on },
        "The engine did not take the community switch now",
      );
      return false;
    }
    this.#o.log.info({ community: on }, "Community discovery and relays changed");
    return true;
  }

  get journal(): WriteJournal {
    return this.#journal;
  }

  #now(): string {
    return new Date(this.#o.clock.now()).toISOString();
  }

  #emit(event: SyncEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  get #peersFile(): string {
    return join(this.#o.home, "sync-peers.json");
  }

  get #persist(): boolean {
    return this.#o.persistPeers ?? true;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    if (this.#persist) this.#peers = await readPeers(this.#peersFile);
    await this.#supervisor.start();
    this.#pumps = [this.#pump("engine"), this.#pump("disk")];
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#supervisor.stop();
    this.#scans.clear();
    await Promise.allSettled(this.#pumps);
    this.#pumps = [];
  }

  /** Applies the options, the devices and the folders after each engine start. */
  async #onEngineStart(rest: EngineRest): Promise<void> {
    const options = await rest.options();
    const wanted: Record<string, unknown> = {
      ...communityOptions(this.#community),
      natEnabled: false,
      reconnectionIntervalS: this.#pairing.size > 0 ? PAIRING_RECONNECT_S : NORMAL_RECONNECT_S,
      listenAddresses: [this.#o.listen],
    };
    const patch = Object.fromEntries(
      Object.entries(wanted).filter(
        ([key, value]) => JSON.stringify(options[key]) !== JSON.stringify(value),
      ),
    );
    if (Object.keys(patch).length > 0) await rest.patchOptions(patch);
    const me = this.#supervisor.deviceId!;
    const devices = await rest.devices();
    const self = devices.find((d) => d.deviceID === me);
    if (self && self.name !== this.#device.slug) {
      await rest.patchDevice(me, { name: this.#device.slug });
    }
    // The engine (v2.1.7) keeps a pause in memory only: after an engine restart awd pauses again;
    // a new awd starts unpaused, and so does the engine (it does not write the pause to config.xml).
    for (const peer of this.#peers) await this.#putDevice(rest, peer, devices);
    if (!this.#persist) await this.#removeOtherDevices(rest);
    for (const folder of this.#folders.values()) await this.#ensureFolder(rest, folder);
    await this.#removeOtherFolders(rest);
    if (this.#paused) await rest.pause();
    this.#connected = new Set(
      Object.entries(await rest.connections())
        .filter(([, c]) => c.connected)
        .map(([id]) => id),
    );
    void this.sweep();
  }

  /**
   * Removes each workspace folder (`aw-<workspace>-<kind>`) that is not in `#folders`: a workspace
   * that awd removed while the engine was down (gap-setup M2). A pairing folder stays.
   */
  async #removeOtherFolders(rest: EngineRest): Promise<void> {
    for (const folder of await rest.folders()) {
      if (this.#folders.has(folder.id) || !WORKSPACE_FOLDER.test(folder.id)) continue;
      await rest.deleteFolder(folder.id);
      this.#o.log.info({ folder: folder.id }, "Removed the engine folder of a removed workspace");
    }
  }

  async #putDevice(
    rest: EngineRest,
    peer: PeerRecord,
    known?: { deviceID: string; name: string; addresses: string[]; paused?: boolean | undefined }[],
  ): Promise<void> {
    const current = (known ?? (await rest.devices())).find((d) => d.deviceID === peer.sync_id);
    if (
      current &&
      current.name === peer.device &&
      JSON.stringify(current.addresses) === JSON.stringify(peer.addresses) &&
      (current.paused ?? false) === this.#paused
    ) {
      return;
    }
    await rest.putDevice({
      deviceID: peer.sync_id,
      name: peer.device,
      addresses: peer.addresses,
      compression: "metadata",
      introducer: false,
      autoAcceptFolders: false,
      // A device added during a pause is paused too.
      paused: this.#paused,
    });
  }

  /** The devices that share a folder kind: each peer, `secure` only with computers. */
  #peersOf(kind: SyncFolderKind): PeerRecord[] {
    return this.#peers.filter((peer) => kind !== "secure" || peer.role !== "mobile");
  }

  #wantedFolder(folder: FolderEntry): Partial<EngineFolderConfig> & { id: string } {
    const me = this.#supervisor.deviceId!;
    const devices = [me, ...this.#peersOf(folder.kind).map((p) => p.sync_id)].sort();
    const computer = this.#device.role !== "mobile";
    return {
      id: folder.id,
      label: folder.kind,
      path: folder.path,
      type: "sendreceive",
      devices: devices.map((deviceID) => ({ deviceID })),
      fsWatcherEnabled: true,
      fsWatcherDelayS: 1,
      rescanIntervalS: 3600,
      maxConflicts: 10,
      paused: false,
      versioning: computer
        ? {
            type: "simple",
            params: { keep: String(VERSIONS_KEEP), cleanoutDays: "0" },
            cleanupIntervalS: 3600,
            fsPath: join(this.#o.home, "sync-versions", folder.id),
            fsType: "basic",
          }
        : { type: "", params: {}, cleanupIntervalS: 3600, fsPath: "", fsType: "basic" },
    };
  }

  /** True when the engine config has each wanted value. */
  static folderMatches(current: EngineFolderConfig, wanted: Partial<EngineFolderConfig>): boolean {
    const devices = (list: { deviceID: string }[] | undefined) =>
      (list ?? []).map((d) => d.deviceID).sort();
    const v = (x: EngineFolderConfig["versioning"] | undefined) => ({
      type: x?.type ?? "",
      keep: x?.params?.keep ?? "",
      fsPath: x?.fsPath ?? "",
    });
    return (
      current.path === wanted.path &&
      current.label === wanted.label &&
      current.type === wanted.type &&
      JSON.stringify(devices(current.devices)) === JSON.stringify(devices(wanted.devices)) &&
      current.fsWatcherEnabled === wanted.fsWatcherEnabled &&
      current.fsWatcherDelayS === wanted.fsWatcherDelayS &&
      current.rescanIntervalS === wanted.rescanIntervalS &&
      current.maxConflicts === wanted.maxConflicts &&
      (current.paused ?? false) === (wanted.paused ?? false) &&
      JSON.stringify(v(current.versioning)) === JSON.stringify(v(wanted.versioning))
    );
  }

  async #ensureFolder(rest: EngineRest, folder: FolderEntry): Promise<void> {
    const wanted = this.#wantedFolder(folder);
    const current = await rest.folder(folder.id);
    if (!current || !SyncthingTransport.folderMatches(current, wanted)) {
      // A folder-config change restarts the folder (ST2): only when a value differs.
      await rest.putFolder(current ? { ...current, ...wanted } : wanted);
      this.#o.log.info({ folder: folder.id, created: !current }, "Sync folder config written");
    }
    const ignores = await rest.ignores(folder.id);
    if (JSON.stringify(ignores) !== JSON.stringify(folder.ignore)) {
      await rest.setIgnores(folder.id, folder.ignore);
    }
  }

  async addFolder(spec: FolderSpec): Promise<void> {
    if (spec.kind === "secure" && this.#device.role === "mobile") return;
    const entry: FolderEntry = {
      ...spec,
      ignore: spec.ignore.length > 0 ? spec.ignore : DEFAULT_IGNORES,
      id: folderId(spec.workspace, spec.kind),
    };
    this.#folders.set(entry.id, entry);
    const rest = this.#supervisor.restOrNull;
    if (rest) await this.#ensureFolder(rest, entry);
  }

  /** Adds the 3 folders of a workspace folder `<root>/{tasks,knowledge,secure}`. */
  async addWorkspace(workspace: string, root: string): Promise<void> {
    for (const kind of KINDS) {
      await this.addFolder({ workspace, kind, path: join(root, kind), ignore: DEFAULT_IGNORES });
    }
  }

  /** Removes the 3 folders of a workspace from the engine. Their files stay on disk. */
  async removeWorkspace(workspace: string): Promise<void> {
    const rest = this.#supervisor.restOrNull;
    for (const kind of KINDS) {
      const id = folderId(workspace, kind);
      this.#folders.delete(id);
      if (rest && (await rest.folder(id))) await rest.deleteFolder(id);
    }
  }

  get folders(): FolderSpec[] {
    return [...this.#folders.values()];
  }

  /**
   * Adds or changes a peer. A record that is not valid or that clashes throws PeerInputError. The
   * peers file changes only after the engine has the device and the folders.
   */
  async addPeer(record: PeerRecord): Promise<void> {
    const parsed = peerRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new PeerInputError(
        `The peer record is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      );
    }
    const peer = parsed.data;
    if (peer.sync_id === this.#supervisor.deviceId) {
      throw new PeerInputError("The device id is the id of this device");
    }
    if (peer.device === this.#device.slug) {
      throw new PeerInputError(`The name ${peer.device} is the name of this device`);
    }
    const others = this.#peers.filter(
      (p) => p.sync_id !== peer.sync_id && p.device !== peer.device,
    );
    const clash = this.#peers.find(
      (p) => (p.sync_id === peer.sync_id) !== (p.device === peer.device),
    );
    if (clash) {
      throw new PeerInputError(
        `The peer ${clash.device} (${clash.sync_id}) has this name or device id`,
      );
    }
    const rest = this.#supervisor.rest;
    const before = this.#peers;
    this.#peers = [...others, peer];
    try {
      await this.#putDevice(rest, peer);
      for (const folder of this.#folders.values()) await this.#ensureFolder(rest, folder);
    } catch (error) {
      // The next engine start applies the peers file: keep the file and the list as they were.
      this.#peers = before;
      throw error;
    }
    if (this.#persist) await writePeers(this.#peersFile, this.#peers);
    // The interval stays 5 s until a connection lasts (#checkPairing), at most 10 min.
    this.#pairing.set(peer.sync_id, this.#o.clock.now() + PAIRING_MAX_MS);
    await this.#setReconnect(rest);
    void this.#o.clock.sleep(PAIRING_MAX_MS).then(() => this.#checkPairing());
    void this.#o.clock.sleep(PAIRING_STABLE_MS + 500).then(() => this.#checkPairing());
  }

  async removePeer(device: string): Promise<void> {
    const peer = this.#peers.find((p) => p.device === device || p.sync_id === device);
    if (!peer) throw new Error(`No peer ${device}`);
    this.#peers = this.#peers.filter((p) => p !== peer);
    if (this.#persist) await writePeers(this.#peersFile, this.#peers);
    this.#pairing.delete(peer.sync_id);
    const rest = this.#supervisor.rest;
    for (const folder of this.#folders.values()) await this.#ensureFolder(rest, folder);
    if ((await rest.devices()).some((d) => d.deviceID === peer.sync_id)) {
      await rest.deleteDevice(peer.sync_id);
    }
    await this.#setReconnect(rest);
  }

  /**
   * Sets the peers to this list (awd: the valid device records). It adds and changes the devices,
   * removes each other engine device (not this device, not a device of an open pairing), and shares
   * the folders again. Before the engine start it only keeps the list; the start applies it.
   */
  async setPeers(records: PeerRecord[]): Promise<void> {
    const peers: PeerRecord[] = [];
    for (const record of records) {
      const parsed = peerRecordSchema.safeParse(record);
      if (!parsed.success) throw new PeerInputError(`The peer ${record.device} is not valid`);
      if (parsed.data.sync_id === this.#supervisor.deviceId) continue;
      if (parsed.data.device === this.#device.slug) continue;
      peers.push(parsed.data);
    }
    const before = new Map(this.#peers.map((p) => [p.sync_id, p]));
    this.#peers = peers;
    const rest = this.#supervisor.restOrNull;
    if (!rest) return;
    const devices = await rest.devices();
    for (const peer of peers) await this.#putDevice(rest, peer, devices);
    await this.#removeOtherDevices(rest);
    for (const folder of this.#folders.values()) await this.#ensureFolder(rest, folder);
    const added = peers.filter((p) => !before.has(p.sync_id));
    for (const peer of added) this.#pairing.set(peer.sync_id, this.#o.clock.now() + PAIRING_MAX_MS);
    for (const id of before.keys()) {
      if (!peers.some((p) => p.sync_id === id)) this.#pairing.delete(id);
    }
    await this.#setReconnect(rest);
    if (added.length > 0) {
      void this.#o.clock.sleep(PAIRING_STABLE_MS + 500).then(() => this.#checkPairing());
      void this.#o.clock.sleep(PAIRING_MAX_MS).then(() => this.#checkPairing());
    }
  }

  /** Removes each engine device that is not this device, a peer or a pairing device. */
  async #removeOtherDevices(rest: EngineRest): Promise<void> {
    const me = this.#supervisor.deviceId;
    for (const device of await rest.devices()) {
      const id = device.deviceID;
      if (id === me || this.#pairingDevices.has(id)) continue;
      if (this.#peers.some((p) => p.sync_id === id)) continue;
      await rest.deleteDevice(id);
      this.#o.log.info({ device: device.name }, "Sync peer removed: no valid device record");
    }
  }

  /** Changes the slug or the role of this device (pairing sets them). */
  async setDevice(device: { slug: string; role: SyncDeviceRole }): Promise<void> {
    this.#device = { ...device };
    const rest = this.#supervisor.restOrNull;
    const me = this.#supervisor.deviceId;
    if (rest && me) await rest.patchDevice(me, { name: device.slug });
  }

  // ---- Pairing (docs/phase-1.md 7) -------------------------------------------------------------

  /** The devices that connected and that the engine does not know. */
  pendingDevices() {
    return this.#supervisor.rest.pendingDevices();
  }

  /** The folders that known devices offer and that this engine does not have. */
  pendingFolders() {
    return this.#supervisor.rest.pendingFolders();
  }

  /** Adds a device of a pairing with no workspace folder. The reconnect interval is 5 s. */
  async addPairingDevice(syncId: string, name: string, addresses: string[]): Promise<void> {
    const rest = this.#supervisor.rest;
    this.#pairingDevices.add(syncId);
    const known = (await rest.devices()).find((d) => d.deviceID === syncId);
    if (!known) {
      await rest.putDevice({
        deviceID: syncId,
        name,
        addresses: addresses.length > 0 ? addresses : ["dynamic"],
        compression: "metadata",
        introducer: false,
        autoAcceptFolders: false,
        paused: false,
      });
    }
    this.#pairing.set(syncId, this.#o.clock.now() + PAIRING_MAX_MS);
    await this.#setReconnect(rest);
  }

  /**
   * Removes the device of a pairing from the engine, unless it is a peer now. A pending entry of
   * the device is removed too.
   */
  async removePairingDevice(syncId: string): Promise<void> {
    this.#pairingDevices.delete(syncId);
    const rest = this.#supervisor.restOrNull;
    if (!rest) return;
    if (!this.#peers.some((p) => p.sync_id === syncId)) {
      if ((await rest.devices()).some((d) => d.deviceID === syncId))
        await rest.deleteDevice(syncId);
      this.#pairing.delete(syncId);
    }
    if (syncId in (await rest.pendingDevices())) await rest.deletePendingDevice(syncId);
    await this.#setReconnect(rest);
  }

  /** Shares the pairing folder `aw-pair-<nonce>` at a path with one device. */
  async addPairingFolder(id: string, path: string, device: string): Promise<void> {
    const rest = this.#supervisor.rest;
    const me = this.#supervisor.deviceId!;
    await rest.putFolder({
      id,
      label: "pairing",
      path,
      type: "sendreceive",
      devices: [me, device].sort().map((deviceID) => ({ deviceID })),
      fsWatcherEnabled: true,
      fsWatcherDelayS: 1,
      rescanIntervalS: 10,
      maxConflicts: 10,
      paused: false,
    });
    await rest.setIgnores(id, DEFAULT_IGNORES);
  }

  /** Scans the pairing folder, so a new file goes to the other device at once. */
  async scanPairingFolder(id: string): Promise<void> {
    await this.#supervisor.rest.scan(id);
  }

  async removePairingFolder(id: string): Promise<void> {
    const rest = this.#supervisor.restOrNull;
    if (!rest) return;
    if (await rest.folder(id)) await rest.deleteFolder(id);
  }

  async #setReconnect(rest: EngineRest): Promise<void> {
    const wanted = this.#pairing.size > 0 ? PAIRING_RECONNECT_S : NORMAL_RECONNECT_S;
    const options = await rest.options();
    if (options.reconnectionIntervalS !== wanted) {
      await rest.patchOptions({ reconnectionIntervalS: wanted });
      this.#o.log.info({ seconds: wanted }, "Sync reconnect interval set");
    }
  }

  /**
   * Ends the pairing interval of each connected peer and of each one older than 10 min. It reads
   * the connections again: a peer that does not know this device yet closes the connection at
   * once, after a DeviceConnected event.
   */
  async #checkPairing(): Promise<void> {
    if (this.#pairing.size === 0) return;
    const rest = this.#supervisor.restOrNull;
    if (!rest) return;
    try {
      const connections = await rest.connections();
      const now = this.#o.clock.now();
      for (const [id, until] of this.#pairing) {
        const connection = connections[id];
        const lasting =
          connection?.connected === true &&
          !connection.paused &&
          now - Date.parse(connection.startedAt ?? "") >= PAIRING_STABLE_MS;
        if (lasting || until <= now) this.#pairing.delete(id);
      }
      await this.#setReconnect(rest);
    } catch (error) {
      this.#o.log.debug({ err: error }, "The pairing check failed");
    }
  }

  /** The engine options (REST). */
  engineOptions(): Promise<Record<string, unknown>> {
    return this.#supervisor.rest.options();
  }

  /** The reconnect interval that the engine uses now. */
  async reconnectInterval(): Promise<number> {
    return Number((await this.#supervisor.rest.options()).reconnectionIntervalS);
  }

  // ---- Writes and scans ----------------------------------------------------------------------

  #folderOf(
    workspace: string | undefined,
    path: string,
  ): { folder: FolderEntry; sub: string } | null {
    const [kind, ...rest] = path.split("/");
    if (!KINDS.includes(kind as SyncFolderKind)) return null;
    const candidates = [...this.#folders.values()].filter(
      (f) => f.kind === kind && (workspace === undefined || f.workspace === workspace),
    );
    if (candidates.length !== 1) return null;
    return { folder: candidates[0]!, sub: rest.join("/") };
  }

  wrote(paths: string[], workspace?: string): void {
    for (const path of paths) {
      const target = this.#folderOf(workspace, path);
      if (!target) continue;
      const key = `${target.folder.id}\n${target.sub}`;
      if (this.#pendingScans.has(key)) continue;
      this.#pendingScans.add(key);
      void this.#scans.add(async () => {
        this.#pendingScans.delete(key);
        const rest = this.#supervisor.restOrNull;
        if (!rest) return;
        try {
          await rest.scan(target.folder.id, target.sub === "" ? undefined : target.sub);
          this.#o.log.debug({ folder: target.folder.id, sub: target.sub }, "Targeted scan");
        } catch (error) {
          // The engine watcher finds the change within fsWatcherDelayS anyway.
          this.#o.log.debug({ err: error, folder: target.folder.id }, "A targeted scan failed");
        }
      });
    }
  }

  /** The write hook of the files layer of a workspace: the journal, then a targeted scan. */
  writeHook(workspace: string): WriteHook {
    return (path, content) => {
      const key = `${workspace}\n${path}`;
      if (content !== null && this.#resolverWrites.has(key)) {
        // The resolver wrote the version of another device: remember it, do not journal it.
        this.#foreignWrites.set(key, sha256Hex(content));
      } else if (content !== null && !isConflictCopy(path)) {
        this.#foreignWrites.delete(key);
        void this.#journal.record(workspace, path, content).catch((error: unknown) => {
          this.#o.log.warn({ err: error, path }, "The write journal failed");
        });
      }
      this.wrote([path], workspace);
    };
  }

  /** Waits for the pending targeted scans. */
  async scansIdle(): Promise<void> {
    await this.#scans.onIdle();
  }

  /**
   * Scans the path, then polls `GET /rest/db/file` until its `availability` (the devices with the
   * newest version) has the peer (openspec revoke-device). False when the peer or the folder is not
   * known, the peer is not connected, the engine does not answer, or the time ends.
   */
  async waitDelivered(
    device: string,
    workspace: string,
    path: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const rest = this.#supervisor.restOrNull;
    // The engine device id, or the slug (revoke-device review low 3).
    const peer =
      this.#peers.find((p) => p.sync_id === device) ?? this.#peers.find((p) => p.device === device);
    const target = this.#folderOf(workspace, path);
    if (!rest || !peer || !target) return false;
    const until = this.#o.clock.now() + timeoutMs;
    try {
      await rest.scan(target.folder.id, target.sub, timeoutMs);
      for (;;) {
        // A slow scan uses the time: no poll after the end (revoke-device review low 6).
        if (this.#o.clock.now() >= until) return false;
        if ((await rest.connections())[peer.sync_id]?.connected !== true) return false;
        const file = await rest.file(target.folder.id, target.sub);
        if (file.availability.includes(peer.sync_id)) return true;
        if (this.#o.clock.now() >= until) return false;
        await this.#o.clock.sleep(SYNC_NOW_POLL_MS);
      }
    } catch (error) {
      this.#o.log.warn({ err: error, device, path }, "The delivery check failed");
      return false;
    }
  }

  // ---- Status and Sync now -------------------------------------------------------------------

  async status(): Promise<PeerStatus[]> {
    const rest = this.#supervisor.rest;
    const [connections, stats] = await Promise.all([
      rest.connections(),
      rest.deviceStats().catch((): Record<string, { lastSeen?: string }> => ({})),
    ]);
    const now = this.#now();
    return Promise.all(
      this.#peers.map(async (peer) => {
        const connection = connections[peer.sync_id];
        const connected = connection?.connected ?? false;
        const folders: FolderPeerStatus[] = await Promise.all(
          [...this.#folders.values()]
            .filter((f) => f.kind !== "secure" || peer.role !== "mobile")
            .map(async (f) => {
              const completion = await rest.completion(f.id, peer.sync_id).catch(() => null);
              return folderStatus(
                { folder: f.id, workspace: f.workspace, kind: f.kind },
                completion,
                connected,
              );
            }),
        );
        const lastSeen = connected ? now : stats[peer.sync_id]?.lastSeen;
        const status = peerStatus({
          device: peer.device,
          role: peer.role,
          connection,
          folders,
          lastSeen: lastSeen && !lastSeen.startsWith("1970") ? lastSeen : undefined,
          lastSynced: this.#lastSynced.get(peer.device),
        });
        // No FolderCompletion event of this peer since the start: the first time awd sees it in
        // sync. A poll never moves the time (FolderCompletion does).
        const synced = lastSyncedAfterPoll(status.lastSynced, status.inSync, now);
        if (synced !== undefined && synced !== status.lastSynced) {
          this.#lastSynced.set(peer.device, synced);
          status.lastSynced = synced;
        }
        return status;
      }),
    );
  }

  async syncNow(
    options: { timeoutMs: number } = { timeoutMs: SYNC_NOW_TIMEOUT_MS },
  ): Promise<SyncResult> {
    const rest = this.#supervisor.rest;
    const { clock } = this.#o;
    const started = clock.now();
    // The scans use only the time that is left of the timeout (at least 1 s).
    const left = () => Math.max(1000, options.timeoutMs - (clock.now() - started));
    // Always scan first: without it the completion showed 100 % while the peer did not have the
    // file (docs/phase-1.md 6.4.1).
    await Promise.race([this.#scans.onIdle(), clock.sleep(left())]);
    const folders = [...this.#folders.values()];
    const scans = await Promise.allSettled(folders.map((f) => rest.scan(f.id, undefined, left())));
    scans.forEach((scan, i) => {
      // A folder that fails its scan (for example a missing folder path) does not stop Sync now:
      // the completion of the peers still says what is not synced.
      if (scan.status === "rejected") {
        this.#o.log.warn(
          { err: scan.reason as unknown, folder: folders[i]!.id },
          "A folder scan of Sync now failed",
        );
      }
    });
    for (;;) {
      const peers = await this.status();
      const timedOut = clock.now() - started >= options.timeoutMs;
      const waiting = peers.filter((p) => p.connected && !p.inSync);
      if (waiting.length === 0 || timedOut) {
        void this.sweep();
        return {
          at: this.#now(),
          pending: peers
            .map((p) => pendingOf(p, true))
            .filter((p): p is NonNullable<typeof p> => p !== null),
        };
      }
      await clock.sleep(SYNC_NOW_POLL_MS);
    }
  }

  async pause(): Promise<void> {
    await this.#supervisor.rest.pause();
    this.#paused = true;
  }

  /** Resumes, with the short reconnect interval until each peer is connected again. */
  async resume(): Promise<void> {
    const rest = this.#supervisor.rest;
    const until = this.#o.clock.now() + PAIRING_MAX_MS;
    for (const peer of this.#peers) this.#pairing.set(peer.sync_id, until);
    await this.#setReconnect(rest);
    await rest.resume();
    this.#paused = false;
    void this.#o.clock.sleep(PAIRING_STABLE_MS + 500).then(() => this.#checkPairing());
  }

  // ---- Events --------------------------------------------------------------------------------

  events(): AsyncIterable<SyncEvent> {
    const queue: SyncEvent[] = [];
    let wake: (() => void) | null = null;
    const listener: Listener = (event) => {
      queue.push(event);
      wake?.();
    };
    this.#listeners.add(listener);
    const listeners = this.#listeners;
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<SyncEvent>> => {
          while (queue.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
          }
          return { value: queue.shift()!, done: false };
        },
        return: (): Promise<IteratorResult<SyncEvent>> => {
          listeners.delete(listener);
          return Promise.resolve({ value: undefined, done: true });
        },
      }),
    };
  }

  /** A long-poll loop. A new engine generation starts again at the first event (6.5.1). */
  async #pump(kind: "engine" | "disk"): Promise<void> {
    let since = 0;
    let generation = -1;
    while (!this.#stopped) {
      const rest = this.#supervisor.restOrNull;
      if (!rest) {
        await this.#o.clock.sleep(250);
        continue;
      }
      if (this.#supervisor.generation !== generation) {
        generation = this.#supervisor.generation;
        since = 0;
      }
      let events: EngineEvent[];
      try {
        events =
          kind === "engine" ? await rest.events(since, 30) : await rest.diskEvents(since, 30);
      } catch (error) {
        if (!this.#stopped) {
          this.#o.log.debug({ err: error, kind }, "An engine event poll failed");
          await this.#o.clock.sleep(500);
        }
        continue;
      }
      for (const event of events) {
        since = Math.max(since, event.id);
        try {
          if (kind === "engine") this.#onEngineEvent(event);
          else await this.#onDiskEvent(event);
        } catch (error) {
          this.#o.log.warn({ err: error, type: event.type }, "An engine event was not handled");
        }
      }
    }
  }

  #onEngineEvent(event: EngineEvent): void {
    const data = event.data ?? {};
    const at = this.#now();
    switch (event.type) {
      case "DeviceConnected": {
        const id = text(data.id);
        this.#connected.add(id);
        void this.#o.clock.sleep(PAIRING_STABLE_MS + 500).then(() => this.#checkPairing());
        const peer = this.#peers.find((p) => p.sync_id === id);
        if (peer) this.#emit({ type: "peer", device: peer.device, connected: true, at });
        // A copy can arrive soon after a reconnect.
        void this.#o.clock.sleep(3000).then(() => this.sweep());
        break;
      }
      case "DeviceDisconnected": {
        const id = text(data.id);
        this.#connected.delete(id);
        const peer = this.#peers.find((p) => p.sync_id === id);
        if (peer) this.#emit({ type: "peer", device: peer.device, connected: false, at });
        break;
      }
      case "FolderCompletion": {
        // The moment a peer gets the last change of a folder: "Synced 12 s ago" counts from here.
        const peer = this.#peers.find((p) => p.sync_id === text(data.device));
        const need = Number(data.needItems ?? 1) + Number(data.needDeletes ?? 0);
        const state = data.remoteState;
        if (peer && need === 0 && (state === undefined || state === "valid")) {
          this.#lastSynced.set(peer.device, text(event.time) || at);
        }
        break;
      }
      case "StateChanged":
        this.#emit({
          type: "folder",
          folder: text(data.folder),
          state: text(data.to),
          at,
        });
        break;
      default:
        break;
    }
  }

  async #onDiskEvent(event: EngineEvent): Promise<void> {
    const data = event.data ?? {};
    const folder = this.#folders.get(text(data.folder));
    if (!folder || typeof data.path !== "string") return;
    const path = `${folder.kind}/${data.path.split(sep).join("/")}`;
    const local = event.type === "LocalChangeDetected";
    this.#emit({ type: "changed", folder: folder.id, path, local, at: this.#now() });
    if (isConflictCopy(path)) {
      if (data.action !== "deleted") await this.#resolve(folder.workspace, path);
      return;
    }
    if (local && data.type === "file" && data.action !== "deleted") {
      // A human edit counts as a write of this device (docs/phase-1.md 6.6.3).
      const bytes = await readFile(join(folder.path, ...String(data.path).split("/"))).catch(
        () => null,
      );
      if (!bytes) return;
      const sha = sha256Hex(bytes);
      const key = `${folder.workspace}\n${path}`;
      // The disk event of a version that the resolver restored: another device wrote it.
      if (this.#foreignWrites.get(key) === sha) return;
      this.#foreignWrites.delete(key);
      await this.#journal.add(folder.workspace, path, sha);
    }
  }

  // ---- Conflicts -----------------------------------------------------------------------------

  /** The rank of each device of a workspace: this device and each peer in one total order. */
  #ranks(workspace: string): (device: string) => number {
    return rankOf(
      [{ device: this.#device.slug, role: this.#device.role }, ...this.#peers],
      this.#o.deviceOrder?.(workspace) ?? [],
    );
  }

  /** True when no connected peer has a higher priority than this device. */
  #elected(workspace: string): boolean {
    const connected = new Set(
      this.#peers.filter((p) => this.#connected.has(p.sync_id)).map((p) => p.device),
    );
    return isElected(
      { device: this.#device.slug, role: this.#device.role },
      this.#peers,
      (device) => connected.has(device),
      this.#o.deviceOrder?.(workspace) ?? [],
    );
  }

  #resolve(workspace: string, copy: string): Promise<ResolveOutcome | null> {
    let queue = this.#resolving.get(workspace);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.#resolving.set(workspace, queue);
    }
    return queue.add(async () => {
      const files = this.#o.files?.(workspace);
      const rest = this.#supervisor.restOrNull;
      if (!files || !rest) return null;
      const rank = this.#ranks(workspace);
      const me: Author = { device: this.#device.slug, rank: rank(this.#device.slug) };
      const authorOf = (peer: PeerRecord): Author => ({
        device: peer.device,
        rank: rank(peer.device),
      });
      const myShort = shortId(this.#supervisor.deviceId ?? "");
      // The resolver writes the version of another device: not a write of this device.
      const original = parseConflictCopy(copy)?.original;
      const key = original === undefined ? null : `${workspace}\n${original}`;
      if (key) this.#resolverWrites.add(key);
      const outcome = await resolveCopy(copy, {
        workspace,
        files,
        journal: this.#journal,
        me,
        byShortId: (short) => {
          if (short === myShort) return me;
          const peer = this.#peers.find((p) => shortId(p.sync_id) === short);
          return peer ? authorOf(peer) : null;
        },
        folderDevices: (path) => {
          const kind = path.split("/")[0] as SyncFolderKind;
          return [me, ...this.#peersOf(kind).map(authorOf)];
        },
        originalModifiedBy: async (path) => {
          const target = this.#folderOf(workspace, path);
          if (!target) return null;
          return (await rest.file(target.folder.id, target.sub)).global?.modifiedBy ?? null;
        },
        elected: () => this.#elected(workspace),
        historyDir: join(this.#o.home, "history", workspace),
        log: this.#o.log,
      }).finally(() => {
        if (key) this.#resolverWrites.delete(key);
      });
      const level = outcome.action.startsWith("left") ? "debug" : "info";
      this.#o.log[level]({ ...outcome, workspace }, "Conflict copy handled");
      this.#emit({
        type: "conflict",
        folder: this.#folderOf(workspace, copy)?.folder.id ?? "",
        path: copy,
        action: outcome.action,
        at: this.#now(),
      });
      return outcome;
    });
  }

  /** Finds each conflict copy in the folders and resolves it (start, reconnect, Sync now). */
  async sweep(): Promise<ResolveOutcome[]> {
    const outcomes: ResolveOutcome[] = [];
    for (const folder of this.#folders.values()) {
      let entries;
      try {
        entries = await readdir(folder.path, { recursive: true, withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.includes(".sync-conflict-")) continue;
        const rel = relative(folder.path, join(entry.parentPath, entry.name)).split(sep).join("/");
        if (rel.startsWith(".stfolder") || rel.startsWith(".stversions")) continue;
        const outcome = await this.#resolve(folder.workspace, `${folder.kind}/${rel}`).catch(
          (error: unknown) => {
            this.#o.log.warn({ err: error, path: rel }, "A conflict copy was not resolved");
            return null;
          },
        );
        if (outcome) outcomes.push(outcome);
      }
    }
    return outcomes;
  }
}
