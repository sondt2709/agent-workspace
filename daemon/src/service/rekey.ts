// The rekey writer of awd (docs/architecture.md 4.3.3 item 3, openspec offline-task-keys): after a
// merge, this device writes `task.rekeyed` for each duplicate task key that it must change.
import { rekeyPlan, type EventRow, type RekeyItem, type WorkspaceView } from "@aw/core";
import type { Logger } from "../log.ts";

export interface RekeyInput {
  view: WorkspaceView;
  /** The slug of this device. */
  device: string;
  /** The merged event rows of a task. */
  rows: (task: string) => EventRow[];
  /** Appends `task.rekeyed` to the log of this device for the task. */
  write: (item: RekeyItem) => Promise<void>;
  log: Logger;
}

/** True when the log of the task has a `task.rekeyed` of this device from the key `from`. */
function written(rows: EventRow[], device: string, from: string): boolean {
  return rows.some(
    (row) =>
      row.type === "task.rekeyed" &&
      row.dev === device &&
      (row.event as { data?: { from?: unknown } }).data?.from === from,
  );
}

/**
 * Writes the rekey plan of this device. A task whose log already has a rekey of this device from
 * its current key gets no second event: so a restart, a second merge or a rejected event never
 * writes again. A failed write goes to the log; the next merge tries again. Returns the items that
 * awd wrote.
 */
export async function rekeyDuplicates(input: RekeyInput): Promise<RekeyItem[]> {
  const prefix = input.view.workspace?.key_prefix;
  if (!prefix) return [];
  const done: RekeyItem[] = [];
  for (const item of rekeyPlan(input.view, prefix, input.device)) {
    if (written(input.rows(item.task), input.device, item.from)) {
      input.log.debug({ rekey: item }, "The rekey of this task is already in the log");
      continue;
    }
    try {
      await input.write(item);
      done.push(item);
      input.log.info({ rekey: item }, `Task key ${item.from} is now ${item.to}`);
    } catch (error) {
      input.log.warn({ err: error, rekey: item }, "The rekey of a duplicate task key failed");
    }
  }
  return done;
}
