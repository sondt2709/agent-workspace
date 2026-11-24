// The keystore of a device (docs/architecture.md 4.1.2, docs/engineering-rules.md 6.1): the OS
// keystore through `@napi-rs/keyring`, or a 0600 file on a computer with no session bus. The one
// adapter module of `@napi-rs/keyring`.
import { AsyncEntry } from "@napi-rs/keyring";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { toBase32Lower, utf8 } from "./encoding.ts";

export type KeystoreKind = "os" | "file";

export interface Keystore {
  readonly kind: KeystoreKind;
  /** The value of an entry, or null. */
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  /** Removes an entry. Returns false when it did not exist. */
  delete(name: string): Promise<boolean>;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error(`A keystore entry name must be a slug, not ${name}`);
}

/** Entries as files `<dir>/<name>` with mode 0600 in a folder with mode 0700. */
export class FileKeystore implements Keystore {
  readonly kind = "file" as const;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  async #folder(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const info = await stat(this.dir);
    if ((info.mode & 0o777) !== 0o700) await chmod(this.dir, 0o700);
  }

  async get(name: string): Promise<string | null> {
    checkName(name);
    try {
      return await readFile(join(this.dir, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /**
   * Writes a new 0600 file with a new temp name, syncs it to the disk, renames it over the entry and
   * syncs the folder: a power loss after the call never leaves an empty key, and 2 writes at once
   * never share a temp file (final check fc1-11).
   */
  async set(name: string, value: string): Promise<void> {
    checkName(name);
    await this.#folder();
    const path = join(this.dir, name);
    const temp = `${path}.${randomBytes(6).toString("hex")}.aw-new`;
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.chmod(0o600);
        await file.writeFile(value);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    const folder = await open(this.dir, "r");
    try {
      await folder.sync();
    } catch {
      // Some file systems refuse a sync of a folder: the rename is still atomic.
    } finally {
      await folder.close();
    }
  }

  async delete(name: string): Promise<boolean> {
    checkName(name);
    const path = join(this.dir, name);
    const existed = await stat(path).then(
      () => true,
      () => false,
    );
    await rm(path, { force: true });
    return existed;
  }
}

/**
 * Entries in the OS keystore (macOS Keychain, Windows Credential Manager, the Secret Service on
 * Linux). The account name holds a hash of the state folder, so 2 state folders of one user never
 * share an entry.
 */
export class OsKeystore implements Keystore {
  readonly kind = "os" as const;
  readonly service: string;
  readonly #scope: string;
  constructor(service: string, scope: string) {
    this.service = service;
    this.#scope = toBase32Lower(sha256(utf8(scope)).slice(0, 8));
  }

  #entry(name: string): AsyncEntry {
    checkName(name);
    return new AsyncEntry(this.service, `${name}.${this.#scope}`);
  }

  async get(name: string): Promise<string | null> {
    return (await this.#entry(name).getPassword()) ?? null;
  }

  async set(name: string, value: string): Promise<void> {
    await this.#entry(name).setPassword(value);
  }

  async delete(name: string): Promise<boolean> {
    return this.#entry(name).deletePassword();
  }
}

/** The keystore service name of awd. */
export const KEYSTORE_SERVICE = "com.agentworkspace.awd";

/** Opens the keystore of a state folder: the OS keystore, or `<home>/keys/`. */
export function openKeystore(
  kind: KeystoreKind,
  home: string,
  service = KEYSTORE_SERVICE,
): Keystore {
  return kind === "os" ? new OsKeystore(service, home) : new FileKeystore(join(home, "keys"));
}
