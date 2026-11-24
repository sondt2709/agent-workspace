// Device priority: local > remote (in the order of the device list) > mobile
// (docs/decisions/2026-11-22-device-sync.md, sync 6 and 7; docs/architecture.md 4.3.3).
import type { DeviceRole } from "@aw/schema";
import { compareText } from "./order.ts";

const ROLE_RANK: Record<DeviceRole, number> = { local: 0, remote: 1, mobile: 2 };

export interface PriorityInput {
  /** The role of each device from its `device.yaml`. A device with no record is last. */
  roles: ReadonlyMap<string, DeviceRole>;
  /** `workspace.yaml` `device_order`: the pairing order by default. */
  order: readonly string[];
}

/** Sorts device slugs from the highest priority to the lowest. */
export function sortByPriority(devices: Iterable<string>, input: PriorityInput): string[] {
  const position = (slug: string) => {
    const index = input.order.indexOf(slug);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const role = (slug: string) => {
    const value = input.roles.get(slug);
    return value === undefined ? 3 : ROLE_RANK[value];
  };
  return [...new Set(devices)].sort(
    (a, b) => role(a) - role(b) || position(a) - position(b) || compareText(a, b),
  );
}

/** A function that gives the rank of a device: 0 is the highest priority. */
export function priorityRank(
  devices: Iterable<string>,
  input: PriorityInput,
): (slug: string) => number {
  const sorted = sortByPriority(devices, input);
  const ranks = new Map(sorted.map((slug, index) => [slug, index]));
  return (slug) => ranks.get(slug) ?? sorted.length;
}
