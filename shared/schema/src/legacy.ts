// The names from before openspec proposal-and-discussion. The logs are append-only, so a reader maps
// each old name to its new name when it parses a line or a task snapshot. A writer writes only the
// new names. The Kotlin port (android/shared `Legacy.kt`) has the same map and the same fixture:
// contracts/fixtures/legacy/names.json.

/** Old event type → new event type. */
export const LEGACY_EVENT_TYPES: Readonly<Record<string, string>> = {
  "approach.proposed": "proposal.proposed",
};

/** Old gate kind → new gate kind. */
export const LEGACY_GATE_KINDS: Readonly<Record<string, string>> = {
  confirm_approach: "approve_proposal",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The event with the new names: the type of `approach.proposed`, and the kind of a `gate.opened`
 * `confirm_approach`. Other values come back unchanged (the same object).
 */
export function upgradeEvent(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const type = typeof value.type === "string" ? (LEGACY_EVENT_TYPES[value.type] ?? null) : null;
  const data = value.data;
  const kind =
    value.type === "gate.opened" && isRecord(data) && typeof data.kind === "string"
      ? (LEGACY_GATE_KINDS[data.kind] ?? null)
      : null;
  if (type === null && kind === null) return value;
  return {
    ...value,
    ...(type === null ? {} : { type }),
    ...(kind === null || !isRecord(data) ? {} : { data: { ...data, kind } }),
  };
}

/**
 * The task snapshot with the new field `proposal: {latest, approved}` (old snapshots have
 * `approach: {latest, confirmed}`).
 */
export function upgradeTaskDocument(value: unknown): unknown {
  if (!isRecord(value) || value.kind !== "task") return value;
  if (!("approach" in value) || "proposal" in value) return value;
  const { approach, ...rest } = value;
  if (!isRecord(approach)) return { ...rest, proposal: approach };
  const { confirmed, ...fields } = approach;
  return { ...rest, proposal: { ...fields, approved: confirmed ?? null } };
}
