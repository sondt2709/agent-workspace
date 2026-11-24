// The peer list of this device: `<AW_HOME>/sync-peers.json` (mode 0600). identity-pairing
// replaces it with the signed device records and calls the same transport methods.
import { priorityRank as corePriorityRank } from "@aw/core";
import type { PeerRecord, SyncDeviceRole } from "@aw/plugin-api";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

/** A Syncthing device id: 8 groups of 7 characters. */
export const SYNC_ID = /^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The Luhn mod-32 check character of a group of 13 base32 characters (the engine rule). */
function luhnBase32(group: string): string {
  let factor = 1;
  let sum = 0;
  for (const char of group) {
    const addend = factor * BASE32.indexOf(char);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / 32) + (addend % 32);
  }
  return BASE32[(32 - (sum % 32)) % 32]!;
}

/**
 * True when a device id has the form and the 4 check characters of an engine device id: the
 * engine refuses an id with a wrong check character, so a typo is bad input here.
 */
export function isSyncId(id: string): boolean {
  if (!SYNC_ID.test(id)) return false;
  const chars = id.replaceAll("-", "");
  for (let group = 0; group < 4; group += 1) {
    const part = chars.slice(group * 14, group * 14 + 14);
    if (luhnBase32(part.slice(0, 13)) !== part[13]) return false;
  }
  return true;
}

export const peerRecordSchema = z.object({
  device: z.string().regex(SLUG),
  sync_id: z.string().refine(isSyncId, "is not a valid device id"),
  role: z.enum(["local", "remote", "mobile"]),
  addresses: z.array(z.string().min(1)).min(1),
});

const fileSchema = z.object({ peers: z.array(peerRecordSchema) });

/** A peer record that is not valid or that clashes with this device or another peer. */
export class PeerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerInputError";
  }
}

/** The short id of a device id: the first group, as in a conflict copy name. */
export function shortId(syncId: string): string {
  return syncId.slice(0, 7);
}

export async function readPeers(file: string): Promise<PeerRecord[]> {
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return [];
  return fileSchema.parse(JSON.parse(text)).peers;
}

export async function writePeers(file: string, peers: PeerRecord[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.aw-new`;
  await writeFile(temp, `${JSON.stringify({ peers }, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

/** A device and its role, for the priority rule. */
export interface RankedDevice {
  device: string;
  role: SyncDeviceRole;
}

/**
 * The priority rank of each device: lower wins. `local` first, then `remote` in the device order
 * of `workspace.yaml`, then `mobile`; the slug breaks a tie (docs/decisions/2026-11-22-device-sync.md
 * sync 6, roles 5). It is the total order of the merge (`@aw/core` `priorityRank`), so each device
 * gives the same ranks to the same devices: give this device and each peer.
 */
export function rankOf(
  devices: RankedDevice[],
  deviceOrder: readonly string[],
): (device: string) => number {
  return corePriorityRank(
    devices.map((d) => d.device),
    { roles: new Map(devices.map((d) => [d.device, d.role])), order: deviceOrder },
  );
}

/**
 * True when no connected peer has a higher priority than this device: this device resolves the
 * conflict copies of shared files. Exactly one device of a connected group is elected.
 */
export function isElected(
  me: RankedDevice,
  peers: RankedDevice[],
  connected: (device: string) => boolean,
  deviceOrder: readonly string[],
): boolean {
  const rank = rankOf([me, ...peers], deviceOrder);
  const mine = rank(me.device);
  return !peers.some((p) => connected(p.device) && rank(p.device) < mine);
}
