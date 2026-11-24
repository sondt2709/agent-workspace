// Pairing (docs/phase-1.md 7; openspec add-identity-and-pairing, design decisions 10 to 12): the
// showing device makes a one-time code, accepts the request of the new device through the pairing
// folder `aw-pair-<nonce>` of the engine, and the human approves with the check code. The new
// device checks the signed records, joins the workspace folders and registers the workspace.
import { type Clock } from "@aw/core";
import {
  checkCode,
  checkRequest,
  decodePairingCode,
  encodePairingCode,
  formatCheckCode,
  fromBase64,
  isExpired,
  newPairingSecrets,
  normalizeCheckCode,
  PAIRING_TTL_MS,
  PairingCodeError,
  pairingDoneSchema,
  pairingRequestSchema,
  pairingResponseSchema,
  signRequest,
  verifyRecord,
  type PairingOffer,
  type PairingRequest,
} from "@aw/identity";
import { deviceV1, uuidv7, type DeviceDocument, type DeviceRole } from "@aw/schema";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { encodeQR } from "qr";
import { parse } from "yaml";
import type { Logger } from "../log.ts";
import type { CredentialService } from "./credentials.ts";
import { invalid, notFound, ServiceError } from "./errors.ts";
import { localAddresses, newestRecords, type IdentityService } from "./identity.ts";
import type { SyncService } from "./sync.ts";
import {
  checkJoinFolder,
  chooseWorkspaceFolder,
  folderName,
  workspaceAt,
  type FolderContext,
} from "./workspace-folder.ts";
import type { WorkspaceService } from "./workspace.ts";

export { folderName } from "./workspace-folder.ts";

export type PairingState =
  "waiting" | "check" | "approved" | "joining" | "done" | "failed" | "expired" | "cancelled";

const TERMINAL: readonly PairingState[] = ["done", "failed", "expired", "cancelled"];
/** The poll period of a pairing: the pending devices, the pairing folder files. */
export const PAIRING_POLL_MS = 1000;
/** The time that the new device waits for `tasks/workspace.yaml` after the approval. */
export const JOIN_WAIT_MS = 5 * 60 * 1000;
/**
 * The time that the showing device waits for `request.json` of a device whose pairing folder it
 * accepted. A device that offers the folder and writes no request is refused after it, so it
 * cannot hold the pairing until the code expires.
 */
export const REQUEST_WAIT_MS = 60 * 1000;

export interface PairingSummary {
  id: string;
  side: "show" | "join";
  state: PairingState;
  workspace: { id: string; name: string };
  /** The showing device. */
  device: string;
  expires_at: string;
  /** The check code, `123 456`, when both keys are known. */
  check_code: string | null;
  /** The new device of the request. */
  new_device: { slug: string; name: string; role: DeviceRole } | null;
  error: string | null;
  /** The workspace folder of this device (join side only; openspec workspace-folder). */
  folder: string | null;
  /** One sentence when the folder rule skipped a taken name (join side only). */
  folder_note: string | null;
  /** The code and the QR code (show side only). */
  code: string | null;
  qr_svg: string | null;
}

interface Pairing {
  id: string;
  side: "show" | "join";
  offer: PairingOffer;
  code: string | null;
  state: PairingState;
  error: string | null;
  folder: string;
  path: string;
  check: string | null;
  request: PairingRequest | null;
  /** The engine devices that this pairing added (show side: pending devices). */
  devices: Set<string>;
  /** The device whose pairing folder this pairing accepted. */
  peer: string | null;
  /** The clock time when the folder of `peer` was accepted (show side). */
  peerAt: number | null;
  root: string | null;
  /** One sentence when the folder rule skipped a taken name (join side). */
  folderNote: string | null;
  slug: string | null;
  name: string | null;
  /** True while approve() runs: a second call is refused (show side). */
  approving: boolean;
  /** The record that approve() wrote: a retry after a failed later step writes no second one. */
  record: DeviceDocument | null;
  /** The last heartbeat HLC of the new device at the approval, or null (show side). */
  beatAtApproval: string | null;
  /** The cleanup after the end: a new pairing with the same nonce waits for it. */
  cleanup: Promise<void> | null;
}

export interface PairingDeps {
  identity: IdentityService;
  credentials: CredentialService;
  sync: () => SyncService;
  clock: Clock;
  log: Logger;
  home: string;
  userHome: string;
  listen: string;
  /** This device from `config.yaml`. */
  device: () => { slug: string; name: string; role: DeviceRole };
  workspace: (selector?: string) => WorkspaceService;
  /** The ids of the registered workspaces. */
  registered: () => string[];
  /** What the folder rule must know (openspec workspace-folder). */
  folderContext: () => Promise<FolderContext>;
  /**
   * Runs `fn` alone with each workspace init: a join chooses and reserves its folder in it, so a
   * second join or an init cannot choose the same folder at the same time.
   */
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Registers a workspace folder that has `tasks/workspace.yaml`. */
  register: (root: string) => Promise<void>;
  /** Saves the slug, the name and the role of this device (`config.yaml`, the sync engine). */
  setDevice: (device: { slug: string; name: string; role: DeviceRole }) => Promise<void>;
  /** Computes the sync peers again, with the pairing cache of these workspaces. */
  refreshPeers: (extra?: string[]) => Promise<void>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The largest file that the pairing folder may hold (a request or a response). */
const MAX_PAIRING_FILE = 1024 * 1024;

/** Reads a JSON file of the pairing folder: a regular file of at most MAX_PAIRING_FILE bytes. */
async function readJson(path: string): Promise<unknown> {
  const info = await lstat(path).catch(() => null);
  if (info === null) return null;
  if (!info.isFile() || info.size > MAX_PAIRING_FILE) {
    throw new ServiceError("refused", `${path} is not a regular file of at most 1 MiB`);
  }
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // The engine writes the file to a temp name and renames it; a half file is not possible, but
    // a damaged file waits for the next poll.
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  // The other device can write into the pairing folder: never follow a file that it put there.
  await rm(`${path}.aw-tmp`, { force: true });
  await writeFile(`${path}.aw-tmp`, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(`${path}.aw-tmp`, path);
}

/**
 * The `id` of `<root>/tasks/workspace.yaml`: null when the file does not exist, "" when the file
 * has no id (or is not YAML).
 */
async function workspaceIdAt(root: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(join(root, "tasks", "workspace.yaml"), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
  try {
    const id = (parse(text) as { id?: unknown } | null)?.id;
    return typeof id === "string" ? id : "";
  } catch {
    return "";
  }
}

/** The raw value of a record file as written: the signature covers it (design decision 6). */
async function rawRecord(root: string, slug: string): Promise<Record<string, unknown> | null> {
  const text = await readFile(join(root, "tasks", "devices", slug, "device.yaml"), "utf8").catch(
    () => null,
  );
  return text === null ? null : (parse(text) as Record<string, unknown>);
}

export class PairingService {
  readonly #d: PairingDeps;
  readonly #pairings = new Map<string, Pairing>();
  #stopped = false;

  constructor(deps: PairingDeps) {
    this.#d = deps;
  }

  #summary(p: Pairing): PairingSummary {
    return {
      id: p.id,
      side: p.side,
      state: p.state,
      workspace: p.offer.workspace,
      device: p.offer.device.slug,
      expires_at: p.offer.expires,
      check_code: p.check ? formatCheckCode(p.check) : null,
      new_device: p.request
        ? { slug: p.request.slug, name: p.request.name, role: p.request.role }
        : p.side === "join" && p.slug
          ? { slug: p.slug, name: p.name ?? p.slug, role: "remote" }
          : null,
      error: p.error,
      folder: p.side === "join" ? p.root : null,
      folder_note: p.side === "join" ? p.folderNote : null,
      code: p.code,
      qr_svg: p.code ? encodeQR(p.code, "svg") : null,
    };
  }

  /** The workspace folders of the joins that run now: the folder rule skips them. */
  reservedFolders(): { id: string; path: string }[] {
    return [...this.#pairings.values()]
      .filter((p) => p.side === "join" && p.root !== null && !TERMINAL.includes(p.state))
      .map((p) => ({ id: p.offer.workspace.id, path: p.root! }));
  }

  status(id: string): PairingSummary {
    const p = this.#pairings.get(id);
    if (!p) throw notFound(`Pairing ${id}`);
    return this.#summary(p);
  }

  #now(): number {
    return this.#d.clock.now();
  }

  #end(p: Pairing, state: PairingState, error: string | null = null): void {
    if (TERMINAL.includes(p.state)) return;
    p.state = state;
    p.error = error;
    this.#d.log[state === "done" ? "info" : "warn"](
      { pairing: p.id, side: p.side, state, error },
      "Pairing ended",
    );
    p.cleanup = this.#cleanup(p);
  }

  /** Removes the pairing folder, its files and each device that is not a peer now. */
  async #cleanup(p: Pairing): Promise<void> {
    const transport = this.#d.sync().transport;
    try {
      await transport?.removePairingFolder(p.folder);
      for (const device of p.devices) await transport?.removePairingDevice(device);
    } catch (error) {
      this.#d.log.warn({ err: error, pairing: p.id }, "The pairing cleanup failed");
    }
    await rm(p.path, { recursive: true, force: true }).catch(() => undefined);
  }

  // ---- The showing device ----------------------------------------------------------------------

  /** Starts a pairing of a workspace: the code, the QR code and the expiry. */
  async start(selector?: string): Promise<PairingSummary> {
    const { identity } = this.#d;
    if (!identity.hasMaster) {
      throw new ServiceError(
        "refused",
        "Only a device with the master key shows a pairing code: run 'aw device add' on the local device",
      );
    }
    const service = this.#d.workspace(selector);
    const transport = this.#d.sync().running();
    const me = this.#d.device();
    const own = service.deviceRecords().find((r) => r.slug === me.slug && !r.revoked);
    if (!own || own.sync_device_id !== transport.syncId) {
      throw new ServiceError(
        "not_ready",
        "The record of this device is not written yet: try again in a few seconds",
      );
    }
    const { nonce, secret } = newPairingSecrets();
    const offer: PairingOffer = {
      v: 1,
      user: identity.user!,
      master: identity.masterPublic!,
      workspace: { id: service.id, name: service.name ?? service.id },
      device: { slug: me.slug, ed25519: identity.device.ed25519, sync_id: transport.syncId },
      addresses: localAddresses(this.#d.listen),
      nonce,
      secret,
      expires: new Date(this.#now() + PAIRING_TTL_MS).toISOString(),
    };
    const p: Pairing = {
      id: nonce,
      side: "show",
      offer,
      code: encodePairingCode(offer),
      state: "waiting",
      error: null,
      folder: `aw-pair-${nonce}`,
      path: join(this.#d.home, "pairing", `${nonce}-show`),
      check: null,
      request: null,
      devices: new Set(),
      peer: null,
      peerAt: null,
      root: service.root,
      folderNote: null,
      slug: null,
      name: null,
      approving: false,
      record: null,
      beatAtApproval: null,
      cleanup: null,
    };
    this.#oneOpenPairing(service.id);
    await mkdir(p.path, { recursive: true, mode: 0o700 });
    // Again after the await, with no await before the set: 2 calls at the same time never both
    // start a pairing.
    this.#oneOpenPairing(service.id);
    this.#pairings.set(p.id, p);
    this.#d.log.info({ pairing: p.id, workspace: service.id }, "Pairing started");
    void this.#showLoop(p, service);
    return this.#summary(p);
  }

  /**
   * One open pairing per workspace (design decision 14): with 2, the first one adds each pending
   * device to itself, and the second one never accepts its pairing folder.
   */
  #oneOpenPairing(workspace: string): void {
    for (const q of this.#pairings.values()) {
      if (q.side === "show" && q.offer.workspace.id === workspace && !TERMINAL.includes(q.state)) {
        throw new ServiceError(
          "conflict",
          `The pairing ${q.id} of this workspace is open (state ${q.state}): finish it, or run 'aw device cancel ${q.id}'`,
        );
      }
    }
  }

  async #showLoop(p: Pairing, service: WorkspaceService): Promise<void> {
    while (!this.#stopped && !TERMINAL.includes(p.state)) {
      try {
        await this.#showStep(p, service);
      } catch (error) {
        this.#d.log.debug({ err: error, pairing: p.id }, "A pairing step failed; it runs again");
      }
      if (TERMINAL.includes(p.state)) break;
      await this.#d.clock.sleep(PAIRING_POLL_MS);
    }
  }

  async #showStep(p: Pairing, service: WorkspaceService): Promise<void> {
    // While approve() runs, the code does not expire: approve() checked the expiry before it
    // started, and an end now would remove the pairing folder under it.
    if ((p.state === "waiting" || p.state === "check") && !p.approving) {
      if (isExpired(p.offer, this.#now())) return this.#end(p, "expired", "The code expired");
    }
    const transport = this.#d.sync().running();
    if (p.state === "waiting") {
      // Each pending device gets no workspace folder; only the folder of this nonce is accepted.
      if (p.peer === null) {
        for (const id of Object.keys(await transport.pendingDevices())) {
          if (p.devices.has(id)) continue;
          p.devices.add(id);
          await transport.addPairingDevice(id, `pairing-${id.slice(0, 7).toLowerCase()}`, []);
        }
        const offered = (await transport.pendingFolders())[p.folder]?.offeredBy ?? {};
        // A pending device of this pairing, or a peer already (a device that joins a second
        // workspace): the HMAC of the request authenticates both.
        const peers = new Set(transport.peers.map((peer) => peer.sync_id));
        const device = Object.keys(offered).find((id) => p.devices.has(id) || peers.has(id));
        if (device) {
          await transport.addPairingFolder(p.folder, p.path, device);
          p.peer = device;
          p.peerAt = this.#now();
          this.#d.log.info({ pairing: p.id, device }, "Pairing folder accepted");
        }
      }
      if (p.peer !== null) {
        let raw: unknown;
        try {
          raw = await readJson(join(p.path, "request.json"));
        } catch {
          return this.#refuseDevice(p, "The request is not a regular file");
        }
        if (raw === null) {
          if (p.peerAt !== null && this.#now() - p.peerAt > REQUEST_WAIT_MS) {
            return this.#refuseDevice(p, "The device wrote no request in time");
          }
          return;
        }
        const parsed = pairingRequestSchema.safeParse(raw);
        if (!parsed.success || parsed.data.nonce !== p.offer.nonce) {
          return this.#refuseDevice(p, "The request is not valid");
        }
        if (!checkRequest(parsed.data, p.offer.secret) || parsed.data.sync_id !== p.peer) {
          return this.#refuseDevice(p, "The request has a wrong HMAC");
        }
        // The first valid request uses the code: no other request counts after it.
        p.request = parsed.data;
        // The check code covers each request field that approve() uses (keys, sync id, slug, role).
        p.check = checkCode(p.offer.device, parsed.data);
        p.state = "check";
        this.#d.log.info(
          { pairing: p.id, device: parsed.data.slug },
          "Pairing request accepted: compare the check code",
        );
      }
      return;
    }
    if (p.state === "approved") {
      const done = pairingDoneSchema.safeParse(
        await readJson(join(p.path, "done.json")).catch(() => null),
      );
      // Only a heartbeat after the approval counts: an old heartbeat of the slug (a pairing again
      // with the same key) must not end the pairing before the new device read the response.
      const beat = this.#lastBeat(service, p.request!.slug);
      const newBeat = beat !== null && (p.beatAtApproval === null || beat > p.beatAtApproval);
      if ((done.success && done.data.ok) || newBeat) return this.#end(p, "done");
      if (Date.parse(p.offer.expires) + JOIN_WAIT_MS < this.#now()) {
        this.#end(p, "done", "The new device did not confirm; its record is written");
      }
    }
  }

  #lastBeat(service: WorkspaceService, slug: string): string | null {
    return service.view.devices.find((d) => d.slug === slug)?.heartbeat?.last_hlc ?? null;
  }

  /**
   * A device whose request fails: it is removed, and the pairing waits for another request. The
   * device is no longer a device of this pairing, so a later offer of it is a new pending device.
   */
  async #refuseDevice(p: Pairing, reason: string): Promise<void> {
    this.#d.log.warn({ pairing: p.id, device: p.peer }, `${reason}: the device is removed`);
    const transport = this.#d.sync().running();
    const peer = p.peer;
    p.peer = null;
    p.peerAt = null;
    await transport.removePairingFolder(p.folder);
    if (peer) {
      // The transport keeps a device that is a peer already (a second workspace).
      p.devices.delete(peer);
      await transport.removePairingDevice(peer);
    }
    await rm(join(p.path, "request.json"), { force: true });
  }

  /** Approves the request with the check code that the new device shows. */
  async approve(id: string, typed: string): Promise<PairingSummary> {
    const p = this.#pairings.get(id);
    if (!p || p.side !== "show") throw notFound(`Pairing ${id}`);
    if (p.state !== "check" || !p.request) {
      throw new ServiceError(
        "conflict",
        `The pairing ${id} has no request to approve (state ${p.state})`,
      );
    }
    if (p.approving) {
      throw new ServiceError("conflict", `The pairing ${id} is being approved now`);
    }
    if (isExpired(p.offer, this.#now())) {
      this.#end(p, "expired", "The code expired");
      throw new ServiceError("refused", "The pairing code expired");
    }
    if (normalizeCheckCode(typed) !== p.check) {
      throw new ServiceError(
        "refused",
        "The check code is not the code of this pairing: compare the code on both screens",
      );
    }
    p.approving = true;
    try {
      return await this.#approve(p, p.request);
    } finally {
      p.approving = false;
    }
  }

  /** Throws when the pairing ended while approve() waited (an awd stop). */
  #stillOpen(p: Pairing): void {
    if (TERMINAL.includes(p.state)) {
      throw new ServiceError(
        "conflict",
        `The pairing ${p.id} ended (${p.state}) during the approval`,
      );
    }
  }

  async #approve(p: Pairing, request: PairingRequest): Promise<PairingSummary> {
    const service = this.#d.workspace(p.offer.workspace.id);
    // The request never names the showing device: its record is not for a new device.
    const showing = p.offer.device;
    if (
      request.slug === showing.slug ||
      request.keys.ed25519 === showing.ed25519 ||
      request.sync_id === showing.sync_id
    ) {
      throw new ServiceError(
        "refused",
        `The request names the showing device ${showing.slug}: a device never pairs as the device that shows the code`,
      );
    }
    // The checks that can fail come before the record write.
    if (request.role !== "mobile") await this.#d.credentials.requireKey(service);
    this.#stillOpen(p);
    const records = newestRecords(service.deviceRecords());
    const revoked = records.find(
      (r) =>
        r.revoked &&
        (r.slug === request.slug ||
          r.keys.ed25519 === request.keys.ed25519 ||
          r.sync_device_id === request.sync_id),
    );
    if (revoked) {
      throw new ServiceError(
        "refused",
        `The device ${revoked.slug} is revoked: a revoked device name, device key or sync device never pairs again (pair a new device with --slug <other name>)`,
      );
    }
    const taken = records.find((r) => r.slug === request.slug);
    if (taken && taken.keys.ed25519 !== request.keys.ed25519) {
      throw new ServiceError(
        "refused",
        `The device name ${request.slug} is in use: run 'aw pair' again with --slug <other name>`,
      );
    }
    p.beatAtApproval = this.#lastBeat(service, request.slug);
    const record = p.record ?? (await this.#writeRecord(service, request, taken));
    p.record = record;
    this.#stillOpen(p);
    if (request.role !== "mobile") await this.#d.credentials.sealKeyTo(service, record);
    this.#stillOpen(p);
    const history = await this.#copyHistory(join(this.#d.home, "history", service.id), p.path);
    this.#stillOpen(p);
    const signed = await this.#signedRecords(service);
    this.#stillOpen(p);
    await writeJson(join(p.path, "response.json"), {
      v: 1,
      nonce: p.offer.nonce,
      approved: true,
      reason: null,
      records: signed,
      workspace: p.offer.workspace,
      history,
    });
    this.#stillOpen(p);
    p.state = "approved";
    await this.#d.refreshPeers();
    await this.#d
      .sync()
      .running()
      .scanPairingFolder(p.folder)
      .catch(() => undefined);
    this.#d.log.info({ pairing: p.id, device: request.slug }, "Device approved");
    return this.#summary(p);
  }

  async #writeRecord(
    service: WorkspaceService,
    request: PairingRequest,
    taken: DeviceDocument | undefined,
  ): Promise<DeviceDocument> {
    const record = this.#d.identity.sign({
      kind: "device",
      schema: 1,
      slug: request.slug,
      name: request.name,
      role: request.role,
      keys: { ed25519: request.keys.ed25519, x25519: request.keys.x25519 },
      sync_device_id: request.sync_id,
      seq: (taken?.seq ?? 0) + 1,
      revoked: false,
      revoked_at: null,
      addresses: request.addresses,
      paired_at: new Date(this.#now()).toISOString(),
    });
    await service.write((files) =>
      files.writeDocument(`tasks/devices/${request.slug}/device.yaml`, record),
    );
    return record;
  }

  /**
   * The newest signed record of each device of the workspace, revoked ones too, so the new device
   * knows each revoke at once. A kept record is the record as written (the files layer writes the
   * schema value); a record that does not verify falls back to the file on disk.
   */
  async #signedRecords(service: WorkspaceService): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const kept of newestRecords(service.deviceRecords())) {
      if (this.#d.identity.verify(kept)) {
        out.push(kept);
        continue;
      }
      const raw = await rawRecord(service.root, kept.slug);
      if (raw !== null && this.#d.identity.verify(raw)) out.push(raw);
    }
    return out;
  }

  /**
   * Copies the knowledge versions of the history store (never `seen.json`, local state) to a new
   * folder `history` in the pairing folder. The new device can write into the pairing folder, so
   * the copy refuses a `history` entry that it did not make (for example a symbolic link).
   */
  async #copyHistory(from: string, pairingPath: string): Promise<number> {
    const names = await readdir(from).catch(() => [] as string[]);
    const versions = names.filter((n) => /^[0-9a-f]{64}$/.test(n));
    const to = join(pairingPath, "history");
    await rm(to, { recursive: true, force: true });
    await mkdir(to, { mode: 0o700 });
    const info = await lstat(to);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new ServiceError("refused", "The history folder of the pairing is not a folder");
    }
    // COPYFILE_EXCL: the other device can sync an entry (a symbolic link) into the new folder
    // between mkdir() and the copy; the copy then fails and never follows it.
    for (const name of versions) {
      await copyFile(join(from, name), join(to, name), constants.COPYFILE_EXCL);
    }
    return versions.length;
  }

  cancel(id: string): PairingSummary {
    const p = this.#pairings.get(id);
    if (!p) throw notFound(`Pairing ${id}`);
    if (p.approving) {
      throw new ServiceError(
        "conflict",
        `The pairing ${id} is being approved now: wait for the approval, then revoke the device if necessary`,
      );
    }
    this.#end(p, "cancelled");
    return this.#summary(p);
  }

  // ---- The new device ------------------------------------------------------------------------

  /** Joins with a code: the request goes to the showing device through the pairing folder. */
  async join(input: {
    code: string;
    path?: string | undefined;
    parent?: string | undefined;
    slug?: string | undefined;
    name?: string | undefined;
  }): Promise<PairingSummary> {
    let offer: PairingOffer;
    try {
      offer = decodePairingCode(input.code);
    } catch (error) {
      if (error instanceof PairingCodeError) throw invalid(error.message);
      throw error;
    }
    if (isExpired(offer, this.#now())) {
      throw invalid(`The pairing code expired at ${offer.expires}: show a new code`);
    }
    // The schema of the code checks it too: the id goes into paths of this device.
    if (!uuidv7.safeParse(offer.workspace.id).success) {
      throw invalid("The pairing code has no valid workspace id");
    }
    const open = this.#pairings.get(offer.nonce);
    if (open && !TERMINAL.includes(open.state)) {
      throw new ServiceError(
        "conflict",
        `The pairing ${offer.nonce} with this code runs already (state ${open.state}): wait for it, or run 'aw device cancel ${offer.nonce}'`,
      );
    }
    // The cleanup of an ended pairing with this nonce removes the same folder: wait for it.
    await open?.cleanup;
    const { identity } = this.#d;
    if (identity.hasMaster) {
      throw new ServiceError(
        "refused",
        "This device has its own master key: it is the local device of another identity",
      );
    }
    if (identity.user !== null && identity.user !== offer.user) {
      throw new ServiceError("refused", `This device belongs to the identity ${identity.user}`);
    }
    if (this.#d.registered().includes(offer.workspace.id)) {
      throw new ServiceError(
        "conflict",
        `The workspace ${offer.workspace.name} is registered on this device already`,
      );
    }
    if (input.path !== undefined && input.parent !== undefined) {
      throw invalid("Give --path or --in, not both");
    }
    if (input.path !== undefined && !isAbsolute(input.path)) {
      throw invalid(`Give an absolute path, not ${input.path}`);
    }
    // One choice at a time (openspec workspace-folder): the folder is reserved before the next
    // join or init reads the folder context.
    const p = await this.#d.exclusive(async (): Promise<Pairing> => {
      // A second join with this code that waited for the lock.
      const running = this.#pairings.get(offer.nonce);
      if (running && !TERMINAL.includes(running.state)) {
        throw new ServiceError(
          "conflict",
          `The pairing ${offer.nonce} with this code runs already`,
        );
      }
      // The workspace folder (openspec workspace-folder): `--path` is the folder itself; `--in` (or
      // the default `~/AW`) is the location, and the rule chooses `<name>` or `<name>-aw1`.
      const context = await this.#d.folderContext();
      let root: string;
      let folderNote: string | null = null;
      if (input.path !== undefined) {
        // resolve() also drops a trailing separator: the same text as the other copies of the path.
        root = resolve(input.path);
        await checkJoinFolder(root, offer.workspace.id, context);
      } else {
        const choice = await chooseWorkspaceFolder(
          {
            parent: input.parent ?? join(this.#d.userHome, "AW"),
            name: folderName(offer.workspace.name, offer.workspace.id),
            match: { id: offer.workspace.id },
          },
          context,
        );
        root = choice.root;
        folderNote = choice.note;
      }
      const me = this.#d.device();
      const slug = input.slug ?? me.slug;
      if (!SLUG.test(slug)) throw invalid(`A device name is a slug, not ${slug}`);
      if (slug !== me.slug && this.#d.registered().length > 0) {
        throw new ServiceError(
          "refused",
          "This device has registered workspaces: it keeps its name",
        );
      }
      if (slug === offer.device.slug) {
        throw invalid(
          `The name ${slug} is the name of the showing device: give --slug <other name>`,
        );
      }
      const transport = this.#d.sync().running();
      const syncId = transport.syncId!;
      const p: Pairing = {
        id: offer.nonce,
        side: "join",
        offer,
        code: null,
        state: "waiting",
        error: null,
        folder: `aw-pair-${offer.nonce}`,
        path: join(this.#d.home, "pairing", offer.nonce),
        check: null,
        request: null,
        devices: new Set([offer.device.sync_id]),
        peer: offer.device.sync_id,
        peerAt: null,
        root,
        folderNote,
        slug,
        name: input.name ?? (slug === me.slug ? me.name : slug),
        approving: false,
        record: null,
        beatAtApproval: null,
        cleanup: null,
      };
      const request = signRequest(
        {
          v: 1,
          nonce: offer.nonce,
          slug,
          name: p.name!,
          role: "remote",
          keys: { ed25519: identity.device.ed25519, x25519: identity.device.x25519 },
          sync_id: syncId,
          addresses: localAddresses(this.#d.listen),
        },
        offer.secret,
        fromBase64(identity.device.secret.ed25519),
      );
      p.check = checkCode(offer.device, request);
      await rm(p.path, { recursive: true, force: true });
      await mkdir(p.path, { recursive: true, mode: 0o700 });
      await writeJson(join(p.path, "request.json"), request);
      this.#pairings.set(p.id, p);
      return p;
    });
    const transport = this.#d.sync().running();
    try {
      await transport.addPairingDevice(offer.device.sync_id, offer.device.slug, offer.addresses);
      await transport.addPairingFolder(p.folder, p.path, offer.device.sync_id);
    } catch (error) {
      // No loop runs for this pairing: end it, so a retry with the same code is not a conflict.
      const message = error instanceof Error ? error.message : String(error);
      this.#end(p, "failed", `The sync engine did not add the pairing: ${message}`);
      await p.cleanup;
      throw new ServiceError(
        "not_ready",
        `The sync engine did not add the pairing folder (${message}): run 'aw pair' again`,
      );
    }
    this.#d.log.info({ pairing: p.id, device: offer.device.slug }, "Pairing request sent");
    void this.#joinLoop(p);
    return this.#summary(p);
  }

  async #joinLoop(p: Pairing): Promise<void> {
    while (!this.#stopped && !TERMINAL.includes(p.state)) {
      try {
        await this.#joinStep(p);
      } catch (error) {
        if (error instanceof ServiceError) {
          this.#end(p, "failed", error.message);
          break;
        }
        this.#d.log.debug({ err: error, pairing: p.id }, "A pairing step failed; it runs again");
      }
      if (TERMINAL.includes(p.state)) break;
      await this.#d.clock.sleep(PAIRING_POLL_MS);
    }
  }

  async #joinStep(p: Pairing): Promise<void> {
    if (p.state === "waiting") {
      const raw = await readJson(join(p.path, "response.json"));
      if (raw === null) {
        if (isExpired(p.offer, this.#now()))
          this.#end(p, "expired", "No approval before the expiry");
        return;
      }
      const response = pairingResponseSchema.safeParse(raw);
      if (!response.success || response.data.nonce !== p.offer.nonce) {
        throw new ServiceError("refused", "The pairing response is not valid");
      }
      if (!response.data.approved) {
        throw new ServiceError(
          "refused",
          `The pairing was refused: ${response.data.reason ?? "no reason"}`,
        );
      }
      await this.#accept(p, response.data.records);
      return;
    }
    if (p.state === "joining") {
      const yaml = await readFile(join(p.root!, "tasks", "workspace.yaml"), "utf8").catch(
        () => null,
      );
      if (yaml === null) {
        if (Date.parse(p.offer.expires) + JOIN_WAIT_MS < this.#now()) {
          this.#end(p, "failed", "tasks/workspace.yaml did not arrive");
        }
        return;
      }
      // The workspace id comes from the file, not from the code: register only the offered one.
      const ws = p.offer.workspace.id;
      const id = await workspaceIdAt(p.root!);
      if (id !== ws) {
        await this.#d
          .sync()
          .removeFolders(ws)
          .catch((error: unknown) => {
            this.#d.log.warn({ err: error, pairing: p.id }, "The sync folders were not removed");
          });
        throw new ServiceError(
          "refused",
          `${p.root!}/tasks/workspace.yaml is the file of another workspace (${id || "no id"}), not ${ws}: the folders are not registered`,
        );
      }
      // A retry after a later step failed: the workspace is registered already.
      if (!this.#d.registered().includes(ws)) await this.#d.register(p.root!);
      await writeJson(join(p.path, "done.json"), { v: 1, nonce: p.offer.nonce, ok: true });
      await this.#d
        .sync()
        .running()
        .scanPairingFolder(p.folder)
        .catch(() => undefined);
      // The showing device reads done.json, or the first heartbeat of this device.
      await this.#d.clock.sleep(3000);
      this.#end(p, "done");
    }
  }

  /** Checks the signed records of the response and joins the workspace folders. */
  async #accept(p: Pairing, records: Record<string, unknown>[]): Promise<void> {
    // The folder can change while the person approves: never sync into another workspace.
    // Check it first, before this device changes its identity.
    const there = await workspaceAt(p.root!);
    if (there !== null && there.id !== p.offer.workspace.id) {
      throw new ServiceError(
        "refused",
        `${p.root!} has the workspace ${there.id ?? "with no id"} now: run 'aw pair' again with another folder`,
      );
    }
    const master = fromBase64(p.offer.master);
    const valid: DeviceDocument[] = [];
    for (const raw of records) {
      const parsed = deviceV1.safeParse(raw);
      if (!parsed.success || !verifyRecord(raw, master)) {
        throw new ServiceError(
          "refused",
          "A record of the response has no valid signature of the master key",
        );
      }
      valid.push(parsed.data);
    }
    const key = this.#d.identity.device;
    const syncId = this.#d.sync().running().syncId;
    const mine = valid.find((r) => r.slug === p.slug);
    const theirs = valid.find((r) => r.slug === p.offer.device.slug);
    if (
      !mine ||
      mine.keys.ed25519 !== key.ed25519 ||
      mine.keys.x25519 !== key.x25519 ||
      mine.sync_device_id !== syncId
    ) {
      throw new ServiceError("refused", "The record of this device in the response has other keys");
    }
    if (!theirs || theirs.keys.ed25519 !== p.offer.device.ed25519) {
      throw new ServiceError(
        "refused",
        "The record of the showing device has other keys than the code",
      );
    }
    const ws = p.offer.workspace.id;
    await this.#d.identity.adopt(p.offer.master);
    await this.#d.identity.cacheRecords(ws, records);
    await this.#d.setDevice({ slug: mine.slug, name: mine.name, role: mine.role });
    await this.#importHistory(join(p.path, "history"), join(this.#d.home, "history", ws));
    for (const kind of ["tasks", "knowledge", "secure"]) {
      await mkdir(join(p.root!, kind), { recursive: true });
    }
    await this.#d.refreshPeers([ws]);
    await this.#d.sync().addFolders(ws, p.root!);
    p.state = "joining";
    this.#d.log.info(
      { pairing: p.id, workspace: ws, root: p.root },
      "Pairing approved: the folders sync",
    );
  }

  async #importHistory(from: string, to: string): Promise<void> {
    const names = (await readdir(from).catch(() => [] as string[])).filter((n) =>
      /^[0-9a-f]{64}$/.test(n),
    );
    await mkdir(to, { recursive: true, mode: 0o700 });
    for (const name of names) {
      await copyFile(join(from, name), join(to, name));
      await chmod(join(to, name), 0o600);
    }
  }

  /** Ends each open pairing (an awd stop). */
  async stop(): Promise<void> {
    this.#stopped = true;
    for (const p of this.#pairings.values()) {
      if (!TERMINAL.includes(p.state)) {
        p.state = "cancelled";
        p.cleanup = this.#cleanup(p);
        await p.cleanup;
      }
    }
  }
}
