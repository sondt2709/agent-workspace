// The learning step at the end of a task (docs/workflow.md 4.10.2, decision D3, openspec
// agent-learning). AW never blocks `done` on it: it reminds the agent, and it writes a thread
// comment when a done task ends its session with no learning step.
import type { EventRow } from "@aw/core";

/** True when the task log has an applied `task.learned` (a learned item or "Nothing new"). */
export function hasLearningStep(rows: EventRow[]): boolean {
  return rows.some((row) => row.type === "task.learned" && row.applied);
}

/** The commands of the learning step, for the "Result approved" notice. */
export function learnCommands(key: string): string {
  return `\`aw learn ${key} --file <path> --title <title>\` for each thing you learned, or \`aw learn ${key} --nothing-new\``;
}

/** The reminder in the reply of `done` when the task has no learning step yet. */
export function learnReminder(key: string): string {
  return `You recorded no learning step for ${key}: run learn for each thing you learned, or learn with nothing_new: true (${learnCommands(key)}), before you end your turn.`;
}

/** The thread comment of AW when a done task ends its session with no learning step. */
export function noLearningComment(key: string): string {
  return `${key} is done with no learned item and no "Nothing new" (decision D3).`;
}
