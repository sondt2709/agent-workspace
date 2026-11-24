// Presence from heartbeats (docs/phase-1.md 9.6.3, docs/architecture.md 4.4.7). A device is offline
// when this device received no new heartbeat for 90 s, by its own receive time. Its tasks wait:
// presence never opens a gate or moves a task (docs/decisions/2026-11-23-manual-move.md). The tasks
// of a revoked device wait for the person to change the assignee (docs/phase-1.md 6.8.2).
import { compareText, hlcMs } from "./order.ts";
import type { DevicePresence, OfflineTask, PresenceView, TaskView, WorkspaceView } from "./view.ts";

export const OFFLINE_AFTER_MS = 90_000;

/** The last heartbeat of a device that this device received, and the local time of the receipt. */
export interface Receipt {
  hlc: string;
  receivedAt: number;
}

/**
 * Updates the receipts from the last heartbeat HLC of each device. The first receipt of a device
 * (a new engine or a rebuild) uses the earlier of the local time and the HLC time. A later, newer
 * heartbeat uses the local time.
 */
export function updateReceipts(
  receipts: Map<string, Receipt>,
  lastHeartbeats: ReadonlyMap<string, string>,
  now: number,
): void {
  for (const [device, hlc] of lastHeartbeats) {
    const old = receipts.get(device);
    if (!old) receipts.set(device, { hlc, receivedAt: Math.min(now, hlcMs(hlc)) });
    else if (hlc > old.hlc) receipts.set(device, { hlc, receivedAt: now });
  }
}

/** The device of a task for the presence: the device of the assignee, else of the claim. */
function workDevice(task: TaskView): string | null {
  const at = task.assignee?.lastIndexOf("@") ?? -1;
  if (task.assignee && at >= 0) return task.assignee.slice(at + 1);
  return task.claim?.device ?? null;
}

/**
 * The presence layer of a view at the local time `now`. `revokedAt` gives the `revoked_at` HLC of a
 * revoked device (the time of its `device_revoked` rows), else the rows use `now`.
 */
export function presenceOf(
  view: Pick<WorkspaceView, "devices" | "tasks">,
  receipts: ReadonlyMap<string, Receipt>,
  now: number,
  revokedAt?: (device: string) => string | undefined,
): PresenceView {
  const devices: DevicePresence[] = view.devices
    .map((device) => {
      const receipt = receipts.get(device.slug);
      if (!receipt) {
        return {
          device: device.slug,
          online: false,
          last_heartbeat_hlc: null,
          received_at: null,
          offline_since: null,
        };
      }
      const online = now - receipt.receivedAt <= OFFLINE_AFTER_MS;
      return {
        device: device.slug,
        online,
        last_heartbeat_hlc: receipt.hlc,
        received_at: new Date(receipt.receivedAt).toISOString(),
        offline_since: online
          ? null
          : new Date(receipt.receivedAt + OFFLINE_AFTER_MS).toISOString(),
      };
    })
    .sort((a, b) => compareText(a.device, b.device));

  const offline = new Map(
    devices.filter((d) => d.offline_since !== null).map((d) => [d.device, d.offline_since!]),
  );
  const revoked = new Set(view.devices.filter((d) => d.revoked).map((d) => d.slug));
  const offlineTasks: OfflineTask[] = [];
  for (const task of view.tasks) {
    if (task.stage === "done" || task.archived) continue;
    const device = workDevice(task);
    if (device !== null && revoked.has(device)) {
      // A revoked device writes no `task.resumed`: this row wins over its own pause.
      const at = revokedAt?.(device);
      offlineTasks.push({
        task: task.id,
        device,
        cause: "device_revoked",
        since: new Date(at === undefined ? now : hlcMs(at)).toISOString(),
      });
      continue;
    }
    // The person moved the task away from a revoked device: the new device claims it.
    if (task.claim && revoked.has(task.claim.device)) continue;
    const since = task.claim ? offline.get(task.claim.device) : undefined;
    if (since === undefined || task.owner !== task.claim?.device || task.paused !== null) continue;
    offlineTasks.push({
      task: task.id,
      device: task.owner,
      cause: "device_offline",
      since,
    });
  }
  offlineTasks.sort((a, b) => compareText(a.task, b.task));
  return { now: new Date(now).toISOString(), devices, offline_tasks: offlineTasks };
}
