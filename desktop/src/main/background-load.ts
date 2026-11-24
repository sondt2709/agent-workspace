// The load of the background refresh (openspec add-desktop-devices-knowledge, revoke-device): the
// tasks of each ready workspace with the pause of the presence, as the renderer shows them, and the
// sync state. So a task of a revoked device gets its notification and counts in the Tray.
import type { AwClient } from "@aw/client";
import { DesktopClient } from "@aw/client/desktop";
import { tasksWithPresence } from "@aw/client/pause-load";
import type { Task, UnassignedTaskView } from "../shared/channels.ts";
import { countUnsynced } from "./tray.ts";

export interface BackgroundLoad {
  /** The tasks, and the tasks with no assignee and their creator for "Assign task" (queue-and-assign). */
  lists: { ws: string; tasks: Task[]; unassigned: UnassignedTaskView[] }[];
  /** The items that the peers still need, or null when the sync state is not known. */
  unsynced: number | null;
  /** False when a workspace was not ready or its load failed: its entry (if any) is the last one. */
  complete: boolean;
}

/**
 * Loads each workspace of awd. A workspace that is not ready, or whose load fails, keeps its entry
 * of `previous`: the notifications must not treat it as empty (fix list 0-12).
 */
export async function loadBackground(
  client: AwClient,
  previous: BackgroundLoad | null = null,
): Promise<BackgroundLoad> {
  const workspaces = await client.workspaces();
  const desktop = new DesktopClient(client);
  const lists: BackgroundLoad["lists"] = [];
  let complete = true;
  for (const w of workspaces) {
    try {
      if (!w.ready) throw new Error(`workspace ${w.id} is not ready`);
      const unassigned = await desktop.queues(w.id).then(
        (q) => q.unassigned,
        () => [],
      );
      lists.push({
        ws: w.id,
        tasks: await tasksWithPresence(client, w.id, await client.tasks(w.id)),
        unassigned,
      });
    } catch {
      complete = false;
      const last = previous?.lists.find((l) => l.ws === w.id);
      if (last) lists.push(last);
    }
  }
  const unsynced = await client.syncStatus().then(countUnsynced, () => null);
  return { lists, unsynced, complete };
}
