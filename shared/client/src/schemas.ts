// The zod schemas of the local API: the bodies, the parameters and the replies. awd checks each
// request with them and makes `contracts/openapi.yaml` from them (design decisions 12 and 13); @aw/client
// parses each reply with them (docs/engineering-rules.md 5.2). Reply objects are loose: a newer
// awd can add a field, and an older client keeps it.
import {
  absolutePath,
  agentRef,
  deviceSlug,
  entryName,
  keyPrefix,
  permissionMode,
  projectSlug,
  sessionHost,
  stage,
  workIn,
} from "@aw/schema";
import { z } from "zod";

// ---- Common -------------------------------------------------------------------------------

export const errorEnvelope = z
  .object({
    error: z.object({
      code: z.string().describe("A stable error code, for example `invalid_input` or `not_found`"),
      message: z.string(),
      details: z.unknown().optional(),
    }),
    trace_id: z.string(),
  })
  .meta({ id: "ErrorEnvelope" });

export const errorReplies = {
  400: errorEnvelope,
  401: errorEnvelope,
  403: errorEnvelope,
  404: errorEnvelope,
  409: errorEnvelope,
  500: errorEnvelope,
  503: errorEnvelope,
};

const selector = z.string().min(1).max(128);
export const wsParams = z.object({
  ws: selector.describe("The workspace id or name. `-` selects the only workspace."),
});
export const taskParams = wsParams.extend({
  task: selector.describe(
    "The task id, the key (any letter case) or an id prefix of 8+ characters",
  ),
});
export const gateParams = wsParams.extend({
  gate: selector.describe("The gate id or an id prefix of 8+ characters"),
});

const boolText = z.enum(["true", "false"]);

// ---- Views (loose) ------------------------------------------------------------------------

const eventRef = z.looseObject({ event: z.string(), dev: z.string(), hlc: z.string() });

export const answerView = eventRef
  .extend({
    by: z.string().nullable(),
    version: z.int(),
    answer: z.string(),
    comment: z.string().nullable(),
    use: z.enum(["pending", "used", "comment"]),
  })
  .meta({ id: "Answer" });

export const gateView = z
  .looseObject({
    gate: z.string(),
    kind: z.string(),
    version: z.int(),
    title: z.string(),
    options: z.array(z.string()),
    file: z.string().nullable(),
    state: z.enum(["open", "resolved"]),
    answer: z.string().nullable(),
    answer_event: z.string().nullable(),
    resolved_by: z.string().nullable(),
    answers: z.array(answerView),
  })
  .meta({ id: "Gate" });

export const taskRef = z
  .looseObject({ id: z.string(), key: z.string().nullable(), title: z.string().nullable() })
  .meta({ id: "TaskRef" });

export const gateEntry = gateView.extend({ task: taskRef }).meta({ id: "GateEntry" });

export const taskView = z
  .looseObject({
    id: z.string(),
    key: z.string().nullable(),
    key_state: z.enum(["ok", "duplicate"]),
    project: z.string().nullable(),
    title: z.string().nullable(),
    first_message: z.string().nullable(),
    priority: z.string().nullable(),
    stage,
    needs_you: z.array(z.string()),
    needs_you_reasons: z.array(z.looseObject({ reason: z.string() })),
    needs_you_lane: z.boolean(),
    assignee: z.string().nullable(),
    owner: z.string().nullable(),
    parent: z.string().nullable(),
    subtasks: z.array(z.string()),
    depends_on: z.array(z.string()),
    archived: z.boolean(),
    gates: z.array(gateView),
    last_hlc: z.string().nullable(),
  })
  .meta({ id: "Task" });

export const eventView = z
  .looseObject({
    v: z.int(),
    id: z.string(),
    hlc: z.string(),
    dev: z.string(),
    type: z.string(),
    task: z.string().optional(),
    by: z.string().optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "Event" });

export const eventRow = z
  .looseObject({
    id: z.string(),
    task: z.string().nullable(),
    hlc: z.string(),
    dev: z.string(),
    type: z.string(),
    path: z.string(),
    line: z.int(),
    applied: z.boolean(),
    reason: z.string().nullable(),
    event: eventView,
  })
  .meta({ id: "EventRow" });

export const writeResult = z
  .looseObject({
    event: eventView,
    applied: z.boolean().describe("False when the merge did not apply the event; see `reason`"),
    reason: z.string().nullable(),
  })
  .meta({ id: "WriteResult" });

export const projectView = z
  .looseObject({
    slug: z.string(),
    name: z.string(),
    devices: z.array(z.string()),
    default_agent: z.string(),
    test_servers: z.array(z.string()),
    links: z.array(z.string()),
    main_repo: z.string().nullable().optional(),
    switches: z
      .looseObject({ assign_new_subtasks_to_default_device: z.boolean().optional() })
      .optional(),
    archived: z.boolean().optional(),
    tasks: z.array(z.string()),
  })
  .meta({ id: "Project" });

export const noticeView = z.looseObject({
  code: z.enum(["truncated", "replaced", "removed"]),
  path: z.string(),
  at: z.string(),
});

export const workspaceSummary = z
  .looseObject({
    id: z.string(),
    name: z.string().nullable(),
    path: z.string(),
    ready: z.boolean(),
    error: z.string().nullable(),
    tasks: z.int(),
    open_gates: z.int(),
    issues: z.int(),
    notices: z.array(noticeView),
    last_hlc: z.string().nullable(),
    /** The permission mode of new projects (openspec permissions-default); null before the load. */
    new_project_permission_mode: permissionMode.nullable().optional(),
  })
  .meta({ id: "WorkspaceSummary" });

export const issueView = z
  .looseObject({
    code: z.string(),
    path: z.string(),
    line: z.int().nullable(),
    event: z.string().nullable(),
    task: z.string().nullable(),
    reason: z.string().nullable(),
    message: z.string(),
  })
  .meta({ id: "Issue" });

export const deviceConfig = z.looseObject({
  slug: z.string(),
  name: z.string(),
  role: z.enum(["local", "remote", "mobile"]),
});

export const statusReply = z
  .looseObject({
    version: z.string(),
    device: deviceConfig,
    pid: z.int(),
    started_at: z.string(),
    uptime_s: z.int(),
    socket: z.string(),
    ready: z.boolean(),
    workspaces: z.array(workspaceSummary),
  })
  .meta({ id: "Status" });

/** The state of the sync engine (docs/phase-1.md 6.1). */
export const syncEngineState = z
  .enum([
    "not_configured",
    "not_installed",
    "starting",
    "running",
    "restarting",
    "stopped",
    "failed",
  ])
  .meta({ id: "SyncEngineState" });

export const readyReply = z
  .object({
    ready: z.boolean(),
    checks: z.object({
      workspaces: z.array(
        z.object({ id: z.string(), ready: z.boolean(), error: z.string().nullable() }),
      ),
      sync_engine: syncEngineState,
      session_host: z.enum(["ok", "failed", "not_configured"]),
      /** The agent binary of the sessions (`claude --version` answers): `ok` or `failed`. */
      session_agent: z.enum(["ok", "failed", "not_configured"]),
    }),
  })
  .meta({ id: "Ready" });

export const versionReply = z
  .object({
    version: z.string(),
    api: z.int(),
    node: z.string(),
  })
  .meta({ id: "Version" });

// ---- Requests -----------------------------------------------------------------------------

export const initWorkspaceBody = z.object({
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The absolute path of the workspace folder itself. Leave it out to use a location (parent).",
    ),
  parent: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The absolute location that holds the workspace folder: <parent>/<name>, or <name>-aw1 when that name is in use. With no path and no parent: ~/AW, with the name Personal by default.",
    ),
  name: z.string().min(1).max(200).optional(),
  key_prefix: keyPrefix.optional(),
});

export const addProjectBody = z.object({
  slug: projectSlug,
  name: z.string().min(1).max(200).optional(),
  devices: z.array(z.string().min(1)).optional(),
  default_agent: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  test_servers: z.array(entryName).optional(),
  links: z.array(z.string().min(1)).optional(),
  permission_mode: permissionMode
    .optional()
    .describe(
      "The permission mode of the project. Not set: new_project_permission_mode of the workspace",
    ),
});

/**
 * The session options of a person (openspec session-options). Only a person route takes them, so
 * an agent never sets them. A field that is left out takes its default.
 */
export const sessionOptionsBody = z
  .object({
    permission_mode: permissionMode
      .nullable()
      .optional()
      .describe(
        "default, accept_edits or skip (no gate for each command); null: the project default",
      ),
    agent_teams: z.boolean().optional().describe("Turn on Claude Code agent teams"),
    work_in: workIn.optional().describe("worktree (default), checkout or folder"),
    folder: absolutePath
      .nullable()
      .optional()
      .describe("The absolute folder on the session device; only with work_in folder"),
    switch_branch: z
      .boolean()
      .optional()
      .describe(
        "With work_in checkout: true (default) checks out aw/<key>; false keeps the branch",
      ),
  })
  .meta({ id: "SessionOptionsInput" });

export const createTaskBody = z.object({
  project: projectSlug,
  title: z.string().min(1).max(500),
  first_message: z.string().describe("The raw first input of the agent. AW passes it as is."),
  assignee: agentRef.nullable().optional(),
  parent: selector.nullable().optional(),
  depends_on: z.array(selector).optional(),
  test_server: entryName.nullable().optional(),
  credentials: z.array(entryName).optional(),
  links: z.array(z.string().min(1)).optional(),
  session_host: sessionHost
    .optional()
    .describe("The session host of the session: tmux (default) or orca (add-orca-session-host)."),
  session_options: sessionOptionsBody.optional(),
});

export const editTaskBody = z.object({
  title: z.string().min(1).max(500).optional(),
  first_message: z.string().optional(),
  priority: z.string().min(1).optional(),
});

export const assignBody = z.object({
  assignee: agentRef,
  session_host: sessionHost
    .optional()
    .describe("The session host of the new session: tmux (default) or orca."),
  session_options: sessionOptionsBody.optional(),
});

/** `aw task archive [--stop]` (openspec task-actions). The client sends `{}` with no stop. */
export const archiveBody = z
  .object({
    stop: z
      .boolean()
      .optional()
      .describe(
        "Stop a running session first (session.stop_requested). Without it, a running session gives 409.",
      ),
  })
  .optional();

export const sendMessageBody = z.object({
  text: z
    .string()
    .min(1)
    .max(60_000)
    .refine((text) => text.trim().length > 0, "The message is empty")
    .describe("The raw text. The session device delivers it as the next input of the session."),
});

export const answerBody = z.object({
  answer: z.string().min(1),
  comment: z.string().nullable().optional(),
  version: z.int().min(1).optional(),
});

export const taskListQuery = z.object({
  project: projectSlug.optional(),
  stage: stage.optional(),
  needs_you: boolText.optional(),
  archived: boolText.optional(),
});

export const threadQuery = z.object({
  after: z.string().min(1).optional().describe("The `next` cursor of the last page"),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  from: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("The offset of the first event (0 is the first), when `after` is not given"),
  ancestors: boolText.optional(),
  before: z
    .string()
    .min(1)
    .optional()
    .describe("The `prev` cursor of a page: the `limit` events just before it"),
  newest: boolText.optional().describe("`true`: the newest `limit` events (still oldest first)"),
  types: z
    .string()
    .regex(/^[a-z_.]+(,[a-z_.]+)*$/)
    .optional()
    .describe(
      "Only the events of these types, comma separated, for example gate.opened,result.posted",
    ),
});

export const gateListQuery = z.object({
  task: selector.optional(),
  state: z.enum(["open", "resolved", "all"]).optional(),
});

// ---- Replies ------------------------------------------------------------------------------

export const threadPage = z
  .object({
    task: taskRef,
    events: z.array(eventRow),
    next: z.string().nullable(),
    prev: z
      .string()
      .nullable()
      .describe("The cursor of the first event when older events exist: pass it as `before`"),
  })
  .meta({ id: "ThreadPage" });

export const threadReply = threadPage.extend({
  ancestors: z.array(threadPage).describe("The threads of the parents, oldest first"),
});

export const taskWriteReply = writeResult.extend({ task: taskView });
export const taskEditReply = z.object({
  task: taskView,
  results: z.array(writeResult),
  applied: z.boolean(),
});
export const gateAnswerReply = writeResult.extend({ gate: gateEntry });
export const initWorkspaceReply = z.object({
  created: z.boolean(),
  workspace: workspaceSummary,
  folder_note: z
    .string()
    .nullable()
    .default(null)
    .describe("One sentence when the folder rule skipped a taken name, else null"),
});

// ---- Event stream -------------------------------------------------------------------------

export const streamMessage = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("hello"), version: z.string() }),
  z.looseObject({
    type: z.literal("changed"),
    workspace: z.string(),
    tasks: z.array(z.string()),
    workspace_changed: z.boolean(),
    documents_changed: z.boolean(),
    full: z.boolean(),
  }),
  z.looseObject({
    type: z.literal("notice"),
    workspace: z.string(),
    notices: z.array(z.looseObject({ code: z.string(), path: z.string() })),
  }),
]);

// ---- Sync ---------------------------------------------------------------------------------

const syncRole = z.enum(["local", "remote", "mobile"]);

export const syncFolderStatus = z.looseObject({
  folder: z.string(),
  workspace: z.string(),
  kind: z.enum(["tasks", "knowledge", "secure"]),
  needItems: z.number().int(),
  needBytes: z.number().int(),
  remoteState: z.string(),
  inSync: z.boolean(),
});

export const syncPeerStatus = z
  .looseObject({
    device: z.string(),
    connected: z.boolean(),
    route: z.enum(["lan", "tailscale", "relay", "internet", "storage"]).optional(),
    needItems: z.number().int(),
    needBytes: z.number().int(),
    inSync: z.boolean(),
    lastSeen: z.string().optional(),
    lastSynced: z.string().optional(),
    role: syncRole.optional(),
    folders: z.array(syncFolderStatus).optional(),
    text: z.string().describe('The status text, for example "Synced 12 s ago"'),
  })
  .meta({ id: "SyncPeerStatus" });

export const syncStatusReply = z
  .looseObject({
    engine: syncEngineState,
    device: z.string(),
    sync_id: z.string().nullable().describe("The engine device id of this device"),
    paused: z.boolean(),
    pids: z.array(z.number().int()),
    peers: z.array(syncPeerStatus),
  })
  .meta({ id: "SyncStatus" });

export const syncNowBody = z.object({
  timeout_ms: z
    .number()
    .int()
    .min(100)
    .max(600_000)
    .optional()
    .describe("Stop after this time. Default 20000 (20 s)."),
});

export const syncNowReply = z
  .looseObject({
    at: z.string(),
    pending: z.array(
      z.looseObject({
        device: z.string(),
        items: z.number().int(),
        reason: z.enum(["offline", "timeout"]),
      }),
    ),
    status: syncStatusReply,
  })
  .meta({ id: "SyncNowResult" });

export const addPeerBody = z.object({
  device_id: z
    .string()
    .regex(/^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$/)
    .describe("The engine device id of the peer"),
  addresses: z
    .array(z.string().min(1))
    .min(1)
    .describe("Addresses to dial, for example tcp://192.0.2.10:22300, or dynamic"),
  name: deviceSlug.optional().describe("The AW device slug of the peer. Default: peer-<short id>."),
  role: syncRole.optional().describe("Default: remote"),
});

export const peerParams = z.object({
  device: z.string().min(1).max(128).describe("The device slug or the engine device id"),
});

// ---- Sessions (add-claude-sessions-tmux) --------------------------------------------------

export * from "./session-schemas.ts";
