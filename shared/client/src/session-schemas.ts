// The zod schemas of the session routes of the local API (add-claude-sessions-tmux): the agent
// commands of a session, the PermissionRequest hook, and the session list.
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f-]{36}$/);
const taskRef = z.string().min(1).max(128).describe("The task key or id of the session");

export const sessionParams = z.object({ session: uuid.describe("The session id") });

/** The longest details of a question: the approach limit (MAX_GATE_FILE_CHARS of awd). */
export const MAX_ASK_DETAILS_CHARS = 256 * 1024;

/** An answer option of `ask`: a label, or a label with a description (openspec gate-context). */
export const askOption = z.union([
  z.string().min(1).max(500),
  z.object({
    label: z.string().min(1).max(500),
    description: z.string().max(2000).default(""),
  }),
]);

export const askBody = z.object({
  task: taskRef,
  text: z.string().min(1).max(20_000).describe("The question"),
  /** The full context of the decision as Markdown: the gate text (openspec gate-context). */
  details: z
    .string()
    .min(1)
    .max(MAX_ASK_DETAILS_CHARS)
    .optional()
    .describe("The full context of the decision as Markdown"),
  options: z.array(askOption).max(20).default([]),
});

export const messageBody = z.object({ task: taskRef, text: z.string().min(1).max(60_000) });

export const fileBody = z.object({
  task: taskRef,
  path: z.string().min(1).max(4096).describe("An absolute path on this computer"),
});

export const permissionBody = z.object({
  request_id: z.string().regex(/^p-[0-9a-f-]{36}$/),
  tool: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()).default({}),
});

const event = z.looseObject({
  id: z.string(),
  hlc: z.string(),
  dev: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const askReply = z
  .looseObject({ gate: z.string(), event, applied: z.boolean(), reason: z.string().nullable() })
  .meta({ id: "AskReply" });

export const agentWriteReply = z
  .looseObject({
    event,
    /** True when the event waits in the 1-second log buffer. */
    buffered: z.boolean(),
    path: z.string().nullable().default(null),
  })
  .meta({ id: "AgentWriteReply" });

export const permissionReply = z
  .looseObject({
    decision: z.discriminatedUnion("behavior", [
      z.looseObject({ behavior: z.literal("allow") }),
      z.looseObject({
        behavior: z.literal("deny"),
        message: z.string(),
        interrupt: z.boolean(),
      }),
    ]),
    gate: z.string().nullable(),
  })
  .meta({ id: "PermissionReply" });

export const sessionInfo = z
  .looseObject({
    id: z.string(),
    workspace: z.string(),
    task: z.string(),
    key: z.string().nullable(),
    agent: z.string(),
    /** The session host: `tmux` or `orca`. An older awd gives no host: its sessions run in tmux. */
    host: z.string().default("tmux"),
    epoch: z.int(),
    state: z.string(),
    cwd: z.string(),
    window: z.string().nullable(),
    pid: z.int().nullable(),
    resumes: z.int(),
  })
  .meta({ id: "Session" });

// ---- The work loop (add-task-loop) ----

export const gateDecisionBody = z.object({
  question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(500)).min(1).max(20),
  recommended: z.string().min(1).max(500).describe("One of the options"),
});

const markdown = z
  .string()
  .min(1)
  .max(256 * 1024)
  .describe("Markdown");

export const approachBody = z.object({
  task: taskRef,
  content: markdown,
  decisions: z.array(gateDecisionBody).max(20).default([]),
});

export const readyBody = z.object({
  task: taskRef,
  missing: z.array(z.string().min(1).max(2000)).max(20).default([]),
});

const name = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)
  .max(63);

export const subtaskBody = z.object({
  parent: taskRef.optional().describe("The session task (the default)"),
  title: z.string().min(1).max(500),
  first_message: z
    .string()
    .min(1)
    .max(256 * 1024),
  project: z.string().min(1).max(63).optional(),
  depends_on: z.array(taskRef).max(50).optional(),
  from_parent: z.boolean().optional().describe("Copy the test server, credentials and links"),
  test_server: name.nullable().optional(),
  credentials: z.array(name).max(50).optional(),
  links: z.array(z.string().min(1).max(2000)).max(50).optional(),
});

export const customGateBody = z.object({
  task: taskRef,
  content: markdown,
  decisions: z.array(gateDecisionBody).max(20).default([]),
  options: z.array(z.string().min(1).max(500)).max(20).default([]),
});

export const resultBody = z.object({
  task: taskRef,
  path: z.string().min(1).max(4096).describe("An absolute path on this computer"),
  artifacts: z.array(z.string().min(1).max(4096)).max(50).default([]),
});

export const doneBody = z.object({ task: taskRef });

/** The reply of a loop command: what happened, and what the agent does next. */
export const loopReply = z
  .looseObject({
    next: z.string(),
    gate: z.string().nullable().optional(),
    gates: z.array(z.string()).optional(),
    event: event.nullable().optional(),
    applied: z.boolean().optional(),
    reason: z.string().nullable().optional(),
  })
  .meta({ id: "LoopReply" });

export const subtaskReply = z
  .looseObject({
    next: z.string(),
    event,
    applied: z.boolean(),
    reason: z.string().nullable(),
    task: z.looseObject({ id: z.string(), key: z.string().nullable() }),
  })
  .meta({ id: "SubtaskReply" });

// ---- Test slots (add-continuity) ----

export const slotBody = z.object({
  resource: z
    .string()
    .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)
    .max(64)
    .describe("The slot resource, for example k3d"),
});

const lease = z.looseObject({
  resource: z.string(),
  slot: z.int(),
  fencing_token: z.int(),
  ttl_ms: z.int(),
  expires_at: z.string(),
});

/** A lease, or the queue position when each slot is taken. */
export const slotAcquireReply = z
  .looseObject({
    lease: lease.nullable(),
    renewed: z.boolean(),
    queued: z.int().nullable(),
    next: z.string(),
  })
  .meta({ id: "SlotAcquireReply" });

export const slotReleaseReply = z
  .looseObject({ released: lease, next: z.string() })
  .meta({ id: "SlotReleaseReply" });
