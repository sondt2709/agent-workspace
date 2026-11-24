// The event envelope and the data of each event type (docs/phase-1.md 3.3, docs/workflow.md 8 and 9).
// One event is one JSON line in a log file of its device. `v` is the major version of the event type.
import { z } from "zod";
import {
  actorRef,
  agentRef,
  count,
  deviceSlug,
  entryName,
  gateKind,
  hlcText,
  isoTime,
  pauseCause,
  permissionMode,
  projectSlug,
  relativePath,
  sessionHost,
  sessionOptions,
  sha256,
  stage,
  taskKey,
  uuidv7,
  workIn,
} from "./common.ts";
import { projectV1 } from "./documents.ts";

/** The fields of each event, with any type and any data. */
export const eventEnvelope = z.looseObject({
  v: z.int().min(1),
  id: uuidv7,
  hlc: hlcText,
  dev: deviceSlug,
  type: z.string().regex(/^[a-z]+(?:\.[a-z_]+)+$/),
  /** The task id. Optional: the folder of a task log names the task. */
  task: uuidv7.optional(),
  /** The actor, for example `human@pixel-9` or `claude@ubuntu-01`. */
  by: actorRef.optional(),
  data: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelope>;

const text = z.string();
/** The longest lease of a test slot: 24 h, in ms. */
export const MAX_LEASE_TTL_MS = 24 * 60 * 60 * 1000;
const leaseTtlMs = z.int().min(1).max(MAX_LEASE_TTL_MS);
/** The window and pane of the session host (openspec agent-pushes-updates). */
const sessionTerminal = z.looseObject({
  window: z.string().min(1).nullable(),
  pane: z.string().min(1).nullable(),
});
const sessionPids = z.looseObject({
  pane: z.int().min(1).nullable().default(null),
  claude: z.int().min(1).nullable().default(null),
  pgid: z.int().min(1).nullable().default(null),
});

/**
 * One decision of a gate: the question, its options and the recommended option. The writer (awd)
 * checks that the recommended option is one of the options.
 */
export const gateDecision = z.looseObject({
  question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(500)).min(1).max(20),
  recommended: z.string().min(1).max(500),
});

/** One option of a gate question: the label is the answer, the description explains it. */
export const gateQuestionOption = z.looseObject({
  label: z.string().min(1).max(500),
  description: z.string().max(2000).default(""),
});

/**
 * One question of a gate with its options (openspec gate-context): the questions of an
 * AskUserQuestion call, or the question of `aw ask` with option descriptions.
 */
export const gateQuestion = z.looseObject({
  question: z.string().min(1).max(2000),
  header: z.string().max(100).nullable().default(null),
  multi_select: z.boolean().default(false),
  options: z.array(gateQuestionOption).max(20).default([]),
});

/** The data schema of each event type, version 1. */
export const eventDataV1 = {
  // Task life cycle (docs/workflow.md 4, docs/architecture.md 4.3).
  "task.created": z.looseObject({
    key: taskKey,
    project: projectSlug,
    title: z.string().min(1).max(500),
    first_message: text,
    assignee: agentRef.nullable().default(null),
    parent: uuidv7.nullable().default(null),
    depends_on: z.array(uuidv7).default([]),
    test_server: entryName.nullable().default(null),
    credentials: z.array(entryName).default([]),
    links: z.array(z.string().min(1)).default([]),
    /** The session host that the person picked for the session (no default: older events). */
    session_host: sessionHost.optional(),
    /** The session options of a person (openspec session-options); the fold ignores an agent's. */
    session_options: sessionOptions.optional(),
  }),
  "task.assigned": z.looseObject({
    assignee: agentRef,
    session_host: sessionHost.optional(),
    session_options: sessionOptions.optional(),
  }),
  "task.claimed": z.looseObject({
    epoch: z.int().min(1),
    device: deviceSlug,
    session: uuidv7,
    /** The id of the claim event that this claim replaces, or null for the first claim. */
    based_on: uuidv7.nullable().default(null),
  }),
  "task.released": z.looseObject({ epoch: z.int().min(1) }),
  "task.rekeyed": z.looseObject({ from: taskKey, to: taskKey }),
  /** An edit of an editable field: the newest HLC wins per field. */
  "task.edited": z.looseObject({
    field: z.enum(["title", "first_message", "priority"]),
    value: text,
  }),
  "task.stage_changed": z.looseObject({ from: stage, to: stage }),
  "task.paused": z.looseObject({
    cause: pauseCause,
    resumes_at: isoTime.nullable().default(null),
    next_step: z.string().min(1),
    needs_human: z.boolean(),
  }),
  "task.resumed": z.looseObject({}),
  "task.ready": z.looseObject({
    missing: z.array(z.string().min(1)).default([]),
    /** The question gate of each missing item, in the same order (add-task-loop). */
    gates: z.array(uuidv7).default([]),
  }),
  "task.progress": z.looseObject({ text: z.string().min(1) }),
  "task.done": z.looseObject({}),
  /**
   * The learning step of a task (decision D3): `aw learn --nothing-new`, or a learned item with its
   * knowledge path, its change id, or its suggestion id when it waits for approval (agent-learning).
   */
  "task.learned": z.looseObject({
    nothing_new: z.boolean(),
    path: relativePath.optional(),
    change: uuidv7.nullable().optional(),
    suggestion: uuidv7.nullable().optional(),
  }),
  "task.archived": z.looseObject({}),
  /** A person makes an archived task active again (openspec task-actions). The newest of the two wins. */
  "task.unarchived": z.looseObject({}),

  // Thread (principle 8): raw text, never a summary.
  "message.human": z.looseObject({
    text,
    /** `notice`: a text of AW itself, for example "Start implementing" (add-task-loop). */
    source: z.enum(["first", "typed", "answer", "phone", "notice"]),
    session: uuidv7,
    delivery_id: z.string().min(1).nullable().default(null),
  }),
  /**
   * `source` (openspec agent-pushes-updates): `turn` is the text of an agent turn (the Stop hook,
   * Session only), `tool` a message that the agent sent with `aw message` or the MCP tool. An older
   * event has no source.
   */
  "message.agent": z.looseObject({
    text,
    session: uuidv7.nullable().default(null),
    source: z.enum(["turn", "tool"]).optional(),
  }),
  /** `kind: nudge`: the notice after a turn with no AW update (Session only). */
  "message.sent": z.looseObject({
    id: uuidv7,
    text,
    to_session: uuidv7,
    kind: z.enum(["nudge"]).optional(),
  }),
  "comment.added": z.looseObject({ text }),

  // Gates (docs/workflow.md 3).
  "gate.opened": z.looseObject({
    gate: uuidv7,
    kind: gateKind,
    version: z.int().min(1),
    title: z.string().default(""),
    text: z.string().default(""),
    options: z.array(z.string().min(1)).default([]),
    /** The permission request id `p-<uuidv7>` of "Approve command". */
    request_id: z
      .string()
      .regex(/^p-[0-9a-f-]{36}$/)
      .nullable()
      .default(null),
    file: relativePath.nullable().default(null),
    /** Optional decisions of an approach or a custom gate, each with a recommended option. */
    decisions: z.array(gateDecision).default([]),
    /** Optional questions with option descriptions, headers and multi-select (gate-context). */
    questions: z.array(gateQuestion).max(10).default([]),
  }),
  "gate.answered": z.looseObject({
    gate: uuidv7,
    version: z.int().min(1),
    answer: text,
    comment: z.string().nullable().default(null),
  }),
  "gate.resolved": z.looseObject({
    gate: uuidv7,
    version: z.int().min(1),
    /** The id of the `gate.answered` event that the session device used. */
    answer_event: uuidv7.nullable(),
    answer: text,
  }),

  // Work products (docs/workflow.md 8).
  "approach.proposed": z.looseObject({ version: z.int().min(1), file: relativePath }),
  "artifact.added": z.looseObject({
    path: relativePath,
    size: count,
    sha256,
  }),
  "result.posted": z.looseObject({
    file: relativePath,
    artifacts: z.array(relativePath).default([]),
  }),
  "handoff.written": z.looseObject({ file: relativePath }),

  // Sessions (docs/phase-1.md 9.3).
  "session.started": z.looseObject({
    session: uuidv7,
    host: z.enum(["tmux", "orca", "pty"]),
    cwd: z.string().min(1),
    plugin_dir: z.string().min(1).nullable().default(null),
    branch: z.string().min(1).nullable().default(null),
    credentials: z.array(entryName).default([]),
    pids: sessionPids.default({ pane: null, claude: null, pgid: null }),
    /** The Claude session name (`-n`) and the terminal of the session host (agent-pushes-updates). */
    name: z.string().min(1).nullable().optional(),
    terminal: sessionTerminal.optional(),
    /** The options of this session (openspec session-options; no default: older events). */
    permission_mode: permissionMode.optional(),
    agent_teams: z.boolean().optional(),
    work_in: workIn.optional(),
  }),
  "session.resumed": z.looseObject({
    session: uuidv7,
    text: z.string().default(""),
    /** The new pane of a resume (agent-pushes-updates); none for "Resume again". */
    terminal: sessionTerminal.optional(),
    pids: sessionPids.optional(),
  }),
  /** A person asks the session device to stop the session (the phone "Stop session"). */
  "session.stop_requested": z.looseObject({ session: uuidv7 }),
  "session.ended": z.looseObject({
    session: uuidv7,
    reason: z.enum(["done", "moved", "stopped", "crashed", "replaced"]),
  }),

  // Workspace log: test slots, queue and credential names (docs/architecture.md 4.6.8 and 4.7).
  // A lease TTL is at most 24 h: the expiry (HLC time + TTL) stays a normal ISO date in both
  // languages (JavaScript toISOString fails above year 275760 and writes +YYYYYY above 9999).
  "slot.acquired": z.looseObject({
    resource: entryName,
    slot: z.int().min(0),
    fencing_token: z.int().min(1),
    ttl_ms: leaseTtlMs,
    task: uuidv7,
    session: uuidv7,
  }),
  "slot.renewed": z.looseObject({
    resource: entryName,
    slot: z.int().min(0),
    fencing_token: z.int().min(1),
    ttl_ms: leaseTtlMs,
  }),
  "slot.released": z.looseObject({
    resource: entryName,
    slot: z.int().min(0),
    fencing_token: z.int().min(1),
  }),
  "slot.revoked": z.looseObject({
    resource: entryName,
    slot: z.int().min(0),
    fencing_token: z.int().min(1),
    reason: z.enum(["expired", "reboot", "human"]),
  }),
  "queue.reordered": z.looseObject({ agent: agentRef, tasks: z.array(uuidv7) }),
  "credential.added": z.looseObject({ name: entryName }),
  "credential.imported": z.looseObject({
    name: entryName,
    from: deviceSlug,
    /** The id of the phone file `devices/<from>/sealed/<id>.age`, or null. */
    sealed: z
      .string()
      .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)
      .nullable()
      .default(null),
  }),
  "credential.removed": z.looseObject({ name: entryName }),
  /**
   * A person removed a project (openspec project-remove). The merge takes the project and its tasks
   * out of the views. `document` is the `project.yaml` at the remove, for a recovery by hand.
   */
  "project.removed": z.looseObject({
    project: projectSlug,
    name: z.string().min(1).max(200),
    document: projectV1,
  }),

  // Knowledge log (docs/phase-1.md 5).
  "knowledge.changed": z.looseObject({
    path: relativePath,
    hash: sha256.nullable(),
    base: sha256.nullable(),
    author: actorRef,
    task: uuidv7.nullable().default(null),
    kind: z.enum(["learned", "edit", "undo", "replaced", "delete"]),
    /** The accepted suggestion that this change applies, else null. */
    suggestion: uuidv7.nullable().default(null),
  }),
  "knowledge.undo_requested": z.looseObject({ path: relativePath, hash: sha256 }),
  /**
   * An agent change that waits for "Approve knowledge change" (docs/architecture.md 4.8.3): a rule,
   * a locked file, shared knowledge or knowledge from another person. The content is in the event
   * (redacted, at most 48 KiB), so each device can show it. `content: null` removes the file.
   */
  "knowledge.suggested": z.looseObject({
    suggestion: uuidv7,
    path: relativePath,
    content: z.string().nullable(),
    hash: sha256.nullable(),
    base: sha256.nullable(),
    author: actorRef,
    task: uuidv7.nullable().default(null),
    kind: z.enum(["learned", "edit", "undo", "delete"]),
    reasons: z.array(z.enum(["rule", "locked", "shared", "other_person"])).min(1),
  }),
  /** A human accepts or rejects a suggestion. The first resolution in merge order wins. */
  "knowledge.suggestion_resolved": z.looseObject({
    suggestion: uuidv7,
    decision: z.enum(["accepted", "rejected"]),
    comment: z.string().nullable().default(null),
  }),

  // Presence: one line per 30 s in `devices/<device>/heartbeat/<date>.jsonl` (docs/phase-1.md 9.6).
  "device.heartbeat": z.looseObject({ boot_time: isoTime }),
} as const;

export type EventType = keyof typeof eventDataV1;
export const eventTypes = Object.keys(eventDataV1) as EventType[];

/** The full schema of one event type, version 1. */
function eventOf<T extends EventType>(type: T) {
  return eventEnvelope.extend({
    v: z.literal(1),
    type: z.literal(type),
    data: eventDataV1[type],
  });
}

type EventSchemas = { [T in EventType]: ReturnType<typeof eventOf<T>> };

/** The schema of each event type, version 1, by type. */
export const eventSchemasV1 = Object.fromEntries(
  eventTypes.map((type) => [type, eventOf(type)]),
) as unknown as EventSchemas;

/** `event.v1`: a known event of any type. */
export const eventV1 = z.discriminatedUnion(
  "type",
  eventTypes.map((type) => eventSchemasV1[type]) as unknown as [
    EventSchemas[EventType],
    ...EventSchemas[EventType][],
  ],
);
export type AwEvent = z.infer<typeof eventV1>;
export type EventOf<T extends EventType> = z.infer<EventSchemas[T]>;
export type EventData<T extends EventType> = z.input<(typeof eventDataV1)[T]>;

/** `heartbeat.v1`: a heartbeat line. */
export const heartbeatV1 = eventSchemasV1["device.heartbeat"];
export type HeartbeatEvent = z.infer<typeof heartbeatV1>;
