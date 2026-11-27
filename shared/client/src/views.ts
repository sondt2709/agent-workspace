// Plain reply types of the identity, pairing, credential, presence and task-file routes
// (add-desktop-devices-knowledge). The zod schemas in identity.ts and desktop.ts are the source;
// these interfaces name the fields that the desktop renderer reads. This file has no import, so a
// browser bundle type-checks it without Node types (the same reason as types.ts).

export type DeviceRole = "local" | "remote" | "mobile";

export interface IdentityView {
  user: string | null;
  master_public: string | null;
  has_master_key: boolean;
  keystore: "os" | "file";
  device: { slug: string; name: string; role: DeviceRole };
  keys: { ed25519: string; x25519: string };
}

export interface DeviceEntryView {
  slug: string;
  name: string;
  role: DeviceRole;
  state: "valid" | "revoked" | "bad_signature";
  sync_device_id: string;
  seq: number;
  paired_at: string;
  revoked_at: string | null;
  this_device: boolean;
}

export interface RevokeView {
  device: string;
  seq: number;
  revoked_at: string;
  /** The credentials that awd wrote again with the new key. */
  credentials: number;
  /** The credentials that did not open on this device (add them again). */
  closed: string[];
  /** False when the revoked device did not confirm its record: its sessions continue. */
  delivered?: boolean;
}

export type PairingState =
  "waiting" | "check" | "approved" | "joining" | "done" | "failed" | "expired" | "cancelled";

export interface PairingView {
  id: string;
  side: "show" | "join";
  state: PairingState;
  workspace: { id: string; name: string };
  device: string;
  expires_at: string;
  check_code: string | null;
  new_device: { slug: string; name: string; role: DeviceRole } | null;
  error: string | null;
  /** The workspace folder of this device (join side only; openspec workspace-folder). */
  folder: string | null;
  /** One sentence when the folder rule skipped a taken name (join side only). */
  folder_note: string | null;
  code: string | null;
  qr_svg: string | null;
}

export interface CredentialView {
  name: string;
  added_by: string | null;
  imported_on: string[];
  file: boolean;
}

export interface DevicePresenceView {
  device: string;
  online: boolean;
  last_heartbeat_hlc: string | null;
  received_at: string | null;
  offline_since: string | null;
}

export interface PresenceReply {
  now: string;
  devices: DevicePresenceView[];
  offline_tasks: { task: string; device: string; cause: string; since: string }[];
}

/** The Orca detection of this device (`available` false gives the reason). */
export interface OrcaStateView {
  available: boolean;
  version: string | null;
  reason: string | null;
}

/** The session hosts of one computer: from its bindings, and the Orca state of this device. */
export interface SessionHostsEntry {
  device: string;
  may_run: boolean;
  use_orca: boolean;
  /** `has_commit` from the health of the device; null when not known (an older awd). */
  checkouts: {
    project: string;
    session_host: "tmux" | "orca" | null;
    has_commit?: boolean | null;
  }[];
  /** Null for another device: AW cannot detect Orca there. */
  orca: OrcaStateView | null;
}

export interface SessionHostsReply {
  /** This device. */
  device: string;
  devices: SessionHostsEntry[];
}

export interface TaskFileEntry {
  /** The path from the workspace root, for example `tasks/<id>/log/macbook-pro.jsonl`. */
  path: string;
  /** The path inside the task folder, for example `log/macbook-pro.jsonl`. */
  name: string;
  kind: "dir" | "file";
  size: number;
  modified: string;
}

export interface TaskFilesReply {
  task: string;
  root: string;
  entries: TaskFileEntry[];
  truncated: boolean;
}

export interface TaskFileContent {
  path: string;
  size: number;
  modified: string;
  /** The text, or null with `reason` for a large or binary file. */
  text: string | null;
  reason: "too_large" | "binary" | null;
}

export interface RestoreReply {
  path: string;
  kind: string;
  restored: boolean;
}

// ---- Setup (gap-setup): workspaces, projects, bindings, the community switch ----

export interface WorkspaceRemoveReply {
  id: string;
  name: string | null;
  /** The folder. awd keeps the files in it. */
  path: string;
  files_kept: boolean;
  /** The keys of the open tasks that stay assigned to an agent of this device (newer awd). */
  tasks?: string[];
  message: string;
}

export interface BindingCheckout {
  project: string;
  path: string;
  session_host?: "tmux" | "orca";
  /** The HLC of the last change; a remove of the project after it drops the checkout. */
  bound_at?: string;
}

/** The bindings of this device (`tasks/devices/<device>/bindings.yaml`). */
export interface BindingsView {
  device: string;
  may_run: boolean;
  use_orca: boolean;
  checkouts: BindingCheckout[];
  /** Test slot resources and their capacity, for example `{ k3d: 1 }`. */
  resources: Record<string, number>;
}

export interface EditBindingsInput {
  use_orca?: boolean;
  resources?: Record<string, number>;
  /** A `path` sets the checkout of the project; `path: null` removes it. */
  /** `session_host`: not set keeps the host of the old entry; null is the default host. */
  checkouts?: { project: string; path: string | null; session_host?: "tmux" | "orca" | null }[];
}

/** The fields of `tasks/workspace.yaml` that a person changes (openspec permissions-default). */
export interface EditWorkspaceInput {
  name?: string;
  new_project_permission_mode?: "default" | "accept_edits" | "skip";
}

export interface EditProjectInput {
  name?: string;
  devices?: string[];
  default_agent?: string;
  links?: string[];
  main_repo?: string | null;
  test_servers?: string[];
  switches?: { assign_new_subtasks_to_default_device?: boolean };
  archived?: boolean;
  /** The permission mode of new sessions (openspec session-options). */
  permission_mode?: "default" | "accept_edits" | "skip";
}

/** "Use community discovery and relay servers" (prd SYN-06, decision D18). */
export interface SyncSettingsView {
  community: boolean;
  /** `env`: AW_SYNC_COMMUNITY sets it, and the switch is read-only. */
  source: "env" | "config" | "default";
  /** The disclosure text of prd SYN-06. */
  text: string;
  /** After a change: `now` (the running engine has it) or `next_start`. */
  applied?: "now" | "next_start";
}
