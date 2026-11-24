// The identity of this device (docs/architecture.md 4.1; openspec add-identity-and-pairing): the
// device key and the recovery phrase in the keystore, `identity.yaml` (the user id and the master
// public key), the signed device records, the check of each record and the revoke.
import { writeFileAtomic } from "@aw/core";
import {
  deviceKeyOf,
  deviceSecretSchema,
  fromBase64,
  masterFromPhrase,
  newDeviceKey,
  newRecoveryPhrase,
  openKeystore,
  signRecord,
  toBase64,
  userIdOf,
  verifyRecord,
  type DeviceKey,
  type Keystore,
  type MasterKey,
} from "@aw/identity";
import { deviceV1, uuidv7, type DeviceDocument, type DeviceRole } from "@aw/schema";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { Logger } from "../log.ts";
import type { Settings } from "../settings.ts";
import { invalid, ServiceError } from "./errors.ts";

export const KEY_DEVICE = "device";
export const KEY_PHRASE = "master-phrase";

export const identityFile = z.object({
  kind: z.literal("aw-identity"),
  schema: z.literal(1),
  /** The user id, or null before this device has an identity. */
  user: z.string().nullable(),
  /** The master public key, base64, or null. */
  master_public: z.string().nullable(),
});
export type IdentityFile = z.infer<typeof identityFile>;

/** A signed device record as written: each field explicit (design decision 6). */
export type RecordFields = Pick<
  DeviceDocument,
  | "kind"
  | "schema"
  | "slug"
  | "name"
  | "role"
  | "keys"
  | "sync_device_id"
  | "seq"
  | "revoked"
  | "revoked_at"
  | "addresses"
  | "paired_at"
>;

/** The engine addresses of this device: each IPv4 LAN address with the listen port. */
export function localAddresses(listen: string): string[] {
  const match = /^tcp[46]?:\/\/(.+):(\d+)$/.exec(listen);
  if (!match) return [];
  const [, host, port] = match;
  if (host !== "0.0.0.0" && host !== "[::]" && host !== "::") return [`tcp://${host}:${port}`];
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) out.push(`tcp://${item.address}:${port}`);
    }
  }
  return [...new Set(out)].sort().slice(0, 8);
}

export interface IdentityServiceOptions {
  settings: Settings;
  log: Logger;
  /** The keystore; default from `settings.keystore`. Tests give a file keystore. */
  keystore?: Keystore;
}

export class IdentityService {
  readonly #settings: Settings;
  readonly #log: Logger;
  readonly #keystore: Keystore;
  #device: DeviceKey | null = null;
  #master: MasterKey | null = null;
  #file: IdentityFile = { kind: "aw-identity", schema: 1, user: null, master_public: null };

  constructor(options: IdentityServiceOptions) {
    this.#settings = options.settings;
    this.#log = options.log;
    this.#keystore =
      options.keystore ?? openKeystore(options.settings.keystore, options.settings.home);
  }

  get #path(): string {
    return join(this.#settings.home, "identity.yaml");
  }

  /** Reads the device key (makes it at the first start), `identity.yaml` and the master key. */
  async load(): Promise<void> {
    const stored = await this.#keystore.get(KEY_DEVICE);
    if (stored === null) {
      this.#device = await newDeviceKey();
      await this.#keystore.set(KEY_DEVICE, JSON.stringify(this.#device.secret));
      this.#log.info({ keystore: this.#keystore.kind }, "Device key created");
    } else {
      this.#device = await deviceKeyOf(deviceSecretSchema.parse(JSON.parse(stored)));
    }
    const text = await readFile(this.#path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (text !== null) this.#file = identityFile.parse(parse(text));
    const phrase = await this.#keystore.get(KEY_PHRASE);
    if (phrase !== null) {
      this.#master = masterFromPhrase(phrase);
      if (this.#file.user === null) {
        // createMaster() stopped after the keystore write and before identity.yaml: repair it.
        this.#file = {
          ...this.#file,
          user: this.#master.user,
          master_public: toBase64(this.#master.public),
        };
        await this.#save();
        this.#log.warn({ user: this.#master.user }, "identity.yaml repaired from the keystore");
      }
      if (this.#file.user !== this.#master.user) {
        throw new Error(
          `${this.#path} names the user ${this.#file.user}, but the keystore has the recovery phrase of ${this.#master.user}`,
        );
      }
    }
  }

  async #save(): Promise<void> {
    await mkdir(this.#settings.home, { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.#path, stringify(identityFile.parse(this.#file)));
    await chmod(this.#path, 0o600);
  }

  get device(): DeviceKey {
    if (!this.#device) throw new ServiceError("not_ready", "awd is starting");
    return this.#device;
  }

  get keystoreKind() {
    return this.#keystore.kind;
  }

  get user(): string | null {
    return this.#file.user;
  }

  get masterPublic(): string | null {
    return this.#file.master_public;
  }

  get hasMaster(): boolean {
    return this.#master !== null;
  }

  /** The record check of the merge: only when this device knows the master public key. */
  verifier(): ((raw: unknown) => boolean) | undefined {
    const pub = this.#file.master_public;
    if (pub === null) return undefined;
    const key = fromBase64(pub);
    return (raw) => verifyRecord(raw, key);
  }

  verify(raw: unknown): boolean {
    return this.verifier()?.(raw) ?? false;
  }

  /** Makes the master key of a new identity (the local device, design decision 5). */
  async createMaster(): Promise<void> {
    if (this.#master) return;
    if (this.#file.user !== null) {
      throw new ServiceError(
        "refused",
        `This device belongs to the identity ${this.#file.user} and has no master key`,
      );
    }
    const phrase = newRecoveryPhrase();
    const master = masterFromPhrase(phrase);
    await this.#keystore.set(KEY_PHRASE, phrase);
    this.#master = master;
    this.#file = { ...this.#file, user: master.user, master_public: toBase64(master.public) };
    await this.#save();
    this.#log.info({ user: master.user }, "Master key created");
  }

  /** Saves the identity of a pairing (the new device has no master key). */
  async adopt(masterPublic: string): Promise<void> {
    if (this.#master) throw new ServiceError("refused", "This device has its own master key");
    const user = userIdOf(fromBase64(masterPublic));
    if (this.#file.user !== null && this.#file.user !== user) {
      throw new ServiceError(
        "refused",
        `This device belongs to the identity ${this.#file.user}, not to ${user}`,
      );
    }
    this.#file = { ...this.#file, user, master_public: masterPublic };
    await this.#save();
  }

  /** The recovery phrase: only on a device with the master key. */
  async phrase(): Promise<string> {
    if (!this.#master) {
      throw new ServiceError("refused", "This device has no master key, so it has no phrase");
    }
    const phrase = await this.#keystore.get(KEY_PHRASE);
    if (phrase === null) throw new ServiceError("internal", "The keystore has no recovery phrase");
    return phrase;
  }

  /** Signs a record with the master key. Each field must be explicit. */
  sign(fields: RecordFields): DeviceDocument {
    if (!this.#master) {
      throw new ServiceError("refused", "Only a device with the master key signs a device record");
    }
    // Sign the fields as the YAML file has them: no undefined value, each field explicit.
    const explicit = JSON.parse(JSON.stringify(fields)) as Record<string, unknown>;
    delete explicit.signature;
    const signed = signRecord(explicit, this.#master.secret);
    const parsed = deviceV1.safeParse(signed);
    if (!parsed.success) throw invalid(`The device record is not valid: ${parsed.error.message}`);
    return signed as unknown as DeviceDocument;
  }

  /** The record of this device with its keys. */
  ownFields(input: {
    slug: string;
    name: string;
    role: DeviceRole;
    syncId: string;
    seq: number;
    pairedAt: string;
  }): RecordFields {
    const key = this.device;
    return {
      kind: "device",
      schema: 1,
      slug: input.slug,
      name: input.name,
      role: input.role,
      keys: { ed25519: key.ed25519, x25519: key.x25519 },
      sync_device_id: input.syncId,
      seq: input.seq,
      revoked: false,
      revoked_at: null,
      addresses: localAddresses(this.#settings.sync.listen),
      paired_at: input.pairedAt,
    };
  }

  /** A revoke record: `revoked: true`, `seq` + 1, `revoked_at`. */
  revokeFields(record: DeviceDocument, revokedAt: string): RecordFields {
    if (record.revoked) throw invalid(`The device ${record.slug} is revoked already`);
    const fields = { ...record } as Partial<DeviceDocument>;
    delete fields.signature;
    return {
      ...(fields as RecordFields),
      seq: record.seq + 1,
      revoked: true,
      revoked_at: revokedAt,
    };
  }

  // ---- The pairing cache: the signed records of a pairing reply, before the tasks folder syncs.

  /** The cache file of a workspace id, or null when the id is not a UUIDv7 (never a path). */
  #cachePath(workspace: string): string | null {
    if (!uuidv7.safeParse(workspace).success) return null;
    return join(this.#settings.home, "records", `${workspace}.json`);
  }

  async cacheRecords(workspace: string, records: unknown[]): Promise<void> {
    const path = this.#cachePath(workspace);
    if (path === null) throw invalid(`${workspace} is not a workspace id`);
    await mkdir(join(this.#settings.home, "records"), { recursive: true, mode: 0o700 });
    await writeFileAtomic(path, `${JSON.stringify(records, null, 2)}\n`);
  }

  /** The valid records of the pairing cache. */
  async cachedRecords(workspace: string): Promise<DeviceDocument[]> {
    const path = this.#cachePath(workspace);
    if (path === null) return [];
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) return [];
    const raw = JSON.parse(text) as unknown[];
    const out: DeviceDocument[] = [];
    for (const item of raw) {
      const parsed = deviceV1.safeParse(item);
      if (parsed.success && this.verify(item)) out.push(parsed.data);
    }
    return out;
  }
}

/** For each slug, the record with the highest `seq`. */
export function newestRecords(records: Iterable<DeviceDocument>): DeviceDocument[] {
  const bySlug = new Map<string, DeviceDocument>();
  for (const record of records) {
    const old = bySlug.get(record.slug);
    if (!old || record.seq > old.seq) bySlug.set(record.slug, record);
  }
  return [...bySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
