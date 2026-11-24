// The pause from the presence in `aw task list` and `aw task show` (openspec move-paused-task,
// revoke-device): a task of an offline or a revoked device shows "paused: MacBook Pro offline" or
// "paused: ubuntu-01 was revoked", as on the desktop app.
import type { AwClient } from "@aw/client";
import { tasksWithPresence } from "@aw/client/pause-load";

export function withPause<T extends { id: string }>(
  client: AwClient,
  ws: string,
  tasks: T[],
): Promise<T[]> {
  return tasksWithPresence(client, ws, tasks);
}
