// Test slots (docs/architecture.md 4.7, design of add-continuity decision 13): leases with fencing
// tokens from the device that has the resource. The lease events go to the workspace log of that
// device; the merge accepts them only from it.
import { hlcMs, type EventRow, type SlotView } from "@aw/core";
import { ServiceError } from "../service/errors.ts";

/** The TTL of a lease (decision 2026-11-22-approved-defaults: 30 min). */
export const SLOT_TTL_MS = 30 * 60 * 1000;
/** A queue entry ends when its session does not ask again in this time. */
export const QUEUE_ENTRY_MS = 2 * 60 * 1000;

type SlotEvent = "slot.acquired" | "slot.renewed" | "slot.released" | "slot.revoked";

export interface SlotHost {
  readonly me: string;
  now(): number;
  /** The device that has the resource in its bindings (this device first), or null. */
  ownerOf(resource: string): string | null;
  /** The capacity of a resource of this device, or undefined. */
  capacity(resource: string): number | undefined;
  /** The current leases of the workspace (the merge view). */
  leases(): readonly SlotView[];
  /** The rows of the workspace log (for the highest fencing token of each slot). */
  workspaceRows(): readonly EventRow[];
  /** True while the session runs on this device. */
  running(session: string): boolean;
  /** Writes one event to the workspace log of this device. */
  write(type: SlotEvent, data: Record<string, unknown>): Promise<void>;
}

export interface Lease {
  resource: string;
  slot: number;
  fencing_token: number;
  ttl_ms: number;
  expires_at: string;
}

export type AcquireResult =
  | { lease: Lease; renewed: boolean; queued: null; next: string }
  | { lease: null; renewed: false; queued: number; next: string };

interface QueueEntry {
  session: string;
  task: string;
  at: number;
}

function leaseOf(view: SlotView): Lease {
  return {
    resource: view.resource,
    slot: view.slot,
    fencing_token: view.fencing_token,
    ttl_ms: view.ttl_ms,
    expires_at: view.expires_at,
  };
}

export class SlotService {
  readonly #host: SlotHost;
  readonly #ttlMs: number;
  readonly #queues = new Map<string, QueueEntry[]>();

  constructor(host: SlotHost, options: { ttlMs?: number } = {}) {
    this.#host = host;
    this.#ttlMs = options.ttlMs ?? SLOT_TTL_MS;
  }

  #mine(resource?: string): SlotView[] {
    return this.#host
      .leases()
      .filter(
        (l) => l.device === this.#host.me && (resource === undefined || l.resource === resource),
      );
  }

  /** The highest fencing token of a slot of this device: a new lease gets a higher one. */
  #maxToken(resource: string, slot: number): number {
    let max = 0;
    for (const row of this.#host.workspaceRows()) {
      if (!row.type.startsWith("slot.") || row.dev !== this.#host.me) continue;
      const data = (row.event as { data?: Record<string, unknown> }).data ?? {};
      if (data.resource !== resource || data.slot !== slot) continue;
      const token = data.fencing_token;
      if (typeof token === "number" && token > max) max = token;
    }
    return max;
  }

  /** The queue of a resource without the entries that stopped asking. */
  #queue(resource: string): QueueEntry[] {
    const now = this.#host.now();
    const queue = (this.#queues.get(resource) ?? []).filter(
      (e) => now - e.at < QUEUE_ENTRY_MS && this.#host.running(e.session),
    );
    this.#queues.set(resource, queue);
    return queue;
  }

  /** A lease for the session, a renewal of its lease, or its queue position. */
  async acquire(input: {
    resource: string;
    task: string;
    session: string;
  }): Promise<AcquireResult> {
    const { resource } = input;
    const owner = this.#host.ownerOf(resource);
    if (owner === null) {
      throw new ServiceError(
        "not_found",
        `No device of the workspace has the slot resource ${resource}`,
        {
          resource,
        },
      );
    }
    if (owner !== this.#host.me) {
      throw new ServiceError(
        "not_available",
        `The resource ${resource} is on ${owner}: AW gives a lease only to a session on that device in phase 1. Ask the human to move the task to ${owner}.`,
        { resource, device: owner },
      );
    }
    await this.expire();
    const held = this.#mine(resource).find((l) => l.session === input.session);
    if (held) {
      await this.#host.write("slot.renewed", {
        resource,
        slot: held.slot,
        fencing_token: held.fencing_token,
        ttl_ms: this.#ttlMs,
      });
      const renewed = this.#mine(resource).find((l) => l.session === input.session) ?? held;
      return {
        lease: leaseOf(renewed),
        renewed: true,
        queued: null,
        next: `Lease of ${resource} slot ${renewed.slot} renewed until ${renewed.expires_at}. Use the fencing token ${renewed.fencing_token}.`,
      };
    }
    const queue = this.#queue(resource);
    const now = this.#host.now();
    let index = queue.findIndex((e) => e.session === input.session);
    if (index < 0) {
      queue.push({ session: input.session, task: input.task, at: now });
      index = queue.length - 1;
    } else {
      queue[index]!.at = now;
    }
    const capacity = this.#host.capacity(resource) ?? 0;
    const taken = new Set(this.#mine(resource).map((l) => l.slot));
    const free = [...Array(capacity).keys()].filter((s) => !taken.has(s));
    if (index < free.length) {
      const slot = free[index]!;
      const token = this.#maxToken(resource, slot) + 1;
      await this.#host.write("slot.acquired", {
        resource,
        slot,
        fencing_token: token,
        ttl_ms: this.#ttlMs,
        task: input.task,
        session: input.session,
      });
      queue.splice(index, 1);
      const lease = this.#mine(resource).find((l) => l.session === input.session);
      if (!lease) {
        throw new ServiceError("internal", `The lease of ${resource} slot ${slot} was not applied`);
      }
      return {
        lease: leaseOf(lease),
        renewed: false,
        queued: null,
        next: `You hold ${resource} slot ${slot} until ${lease.expires_at} (fencing token ${token}). Run the acquire again before ${Math.round(this.#ttlMs / 3 / 60_000)} min to renew it, and release it when you are done.`,
      };
    }
    const position = index + 1;
    return {
      lease: null,
      renewed: false,
      queued: position,
      next: `Each ${resource} slot is taken. You are number ${position} in the queue: ask again in about 1 min (the queue keeps your place for 2 min).`,
    };
  }

  /** Releases the lease of the session. */
  async release(input: {
    resource: string;
    session: string;
  }): Promise<{ released: Lease; next: string }> {
    const queue = this.#queues.get(input.resource);
    if (queue)
      this.#queues.set(
        input.resource,
        queue.filter((e) => e.session !== input.session),
      );
    const held = this.#mine(input.resource).find((l) => l.session === input.session);
    if (!held) {
      throw new ServiceError("not_found", `This session holds no lease of ${input.resource}`, {
        resource: input.resource,
      });
    }
    await this.#host.write("slot.released", {
      resource: held.resource,
      slot: held.slot,
      fencing_token: held.fencing_token,
    });
    return { released: leaseOf(held), next: `Released ${held.resource} slot ${held.slot}.` };
  }

  /**
   * Ends the leases that must end: past the expiry (`slot.revoked expired`), of a session that does
   * not run any more (`slot.released`), and from before the boot (`slot.revoked reboot`). Renews the
   * lease of a running session at ttl/3. Returns the count of ended leases.
   */
  async expire(bootMs?: number): Promise<number> {
    const now = this.#host.now();
    let ended = 0;
    for (const lease of this.#mine()) {
      const base = {
        resource: lease.resource,
        slot: lease.slot,
        fencing_token: lease.fencing_token,
      };
      if (bootMs !== undefined && hlcMs(lease.renewed_hlc) < bootMs) {
        await this.#host.write("slot.revoked", { ...base, reason: "reboot" });
      } else if (Date.parse(lease.expires_at) <= now) {
        await this.#host.write("slot.revoked", { ...base, reason: "expired" });
      } else if (!this.#host.running(lease.session)) {
        await this.#host.write("slot.released", base);
      } else if (now - hlcMs(lease.renewed_hlc) >= lease.ttl_ms / 3) {
        // The session heartbeat (docs/workflow.md 3, rule 4): awd renews the lease of a running
        // session at ttl/3, so a lease ends with its session, not in the middle of a test run.
        await this.#host.write("slot.renewed", { ...base, ttl_ms: lease.ttl_ms });
        continue;
      } else {
        continue;
      }
      ended++;
    }
    return ended;
  }
}
