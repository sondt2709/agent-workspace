// The shown pause with the presence for the `aw` CLI and the desktop main process (openspec
// move-paused-task, revoke-device). The presence and the device names are person routes: an agent
// session gets the tasks as they are. The renderer reads them through its own queries.
import { DesktopClient } from "./desktop.ts";
import { IdentityClient } from "./identity.ts";
import type { AwClient } from "./index.ts";
import { deviceNames, withPresencePause } from "./pause.ts";

/**
 * The tasks with the pause of the presence and the device names of the valid records. It reads the
 * devices only when the presence has a row. A failed read gives the tasks as they are.
 */
export async function tasksWithPresence<T extends { id: string }>(
  client: AwClient,
  ws: string,
  tasks: T[],
): Promise<T[]> {
  const presence = await new DesktopClient(client).presence(ws).catch(() => null);
  if (presence === null || presence.offline_tasks.length === 0) return tasks;
  const devices = await new IdentityClient(client).devices(ws).catch(() => []);
  return withPresencePause(
    tasks,
    presence,
    deviceNames(devices.filter((d) => d.state !== "bad_signature")),
  );
}
