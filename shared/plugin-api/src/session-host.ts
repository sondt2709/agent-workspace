// The session host interface (docs/architecture.md 6.2): tmux (default), Orca and a direct PTY.
// Refs are stored ids, never live handles, so awd can use them again after a restart.

/** What the host found on this device. */
export interface HostInfo {
  /** The host name, for example `tmux`. */
  name: string;
  /** True when the host can run sessions on this device. */
  available: boolean;
  /** The absolute path of the binary, or null. */
  binary: string | null;
  /** The version text, for example `3.4`, or null. */
  version: string | null;
  /** True when a session lives after awd stops. */
  survivesDaemonRestart: boolean;
  /** Why the host is not available, or null. */
  reason: string | null;
}

export interface OpenOptions {
  /** The window name, for example `aw-<task-id>`. Never user text. */
  name: string;
  /** The working folder. */
  cwd: string;
  /** The command as separate arguments: at least 2, so no shell parses it. */
  command: string[];
  /** Extra environment variables. Never a token. */
  env: Record<string, string>;
}

/** A stored reference to one pane. */
export interface PaneRef {
  host: string;
  window: string;
  pane: string;
  /** The pid of the pane process. */
  pid: number;
  /** The process group id of the pane process. */
  pgid: number;
  /**
   * The wall time in ms when the host opened the pane. A stop of a dead pane signals only the
   * processes that started after it, because the stored pids can belong to other processes now.
   */
  opened?: number;
  /**
   * The id of this run of the pane process, when the host has one (the Orca `incarnationId`). The
   * stored pids are true only while the host shows the same instance.
   */
  instance?: string;
}

export interface PaneState {
  /** The window name. */
  name: string;
  window: string;
  pane: string;
  pid: number;
  dead: boolean;
  /** The exit status of a dead pane, or null. */
  status: number | null;
}

export interface StopOptions {
  /** The wait between SIGTERM and SIGKILL. Default 5,000 ms. */
  graceMs?: number;
}

/** The input of `SessionHost.worktree()`: the working folder of a task. */
export interface WorktreeInput {
  /** The folder name of a new worktree in the host, for example `aw-AW-12`. Never user text. */
  name: string;
  /** Older names of the worktree of the same task (`aw-<task id>`, the key before a rekey). */
  aliases?: readonly string[];
  /** The project checkout of the device (a git repository). */
  checkout: string;
  /** The branch of the task, for example `aw/AW-12`. */
  branch: string;
}

/** The input of `SessionHost.removeWorktree()`. */
export interface WorktreeRemoveInput {
  /** The folder of the worktree. */
  path: string;
  /** The main folder of its repository (the project checkout). */
  checkout: string;
}

export interface WorktreeInfo {
  /** The working folder of the session. */
  path: string;
  /** The branch that the host checked out (it can differ from the asked branch). */
  branch: string;
  /** The id of the worktree in the host. */
  id: string;
}

export interface SessionHost {
  readonly name: string;
  /**
   * False when AW must not read the screen of this host (Orca): the manager then uses the hooks
   * only, and delivers a text only while the agent is idle. Default true.
   */
  readonly readsScreen?: boolean;
  detect(): Promise<HostInfo>;
  /**
   * Makes the working folder of a task in the host. A host without this method runs in the git
   * worktree that awd makes.
   */
  worktree?(input: WorktreeInput): Promise<WorktreeInfo>;
  /**
   * Removes the worktree of the host at `path` of the checkout, and keeps its branch (openspec
   * project-remove). awd calls it only for a clean worktree with no unpushed commit. A host without
   * this method gets `git worktree remove`.
   */
  removeWorktree?(input: WorktreeRemoveInput): Promise<void>;
  open(options: OpenOptions): Promise<PaneRef>;
  list(): Promise<PaneState[]>;
  /**
   * The state of one stored pane: null when the host does not know it any more. It throws when the
   * host cannot tell (for example, the host app does not run). A host without this method is read
   * with `list()`.
   */
  find?(ref: PaneRef): Promise<PaneState | null>;
  alive(ref: PaneRef): Promise<boolean>;
  /** The last lines of the screen. Only for dialogs, the watchdog and the terminal snapshot. */
  capture(ref: PaneRef, lines: number): Promise<string>;
  /** Pastes the text as one bracketed paste. */
  paste(ref: PaneRef, text: string): Promise<void>;
  /** Sends fixed key names, for example `Enter`. Never user text. */
  keys(ref: PaneRef, keys: string[]): Promise<void>;
  /**
   * Sends the text as one prompt and presses Enter, in one call. A host without this method gets
   * `paste()` and the key `Enter`.
   */
  submit?(ref: PaneRef, text: string): Promise<void>;
  /**
   * Stops the process group of the pane and each remaining descendant. It signals nothing when the
   * host does not list the pane with the same pid any more (a reboot or a lost window), and for a
   * dead pane only the processes of its group that started after `opened`.
   */
  stop(ref: PaneRef, options?: StopOptions): Promise<void>;
  /** Closes the window. */
  close(ref: PaneRef): Promise<void>;
}
