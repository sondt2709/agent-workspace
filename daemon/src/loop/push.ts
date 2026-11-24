// The Web Push of the gate owner device (docs/phase-1.md 8, design of add-task-loop decision 13):
// the VAPID key of this computer, its public key in `bindings.yaml`, and the send to each phone
// subscription of `push.yaml` with this computer slug and the current key.
import {
  generateVapidKeys,
  sendPush,
  validVapidKeys,
  type FetchLike,
  type PushPreview,
  type VapidKeys,
} from "@aw/push-webpush";
import { pushV1, type PushDocument } from "@aw/schema";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { Logger } from "../log.ts";
import { isRevoked, revokedIdentities } from "../service/revoked.ts";
import type { WorkspaceService } from "../service/workspace.ts";
import { privateFolder, writePrivate } from "../sessions/records.ts";

/**
 * The VAPID `sub` claim: a fixed reserved address that names no person, so no personal address
 * leaves the computer (owner decision Q9). Add a setting only if a push service refuses it.
 */
export const PUSH_SUBJECT = "mailto:noreply@example.com";

export interface PushServiceOptions {
  home: string;
  log: Logger;
  now: () => number;
  fetch?: FetchLike;
  /** The open workspaces: a phone that one of them revoked gets no push (openspec revoke-device). */
  workspaces?: () => WorkspaceService[];
}

/** The key file `~/.aw/keys/vapid.json` (0600): made once, kept over each restart. */
export async function loadVapidKeys(home: string): Promise<VapidKeys> {
  const dir = join(home, "keys");
  const file = join(dir, "vapid.json");
  try {
    const keys = JSON.parse(await readFile(file, "utf8")) as VapidKeys;
    if (validVapidKeys(keys)) return keys;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
  }
  const keys = generateVapidKeys();
  await privateFolder(dir);
  await writePrivate(file, `${JSON.stringify(keys)}\n`);
  return keys;
}

export class PushService {
  readonly #o: PushServiceOptions;
  #keys: Promise<VapidKeys> | null = null;

  constructor(options: PushServiceOptions) {
    this.#o = options;
  }

  keys(): Promise<VapidKeys> {
    this.#keys ??= loadVapidKeys(this.#o.home).catch((error: unknown) => {
      this.#keys = null;
      throw error;
    });
    return this.#keys;
  }

  /** Writes the public key to the bindings of this computer when it differs (not on a phone). */
  async ensureBindings(service: WorkspaceService): Promise<void> {
    if (service.device.role === "mobile") return;
    const { publicKey } = await this.keys();
    const path = `tasks/devices/${service.device.slug}/bindings.yaml`;
    const doc = await service.files.readDocument<"bindings">(path);
    if (doc.value.vapid_public_key === publicKey) return;
    await service.writeOwnDocument<"bindings">(path, { ...doc.value, vapid_public_key: publicKey });
    this.#o.log.info({ workspace: service.id }, "The VAPID public key is in the bindings");
  }

  /**
   * The subscriptions of each phone for this computer and its current key. Only a phone (a record
   * with the role `mobile`) with a kept record in this workspace that no open workspace revoked
   * (its slug, key or sync id) gets a push.
   */
  async subscriptions(service: WorkspaceService): Promise<PushDocument["subscriptions"]> {
    const { publicKey } = await this.keys();
    const root = join(service.root, "tasks", "devices");
    const names = await readdir(root).catch(() => [] as string[]);
    const result: PushDocument["subscriptions"] = [];
    const others = this.#o.workspaces?.() ?? [];
    const revoked = revokedIdentities(
      [service, ...others.filter((w) => w !== service)].flatMap((w) => w.deviceRecords()),
    );
    const records = new Map(service.deviceRecords().map((r) => [r.slug, r]));
    for (const name of names.sort()) {
      const record = records.get(name);
      if (!record || isRevoked(record, revoked)) {
        this.#o.log.debug({ device: name }, "No push: no valid record, or the device is revoked");
        continue;
      }
      // Only a phone gets a push. A push.yaml under the folder of a computer is not of that
      // computer: any sync peer can write it (a revoked phone that plants its subscription).
      if (record.role !== "mobile") continue;
      const text = await readFile(join(root, name, "push.yaml"), "utf8").catch(() => null);
      if (text === null) continue;
      let parsed;
      try {
        parsed = pushV1.safeParse(parse(text));
      } catch {
        parsed = null;
      }
      if (!parsed?.success || parsed.data.device !== name) {
        this.#o.log.warn({ device: name }, "A push.yaml is not valid: no push to it");
        continue;
      }
      for (const sub of parsed.data.subscriptions) {
        if (sub.computer === service.device.slug && sub.vapid_public_key === publicKey) {
          result.push(sub);
        }
      }
    }
    return result;
  }

  /** Sends one preview to each subscription. A failure is logged; it never throws. */
  async send(service: WorkspaceService, preview: PushPreview): Promise<number> {
    let sent = 0;
    try {
      const keys = await this.keys();
      for (const sub of await this.subscriptions(service)) {
        try {
          const result = await sendPush(sub, preview, {
            keys,
            subject: PUSH_SUBJECT,
            nowMs: this.#o.now(),
            ...(this.#o.fetch ? { fetch: this.#o.fetch } : {}),
          });
          if (result.ok) sent++;
          else if (result.gone) {
            this.#o.log.info({ status: result.status }, "A push subscription is gone");
          } else {
            this.#o.log.warn({ status: result.status, body: result.body }, "A push failed");
          }
        } catch (error) {
          this.#o.log.warn({ err: error }, "A push failed");
        }
      }
    } catch (error) {
      this.#o.log.warn({ err: error }, "No push: the push keys or subscriptions failed");
    }
    return sent;
  }
}
