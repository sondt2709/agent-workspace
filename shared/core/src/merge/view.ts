// The types of the merged view of a workspace. All field names are snake_case, like the files, so
// the Kotlin port and the expected JSON files of the fixtures use the same names.
import type {
  DeviceRole,
  GateKind,
  PauseCause,
  PermissionMode,
  ProjectDocument,
  Stage,
  WorkIn,
  WorkspaceDocument,
} from "@aw/schema";

/** Where an event came from: the log file and the line. */
export interface EventRef {
  event: string;
  dev: string;
  hlc: string;
}

export type IssueCode =
  /** A line that is not valid JSON, fails its schema, or has the wrong device or task. */
  | "bad_line"
  /** The last line of a log has no newline: a write that did not finish. */
  | "partial_tail"
  /** An event more than the skew bound ahead of the local clock. It is held back. */
  | "future_hlc"
  /** A second event with the same id. */
  | "duplicate_event"
  /** An event that a merge rule did not apply, with the reason. */
  | "ignored"
  /** An event of a type that this AW does not know (a newer minor version). */
  | "unknown_type"
  /** A document that fails its syntax or schema check. */
  | "bad_document"
  /** A log or a document that cannot be read (EACCES, EIO): it keeps its last read. */
  | "read_error";

export interface MergeIssue {
  code: IssueCode;
  /** The path relative to the workspace root. */
  path: string;
  /** The line of a log file, from 1, or null. */
  line: number | null;
  /** The event id, or null. */
  event: string | null;
  /** The task id, or null. */
  task: string | null;
  /** The rule reason of an ignored event, for example `not_owner`, or null. */
  reason: string | null;
  message: string;
}

/** Why a task is in the "Needs you" lane (docs/workflow.md 3). */
export type NeedsYouReason =
  /** An open gate. `waiting_for_owner` is true when a person answered and the owner did not resolve it yet. */
  | { reason: "gate"; gate: string; kind: GateKind; waiting_for_owner: boolean }
  /** The task has no assignee (task-model decision §5.1). */
  | { reason: "assign" }
  /** A pause that needs the human (docs/architecture.md 4.6.5). */
  | { reason: "paused"; cause: PauseCause };

export interface AnswerView extends EventRef {
  by: string | null;
  version: number;
  answer: string;
  comment: string | null;
  /** `pending` until the gate is resolved; `used` for the answer of the resolution; else `comment`. */
  use: "pending" | "used" | "comment";
}

export interface GateView {
  gate: string;
  kind: GateKind;
  version: number;
  title: string;
  options: string[];
  file: string | null;
  opened: EventRef;
  state: "open" | "resolved";
  answer: string | null;
  answer_event: string | null;
  /** The device that resolved the gate, or null. */
  resolved_by: string | null;
  answers: AnswerView[];
}

export interface CommentView extends EventRef {
  by: string | null;
  text: string;
  /** `comment` for `comment.added`; `late_answer` for a gate answer that became a comment. */
  source: "comment" | "late_answer";
  gate: string | null;
}

export interface PauseView {
  cause: PauseCause;
  since: string;
  resumes_at: string | null;
  next_step: string;
  needs_human: boolean;
}

export interface ClaimView {
  epoch: number;
  device: string;
  session: string;
  event: string;
}

export interface SessionView {
  session: string;
  device: string;
  host: string;
  state: "running" | "ended";
  reason: string | null;
  /** The working folder on the session device (`session.started`), or null for an older event. */
  cwd: string | null;
  /** The branch of the session, or null (a session in another folder has none). */
  branch: string | null;
  /** The options of the session (openspec session-options), or null for an older event. */
  permission_mode: PermissionMode | null;
  agent_teams: boolean | null;
  work_in: WorkIn | null;
  /**
   * The link to the agent session and its terminal (openspec agent-pushes-updates): the Claude
   * session name, the window and pane of the session host and the pid of the pane, or null.
   */
  name: string | null;
  terminal: { window: string | null; pane: string | null } | null;
  pid: number | null;
}

/** The session options of a task, as a person set them (openspec session-options). */
export interface SessionOptionsView {
  /** Null: the project default. */
  permission_mode: PermissionMode | null;
  agent_teams: boolean;
  work_in: WorkIn;
  /** The absolute folder of `work_in: folder`, else null. */
  folder: string | null;
  /** `work_in: checkout`: false keeps the branch of the checkout. */
  switch_branch: boolean;
}

/**
 * The last failed start of the session of a task (openspec restart-agent): the `start_failed`
 * comment of awd. `retrying` is true after a newer person assignment ("Restart agent").
 */
export interface StartFailureView {
  device: string;
  text: string;
  /** The HLC of the comment. */
  at: string;
  retrying: boolean;
}

export interface TaskView {
  id: string;
  /** The display key now: the last accepted rekey, else the key of `task.created`. */
  key: string | null;
  created_key: string | null;
  /** `duplicate` while another task with a higher priority has the same key. */
  key_state: "ok" | "duplicate";
  /** The device that must write `task.rekeyed`, or null. */
  rekey_by: string | null;
  project: string | null;
  title: string | null;
  first_message: string | null;
  priority: string | null;
  stage: Stage;
  /** Open gate ids, in the order they opened. The same as `needs_you` of `task.yaml`. */
  needs_you: string[];
  needs_you_reasons: NeedsYouReason[];
  /** True when `needs_you_reasons` is not empty. */
  needs_you_lane: boolean;
  paused: PauseView | null;
  assignee: string | null;
  /** The owner device: the highest accepted claim, else the creating device. */
  owner: string | null;
  created: EventRef | null;
  /** The actor of `task.created` (`human@…` for a person), or null. */
  created_by: string | null;
  /** The session options of the newest event of a person that set them, or null. */
  session_options: SessionOptionsView | null;
  /** The last failed start, until a newer claim (openspec restart-agent). */
  start_failure: StartFailureView | null;
  claim: ClaimView | null;
  /** The device of the assignee while the accepted claim is on another device (a move), or null. */
  moving_to: string | null;
  released_epoch: number | null;
  proposal: { latest: number; approved: number | null };
  ready: { passed_on: string | null; missing: string[] } | null;
  test_server: string | null;
  credentials: string[];
  parent: string | null;
  subtasks: string[];
  depends_on: string[];
  /** The dependencies that are not done (or not known). */
  open_dependencies: string[];
  links: string[];
  branch: string | null;
  session: SessionView | null;
  progress: string | null;
  result: string | null;
  artifacts: string[];
  learned: boolean;
  archived: boolean;
  gates: GateView[];
  comments: CommentView[];
  /** The count of log lines of each device that the view includes. */
  includes: Record<string, number>;
  /** The HLC of the last merged event of the task. */
  last_hlc: string | null;
  /** The count of merged events of the task, applied or not. */
  event_count: number;
}

export interface ProjectView extends ProjectDocument {
  /** The ids of the tasks of the project. */
  tasks: string[];
}

/** One `project.removed` of a person (openspec project-remove). */
export interface RemovedProjectView {
  slug: string;
  name: string;
  removed: EventRef & { by: string };
  /** The `project.yaml` at the remove. */
  document: ProjectDocument;
}

export interface DeviceView {
  slug: string;
  name: string | null;
  role: DeviceRole | null;
  revoked: boolean;
  /** 0 is the highest priority. */
  priority: number;
  may_run: boolean | null;
  resources: Record<string, number>;
  health: { updated: string; boot_time: string; disk_used_percentage: number } | null;
  heartbeat: { last_hlc: string; boot_time: string; count: number } | null;
}

export interface CredentialView {
  name: string;
  added: EventRef | null;
  imported_on: string[];
}

export interface QueueView extends EventRef {
  agent: string;
  tasks: string[];
}

export interface SlotView {
  device: string;
  resource: string;
  slot: number;
  fencing_token: number;
  ttl_ms: number;
  task: string;
  session: string;
  acquired: EventRef;
  renewed_hlc: string;
  /** The renew time plus the TTL, by the HLC time. The resource device decides the real expiry. */
  expires_at: string;
}

/** The merged view. It depends only on the files and the local time of the HLC bound. */
export interface WorkspaceView {
  workspace: WorkspaceDocument | null;
  credentials: CredentialView[];
  /** The live projects: a removed project is in `removed_projects`. */
  projects: ProjectView[];
  /** The tasks of the live projects (and the tasks with no project yet). */
  tasks: TaskView[];
  /** Each removal of a project by a person, in merge order (openspec project-remove). */
  removed_projects: RemovedProjectView[];
  /** The tasks that a removal took out of `tasks`, by id. AW keeps their files. */
  removed_tasks: TaskView[];
  devices: DeviceView[];
  queues: QueueView[];
  slots: SlotView[];
  issues: MergeIssue[];
  /** The highest merged HLC. Give it to `HybridLogicalClock.observe()`. */
  last_hlc: string | null;
}

export interface DevicePresence {
  device: string;
  online: boolean;
  last_heartbeat_hlc: string | null;
  /** The local time when this device received the last heartbeat, ISO 8601. */
  received_at: string | null;
  /** `received_at` plus 90 s when the device is offline, else null. */
  offline_since: string | null;
}

export interface OfflineTask {
  task: string;
  device: string;
  /** `device_offline` from the heartbeats, `device_revoked` from the device record. */
  cause: "device_offline" | "device_revoked";
  since: string;
}

/** Presence: it depends on the local receive times of the heartbeats (docs/phase-1.md 9.6.3). */
export interface PresenceView {
  now: string;
  devices: DevicePresence[];
  offline_tasks: OfflineTask[];
}
