// The sync transport interface (docs/architecture.md 6.1). The core calls only this interface.
// Phase 1 has one transport, `syncthing` (plugins/sync-syncthing). The Kotlin app has the same one.

/** The role of a device (docs/decisions/2026-11-22-device-sync.md). */
export type SyncDeviceRole = "local" | "remote" | "mobile";

/** The 3 synced folders of a workspace (docs/phase-1.md 3.1). */
export type SyncFolderKind = "tasks" | "knowledge" | "secure";

/** A peer device of this device. identity-pairing makes it from a signed device record. */
export interface PeerRecord {
  /** The AW device slug, for example `ubuntu-01`. */
  device: string;
  /** The device id of the transport (the Syncthing device id). */
  sync_id: string;
  role: SyncDeviceRole;
  /** Addresses to dial, for example `tcp://192.0.2.10:22300`, or `dynamic`. */
  addresses: string[];
}

export interface FolderSpec {
  /** The workspace id. */
  workspace: string;
  kind: SyncFolderKind;
  /** The absolute path of the folder, for example `~/AW/<workspace>/tasks`. */
  path: string;
  /** Ignore patterns of this device. Ignores do not sync, so each device sets them. */
  ignore: string[];
}

/** The way a peer is connected. `internet` is a direct connection outside the LAN. */
export type PeerRoute = "lan" | "tailscale" | "relay" | "internet" | "storage";

export interface FolderPeerStatus {
  /** The folder id, for example `aw-<workspace>-knowledge`. */
  folder: string;
  workspace: string;
  kind: SyncFolderKind;
  needItems: number;
  needBytes: number;
  /** The remote state of the engine: `valid` means that the peer told its state. */
  remoteState: string;
  inSync: boolean;
  /**
   * The completion percent of the engine (0 to 100), or null. Only for a text: the decision uses
   * `inSync` (the percent showed 100 % before the peer had the file, ST8).
   */
  completion?: number | null;
}

export interface PeerStatus {
  device: string;
  connected: boolean;
  route?: PeerRoute;
  needItems: number;
  needBytes: number;
  /** True only when connected and each folder has 0 items to send and a valid remote state. */
  inSync: boolean;
  lastSeen?: string;
  /** The last time this device saw the peer in sync. */
  lastSynced?: string;
  role?: SyncDeviceRole;
  folders?: FolderPeerStatus[];
}

export interface SyncPending {
  device: string;
  items: number;
  reason: "offline" | "timeout";
}

export interface SyncResult {
  /** The time of the result (ISO 8601). */
  at: string;
  pending: SyncPending[];
}

/** An event of the transport, for the index and the apps. */
export type SyncEvent =
  | { type: "peer"; device: string; connected: boolean; at: string }
  | { type: "folder"; folder: string; state: string; at: string }
  | { type: "changed"; folder: string; path: string; local: boolean; at: string }
  | { type: "conflict"; folder: string; path: string; action: string; at: string }
  | { type: "engine"; state: string; at: string };

export interface SyncTransport {
  /** `syncthing`, `r2`, `iroh`, `gdrive`. */
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  addPeer(record: PeerRecord): Promise<void>;
  /** Removes a peer by its device slug (revoke). */
  removePeer(device: string): Promise<void>;
  addFolder(folder: FolderSpec): Promise<void>;
  /** Asks for a targeted scan after a write. Paths are relative to the workspace root. */
  wrote(paths: string[], workspace?: string): void;
  syncNow(options: { timeoutMs: number }): Promise<SyncResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  status(): Promise<PeerStatus[]>;
  events(): AsyncIterable<SyncEvent>;
  /**
   * Scans a path (relative to the workspace root), then waits until the peer (its engine device id,
   * or its slug) has its newest version: true. False when the peer is not connected, the path is in no folder, or the time
   * ends. The revoke uses it to give the revoked device its record before the peer goes.
   */
  waitDelivered?(
    device: string,
    workspace: string,
    path: string,
    timeoutMs: number,
  ): Promise<boolean>;
}
