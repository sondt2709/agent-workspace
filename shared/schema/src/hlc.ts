// Hybrid logical clock (docs/phase-1.md 3.6, docs/architecture.md 4.2.4).
// Text form: `<UTC time, ISO 8601 with ms>#<4-digit counter>`. It sorts as text.
// The Kotlin module runs the same test vectors: contracts/test-vectors/hlc.json.
import { hlcTimeOf } from "./common.ts";

/** A source of the physical time in ms since the epoch. In awd, it is the clock module. */
export interface TimeSource {
  now(): number;
}

export interface HlcValue {
  /** The time part, ms since the epoch. */
  time: number;
  /** The logical counter, 0 to 9999. */
  counter: number;
}

export const HLC_MAX_COUNTER = 9999;

export class HlcFormatError extends Error {
  readonly text: string;
  constructor(text: string) {
    super(`Not an HLC: "${text}". Use <UTC time with ms>#<4-digit counter>.`);
    this.name = "HlcFormatError";
    this.text = text;
  }
}

export function formatHlc(value: HlcValue): string {
  if (!Number.isInteger(value.counter) || value.counter < 0 || value.counter > HLC_MAX_COUNTER) {
    throw new RangeError(`HLC counter out of range: ${value.counter}`);
  }
  const iso = new Date(value.time).toISOString();
  if (iso.length !== 24) throw new RangeError(`HLC time out of range: ${value.time}`);
  return `${iso}#${String(value.counter).padStart(4, "0")}`;
}

export function parseHlc(text: string): HlcValue {
  const time = hlcTimeOf(text);
  if (time === undefined) throw new HlcFormatError(text);
  return { time, counter: Number(text.slice(text.indexOf("#") + 1)) };
}

export function isHlc(text: string): boolean {
  try {
    parseHlc(text);
    return true;
  } catch {
    return false;
  }
}

/** Compares 2 HLC texts. The text order is the HLC order. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The merge order of events: the HLC, then the device slug (docs/phase-1.md 3.6). */
export function compareEventOrder(
  a: { hlc: string; dev: string },
  b: { hlc: string; dev: string },
): number {
  return compareHlc(a.hlc, b.hlc) || compareHlc(a.dev, b.dev);
}

function maxValue(a: HlcValue, b: HlcValue): HlcValue {
  if (a.time !== b.time) return a.time > b.time ? a : b;
  return a.counter >= b.counter ? a : b;
}

/**
 * The HLC of one device. It keeps its value above each HLC that it made or read, so clock skew
 * cannot put an answer before its question.
 */
export class HybridLogicalClock {
  readonly #source: TimeSource;
  #last: HlcValue | null;

  constructor(source: TimeSource, last?: string | null) {
    this.#source = source;
    this.#last = last ? parseHlc(last) : null;
  }

  /** The last HLC that this clock made or read, or null. */
  peek(): string | null {
    return this.#last ? formatHlc(this.#last) : null;
  }

  /** Makes the HLC of a new local event. */
  now(): string {
    const physical = this.#source.now();
    const last = this.#last;
    let next: HlcValue;
    if (last === null || physical > last.time) {
      next = { time: physical, counter: 0 };
    } else if (last.counter < HLC_MAX_COUNTER) {
      next = { time: last.time, counter: last.counter + 1 };
    } else {
      // The counter is full: move the time part 1 ms forward, so the text stays sortable.
      next = { time: last.time + 1, counter: 0 };
    }
    this.#last = next;
    return formatHlc(next);
  }

  /** Reads the HLC of an event of another device. The next `now()` is greater than it. */
  observe(remote: string): void {
    const value = parseHlc(remote);
    this.#last = this.#last ? maxValue(this.#last, value) : value;
  }

  /** Reads a remote HLC and makes the HLC of the local event that answers it. */
  receive(remote: string): string {
    this.observe(remote);
    return this.now();
  }
}
