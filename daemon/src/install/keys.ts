// The keys of a headless Mac (openspec gap-install, awd-service: service units). A LaunchDaemon
// has no login Keychain, so its awd uses the file keystore (`AW_KEYSTORE=file`). A device key that
// is only in the Keychain must move to `<AW_HOME>/keys/` first: `aw service move-keys`.
import { FileKeystore, KEYSTORE_SERVICE, OsKeystore, type Keystore } from "@aw/identity";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { KEY_DEVICE, KEY_PHRASE } from "../service/identity.ts";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** The file of the device key in the file keystore. */
export const fileKeyPath = (awHome: string) => join(awHome, "keys", KEY_DEVICE);

/**
 * True when awd ran with this state folder (it has `config.yaml` or `identity.yaml`) and the file
 * keystore has no device key: then the key is in the OS keystore (the macOS default).
 */
export async function keyOnlyInOsKeystore(awHome: string): Promise<boolean> {
  if (await exists(fileKeyPath(awHome))) return false;
  return (
    (await exists(join(awHome, "config.yaml"))) || (await exists(join(awHome, "identity.yaml")))
  );
}

/** The refusal text of `aw service install --headless` for a key in the Keychain. */
export function keyInKeychainText(user: string): string {
  return [
    "The device key of this Mac is in the login Keychain, and a LaunchDaemon cannot read it.",
    `Move it first. As ${user}, with no sudo: aw service uninstall, then aw service move-keys.`,
    "Then run: sudo aw service install --headless",
  ].join("\n");
}

export interface MoveKeysResult {
  /** The names that moved. */
  moved: string[];
  /** The folder of the file keystore. */
  folder: string;
}

/** A move that cannot run: the message names the cause. */
export class MoveKeysError extends Error {}

/**
 * Copies the device key and the recovery phrase from the OS keystore to the file keystore, reads
 * them back, and then deletes them from the OS keystore. Stop awd before the call.
 */
export async function moveKeys(
  awHome: string,
  stores: { from?: Keystore; to?: Keystore } = {},
): Promise<MoveKeysResult> {
  const from = stores.from ?? new OsKeystore(KEYSTORE_SERVICE, awHome);
  const to = stores.to ?? new FileKeystore(join(awHome, "keys"));
  const moved: string[] = [];
  const values = new Map<string, string>();
  for (const name of [KEY_DEVICE, KEY_PHRASE]) {
    const value = await from.get(name);
    if (value === null) continue;
    const there = await to.get(name);
    if (there !== null && there !== value) {
      throw new MoveKeysError(
        `${join(awHome, "keys", name)} has another value than the Keychain. Nothing moved: remove one of them by hand.`,
      );
    }
    values.set(name, value);
  }
  // A device key that is already in the file keystore: the phrase still moves (gap-install low 7).
  if (!values.has(KEY_DEVICE) && (await to.get(KEY_DEVICE)) === null) {
    throw new MoveKeysError("The Keychain has no device key of this state folder. Nothing moved.");
  }
  for (const [name, value] of values) {
    await to.set(name, value);
    if ((await to.get(name)) !== value) {
      throw new MoveKeysError(`The copy of ${name} did not read back. The Keychain keeps it.`);
    }
  }
  for (const name of values.keys()) {
    await from.delete(name);
    moved.push(name);
  }
  return { moved, folder: join(awHome, "keys") };
}
