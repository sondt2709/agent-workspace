// The Activity rule of the task detail (openspec task-view-focus and phone-task-focus, docs/design.md
// 8.6): which event of the thread shows in the Activity tab. Each event shows in the Session tab
// (principle 8). The phone has the same rule (android/control Activity.kt): both tests read
// contracts/fixtures/activity/cases.json.
import type { EventRow } from "../../shared/channels.ts";

export type ActivityPlace = "activity" | "session";

/**
 * One entry for each event type of `contracts/samples/schema-samples.json`. A test fails when a
 * type has no entry or the entry differs from `places` of the shared fixture, so a new event type
 * needs a decision here and on the phone.
 */
export const ACTIVITY: Readonly<Record<string, ActivityPlace>> = {
  // The task: what changed, as an issue shows it.
  "task.created": "activity",
  "task.assigned": "activity",
  "task.rekeyed": "activity",
  "task.edited": "activity",
  "task.stage_changed": "activity",
  "task.paused": "activity",
  "task.resumed": "activity",
  "task.done": "activity",
  "task.archived": "activity",
  "task.unarchived": "activity",
  "task.learned": "activity",
  // The conversation and the work products.
  "message.agent": "activity",
  "message.sent": "activity",
  "comment.added": "activity",
  "message.human": "activity", // only some sources: see inActivity()
  "gate.opened": "activity",
  "gate.answered": "activity",
  "approach.proposed": "activity",
  "result.posted": "activity",
  "artifact.added": "activity",
  // A stop shows its cause (principle 2, decision 37): only some reasons, see inActivity().
  "session.ended": "activity",
  // The session detail.
  "task.claimed": "session",
  "task.released": "session",
  "task.ready": "session",
  "task.progress": "session",
  "gate.resolved": "session",
  "handoff.written": "session",
  "session.started": "session",
  "session.resumed": "session",
  "session.stop_requested": "session",
  // Workspace events: they do not belong to the task view.
  "slot.acquired": "session",
  "slot.renewed": "session",
  "slot.released": "session",
  "slot.revoked": "session",
  "queue.reordered": "session",
  "credential.added": "session",
  "credential.imported": "session",
  "credential.removed": "session",
  "project.removed": "session",
  "knowledge.changed": "session",
  "knowledge.undo_requested": "session",
  "knowledge.suggested": "session",
  "knowledge.suggestion_resolved": "session",
  "device.heartbeat": "session",
};

/** The reasons of a session end that show in Activity: the work stopped and waits for a person. */
const STOPS = new Set(["stopped", "crashed"]);

/**
 * True when the row shows in Activity. A `message.human` is each input of the session: it shows
 * only when the person typed it in the terminal (source `typed` or `phone` with no delivery id).
 * Each other input repeats a text that Activity has: the first message (the description), an
 * answer (`gate.answered`), a notice of AW, or a delivered message (`message.sent`).
 * A `session.ended` shows only when the session stopped or crashed (decision 37); a done, moved or
 * replaced session shows its effect in other rows (Done, the assignment).
 */
export function inActivity(row: EventRow): boolean {
  if (ACTIVITY[row.type] !== "activity") return false;
  const data = row.event.data;
  if (row.type === "session.ended") return STOPS.has(String(data.reason));
  if (row.type !== "message.human") return true;
  const { source, delivery_id: delivery } = data;
  return (
    (source === "typed" || source === "phone") && (delivery === null || delivery === undefined)
  );
}

const NO_NEW_SESSION = "AW starts no new session until a person starts one.";

/**
 * The line of an Activity row that has its own text in Activity, or null for the usual text. A
 * stopped or crashed session shows its cause and when the work continues (principle 2).
 */
export function activityLine(row: EventRow): string | null {
  if (row.type !== "session.ended") return null;
  switch (row.event.data.reason) {
    case "stopped":
      return `Session stopped on ${row.dev}: a person stopped it or ended the agent. ${NO_NEW_SESSION}`;
    case "crashed":
      return `Session crashed on ${row.dev}: the agent process ended and AW did not restart it. ${NO_NEW_SESSION}`;
    default:
      return null;
  }
}

/** The text of an agent message that Activity shows first: at most 6 lines. */
export const CLAMP_LINES = 6;

export function clampText(text: string): { head: string; cut: boolean } {
  const lines = text.split("\n");
  if (lines.length <= CLAMP_LINES) return { head: text, cut: false };
  return { head: lines.slice(0, CLAMP_LINES).join("\n"), cut: true };
}
