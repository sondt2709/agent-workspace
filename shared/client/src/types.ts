// The reply and input types of the local API (contracts/openapi.yaml). The zod schemas in schemas.ts are
// the source, and the client parses each reply with them; these types name the fields that the
// clients read. Each object can have more fields.

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
  trace_id: string;
}

export interface VersionReply {
  version: string;
  api: number;
  node: string;
}

export interface ReadyReply {
  ready: boolean;
  checks: {
    workspaces: { id: string; ready: boolean; error: string | null }[];
    sync_engine: string;
    session_host: string;
    session_agent: string;
  };
}

export interface Notice {
  code: "truncated" | "replaced" | "removed";
  path: string;
  at: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string | null;
  path: string;
  ready: boolean;
  error: string | null;
  tasks: number;
  open_gates: number;
  issues: number;
  notices: Notice[];
  last_hlc: string | null;
  /** The permission mode of new projects (openspec permissions-default); null before the load. */
  new_project_permission_mode?: "default" | "accept_edits" | "skip" | null;
}

export interface StatusReply {
  version: string;
  device: { slug: string; name: string; role: "local" | "remote" | "mobile" };
  pid: number;
  started_at: string;
  uptime_s: number;
  socket: string;
  ready: boolean;
  workspaces: WorkspaceSummary[];
}

export interface InitWorkspaceInput {
  /** The absolute workspace folder itself. */
  path?: string;
  /**
   * The absolute location that holds the workspace folder: `<parent>/<name>`, or `<name>-aw1` when
   * that name is in use. With no path and no parent: `~/AW` (the name "Personal" by default).
   */
  parent?: string;
  name?: string;
  key_prefix?: string;
}

export interface InitWorkspaceReply {
  created: boolean;
  workspace: WorkspaceSummary;
  /** One sentence when the folder rule skipped a taken name, else null. */
  folder_note: string | null;
}

export interface Project {
  slug: string;
  name: string;
  devices: string[];
  default_agent: string;
  test_servers: string[];
  links: string[];
  /** The main repository, one of `links` (gap-setup). */
  main_repo?: string | null;
  switches?: { assign_new_subtasks_to_default_device?: boolean };
  archived?: boolean;
  /** The permission mode of new sessions (openspec session-options). */
  permission_mode?: "default" | "accept_edits" | "skip";
  tasks: string[];
  [field: string]: unknown;
}

export interface AddProjectInput {
  slug: string;
  name?: string;
  devices?: string[];
  default_agent?: string;
  test_servers?: string[];
  links?: string[];
  /** Not set: `new_project_permission_mode` of the workspace (openspec permissions-default). */
  permission_mode?: "default" | "accept_edits" | "skip";
}

export interface Issue {
  code: string;
  path: string;
  line: number | null;
  event: string | null;
  task: string | null;
  reason: string | null;
  message: string;
}

export interface Answer {
  event: string;
  dev: string;
  hlc: string;
  by: string | null;
  version: number;
  answer: string;
  comment: string | null;
  use: "pending" | "used" | "comment";
}

export interface Gate {
  gate: string;
  kind: string;
  version: number;
  title: string;
  options: string[];
  file: string | null;
  state: "open" | "resolved";
  answer: string | null;
  answer_event: string | null;
  resolved_by: string | null;
  answers: Answer[];
  [field: string]: unknown;
}

export interface TaskRef {
  id: string;
  key: string | null;
  title: string | null;
}

export interface GateEntry extends Gate {
  task: TaskRef;
}

export interface Task {
  id: string;
  key: string | null;
  key_state: "ok" | "duplicate";
  project: string | null;
  title: string | null;
  first_message: string | null;
  priority: string | null;
  stage: string;
  needs_you: string[];
  needs_you_reasons: { reason: string; [field: string]: unknown }[];
  needs_you_lane: boolean;
  assignee: string | null;
  owner: string | null;
  parent: string | null;
  subtasks: string[];
  depends_on: string[];
  archived: boolean;
  gates: Gate[];
  last_hlc: string | null;
  [field: string]: unknown;
}

export interface Event {
  v: number;
  id: string;
  hlc: string;
  dev: string;
  type: string;
  task?: string;
  by?: string;
  data: Record<string, unknown>;
}

export interface EventRow {
  id: string;
  task: string | null;
  hlc: string;
  dev: string;
  type: string;
  path: string;
  line: number;
  applied: boolean;
  reason: string | null;
  event: Event;
}

export interface WriteResult {
  event: Event;
  applied: boolean;
  reason: string | null;
}

export interface TaskWriteReply extends WriteResult {
  task: Task;
}

export interface TaskEditReply {
  task: Task;
  results: WriteResult[];
  applied: boolean;
}

export interface GateAnswerReply extends WriteResult {
  gate: GateEntry;
}

export interface CreateTaskInput {
  project: string;
  title: string;
  first_message: string;
  assignee?: string | null;
  parent?: string | null;
  depends_on?: string[];
  test_server?: string | null;
  credentials?: string[];
  links?: string[];
  /** The session host of the session (add-orca-session-host). */
  session_host?: "tmux" | "orca";
  /** The session options of a person (openspec session-options). */
  session_options?: SessionOptionsInput;
}

/** The session options of a request (openspec session-options); a left-out field is the default. */
export interface SessionOptionsInput {
  /** `skip` runs each command with no gate. Null: the project default. */
  permission_mode?: "default" | "accept_edits" | "skip" | null;
  agent_teams?: boolean;
  work_in?: "worktree" | "checkout" | "folder";
  /** The absolute folder on the session device, only with `work_in: folder`. */
  folder?: string | null;
  /** With `work_in: checkout`: true (default) checks out `aw/<key>`; false keeps the branch. */
  switch_branch?: boolean;
}

export interface EditTaskInput {
  title?: string;
  first_message?: string;
  priority?: string;
}

export interface AnswerInput {
  answer: string;
  comment?: string | null;
  version?: number;
}

export type TaskListQuery = {
  project?: string;
  stage?: string;
  needs_you?: "true" | "false";
  archived?: "true" | "false";
};

export type ThreadQuery = {
  after?: string;
  limit?: number;
  /** The offset of the first event, when `after` is not given. */
  from?: number;
  ancestors?: "true" | "false";
  /** The `prev` cursor of a page: the `limit` events just before it. */
  before?: string;
  /** `true`: the newest `limit` events, still oldest first. */
  newest?: "true" | "false";
  /** Only the events of these types, comma separated. */
  types?: string;
};

export interface ThreadPage {
  task: TaskRef;
  events: EventRow[];
  next: string | null;
  /** The cursor of the first event when older events exist: pass it as `before`. */
  prev: string | null;
}

export interface ThreadReply extends ThreadPage {
  ancestors: ThreadPage[];
}

export type GateListQuery = {
  task?: string;
  state?: "open" | "resolved" | "all";
};

export type StreamMessage =
  | { type: "hello"; version: string }
  | {
      type: "changed";
      workspace: string;
      tasks: string[];
      workspace_changed: boolean;
      documents_changed: boolean;
      full: boolean;
    }
  | { type: "notice"; workspace: string; notices: { code: string; path: string }[] };

export type SyncEngineState =
  "not_configured" | "not_installed" | "starting" | "running" | "restarting" | "stopped" | "failed";

export interface SyncFolderStatus {
  folder: string;
  workspace: string;
  kind: "tasks" | "knowledge" | "secure";
  needItems: number;
  needBytes: number;
  remoteState: string;
  inSync: boolean;
}

export interface SyncPeerStatus {
  device: string;
  connected: boolean;
  route?: "lan" | "tailscale" | "relay" | "internet" | "storage";
  needItems: number;
  needBytes: number;
  inSync: boolean;
  lastSeen?: string;
  lastSynced?: string;
  role?: "local" | "remote" | "mobile";
  folders?: SyncFolderStatus[];
  /** "Synced 12 s ago", "3 changes not synced to ubuntu-01 (offline)". */
  text: string;
}

export interface SyncStatusReply {
  engine: SyncEngineState;
  device: string;
  sync_id: string | null;
  paused: boolean;
  pids: number[];
  peers: SyncPeerStatus[];
}

export interface SyncNowReply {
  at: string;
  pending: { device: string; items: number; reason: "offline" | "timeout" }[];
  status: SyncStatusReply;
}

export interface AddPeerInput {
  device_id: string;
  addresses: string[];
  name?: string;
  role?: "local" | "remote" | "mobile";
}

// ---- Sessions ----

/** An answer option of `ask`: a label, or a label with a description (openspec gate-context). */
export type AskOption = string | { label: string; description?: string };

export interface AskInput {
  task: string;
  /** The question: the gate title. */
  text: string;
  /** The full context of the decision as Markdown: the gate text. */
  details?: string;
  options?: AskOption[];
}

export interface AskReply {
  gate: string;
  event: Event;
  applied: boolean;
  reason: string | null;
}

export interface AgentWriteReply {
  event: Pick<Event, "id" | "hlc" | "dev" | "type" | "data">;
  buffered: boolean;
  path: string | null;
}

// ---- The work loop (add-task-loop) ----

export interface ProposalInput {
  task: string;
  content: string;
}

export interface ReadyInput {
  task: string;
  missing?: string[];
}

export interface SubtaskInput {
  parent?: string;
  title: string;
  first_message: string;
  project?: string;
  depends_on?: string[];
  from_parent?: boolean;
  test_server?: string | null;
  credentials?: string[];
  links?: string[];
}

export interface CustomGateInput {
  task: string;
  content: string;
  options?: string[];
}

export interface ResultInput {
  task: string;
  path: string;
  artifacts?: string[];
}

export interface LoopReply {
  next: string;
  gate?: string | null;
  gates?: string[];
  event?: Pick<Event, "id" | "hlc" | "dev" | "type" | "data"> | null;
  applied?: boolean;
  reason?: string | null;
}

export interface SlotLease {
  resource: string;
  slot: number;
  fencing_token: number;
  ttl_ms: number;
  expires_at: string;
}

export interface SlotAcquireReply {
  lease: SlotLease | null;
  renewed: boolean;
  queued: number | null;
  next: string;
}

export interface SlotReleaseReply {
  released: SlotLease;
  next: string;
}

export interface SubtaskReply {
  next: string;
  event: Pick<Event, "id" | "hlc" | "dev" | "type" | "data">;
  applied: boolean;
  reason: string | null;
  task: { id: string; key: string | null; assignee?: string | null };
}

export type PermissionDecision =
  { behavior: "allow" } | { behavior: "deny"; message: string; interrupt: boolean };

export interface PermissionReply {
  decision: PermissionDecision;
  gate: string | null;
}

export interface SessionInfo {
  id: string;
  workspace: string;
  task: string;
  key: string | null;
  agent: string;
  epoch: number;
  state: string;
  cwd: string;
  window: string | null;
  pid: number | null;
  resumes: number;
}
