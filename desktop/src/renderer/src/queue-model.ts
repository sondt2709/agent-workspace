// The queue of a task as the desktop shows it (openspec queue-and-assign): awd gives the label and
// the cause in the queues route; this module indexes them by task and joins them into one line.
import type { QueuesReply } from "../../shared/channels.ts";

export interface TaskQueue {
  agent: string;
  /** From 1; null for a task with open dependencies. */
  position: number | null;
  /** "Queued · 2nd for claude@ubuntu-01". */
  label: string;
  /** "2 sessions working". */
  cause: string;
}

/** The queue of each queued task, by task id. */
export function queueIndex(reply: QueuesReply | undefined): ReadonlyMap<string, TaskQueue> {
  const index = new Map<string, TaskQueue>();
  for (const queue of reply?.agents ?? []) {
    for (const entry of queue.tasks) {
      index.set(entry.task, {
        agent: queue.agent,
        position: entry.position,
        label: entry.text,
        cause: entry.cause.text,
      });
    }
  }
  return index;
}

/** "Queued · 2nd for claude@ubuntu-01 · 2 sessions working". */
export function queueLine(queue: TaskQueue): string {
  return `${queue.label} · ${queue.cause}`;
}
