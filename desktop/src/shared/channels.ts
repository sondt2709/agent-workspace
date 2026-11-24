// The bridge contract, part 1: the IPC channel names, the calls and their types (docs/tech-stack.md
// 2.3 "Own typed preload bridge"). Main, the preload and the renderer import this file. It has no
// runtime dependency, so the sandboxed preload bundle stays small. The zod schemas of the call
// arguments are in contract.ts (main only).
import type { DoctorReply } from "@aw/client/doctor-types";
import type { QueuesReply } from "@aw/client/queues";
import type { TerminalReply } from "@aw/client/terminal";
import type {
  AnswerInput,
  CreateTaskInput,
  EditTaskInput,
  GateAnswerReply,
  GateEntry,
  GateListQuery,
  Issue,
  Project,
  SessionInfo,
  SessionOptionsInput,
  StatusReply,
  StreamMessage,
  SyncNowReply,
  SyncStatusReply,
  Task,
  TaskEditReply,
  TaskListQuery,
  TaskWriteReply,
  ThreadQuery,
  ThreadReply,
  WorkspaceSummary,
} from "@aw/client/types";
import type {
  CredentialView,
  DeviceEntryView,
  IdentityView,
  PairingView,
  PresenceReply,
  RestoreReply,
  RevokeView,
  SessionHostsReply,
  TaskFileContent,
  TaskFilesReply,
} from "@aw/client/views";
import type {
  ChangeResult,
  Digest,
  HistoryEntry,
  KnowledgeFile,
  KnowledgeVersion,
  Suggestion,
} from "@aw/plugin-api";
import type { SetupCallMap } from "./setup-channels.ts";
import type { OpenTerminalResult, TerminalAction } from "./terminal-types.ts";

export type { DoctorCheck, DoctorReply } from "@aw/client/doctor-types";
export type * from "@aw/client/queues";
export type * from "@aw/client/terminal";
export type * from "@aw/client/types";
export type * from "@aw/client/views";
export type {
  ChangeResult,
  Digest,
  HistoryEntry,
  KnowledgeChange,
  KnowledgeFile,
  KnowledgeVersion,
  Suggestion,
} from "@aw/plugin-api";
export type * from "./terminal-types.ts";

/** The state of the login item (`app.getLoginItemSettings()`), or `supported: false`. */
export interface LoginItemState {
  supported: boolean;
  open: boolean;
  /** `not-registered`, `enabled`, `requires-approval`, `not-found`, or null. */
  status: string | null;
}

/** The color scheme of the app: the system setting, or always light or dark (openspec screens-align). */
export type Appearance = "system" | "light" | "dark";

/** What the person picks a folder for (openspec create-flows). */
export type FolderPurpose = "checkout" | "workspace" | "session";

/** The folder of the native picker: `path` null on cancel; `git` true when it has `.git`. */
export interface ChosenFolder {
  path: string | null;
  name: string | null;
  git: boolean;
}

/** What the Settings page shows about the app. */
export interface AppSettings {
  /** The Appearance choice of Settings (`aw-desktop.json`). */
  appearance: Appearance;
  login: LoginItemState;
  /** False in a build that cannot show notifications (for example an unsigned app). */
  notifications: boolean;
  /**
   * The error of the last notification that macOS did not show (the `failed` event), or null. An
   * unsigned app gets "supported" but each notification fails (verify-journeys finding 16).
   */
  notification_error: string | null;
}

type Ws = { ws: string };

/** The IPC channels. `call` is the only channel from the renderer to main. */
export const CHANNELS = {
  call: "aw:call",
  event: "aw:event",
  connection: "aw:connection",
  resync: "aw:resync",
  command: "aw:command",
  /** The renderer listens for commands (renderer to main, no payload). */
  commandReady: "aw:command-ready",
} as const;

/** The arguments and the result of each allowed call (the setup calls: setup-channels.ts). */
export interface CallMap extends SetupCallMap {
  connection: { args: Record<string, never>; result: ConnectionState };
  status: { args: Record<string, never>; result: StatusReply };
  workspaces: { args: Record<string, never>; result: WorkspaceSummary[] };
  projects: { args: { ws: string }; result: Project[] };
  tasks: { args: { ws: string; query?: TaskListQuery }; result: Task[] };
  task: { args: { ws: string; task: string }; result: Task };
  thread: { args: { ws: string; task: string; query?: ThreadQuery }; result: ThreadReply };
  gates: { args: { ws: string; query?: GateListQuery }; result: GateEntry[] };
  sessions: { args: Record<string, never>; result: SessionInfo[] };
  createTask: { args: { ws: string; body: CreateTaskInput }; result: TaskWriteReply };
  editTask: { args: { ws: string; task: string; body: EditTaskInput }; result: TaskEditReply };
  assignTask: {
    args: {
      ws: string;
      task: string;
      assignee: string;
      session_host?: "tmux" | "orca";
      session_options?: SessionOptionsInput;
    };
    result: TaskWriteReply;
  };
  archiveTask: { args: { ws: string; task: string; stop?: boolean }; result: TaskWriteReply };
  unarchiveTask: { args: { ws: string; task: string }; result: TaskWriteReply };
  stopTaskSession: { args: { ws: string; task: string }; result: TaskWriteReply };
  answerGate: { args: { ws: string; gate: string; body: AnswerInput }; result: GateAnswerReply };
  sendMessage: { args: { ws: string; task: string; text: string }; result: TaskWriteReply };
  stopSession: { args: { session: string }; result: SessionInfo };
  openExternal: { args: { url: string }; result: { opened: boolean } };
  // ---- Devices, sync, pairing, credentials (add-desktop-devices-knowledge) ----
  syncStatus: { args: Record<string, never>; result: SyncStatusReply };
  syncNow: { args: { timeout_ms?: number }; result: SyncNowReply };
  identity: { args: Record<string, never>; result: IdentityView };
  phrase: { args: Record<string, never>; result: { phrase: string } };
  devices: { args: Ws; result: DeviceEntryView[] };
  presence: { args: Ws; result: PresenceReply };
  sessionHosts: { args: Ws; result: SessionHostsReply };
  queues: { args: Ws; result: QueuesReply };
  revokeDevice: { args: Ws & { device: string }; result: RevokeView };
  startPairing: { args: Ws; result: PairingView };
  pairing: { args: { id: string }; result: PairingView };
  approvePairing: { args: { id: string; check_code: string }; result: PairingView };
  cancelPairing: { args: { id: string }; result: PairingView };
  /** This device joins the workspace of another computer with its code (fix list 0-16). */
  joinPairing: { args: { code: string; parent?: string }; result: PairingView };
  credentials: { args: Ws; result: CredentialView[] };
  addCredential: { args: Ws & { name: string; value: string }; result: CredentialView };
  removeCredential: { args: Ws & { name: string }; result: { name: string } };
  // ---- Knowledge ----
  kbList: {
    args: Ws & { scope?: "all" | "shared" | "project"; project?: string };
    result: KnowledgeFile[];
  };
  kbRead: { args: Ws & { path: string; version?: string }; result: KnowledgeVersion };
  kbHistory: { args: Ws & { path: string }; result: HistoryEntry[] };
  kbUndo: { args: Ws & { change: string }; result: ChangeResult };
  kbSuggestions: { args: Ws & { state?: "pending" | "all" }; result: Suggestion[] };
  kbAccept: {
    args: Ws & { suggestion: string; force?: boolean; comment?: string };
    result: ChangeResult;
  };
  kbReject: { args: Ws & { suggestion: string; comment?: string }; result: Suggestion };
  kbDigest: { args: Ws & { date?: string }; result: Digest };
  // ---- Files and issues ----
  issues: { args: Ws; result: Issue[] };
  restoreDocument: { args: Ws & { path: string }; result: RestoreReply };
  openWorkspaceFile: { args: Ws & { path: string }; result: { opened: boolean } };
  taskFiles: { args: Ws & { task: string }; result: TaskFilesReply };
  terminal: { args: Ws & { task: string }; result: TerminalReply };
  openTerminal: {
    args: Ws & { task: string; action: TerminalAction };
    result: OpenTerminalResult;
  };
  taskFile: { args: Ws & { task: string; path: string }; result: TaskFileContent };
  /** Opens the folder of the newest session of the task on this device (openspec session-options). */
  openSessionFolder: { args: Ws & { task: string }; result: { opened: boolean; path: string } };
  /** Opens an artifact of a task (gate-full-context): a document in its app, else in Finder. */
  openTaskArtifact: {
    args: Ws & { task: string; path: string };
    result: { opened: "app" | "folder"; path: string };
  };
  // ---- App ----
  /** `shown`: the app showed the phrase by itself before (owner decision Q10, fix list 0-34). */
  phraseConfirmed: { args: { user: string }; result: { confirmed: boolean; shown: boolean } };
  phraseShown: { args: { user: string }; result: { shown: boolean } };
  confirmPhrase: { args: { user: string }; result: { confirmed: boolean } };
  /** Main reads the phrase from awd and copies it; it clears the clipboard after `clear_after_ms`. */
  copyPhrase: { args: Record<string, never>; result: { copied: true; clear_after_ms: number } };
  /** Main reads the phrase from awd and saves it after the native save dialog (mode 0600). */
  savePhrase: { args: Record<string, never>; result: { saved: boolean; path: string | null } };
  appSettings: { args: Record<string, never>; result: AppSettings };
  setOpenAtLogin: { args: { open: boolean }; result: AppSettings };
  setAppearance: { args: { appearance: Appearance }; result: AppSettings };
  /** The native folder dialog of main (openspec create-flows); `default_path` is the start folder. */
  chooseFolder: {
    args: { purpose: FolderPurpose; default_path?: string };
    result: ChosenFolder;
  };
  // ---- Setup check (gap-install) ----
  doctor: { args: Record<string, never>; result: DoctorReply };
}

export type CallMethod = keyof CallMap;
export type CallArgs<M extends CallMethod> = CallMap[M]["args"];
export type CallValue<M extends CallMethod> = CallMap[M]["result"];

/** The error of a call, as plain data: an Error object loses its fields over IPC. */
export interface CallError {
  /** An awd error code (`not_found`, `gate_not_open`, ...), or `unreachable`, `protocol`, `invalid_input`, `refused`, `internal`. */
  code: string;
  message: string;
  /** The HTTP status of an awd reply, or null. */
  status: number | null;
  /** The `details` of an awd error (gate-full-context: the answer of a resolved gate). */
  details?: unknown;
}

export type CallResult<T> = { ok: true; value: T } | { ok: false; error: CallError };

/** The state of the awd connection of main. */
export type ConnectionState =
  | { state: "connecting" }
  | { state: "online"; version: string | null; device: string | null }
  | { state: "offline"; reason: string; attempt: number; retryAt: number | null };

/** A command of the app menu, the Tray or a notification for the renderer. */
export type AppCommand =
  "new-task" | "new-session" | "sync-now" | { open: "task"; ws: string; task: string };

/** The API of `window.aw` (the preload bridge). */
export interface AwBridge {
  call<M extends CallMethod>(method: M, args: CallArgs<M>): Promise<CallResult<CallValue<M>>>;
  /** Each `on*()` returns a function that removes the listener. */
  onEvent(listener: (message: StreamMessage) => void): () => void;
  onConnection(listener: (state: ConnectionState) => void): () => void;
  onResync(listener: () => void): () => void;
  onCommand(listener: (command: AppCommand) => void): () => void;
}
