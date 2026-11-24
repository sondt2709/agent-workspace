// The sync state of each peer (docs/phase-1.md 6.4, 6.5). A peer is synced only when it is
// connected and each shared folder has 0 items to get and a valid remote state. The total
// completion is never used: it showed 100 % while the peer did not have the file (ST8).
import type { FolderPeerStatus, PeerRoute, PeerStatus, SyncPending } from "@aw/plugin-api";
import type { EngineCompletion, EngineConnection } from "./rest.ts";

/** True when an IPv4 address is in the Tailscale range 100.64.0.0/10. */
export function isTailscale(address: string): boolean {
  const host = /^\[?([0-9.]+)\]?(?::\d+)?$/.exec(address)?.[1];
  if (!host) return false;
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}

/** The route of a connection (docs/phase-1.md 6.5.2). */
export function routeOf(connection: EngineConnection | undefined): PeerRoute | undefined {
  if (!connection?.connected) return undefined;
  if (connection.type.includes("relay")) return "relay";
  if (isTailscale(connection.address)) return "tailscale";
  return connection.isLocal ? "lan" : "internet";
}

/** The status of one folder for one peer. */
export function folderStatus(
  folder: Omit<
    FolderPeerStatus,
    "needItems" | "needBytes" | "remoteState" | "inSync" | "completion"
  >,
  completion: EngineCompletion | null,
  connected: boolean,
): FolderPeerStatus {
  const needItems = completion ? completion.needItems + (completion.needDeletes ?? 0) : 0;
  const remoteState = completion?.remoteState ?? "unknown";
  return {
    ...folder,
    needItems,
    needBytes: completion?.needBytes ?? 0,
    remoteState,
    // The engine percent, only for a text such as "Waiting for sync: knowledge 92 %".
    completion: completion?.completion ?? null,
    inSync: connected && completion !== null && needItems === 0 && remoteState === "valid",
  };
}

/**
 * The time of "Synced 12 s ago" after a status poll: the time of the last FolderCompletion of the
 * peer. A poll sets it only when it sees the peer in sync the first time; a poll never moves it
 * (kb-4: the rule as a pure function, so a test of it does not race a FolderCompletion event).
 */
export function lastSyncedAfterPoll(
  known: string | undefined,
  inSync: boolean,
  now: string,
): string | undefined {
  return known ?? (inSync ? now : undefined);
}

/** Joins the folder states of a peer. */
export function peerStatus(input: {
  device: string;
  role?: PeerStatus["role"];
  connection: EngineConnection | undefined;
  folders: FolderPeerStatus[];
  lastSeen?: string | undefined;
  lastSynced?: string | undefined;
}): PeerStatus {
  const connected = input.connection?.connected ?? false;
  const route = routeOf(input.connection);
  const needItems = input.folders.reduce((n, f) => n + f.needItems, 0);
  const needBytes = input.folders.reduce((n, f) => n + f.needBytes, 0);
  return {
    device: input.device,
    connected,
    ...(route ? { route } : {}),
    needItems,
    needBytes,
    inSync: connected && input.folders.every((f) => f.inSync),
    ...(input.lastSeen ? { lastSeen: input.lastSeen } : {}),
    ...(input.lastSynced ? { lastSynced: input.lastSynced } : {}),
    ...(input.role ? { role: input.role } : {}),
    folders: input.folders,
  };
}

/** The pending entry of a peer that is not synced, or null. */
export function pendingOf(peer: PeerStatus, timedOut: boolean): SyncPending | null {
  if (peer.inSync) return null;
  if (!peer.connected) return { device: peer.device, items: peer.needItems, reason: "offline" };
  return timedOut ? { device: peer.device, items: peer.needItems, reason: "timeout" } : null;
}

/** "12 s ago", "5 min ago", "3 h ago", "2 d ago". */
export function ago(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function changes(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

/**
 * The status text of a peer (docs/decisions/2026-11-22-device-sync.md sync 10): "Synced 12 s ago",
 * "3 changes not synced to ubuntu-01 (offline)" or "(syncing)".
 */
export function describePeer(peer: PeerStatus, now: number): string {
  if (peer.inSync) {
    return peer.lastSynced ? `Synced ${ago(peer.lastSynced, now)}` : "Synced";
  }
  const why = peer.connected ? "syncing" : "offline";
  if (peer.needItems === 0) {
    return peer.connected
      ? `Checking ${peer.device} (syncing)`
      : `No changes waiting for ${peer.device} (offline)`;
  }
  return `${changes(peer.needItems)} not synced to ${peer.device} (${why})`;
}
