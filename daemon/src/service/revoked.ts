// The revoke rule of awd for each workspace (docs/phase-1.md 6.8.4, openspec revoke-device): a
// device whose device key or sync device id one workspace revoked is no peer and gets no push.
import type { DeviceDocument } from "@aw/schema";

export interface RevokedIdentities {
  keys: ReadonlySet<string>;
  syncIds: ReadonlySet<string>;
}

/** The device keys and the sync device ids of the revoked records (of all workspaces). */
export function revokedIdentities(records: Iterable<DeviceDocument>): RevokedIdentities {
  const keys = new Set<string>();
  const syncIds = new Set<string>();
  for (const r of records) {
    if (!r.revoked) continue;
    keys.add(r.keys.ed25519);
    syncIds.add(r.sync_device_id);
  }
  return { keys, syncIds };
}

/** True when the record is revoked, or another revoked record has its device key or sync id. */
export function isRevoked(record: DeviceDocument, revoked: RevokedIdentities): boolean {
  return (
    record.revoked ||
    revoked.keys.has(record.keys.ed25519) ||
    revoked.syncIds.has(record.sync_device_id)
  );
}
