// The pause of a task as the person sees it (openspec move-paused-task, revoke-device): the pause
// event of the session device, else a pause from the presence. The presence gives `offline_tasks`
// (docs/phase-1.md 9.6.3): `device_offline` from the heartbeats and `device_revoked` from the
// device records. A pause from the presence never needs a push (docs/architecture.md 4.6.5); only
// `device_revoked` needs the human. No Node import: the renderer of the desktop app uses this
// module too.
import type { PresenceReply } from "./views.ts";

export interface ShownPause {
  cause: string;
  since: string;
  resumes_at: string | null;
  next_step: string;
  needs_human: boolean;
  /** The device of a presence pause (its slug), else absent. */
  device?: string;
  /** The name of that device (the slug when the device record has no name). */
  device_name?: string;
}

/** The short text of a shown pause: the presence text with the device, else the cause. */
export function shownPauseText(pause: ShownPause, causeText: (cause: string) => string): string {
  if (pause.device === undefined) return causeText(pause.cause);
  const names = new Map([[pause.device, pause.device_name ?? pause.device]]);
  return presencePauseText(pause.cause, pause.device, names);
}

/** The name of a device: its name from the device record, else the slug. */
export type DeviceNames = ReadonlyMap<string, string>;

/** The short text of a presence pause: "MacBook Pro offline", "MacBook Pro was revoked". */
export function presencePauseText(cause: string, device: string, names?: DeviceNames): string {
  const name = names?.get(device) ?? device;
  if (cause === "device_revoked") return `${name} was revoked`;
  if (cause === "device_offline") return `${name} offline`;
  return `${name}: ${cause.replaceAll("_", " ")}`;
}

function nextStep(cause: string, name: string): string {
  if (cause === "device_revoked") return `Change the assignee to continue on another device.`;
  return `It continues when ${name} is back. Assign it to another device to continue now.`;
}

/**
 * The tasks with the pause of the presence: a task in `offline_tasks` with no own pause gets
 * `paused` with the cause, the time and the device. A `device_revoked` row replaces the own pause
 * (the revoked device writes no `task.resumed`) and, as the merge does for a pause that needs the
 * human, adds the "Needs you" reason `paused` (openspec revoke-device). Other tasks stay the same
 * objects.
 */
export function withPresencePause<T extends { id: string }>(
  tasks: readonly T[],
  presence: Pick<PresenceReply, "offline_tasks"> | null | undefined,
  names?: DeviceNames,
): T[] {
  const rows = new Map((presence?.offline_tasks ?? []).map((row) => [row.task, row]));
  if (rows.size === 0) return [...tasks];
  return tasks.map((task) => {
    const row = rows.get(task.id);
    const own = (task as { paused?: unknown }).paused;
    const needsHuman = row?.cause === "device_revoked";
    if (!row || (!needsHuman && own !== null && own !== undefined)) return task;
    const name = names?.get(row.device) ?? row.device;
    const paused: ShownPause = {
      cause: row.cause,
      since: row.since,
      resumes_at: null,
      next_step: nextStep(row.cause, name),
      needs_human: needsHuman,
      device: row.device,
      device_name: name,
    };
    if (!needsHuman) return { ...task, paused };
    const lane = task as { needs_you_reasons?: unknown[] };
    const reasons = (lane.needs_you_reasons ?? []).filter(
      (r) => (r as { reason?: unknown }).reason !== "paused",
    );
    return {
      ...task,
      paused,
      needs_you_reasons: [...reasons, { reason: "paused", cause: row.cause }],
      needs_you_lane: true,
    };
  });
}

/** The names of the devices from the device list of the workspace (slug to name). */
export function deviceNames(devices: readonly { slug: string; name: string | null }[] | undefined) {
  const names = new Map<string, string>();
  for (const d of devices ?? []) if (d.name) names.set(d.slug, d.name);
  return names;
}
