// The device records of each workspace (openspec add-identity-and-pairing, device-identity): the
// own record of the device with the master key, the peers from the valid records, the revoke and
// the list. It also runs the periodic checks of the credentials (phone outbox, secrets).
import type { Clock } from "@aw/core";
import type { PeerRecord } from "@aw/plugin-api";
import type { DeviceDocument, DeviceRole } from "@aw/schema";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { Logger } from "../log.ts";
import type { CredentialService } from "./credentials.ts";
import { invalid, notFound, ServiceError } from "./errors.ts";
import { newestRecords, type IdentityService } from "./identity.ts";
import { isRevoked, revokedIdentities } from "./revoked.ts";
import type { SyncService } from "./sync.ts";
import type { WorkspaceService } from "./workspace.ts";

/** The raw value of `tasks/devices/<slug>/device.yaml` on disk, or null (no file, no YAML). */
export async function rawRecordOf(root: string, slug: string): Promise<unknown> {
  const text = await readFile(join(root, "tasks", "devices", slug, "device.yaml"), "utf8").catch(
    () => null,
  );
  if (text === null) return null;
  try {
    return parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * The longest wait of a revoke for the revoked device to get its record (PRD NFR-06: a revoke takes
 * effect within 10 s on online devices).
 */
export const REVOKE_DELIVERY_MS = 10_000;

/** The period of the credential checks: the phone outbox and the secrets (design decision 14). */
export const CREDENTIAL_CHECK_MS = 10_000;

export interface DeviceEntry {
  slug: string;
  name: string;
  role: DeviceRole;
  state: "valid" | "revoked" | "bad_signature";
  sync_device_id: string;
  seq: number;
  paired_at: string;
  revoked_at: string | null;
  this_device: boolean;
}

export interface DeviceServiceDeps {
  identity: IdentityService;
  credentials: CredentialService;
  sync: () => SyncService;
  clock: Clock;
  log: Logger;
  device: () => { slug: string; name: string; role: DeviceRole };
  /** The open workspaces. */
  workspaces: () => WorkspaceService[];
  /** Saves the name and the role of this device (`config.yaml`). */
  setDevice: (device: { slug: string; name: string; role: DeviceRole }) => Promise<void>;
}

interface RecordCore {
  name: string;
  role: DeviceRole;
  keys: { ed25519: string; x25519: string };
  sync_device_id: string;
  addresses: string[];
}

function sameRecord(a: DeviceDocument, b: RecordCore): boolean {
  return (
    a.name === b.name &&
    a.role === b.role &&
    a.keys.ed25519 === b.keys.ed25519 &&
    a.keys.x25519 === b.keys.x25519 &&
    a.sync_device_id === b.sync_device_id &&
    JSON.stringify(a.addresses) === JSON.stringify(b.addresses) &&
    !a.revoked
  );
}

export class DeviceService {
  readonly #d: DeviceServiceDeps;
  #stopped = false;
  /** One peer computation at a time; a call during a run plans one more run. */
  #peersRun: Promise<void> | null = null;
  #peersAgain = false;
  #extra = new Set<string>();
  /** The sync ids of revoked devices that still get their revoke record (openspec revoke-device). */
  #delivering = new Set<string>();

  constructor(deps: DeviceServiceDeps) {
    this.#d = deps;
  }

  /**
   * Writes the record of this device on the device with the master key, when it is missing or
   * differs (keys, sync device id, name, role, addresses). It needs the engine device id.
   */
  async ensureOwnRecord(service: WorkspaceService): Promise<boolean> {
    const { identity } = this.#d;
    if (!identity.hasMaster || !service.ready) return false;
    const syncId = this.#d.sync().transport?.syncId ?? null;
    if (syncId === null) return false;
    const me = this.#d.device();
    const kept = service.deviceRecords().find((r) => r.slug === me.slug);
    const fields = identity.ownFields({
      slug: me.slug,
      name: me.name,
      role: me.role,
      syncId,
      seq: (kept?.seq ?? 0) + 1,
      pairedAt: kept?.paired_at ?? new Date(this.#d.clock.now()).toISOString(),
    });
    if (kept && sameRecord(kept, fields)) return false;
    const record = identity.sign(fields);
    await service.write((files) =>
      files.writeDocument(`tasks/devices/${me.slug}/device.yaml`, record),
    );
    this.#d.log.info({ workspace: service.id, seq: record.seq }, "Own device record written");
    return true;
  }

  /**
   * On the device with the master key: writes a kept record again when its file is missing, has
   * no valid signature, has a lower `seq`, or drops the revoke. So a revoked device cannot undo a
   * revoke on a device that did not see it: the newest record always wins again (a durable
   * revoke). Returns the slugs that it wrote.
   */
  async restoreRecords(service: WorkspaceService): Promise<string[]> {
    const { identity } = this.#d;
    if (!identity.hasMaster || !service.ready) return [];
    const written: string[] = [];
    for (const kept of newestRecords(service.deviceRecords())) {
      const raw = (await rawRecordOf(service.root, kept.slug)) as Partial<DeviceDocument> | null;
      const current =
        raw !== null &&
        identity.verify(raw) &&
        typeof raw.seq === "number" &&
        raw.seq >= kept.seq &&
        (!kept.revoked || raw.revoked === true);
      if (current || !identity.verify(kept)) continue;
      await service.write((files) =>
        files.writeDocument(`tasks/devices/${kept.slug}/device.yaml`, kept),
      );
      written.push(kept.slug);
      this.#d.log.warn(
        { workspace: service.id, device: kept.slug, seq: kept.seq, revoked: kept.revoked },
        "A device record on disk was missing or older: the newest valid record is written again",
      );
    }
    return written;
  }

  /** The valid records of a workspace: the merged records and the pairing cache, highest `seq`. */
  async recordsOf(service: WorkspaceService): Promise<DeviceDocument[]> {
    if (this.#d.identity.masterPublic === null) return [];
    return newestRecords([
      ...(await this.#d.identity.cachedRecords(service.id)),
      ...service.deviceRecords(),
    ]);
  }

  /** Computes the sync peers from the valid, not revoked records of each workspace. */
  refreshPeers(extra: string[] = []): Promise<void> {
    for (const ws of extra) this.#extra.add(ws);
    if (this.#peersRun) {
      this.#peersAgain = true;
      return this.#peersRun;
    }
    this.#peersRun = (async () => {
      try {
        do {
          this.#peersAgain = false;
          await this.#refreshPeersNow();
        } while (this.#peersAgain && !this.#stopped);
      } finally {
        this.#peersRun = null;
      }
    })();
    return this.#peersRun;
  }

  /**
   * The newest record of each slug per workspace, of the open workspaces and of the workspaces of a
   * join (`#extra`): each workspace has its own `seq` counter, so records of 2 workspaces are never
   * compared by `seq`. The peer rule and the revoke read the same sets (revoke-device review low 1).
   */
  async #recordSets(): Promise<DeviceDocument[][]> {
    const perWorkspace: DeviceDocument[][] = [];
    const open = new Set<string>();
    for (const service of this.#d.workspaces()) {
      if (!service.ready) continue;
      open.add(service.id);
      perWorkspace.push(await this.recordsOf(service));
    }
    for (const ws of this.#extra) {
      if (!open.has(ws)) perWorkspace.push(newestRecords(await this.#d.identity.cachedRecords(ws)));
    }
    return perWorkspace;
  }

  async #refreshPeersNow(): Promise<void> {
    const { identity } = this.#d;
    if (identity.masterPublic === null) return;
    const me = this.#d.device();
    const perWorkspace = await this.#recordSets();
    // A device that one workspace revoked is no peer: its device key and its engine id are out.
    // Exception: a device that a revoke of this awd still delivers its record to (at most
    // REVOKE_DELIVERY_MS).
    const revoked = revokedIdentities(perWorkspace.flat());
    const ownKey = identity.device.ed25519;
    const bySyncId = new Map<string, PeerRecord>();
    for (const r of perWorkspace.flat()) {
      if (r.slug === me.slug || r.keys.ed25519 === ownKey) continue;
      if (isRevoked(r, revoked) && !this.#delivering.has(r.sync_device_id)) continue;
      if (bySyncId.has(r.sync_device_id)) continue;
      bySyncId.set(r.sync_device_id, {
        device: r.slug,
        sync_id: r.sync_device_id,
        role: r.role,
        addresses: [...r.addresses, "dynamic"],
      });
    }
    const peers = [...bySyncId.values()].sort((a, b) => (a.device < b.device ? -1 : 1));
    await this.#d.sync().setPeers(peers);
  }

  /** The devices of a workspace with their state. */
  async list(service: WorkspaceService): Promise<DeviceEntry[]> {
    const me = this.#d.device();
    const records = await this.recordsOf(service);
    const bad = new Set(
      service.view.issues
        .filter((i) => i.reason === "bad_signature" && i.path?.startsWith("tasks/devices/"))
        .map((i) => i.path.split("/")[2]!),
    );
    const entries: DeviceEntry[] = records.map((r) => ({
      slug: r.slug,
      name: r.name,
      role: r.role,
      state: r.revoked ? "revoked" : "valid",
      sync_device_id: r.sync_device_id,
      seq: r.seq,
      paired_at: r.paired_at,
      revoked_at: r.revoked_at,
      this_device: r.slug === me.slug,
    }));
    for (const slug of bad) {
      const entry = entries.find((e) => e.slug === slug);
      if (entry && entry.state === "valid") entry.state = "bad_signature";
    }
    return entries;
  }

  /**
   * Revokes a device (docs/phase-1.md 6.8): a signed record with `revoked: true`, `seq` + 1 and
   * `revoked_at`, a new credential key for the remaining computers, and the peer removed.
   */
  async revoke(
    service: WorkspaceService,
    slug: string,
  ): Promise<{
    record: DeviceDocument;
    credentials: number;
    closed: string[];
    /** True when the engine confirmed that the revoked device has its revoke record. */
    delivered: boolean;
  }> {
    const { identity } = this.#d;
    if (!identity.hasMaster) {
      throw new ServiceError("refused", "Only a device with the master key revokes a device");
    }
    const me = this.#d.device();
    if (slug === me.slug) throw invalid("A device cannot revoke itself");
    const records = await this.recordsOf(service);
    const target = records.find((r) => r.slug === slug);
    if (!target) throw notFound(`Device ${slug}`);
    const path = `tasks/devices/${slug}/device.yaml`;
    // The revoked device stays a peer until it has its revoke record, so it stops its sessions
    // (docs/phase-1.md 6.8.2). Each peer refresh during the wait keeps it.
    // Only a device that no workspace revoked yet is a peer now.
    const syncId = target.sync_device_id;
    const all = await this.#recordSets();
    const delivering =
      !isRevoked(target, revokedIdentities(all.flat())) && !this.#delivering.has(syncId);
    if (delivering) this.#delivering.add(syncId);
    let record!: DeviceDocument;
    let credentials: number;
    let closed: string[];
    let delivered = false;
    try {
      await service.write(async (files) => {
        record = identity.sign(identity.revokeFields(target, files.hlc.now()));
        await files.writeDocument(path, record);
      });
      const remaining = records.filter((r) => r.slug !== slug && !r.revoked);
      ({ count: credentials, closed } = await this.#d.credentials.rotate(service, remaining));
      if (delivering) {
        await this.refreshPeers();
        delivered = await this.#d
          .sync()
          // The sync id: the peer list keeps one slug per sync id (revoke-device review low 3).
          .waitDelivered(syncId, service.id, path, REVOKE_DELIVERY_MS)
          .catch(() => false);
      }
    } finally {
      if (delivering) this.#delivering.delete(syncId);
      // Also after an error (a failed rotation): the revoked device is never a peer after this.
      await this.refreshPeers();
    }
    this.#d.log.info(
      { workspace: service.id, device: slug, credentials, closed: closed.length, delivered },
      "Device revoked",
    );
    return { record, credentials, closed, delivered };
  }

  /**
   * A device without the master key takes the name and the role of its own valid record (the
   * record wins over `config.yaml`; the slug changes only by pairing).
   */
  async #followOwnRecord(service: WorkspaceService): Promise<void> {
    if (this.#d.identity.hasMaster || this.#d.identity.masterPublic === null) return;
    const me = this.#d.device();
    const key = this.#d.identity.device.ed25519;
    const own = (await this.recordsOf(service)).find(
      (r) => r.slug === me.slug && r.keys.ed25519 === key && !r.revoked,
    );
    if (own && (own.name !== me.name || own.role !== me.role)) {
      await this.#d.setDevice({ slug: me.slug, name: own.name, role: own.role });
      this.#d.log.info(
        { name: own.name, role: own.role },
        "config.yaml follows the own device record",
      );
    }
  }

  /** After an open, an engine start or a change of the documents: the own record and the peers. */
  async reconcile(service?: WorkspaceService): Promise<void> {
    const services = service ? [service] : this.#d.workspaces();
    for (const ws of services) {
      try {
        await this.#followOwnRecord(ws);
        await this.ensureOwnRecord(ws);
        await this.restoreRecords(ws);
      } catch (error) {
        this.#d.log.error(
          { err: error, workspace: ws.id },
          "The own device record was not written",
        );
      }
    }
    await this.refreshPeers().catch((error: unknown) => {
      this.#d.log.error({ err: error }, "The sync peers were not set");
    });
  }

  /** The credential checks of each workspace: the key, the secrets and the phone outbox. */
  async checkCredentials(): Promise<void> {
    for (const service of this.#d.workspaces()) {
      if (!service.ready || service.device.role === "mobile") continue;
      try {
        await this.#d.credentials.ensureKey(service);
        await this.#d.credentials.refreshSecrets(service);
        await this.#d.credentials.importSealed(service);
      } catch (error) {
        this.#d.log.warn({ err: error, workspace: service.id }, "The credential check failed");
      }
    }
  }

  /** Runs the credential checks every CREDENTIAL_CHECK_MS until stop(). */
  loop(): void {
    void (async () => {
      while (!this.#stopped) {
        await this.#d.clock.sleep(CREDENTIAL_CHECK_MS);
        if (this.#stopped) break;
        await this.checkCredentials();
      }
    })();
  }

  stop(): void {
    this.#stopped = true;
  }
}
