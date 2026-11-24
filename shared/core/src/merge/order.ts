// The merge order of events (docs/phase-1.md 3.6): the HLC text, then the device slug, then the
// event id. The id only breaks a tie that a broken device can make (2 events with the same HLC).
import { compareEventOrder, hlcTimeOf } from "@aw/schema";

/** The fields of an event that set its place in the merge order. */
export interface OrderKey {
  hlc: string;
  dev: string;
  id: string;
}

export function compareOrder(a: OrderKey, b: OrderKey): number {
  return compareEventOrder(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The time of an HLC text as an ISO 8601 text, for example the `since` of a pause. */
export function hlcIso(hlc: string): string {
  const time = hlcTimeOf(hlc);
  if (time === undefined) throw new RangeError(`Not an HLC: ${hlc}`);
  return new Date(time).toISOString();
}

/** The time of an HLC text in ms. The merge reads only valid events, so the HLC is valid. */
export function hlcMs(hlc: string): number {
  const time = hlcTimeOf(hlc);
  if (time === undefined) throw new RangeError(`Not an HLC: ${hlc}`);
  return time;
}

/** Compares 2 texts by their UTF-16 code units, the same order as SQLite BINARY for ASCII. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
