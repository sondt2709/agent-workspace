// Credentials (task-model decision §4 and §5.3, docs/phase-1.md 10.2; openspec
// add-identity-and-pairing, design decisions 13 to 17): the workspace credential key sealed to
// each computer in `secure/keys/<device>.age`, the values in `secure/credentials/<name>.age`, the
// import of the phone outbox, and the secrets of the redaction. Values stay in memory only.
import type { Clock, WorkspaceFiles } from "@aw/core";
import {
  newCredentialKey,
  open,
  openCredential,
  OpenError,
  openText,
  recipientOf,
  seal,
  x25519ToRecipient,
} from "@aw/identity";
import { entryName, type DeviceDocument } from "@aw/schema";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../log.ts";
import { invalid, notFound, ServiceError } from "./errors.ts";
import type { IdentityService } from "./identity.ts";
import type { WorkspaceService } from "./workspace.ts";

export interface CredentialEntry {
  name: string;
  /** The device of the `credential.added` event, or null. */
  added_by: string | null;
  /** The devices that imported it from a phone. */
  imported_on: string[];
  /** True when `secure/credentials/<name>.age` exists on this device. */
  file: boolean;
}

/**
 * A computer without the master key imports a phone outbox file only when it is this old, so the
 * device with the master key imports it first when it is online, and 2 computers seldom write
 * the same credential file at the same time (a sync conflict).
 */
export const IMPORT_DELAY_MS = 2 * 60 * 1000;

/** The old credential keys that awd keeps in memory per workspace (the newest first). */
const OLD_KEYS = 4;
/** The id of a phone outbox file: the `sealed` field of `credential.imported`. */
const SEALED_ID = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

const keyPath = (device: string) => `secure/keys/${device}.age`;
const credentialPath = (name: string) => `secure/credentials/${name}.age`;

async function readBytes(root: string, path: string): Promise<Uint8Array | null> {
  return readFile(join(root, ...path.split("/"))).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

async function names(root: string, dir: string, suffix: string): Promise<string[]> {
  const entries = await readdir(join(root, ...dir.split("/"))).catch(() => [] as string[]);
  return entries
    .filter((n) => n.endsWith(suffix) && !n.includes(".sync-conflict-"))
    .map((n) => n.slice(0, -suffix.length))
    .sort();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Removes one trailing newline (a value from `echo` or a file). */
export function trimValue(value: string): string {
  return value.endsWith("\r\n")
    ? value.slice(0, -2)
    : value.endsWith("\n")
      ? value.slice(0, -1)
      : value;
}

export class CredentialService {
  readonly #identity: IdentityService;
  readonly #log: Logger;
  readonly #clock: Clock;
  /**
   * The open credential key of each workspace, with the sealed bytes that gave it. A revoke on
   * another computer writes a new `secure/keys/<device>.age` through sync, so each call compares
   * the bytes on disk with the cached bytes and opens the file again when they differ.
   */
  readonly #keys = new Map<string, { sealed: Uint8Array; key: string }>();
  /**
   * The credential keys before the last rotations, in memory only. A credential file that another
   * computer wrote with an old key during a revoke still opens with it; the device with the master
   * key then writes it again with the current key (refreshSecrets).
   */
  readonly #oldKeys = new Map<string, string[]>();
  /** The last secrets of each workspace: a value that does not open for a short time stays. */
  readonly #secrets = new Map<string, Map<string, string>>();
  /**
   * The values that a session got (value to name), per workspace. They stay in the redaction while
   * awd runs, also after a rotation or a remove, because a session file can still have an old value.
   */
  readonly #given = new Map<string, Map<string, string>>();
  /** The sealed ids that this process imported (before the merge has the event). */
  readonly #imported = new Set<string>();
  /** One import at a time per workspace, so 2 checks never import one file twice. */
  readonly #importing = new Map<string, Promise<string[]>>();

  constructor(options: { identity: IdentityService; log: Logger; clock: Clock }) {
    this.#identity = options.identity;
    this.#log = options.log.child({ module: "credentials" });
    this.#clock = options.clock;
  }

  #rememberOld(workspace: string, key: string): void {
    const list = (this.#oldKeys.get(workspace) ?? []).filter((k) => k !== key);
    this.#oldKeys.set(workspace, [key, ...list].slice(0, OLD_KEYS));
  }

  /**
   * Opens a credential file with the current key, else with an old key of this process. `stale`
   * is true when only an old key opens it. Throws OpenError when no key opens it.
   */
  async #openValue(
    service: WorkspaceService,
    file: Uint8Array,
    key: string,
  ): Promise<{ value: string; stale: boolean }> {
    for (const [i, candidate] of [key, ...(this.#oldKeys.get(service.id) ?? [])].entries()) {
      if (i > 0 && candidate === key) continue;
      try {
        return { value: new TextDecoder().decode(await open(file, candidate)), stale: i > 0 };
      } catch (error) {
        if (!(error instanceof OpenError)) throw error;
      }
    }
    throw new OpenError("No credential key of this device opens the file");
  }

  #computer(service: WorkspaceService): void {
    if (service.device.role === "mobile") {
      throw new ServiceError("refused", "A mobile device never gets the credential key");
    }
  }

  /** The credential key of a workspace, opened with the device key; null when this device has none. */
  async key(service: WorkspaceService): Promise<string | null> {
    const file = await readBytes(service.root, keyPath(service.device.slug));
    if (file === null) return null;
    const cached = this.#keys.get(service.id);
    if (cached && sameBytes(cached.sealed, file)) return cached.key;
    try {
      const identity = await openText(file, this.#identity.device.secret.x25519);
      if (cached && cached.key !== identity) {
        this.#log.info({ workspace: service.id }, "The credential key changed (a rotation)");
        this.#rememberOld(service.id, cached.key);
      }
      this.#keys.set(service.id, { sealed: file, key: identity });
      return identity;
    } catch (error) {
      if (error instanceof OpenError) {
        this.#log.warn({ workspace: service.id }, "The sealed credential key does not open");
        return null;
      }
      throw error;
    }
  }

  async #requireKey(service: WorkspaceService): Promise<string> {
    this.#computer(service);
    const key = await this.key(service);
    if (key === null) {
      throw new ServiceError(
        "refused",
        `This device has no credential key of the workspace yet (${keyPath(service.device.slug)}). Wait for the sync of the secure folder.`,
      );
    }
    return key;
  }

  /**
   * Makes the credential key of a workspace that has none: only on the device with the master key,
   * at the first workspace (design decision 5).
   */
  async ensureKey(service: WorkspaceService): Promise<void> {
    if (!this.#identity.hasMaster || service.device.role === "mobile") return;
    if ((await names(service.root, "secure/keys", ".age")).length > 0) return;
    const key = await newCredentialKey();
    const file = await seal(key.identity, [this.#identity.device.recipient]);
    await service.write((files) => files.writeFile(keyPath(service.device.slug), file));
    this.#keys.set(service.id, { sealed: file, key: key.identity });
    this.#log.info({ workspace: service.id }, "Credential key created");
  }

  /** Throws `refused` when this device cannot open the credential key of the workspace yet. */
  async requireKey(service: WorkspaceService): Promise<void> {
    await this.#requireKey(service);
  }

  /** Seals the credential key to the device key of a computer (pairing). */
  async sealKeyTo(service: WorkspaceService, record: DeviceDocument): Promise<void> {
    if (record.role === "mobile") return;
    const key = await this.#requireKey(service);
    const file = await seal(key, [x25519ToRecipient(record.keys.x25519)]);
    await service.write((files) => files.writeFile(keyPath(record.slug), file));
  }

  async add(service: WorkspaceService, name: string, value: string): Promise<CredentialEntry> {
    if (!entryName.safeParse(name).success) {
      throw invalid(
        `A credential name is lower case letters, digits, '-', '_' or '.', not ${name}`,
      );
    }
    const plain = trimValue(value);
    if (plain.length === 0) throw invalid("The credential value is empty");
    const key = await this.#requireKey(service);
    const file = await seal(plain, [await recipientOf(key)]);
    await service.write(async (files) => {
      await files.writeFile(credentialPath(name), file);
      await this.#event(files, service, "credential.added", { name });
    });
    await this.refreshSecrets(service);
    return this.#entry(service, name);
  }

  async #event(
    files: WorkspaceFiles,
    service: WorkspaceService,
    type: "credential.added" | "credential.removed" | "credential.imported",
    data: Record<string, unknown>,
  ): Promise<void> {
    const by =
      type === "credential.imported" ? `aw@${service.device.slug}` : `human@${service.device.slug}`;
    await files.writeEvent(`tasks/log/${service.device.slug}.jsonl`, type, data as never, { by });
  }

  async #entry(service: WorkspaceService, name: string): Promise<CredentialEntry> {
    const list = await this.list(service);
    const entry = list.find((c) => c.name === name);
    if (!entry) throw notFound(`Credential ${name}`);
    return entry;
  }

  async list(service: WorkspaceService): Promise<CredentialEntry[]> {
    const files =
      service.device.role === "mobile"
        ? []
        : await names(service.root, "secure/credentials", ".age");
    const out = new Map<string, CredentialEntry>();
    for (const view of service.view.credentials) {
      out.set(view.name, {
        name: view.name,
        added_by: view.added?.dev ?? null,
        imported_on: [...view.imported_on],
        file: files.includes(view.name),
      });
    }
    for (const name of files) {
      if (!out.has(name)) out.set(name, { name, added_by: null, imported_on: [], file: true });
    }
    return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async remove(service: WorkspaceService, name: string): Promise<void> {
    this.#computer(service);
    const exists = (await readBytes(service.root, credentialPath(name))) !== null;
    if (!exists && !service.view.credentials.some((c) => c.name === name)) {
      throw notFound(`Credential ${name}`);
    }
    await service.write(async (files) => {
      if (exists) await files.removeCredentialFile(credentialPath(name));
      await this.#event(files, service, "credential.removed", { name });
    });
    await this.refreshSecrets(service);
  }

  /** The value of a credential, for the session start (task-loop). */
  async value(service: WorkspaceService, name: string): Promise<string> {
    const key = await this.#requireKey(service);
    const file = await readBytes(service.root, credentialPath(name));
    if (file === null) throw notFound(`Credential ${name}`);
    try {
      return (await this.#openValue(service, file, key)).value;
    } catch (error) {
      if (!(error instanceof OpenError)) throw error;
      throw new ServiceError(
        "not_ready",
        `The credential ${name} does not open with the credential key of this device: wait for the sync of the secure folder (a rotation after a revoke)`,
      );
    }
  }

  /**
   * Each credential value that opens, for the redaction, and the names of the files that do not
   * open (a rotation that is half synced: the key file and the credential files arrive at
   * different times).
   */
  async #values(service: WorkspaceService): Promise<{
    key: string | null;
    values: { name: string; value: string; stale: boolean }[];
    closed: string[];
  }> {
    const key = service.device.role === "mobile" ? null : await this.key(service);
    if (key === null) return { key, values: [], closed: [] };
    const values: { name: string; value: string; stale: boolean }[] = [];
    const closed: string[] = [];
    for (const name of await names(service.root, "secure/credentials", ".age")) {
      const file = await readBytes(service.root, credentialPath(name));
      if (file === null) continue;
      try {
        values.push({ name, ...(await this.#openValue(service, file, key)) });
      } catch (error) {
        if (!(error instanceof OpenError)) throw error;
        closed.push(name);
        this.#log.warn({ workspace: service.id, credential: name }, "A credential does not open");
      }
    }
    return { key, values, closed };
  }

  /**
   * Gives each credential value to the redaction of the files layer and of the knowledge store.
   * A credential file that does not open keeps its last value, so the redaction never loses a
   * value during a rotation.
   */
  async refreshSecrets(service: WorkspaceService): Promise<number> {
    const { key, values, closed } = await this.#values(service);
    await this.#sealAgain(service, key, values);
    const before = this.#secrets.get(service.id) ?? new Map<string, string>();
    const next = new Map(values.map((v) => [v.name, v.value]));
    for (const name of closed) {
      const old = before.get(name);
      if (old !== undefined) next.set(name, old);
    }
    this.#secrets.set(service.id, next);
    const secrets = [...next].map(([name, value]) => ({ name, value }));
    const current = new Set(next.values());
    const given = [...(this.#given.get(service.id) ?? [])]
      .filter(([value]) => !current.has(value))
      .map(([value, name]) => ({ name, value }));
    service.setSecrets([...secrets, ...given]);
    return secrets.length;
  }

  /**
   * The values of the credential names of a session start (task-loop, docs/workflow.md 4.8.5).
   * A name with no value on this device (no file, no credential key, a file that does not open, a
   * mobile device) is not in the map; the log names it, never a value. Each value is in the
   * redaction before the session gets it.
   */
  async sessionValues(service: WorkspaceService, names: string[]): Promise<Map<string, string>> {
    const values = new Map<string, string>();
    for (const name of new Set(names)) {
      try {
        values.set(name, await this.value(service, name));
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
        this.#log.warn(
          { workspace: service.id, credential: name, reason: error.code },
          "A credential of a session has no value on this device",
        );
      }
    }
    if (values.size === 0) return values;
    const given = this.#given.get(service.id) ?? new Map<string, string>();
    for (const [name, value] of values) given.set(value, name);
    this.#given.set(service.id, given);
    await this.refreshSecrets(service);
    return values;
  }

  /**
   * The device with the master key writes a credential that only an old key opens again with the
   * current key (a file that another computer wrote during a revoke). Only this device does it, so
   * 2 computers never write the same file at the same time.
   */
  async #sealAgain(
    service: WorkspaceService,
    key: string | null,
    values: { name: string; value: string; stale: boolean }[],
  ): Promise<void> {
    const stale = values.filter((v) => v.stale);
    if (key === null || stale.length === 0 || !this.#identity.hasMaster) return;
    const recipient = await recipientOf(key);
    const files = await Promise.all(
      stale.map(async (v) => ({ name: v.name, file: await seal(v.value, [recipient]) })),
    );
    await service.write(async (layer) => {
      for (const v of files) await layer.writeFile(credentialPath(v.name), v.file);
    });
    this.#log.info(
      { workspace: service.id, credentials: stale.map((v) => v.name) },
      "Credentials of an old key written again with the current key",
    );
  }

  /**
   * Makes a new credential key, writes each credential again with it and seals it to each
   * computer of the list (the revoke, design decision 16). A credential that no key of this
   * process opens keeps its file; its name is in `closed`, so the revoke reply names it. When
   * this device cannot open the current key, each credential file is in `closed`.
   */
  async rotate(
    service: WorkspaceService,
    computers: DeviceDocument[],
  ): Promise<{ count: number; closed: string[] }> {
    const { key: current, values, closed } = await this.#values(service);
    if (current !== null) this.#rememberOld(service.id, current);
    else {
      // The own key file is missing or does not open: no credential opens here, so each file
      // keeps the old key. The reply names each one; the person adds them again.
      closed.push(...(await names(service.root, "secure/credentials", ".age")));
      if (closed.length > 0) {
        this.#log.error(
          { workspace: service.id, credentials: closed },
          "The credential key of this device does not open: no credential is sealed again",
        );
      }
    }
    const key = await newCredentialKey();
    const sealedKeys = await Promise.all(
      computers
        .filter((c) => c.role !== "mobile")
        .map(async (c) => ({
          slug: c.slug,
          file: await seal(key.identity, [x25519ToRecipient(c.keys.x25519)]),
        })),
    );
    const files = await Promise.all(
      values.map(async (v) => ({ name: v.name, file: await seal(v.value, [key.recipient]) })),
    );
    await service.write(async (layer) => {
      for (const v of files) await layer.writeFile(credentialPath(v.name), v.file);
      for (const k of sealedKeys) await layer.writeFile(keyPath(k.slug), k.file);
    });
    const own = sealedKeys.find((k) => k.slug === service.device.slug);
    if (own) this.#keys.set(service.id, { sealed: own.file, key: key.identity });
    else this.#keys.delete(service.id);
    if (closed.length > 0) {
      this.#log.warn(
        { workspace: service.id, credentials: closed },
        "Credentials that did not open keep the old key: add them again",
      );
    }
    return { count: files.length, closed };
  }

  /**
   * Imports each phone outbox file `devices/<phone>/sealed/<id>.age` of a valid mobile device that
   * no `credential.imported` names (design decision 14). Returns the imported names.
   */
  importSealed(service: WorkspaceService): Promise<string[]> {
    const before = this.#importing.get(service.id) ?? Promise.resolve([]);
    const next = before.catch(() => []).then(() => this.#importSealed(service));
    this.#importing.set(service.id, next);
    return next;
  }

  async #importSealed(service: WorkspaceService): Promise<string[]> {
    if (service.device.role === "mobile" || !service.ready) return [];
    const key = await this.key(service);
    if (key === null) return [];
    const phones = service
      .deviceRecords()
      .filter((r) => r.role === "mobile" && !r.revoked && r.slug !== service.device.slug);
    if (phones.length === 0) return [];
    const done = new Set<string>(this.#imported);
    for (const row of service.workspaceEvents()) {
      const data = (row.event as { data?: { sealed?: unknown } }).data;
      if (row.type === "credential.imported" && typeof data?.sealed === "string")
        done.add(data.sealed);
    }
    const imported: string[] = [];
    for (const phone of phones) {
      const dir = `tasks/devices/${phone.slug}/sealed`;
      for (const id of await names(service.root, dir, ".age")) {
        if (done.has(id)) continue;
        // One bad file never stops the other files: each file has its own try.
        try {
          const name = await this.#importOne(service, key, phone.slug, dir, id);
          if (name !== null) imported.push(name);
        } catch (error) {
          this.#log.warn(
            { err: error, phone: phone.slug, sealed: id },
            "A phone credential file was not imported; the next check tries it again",
          );
        }
      }
    }
    if (imported.length > 0) await this.refreshSecrets(service);
    return imported;
  }

  /** Imports one phone outbox file; null when it waits or is skipped. */
  async #importOne(
    service: WorkspaceService,
    key: string,
    phone: string,
    dir: string,
    id: string,
  ): Promise<string | null> {
    if (!SEALED_ID.test(id)) {
      // The id goes into the event (`sealed`): a name that the event schema refuses is skipped.
      this.#log.warn({ phone, sealed: id }, "A phone credential file has a name that is not valid");
      this.#imported.add(id);
      return null;
    }
    if (!this.#identity.hasMaster) {
      const info = await stat(join(service.root, ...dir.split("/"), `${id}.age`)).catch(() => null);
      if (info === null || this.#clock.now() - info.mtimeMs < IMPORT_DELAY_MS) return null;
    }
    const file = await readBytes(service.root, `${dir}/${id}.age`);
    if (file === null) return null;
    let content;
    try {
      content = await openCredential(file, this.#identity.device.secret.x25519);
    } catch (error) {
      if (!(error instanceof OpenError)) throw error;
      this.#log.warn({ phone, sealed: id }, "A phone credential file does not open here");
      this.#imported.add(id);
      return null;
    }
    if (!entryName.safeParse(content.name).success) {
      this.#log.warn({ phone, sealed: id }, "A phone credential has a name that is not valid");
      this.#imported.add(id);
      return null;
    }
    const sealedFile = await seal(content.value, [await recipientOf(key)]);
    // The id and the name are checked above, so the event passes its schema. The file comes first:
    // a file with no event is imported again (the same value), never lost.
    await service.write(async (files) => {
      await files.writeFile(credentialPath(content.name), sealedFile);
      await this.#event(files, service, "credential.imported", {
        name: content.name,
        from: phone,
        sealed: id,
      });
    });
    this.#imported.add(id);
    this.#log.info({ phone, credential: content.name }, "Phone credential imported");
    return content.name;
  }
}
