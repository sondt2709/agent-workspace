// UUIDv7 ids (RFC 9562) for tasks, events, sessions and gates (docs/architecture.md 4.2.6).
// The time comes from the clock module, never from Date.now() (AGENTS.md).
import { v7 } from "uuid";
import type { TimeSource } from "./hlc.ts";

// The per-process state of the 32-bit sequence after the time part (RFC 9562 6.2, method 2).
let lastMsecs = Number.NEGATIVE_INFINITY;
let lastSeq = 0;

/**
 * Makes a new UUIDv7 with the time of the source. Ids made in the same ms in this process sort in
 * the order they were made: the sequence counts up. A new ms starts the sequence at a random
 * 31-bit value. Ids of other processes or devices in the same ms have no fixed order.
 */
export function newId(source: TimeSource): string {
  const msecs = source.now();
  if (msecs === lastMsecs && lastSeq < 0xffffffff) {
    lastSeq += 1;
  } else {
    lastMsecs = msecs;
    lastSeq = crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1;
  }
  return v7({ msecs, seq: lastSeq });
}

/** The time in ms that the first 48 bits of a UUIDv7 hold. */
export function idTime(id: string): number {
  return Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}
