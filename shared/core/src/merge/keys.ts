// Task keys (docs/architecture.md 4.3.3): on a collision, the task of the device with the higher
// priority keeps the key. The other task shows "duplicate" until its creating device rekeys it.
import { compareOrder } from "./order.ts";
import type { TaskView, WorkspaceView } from "./view.ts";

/** Sets `key_state` and `rekey_by` of each task. `rank` gives 0 for the highest priority. */
export function markDuplicateKeys(tasks: TaskView[], rank: (device: string) => number): void {
  const groups = new Map<string, TaskView[]>();
  for (const task of tasks) {
    task.key_state = "ok";
    task.rekey_by = null;
    if (task.key === null || task.created === null) continue;
    const group = groups.get(task.key) ?? [];
    group.push(task);
    groups.set(task.key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) =>
        rank(a.created!.dev) - rank(b.created!.dev) ||
        compareOrder(
          { hlc: a.created!.hlc, dev: a.created!.dev, id: a.created!.event },
          { hlc: b.created!.hlc, dev: b.created!.dev, id: b.created!.event },
        ),
    );
    for (const task of group.slice(1)) {
      task.key_state = "duplicate";
      task.rekey_by = task.created!.dev;
    }
  }
}

/** The number of a key with this prefix, or null. */
function keyNumber(key: string | null, prefix: string): number | null {
  if (key === null || !key.startsWith(`${prefix}-`)) return null;
  const number = Number(key.slice(prefix.length + 1));
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * The next free key that the view knows: 1 above each number of the keys of the tasks, also the
 * keys of `task.created` before a rekey (docs/decisions/2026-11-22-device-sync.md, sync 7), and the
 * keys of the removed tasks, so no new task gets the key and the branch of a removed task.
 */
export function nextFreeKey(
  view: Pick<WorkspaceView, "tasks"> & Partial<Pick<WorkspaceView, "removed_tasks">>,
  prefix: string,
): string {
  let highest = 0;
  for (const task of [...view.tasks, ...(view.removed_tasks ?? [])]) {
    for (const key of [task.key, task.created_key]) {
      const number = keyNumber(key, prefix);
      if (number !== null && number > highest) highest = number;
    }
  }
  return `${prefix}-${highest + 1}`;
}

/** One `task.rekeyed` that a device must write. */
export interface RekeyItem {
  task: string;
  from: string;
  to: string;
}

/**
 * The rekeys that `device` must write (docs/architecture.md 4.3.3 item 3): one item for each task
 * with `key_state: duplicate` and `rekey_by: device`, in the order of their `task.created` events.
 * The first new key is the next free key of the view, and each next item adds 1. The Kotlin engine
 * gives the same plan (`android/shared` Rules.kt, contracts/fixtures/merge/task-key-collision).
 */
export function rekeyPlan(
  view: Pick<WorkspaceView, "tasks">,
  prefix: string,
  device: string,
): RekeyItem[] {
  const own = view.tasks
    .filter((t) => t.key_state === "duplicate" && t.rekey_by === device && t.key !== null)
    .sort((a, b) =>
      compareOrder(
        { hlc: a.created!.hlc, dev: a.created!.dev, id: a.created!.event },
        { hlc: b.created!.hlc, dev: b.created!.dev, id: b.created!.event },
      ),
    );
  if (own.length === 0) return [];
  const first = keyNumber(nextFreeKey(view, prefix), prefix)!;
  return own.map((task, index) => ({
    task: task.id,
    from: task.key!,
    to: `${prefix}-${first + index}`,
  }));
}
