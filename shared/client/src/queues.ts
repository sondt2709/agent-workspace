// The queues route (openspec queue-and-assign): the queue of each agent with the position and the
// cause of each waiting task, and the tasks that need an assignee. awd checks its reply with this
// schema and generates contracts/openapi.yaml from it. The interfaces name the fields that the
// desktop reads; the renderer imports only the types.
import { z } from "zod";

export type QueueCauseCode =
  | "device_revoked"
  | "device_offline"
  | "max_working"
  | "login_ended"
  | "usage_limit"
  | "disk_full"
  | "dependencies"
  | "starting";

export interface QueueEntryView {
  task: string;
  key: string | null;
  title: string | null;
  /** From 1; null for a task with open dependencies. */
  position: number | null;
  /** "Queued · 2nd for claude@ubuntu-01". */
  text: string;
  cause: { code: QueueCauseCode; text: string };
}

export interface AgentQueueView {
  agent: string;
  device: string;
  max_working: number;
  working: number;
  tasks: QueueEntryView[];
}

export interface UnassignedTaskView {
  task: string;
  key: string | null;
  title: string | null;
  /** The `by` of `task.created`, or null. */
  created_by: string | null;
  /** True when an agent created the task ("Assign task" notifies only then). */
  by_agent: boolean;
}

export interface QueuesReply {
  /** This device. */
  device: string;
  agents: AgentQueueView[];
  unassigned: UnassignedTaskView[];
}

const causeCode = z.enum([
  "device_revoked",
  "device_offline",
  "max_working",
  "login_ended",
  "usage_limit",
  "disk_full",
  "dependencies",
  "starting",
]);

function queuesSchema(code: z.ZodType<string>) {
  return z.looseObject({
    device: z.string().describe("This device"),
    agents: z.array(
      z.looseObject({
        agent: z.string().describe("agent@device"),
        device: z.string(),
        max_working: z.int().describe("The maximum of working sessions (health.yaml, else 2)"),
        working: z.int().describe("The working sessions: running, no open gate, no pause"),
        tasks: z.array(
          z.looseObject({
            task: z.string(),
            key: z.string().nullable(),
            title: z.string().nullable(),
            position: z
              .int()
              .min(1)
              .nullable()
              .describe("From 1; null for a task with open dependencies"),
            text: z.string().describe('For example "Queued · 2nd for claude@ubuntu-01"'),
            cause: z.looseObject({
              code,
              text: z.string().describe('For example "2 sessions working"'),
            }),
          }),
        ),
      }),
    ),
    unassigned: z.array(
      z.looseObject({
        task: z.string(),
        key: z.string().nullable(),
        title: z.string().nullable(),
        created_by: z.string().nullable(),
        by_agent: z.boolean().describe("True when an agent created the task"),
      }),
    ),
  });
}

/** The reply of awd: the closed list of cause codes (contracts/openapi.yaml). */
export const queuesReply = queuesSchema(causeCode).meta({ id: "Queues" });

/**
 * The reply as a client reads it: any cause code, so an older desktop keeps its queue chips and the
 * "Assign task" notifications when a newer awd adds a cause (queue-and-assign review low 4).
 */
export const queuesReplyRead = queuesSchema(z.string());
