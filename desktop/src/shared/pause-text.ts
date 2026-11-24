// The text of each pause cause of `task.paused` (contracts/schemas/event.v1.schema.json), for the
// Paused chip of the renderer and the notification title of the main process.
import { shownPauseText, type ShownPause } from "@aw/client/pause";

const PAUSE_TEXT: Record<string, string> = {
  usage_limit: "usage limit",
  usage_limit_weekly: "weekly usage limit",
  continue_cap: "continue limit",
  device_offline: "device offline",
  device_restart: "device restart",
  device_revoked: "device revoked",
  network_lost: "network lost",
  waiting_for_sync: "waiting for sync",
  task_moving: "moving to another device",
  agent_error: "agent error",
  login_expired: "login expired",
};

/** The text of a pause cause; an unknown cause shows its name with spaces. */
export function pauseText(cause: string): string {
  return PAUSE_TEXT[cause] ?? cause.replaceAll("_", " ");
}

/**
 * The text of a shown pause: "MacBook Pro offline" for a pause from the presence (openspec
 * move-paused-task), else the text of the cause.
 */
export function pauseLabel(pause: ShownPause): string {
  return shownPauseText(pause, pauseText);
}
