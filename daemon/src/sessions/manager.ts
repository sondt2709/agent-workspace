// The session manager of one workspace (docs/phase-1.md 9, design of add-claude-sessions-tmux):
// claims, start, stop on a move, the hook spool, the thread from hooks, gates from hooks, gate
// resolution, safe delivery, the permission gate, reconcile and resume. All writes go through the
// workspace service and its files layer.
import {
  assigneeDevice,
  compareOrder,
  effectiveSessionOptions,
  hlcMs,
  type Clock,
  type EffectiveSessionOptions,
  type EventRow,
  type GateView,
  type TaskView,
} from "@aw/core";
import type {
  AgentHookEvent,
  AgentInfo,
  AgentRuntimeAdapter,
  HostInfo,
  PaneRef,
  PaneState,
  PermissionDecision,
  SessionHost,
  ToolGate,
} from "@aw/plugin-api";
import {
  newId,
  type EventData,
  type EventType,
  type PauseCause,
  type PermissionMode,
} from "@aw/schema";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import PQueue from "p-queue";
import { HUMAN_COMMANDS } from "../cli/person-commands.ts";
import { loginEndsSoon, type AuthState } from "../continuity/auth.ts";
import { git, LOCAL_GIT_TIMEOUT_MS } from "../continuity/git-branch.ts";
import { healthDocument, healthDue, healthKey, sessionState } from "../continuity/health.ts";
import {
  ACTIVE_ENDS,
  pauseChanged,
  pauseData,
  pausedBy,
  type PauseInput,
} from "../continuity/pause.ts";
import { diskUse, processInfo, runsSession } from "../continuity/processes.ts";
import { isWorking, queueOrder, startBlock } from "../continuity/queue.ts";
import {
  lostNote,
  MAX_RESTARTS,
  MAX_RESUMES,
  PROGRESS_ALIVE_MS,
  recentResumes,
  resumePlan,
} from "../continuity/resume.ts";
import { SlotService, type AcquireResult } from "../continuity/slots.ts";
import {
  CONTINUE_AFTER_RESET_MS,
  fiveHourUse,
  limitPlan,
  limitText,
  MAX_CONTINUES,
  QUEUE_USAGE_LIMIT,
  readUsage,
  shortTime,
  type UsageState,
} from "../continuity/usage.ts";
import { pushUnpushedWork, wakeComment } from "../continuity/wake.ts";
import {
  newWatchState,
  WATCHDOG_CHECK_MS,
  watchStep,
  type WatchState,
} from "../continuity/watchdog.ts";
import type { Logger } from "../log.ts";
import {
  APPROVE,
  askGate,
  createSubtask,
  isReplacedAnswer,
  markDone as markTaskDone,
  openCustomGate,
  postResult,
  proposeProposal,
  replaceOpen,
  reportReady,
  type AgentContext,
  type AskGateInput,
  type SubtaskInput,
} from "../loop/agent.ts";
import {
  noCredentials,
  writeCredentialFiles,
  type CredentialProvider,
} from "../loop/credentials.ts";
import { TaskLoop, type LoopHost, type TaskLoopOptions } from "../loop/loop.ts";
import { loginPush } from "../loop/rules.ts";
import { isCloseAnswer } from "../loop/stale-gates.ts";
import type { SessionTokens } from "../mcp/tokens.ts";
import { ServiceError } from "../service/errors.ts";
import type { CleanupItem } from "../service/project-remove.ts";
import type { WorkspaceService, WriteResult } from "../service/workspace.ts";
import type { Settings } from "../settings.ts";
import { AW_VERSION } from "../version.ts";
import { EventBuffer } from "./buffer.ts";
import {
  checkpointBranch,
  CheckpointPusher,
  prepareBranch,
  pushesCheckpoint,
} from "./checkpoint.ts";
import {
  continueMessage,
  endsWithQuestion,
  firstInput,
  knowledgeUnavailable,
  launchMessage,
  RESUME_PREFIX,
  sessionContext,
  toolSummary,
} from "./context.ts";
import {
  decisionOf,
  inputHash,
  isAllow,
  PERMISSION_OPTIONS,
  PermissionWaits,
  remainingWaitMs,
  ruleKey,
  timeoutDecision,
} from "./permissions.ts";
import {
  prepareSessionFolder,
  privateFolder,
  saveRecord,
  sessionPaths,
  writePrivate,
  type LaunchFile,
  type SessionRecord,
} from "./records.ts";
import { cleanupTarget, keptComment, type CleanupTarget } from "./removed.ts";
import { dialogOnScreen, trustCursor } from "./screen.ts";
import { hookEventId, markDone, markFailed, pruneDone, readSpool } from "./spool.ts";
import { taskPaths } from "./task-paths.ts";
import { redactScreen, TerminalSnapshots, type SnapshotInput } from "./terminal-snapshot.ts";

/** The spool and delivery check period. */
export const TICK_MS = 500;
/** The pane check (reconcile) period: every 10 ticks. */
export const PANE_CHECK_TICKS = 10;
export const DELIVERY_RETRY_MS = 30_000;
export const DELIVERY_ATTEMPTS = 3;
// The resume limits live in the continuity module (add-continuity); the tests import them here.
export { MAX_RESTARTS, MAX_RESUMES };
/** The retry waits of an agent error (StopFailure that is not a usage limit). */
export const AGENT_RETRY_MS = [60_000, 120_000, 240_000];
/** The disk use is read at most this often. */
const DISK_CHECK_MS = 60_000;
/** The wait before AW tries again to start a session that failed to start. */
export const START_RETRY_MS = 60_000;
/** The tries of one spool file before it moves to `spool/failed/`. */
export const SPOOL_ATTEMPTS = 5;
/** The time after a window opens in which AW looks for the trust screen. */
export const TRUST_WINDOW_MS = 120_000;
/** A delivery that a dialog on the screen blocks this long gets a comment on the task. */
export const DIALOG_NOTICE_MS = DELIVERY_RETRY_MS * DELIVERY_ATTEMPTS;
/** The largest file of `aw artifact add` and `aw handoff`. */
export const MAX_AGENT_FILE_BYTES = 50 * 1024 * 1024;
/** The wait before AW asks Orca again whether it is available (add-orca-session-host). */
export const ORCA_DETECT_MS = 60_000;
/**
 * A session host that does not answer this long, or an agent in a host that does not read the
 * screen with no SessionStart this long, gets one comment on the task (principle 2).
 */
export const HOST_NOTICE_MS = 120_000;
/** The gates that wait for an answer to the turn of the agent: one of them stops a Reply gate. */
const TURN_GATES = new Set(["question", "approve_proposal", "reply"]);
/** The events of an agent that count as an update of its turn (openspec agent-pushes-updates). */
const UPDATE_TYPES = new Set([
  "message.agent",
  "gate.opened",
  "proposal.proposed",
  "task.ready",
  "result.posted",
  "task.done",
  "task.learned",
]);
/** The text of the notice after a turn with no AW update. */
export const NUDGE_TEXT =
  "Your turn ended with no AW update, and the human reads only AW. Send the update now: `message` (short), or `ask`, `proposal`, `result` or `gate`. Then end your turn.";
const DONE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionTools {
  /** The default session host (tmux). */
  host: SessionHost;
  /** The optional hosts by name, for example `orca` (off by default, on per device). */
  hosts?: Map<string, SessionHost>;
  adapter: AgentRuntimeAdapter;
  agent: AgentInfo;
  /** The AW plugin directory (`--plugin-dir`). */
  pluginDir: string;
  /** `daemon/bin/aw-launch`, `daemon/src/bin/aw.ts`, `daemon/src/bin/aw-hook.ts`. */
  awLaunch: string;
  awCli: string;
  awHook: string;
  /** `daemon/src/bin/aw-statusline.ts`: the statusLine command of the sessions (add-continuity). */
  awStatusline?: string;
}

export interface SessionManagerOptions {
  service: WorkspaceService;
  settings: Settings;
  clock: Clock;
  log: Logger;
  tools: SessionTools;
  waits: PermissionWaits;
  /** The records of this workspace, read at start. */
  records: SessionRecord[];
  /** The wait before a new try of a failed start. Default START_RETRY_MS (tests give a short one). */
  startRetryMs?: number;
  /** The session tokens of this device (add-mcp-server). */
  tokens: SessionTokens;
  /** The work loop: push, sync check and the push records (add-task-loop). */
  loop: TaskLoopOptions;
  /** The credential values of a session. Default: none. awd gives the credential service. */
  credentials?: CredentialProvider;
  /** The wait before a host notice (HOST_NOTICE_MS). Tests give a short one. */
  hostNoticeMs?: number;
  /** The sign-in state of the agent (add-continuity). Default: not known (no block). */
  auth?: () => AuthState | null;
  /** The boot time of the computer in ms (the restart comment, the slot revoke). Default: 0. */
  bootMs?: number;
  /** The TTL of a test slot lease (tests give a short one). Default 30 min. */
  slotTtlMs?: number;
  /**
   * The working sessions of the agent on this device in all workspaces (AW_MAX_WORKING is per
   * device, fix list 0g). Default: the working sessions of this workspace.
   */
  deviceWorking?: () => number;
  /**
   * True when another open workspace of this device has a revoked own record: this device then
   * runs no session in any workspace (fix list 0-43). Default: false.
   */
  revokedElsewhere?: () => boolean;
  /**
   * The registered workspace folders of this device: the AW guard denies an agent edit there, and
   * a session never works there (openspec session-options). Default: the folder of this workspace.
   */
  workspaceFolders?: () => string[];
}

interface DeliveryItem {
  id: string;
  text: string;
  order: { hlc: string; dev: string; id: string };
}

interface Attempt {
  count: number;
  last: number;
}

/**
 * The write of one event of a hook. `step` names the event in its spool file: a retry of the file
 * skips the steps that are in the log already.
 */
interface HookWrite {
  <T extends EventType>(step: string, type: T, data: EventData<T>, by: string): Promise<void>;
  /** The event id of a step: the same id at each retry of the spool file. */
  eventId(step: string): string;
}

function data(row: EventRow): Record<string, unknown> {
  return (row.event as { data?: Record<string, unknown> }).data ?? {};
}

/** The bindings of this device for the project of a task. */
interface Binding {
  checkout: string | null;
  sessionHost: string | undefined;
  useOrca: boolean;
}

/** The name of a session host in a comment. */
function hostLabel(host: string): string {
  return host === "orca" ? "Orca" : host;
}

/**
 * The session settings file (the adapter writes the format): the allow rules, the deny rules of
 * the person commands, the statusLine command of AW when the plugin has it (the usage windows,
 * add-continuity), and the settings of the session options (openspec session-options).
 */
export function sessionSettingsFile(
  tools: Pick<SessionTools, "adapter" | "pluginDir" | "awStatusline">,
  options: { permissionMode: string; agentTeams: boolean },
): string {
  return tools.adapter.sessionSettings({
    permissionMode: options.permissionMode,
    agentTeams: options.agentTeams,
    personCommands: [...HUMAN_COMMANDS],
    statusLine: tools.awStatusline ? `"${join(tools.pluginDir, "bin", "aw-statusline")}"` : null,
  });
}

/** The permission mode of a record as a schema value: an older record has `default`. */
function permissionModeOf(mode: string): PermissionMode {
  return mode === "accept_edits" || mode === "skip" ? mode : "default";
}

/** True when `path` is `root` or a path inside it (no file system call). */
function within(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The local target of "Open the terminal" (SessionManager.localTerminal). */
export interface LocalTerminal {
  host: string;
  /** The absolute binary of the host (tmux or orca), or null when the host did not find it. */
  binary: string | null;
  /** The working folder of the session (the Orca worktree for Orca). */
  worktree: string;
  /** The tmux socket name, or null for Orca. */
  socket: string | null;
}

function agentOf(assignee: string | null): string | null {
  if (assignee === null) return null;
  const at = assignee.indexOf("@");
  return at < 0 ? null : assignee.slice(0, at);
}

export class SessionManager {
  readonly service: WorkspaceService;
  readonly #settings: Settings;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #tools: SessionTools;
  readonly #waits: PermissionWaits;
  readonly #buffer: EventBuffer;
  /** The terminal snapshots of the tmux sessions (openspec task-terminal-view). */
  readonly #snapshots: TerminalSnapshots;
  /** The redaction of the files layer: each cut of agent or screen text runs after it (0-41). */
  readonly #redact = (text: string): string => this.service.files.redactText(text);
  readonly #startRetryMs: number;
  readonly #tokens: SessionTokens;
  readonly #hostNoticeMs: number;
  readonly #records = new Map<string, SessionRecord>();
  readonly #queue = new PQueue({ concurrency: 1 });
  readonly #attempts = new Map<string, Attempt>();
  /** Tasks with no checkout on this device: the comment is written once per awd start. */
  readonly #noCheckout = new Set<string>();
  /** The cause of the last "Orca is off or missing" comment of each task. */
  readonly #hostNotices = new Map<string, string>();
  /**
   * The sessions whose host does not answer (Orca): the time of the first failed check, the last
   * error, and whether the task got the comment.
   */
  readonly #hostDown = new Map<string, { since: number; error: string; noticed: boolean }>();
  /** The sessions that did not stop for a new session of their task, with the "waits" comment. */
  readonly #stopWaitNoticed = new Set<string>();
  /** The last detect of Orca, at most once per ORCA_DETECT_MS. */
  #orcaInfo: { at: number; info: HostInfo } | null = null;
  /** Tasks whose session did not start: the last error, so AW tries again only after a wait. */
  readonly #startErrors = new Map<string, { at: number; message: string }>();
  /** Failed tries of each spool file. */
  readonly #spoolFailures = new Map<string, number>();
  /** The written steps of each spool file that failed in a later step (see HookWrite). */
  readonly #spoolSteps = new Map<string, Set<string>>();
  /** The pane of each session that sent its SessionStart since the window opened. */
  readonly #startedPanes = new Map<string, string>();
  /** The trust screen of each pane: `down` after AW moved the cursor, `done` after the answer. */
  readonly #trustAnswered = new Map<string, "down" | "done">();
  /** The time since a dialog on the screen blocks each delivery, and the ones with a comment. */
  readonly #dialogSince = new Map<string, number>();
  readonly #dialogNoticed = new Set<string>();
  /** The work loop of the workspace (add-task-loop). */
  readonly #work: TaskLoop;
  readonly #credentials: CredentialProvider;
  /** Tasks whose ended session AW starts again with a notice as the first input. */
  readonly #restarts = new Map<string, { id: string; text: string }>();
  /** Sessions that got the comment about a credential with no value. */
  readonly #credentialNoticed = new Set<string>();
  // ---- Continuity (add-continuity) ----
  readonly #auth: () => AuthState | null;
  readonly #deviceWorking: () => number;
  readonly #revokedElsewhere: () => boolean;
  readonly #workspaceFolders: () => string[];
  readonly #bootMs: number;
  readonly #slots: SlotService;
  /** The clock time of the last hook event of each session (the watchdog). */
  readonly #lastEvent = new Map<string, number>();
  readonly #watch = new Map<string, WatchState>();
  #lastWatch = 0;
  /** The usage windows of each running session (`usage.json`). */
  readonly #usage = new Map<string, UsageState | null>();
  #disk: { at: number; value: number | null } | null = null;
  #health: { at: number; key: string } | null = null;
  /** The tasks that got the push of an ended login, and the login ends that got a warning. */
  readonly #loginPushed = new Set<string>();
  /** The checkpoint pushes at each Stop (openspec move-paused-task), outside the queue. */
  readonly #pusher: CheckpointPusher;
  /** The prepare comments already written, by task and text (a start retry writes no copy). */
  readonly #prepareNotes = new Set<string>();
  readonly #loginWarned = new Set<string>();
  /** The cause that blocks the start of a queued task, for one log line per cause. */
  #queueBlock: string | null = null;
  #revoked = false;
  readonly #startedAt: number;
  #ticks = 0;
  /** The cleanup result of each removal of a project, by event id (openspec project-remove). */
  #removedDone: Map<string, CleanupItem[]> | null = null;
  #checks = 0;
  #closed = false;

  constructor(options: SessionManagerOptions) {
    this.service = options.service;
    this.#settings = options.settings;
    this.#clock = options.clock;
    this.#log = options.log.child({ sessions: options.service.id });
    this.#tools = options.tools;
    this.#waits = options.waits;
    this.#buffer = new EventBuffer(options.service, options.clock, this.#log, (task, type) =>
      type === "gate.opened" ? this.#gateSnapshot(task) : undefined,
    );
    this.#snapshots = new TerminalSnapshots({
      write: (path, text) => this.service.writeTaskFile(path, text),
      redact: this.#redact,
    });
    this.#pusher = new CheckpointPusher({
      comment: async (task, text) => {
        await this.#buffer.now(task, "comment.added", { text }, this.#aw);
      },
      save: (target) => this.#queue.add(() => this.#save(target as SessionRecord)),
      log: this.#log,
    });
    this.#startRetryMs = options.startRetryMs ?? START_RETRY_MS;
    this.#tokens = options.tokens;
    this.#credentials = options.credentials ?? noCredentials;
    this.#hostNoticeMs = options.hostNoticeMs ?? HOST_NOTICE_MS;
    for (const record of options.records) this.#records.set(record.id, record);
    this.#work = new TaskLoop(this.#loopHost(), options.loop);
    this.#auth = options.auth ?? (() => null);
    this.#deviceWorking = options.deviceWorking ?? (() => this.working());
    this.#revokedElsewhere = options.revokedElsewhere ?? (() => false);
    this.#workspaceFolders = options.workspaceFolders ?? (() => [this.service.root]);
    this.#bootMs = options.bootMs ?? 0;
    this.#startedAt = options.clock.now();
    this.#push = options.loop.push;
    this.#slots = new SlotService(
      {
        me: this.#me,
        now: () => this.#clock.now(),
        ownerOf: (resource) => {
          const devices = this.service.view.devices.filter(
            (d) => !d.revoked && (d.resources[resource] ?? 0) > 0,
          );
          return (devices.find((d) => d.slug === this.#me) ?? devices[0])?.slug ?? null;
        },
        capacity: (resource) =>
          this.service.view.devices.find((d) => d.slug === this.#me)?.resources[resource],
        leases: () => this.service.view.slots,
        workspaceRows: () => this.service.workspaceEvents(),
        running: (session) => this.#records.get(session)?.state === "running",
        write: (type, data) =>
          this.service.write(async (files) => {
            await files.writeEvent(`tasks/log/${this.#me}.jsonl`, type, data as never, {
              by: this.#aw,
            });
          }),
      },
      options.slotTtlMs === undefined ? {} : { ttlMs: options.slotTtlMs },
    );
  }

  readonly #push: TaskLoopOptions["push"];

  /** The writes and reads of the work loop: through the log buffer and the records of this manager. */
  #loopHost(): LoopHost {
    return {
      service: this.service,
      me: this.#me,
      clock: this.#clock,
      log: this.#log,
      write: (task, type, data, by, options) => this.#buffer.now(task, type, data, by, options),
      rows: (task) => this.#rows(task),
      task: (id) => this.#task(id),
      runningSession: (task) => {
        const claim = this.#task(task)?.claim;
        const record = claim ? this.#records.get(claim.session) : undefined;
        return record?.state === "running" && claim?.device === this.#me ? record : undefined;
      },
      restartWith: (task, notice) => {
        if (!this.#restarts.has(task)) this.#restarts.set(task, notice);
      },
      stoppedByPerson: (task) => {
        const claim = this.#task(task)?.claim;
        const record = claim ? this.#records.get(claim.session) : undefined;
        return claim?.device === this.#me && record?.state === "stopped";
      },
      finish: (record) => this.#finish(record),
      permissionTimeoutMs: this.#waits.timeoutMs,
    };
  }

  get #me(): string {
    return this.service.device.slug;
  }

  get #aw(): string {
    return `aw@${this.#me}`;
  }

  #agentActor(record: SessionRecord): string {
    return `${record.agent}@${this.#me}`;
  }

  get records(): SessionRecord[] {
    return [...this.#records.values()];
  }

  record(id: string): SessionRecord | undefined {
    return this.#records.get(id);
  }

  /** The count of completed checks (tests wait for it instead of a sleep). */
  get checks(): number {
    return this.#checks;
  }

  /** Reconciles at start, then runs the tick loop. A failed first check does not stop the loop. */
  async start(): Promise<void> {
    try {
      for (const record of this.#records.values()) {
        await pruneDone(
          sessionPaths(this.#settings.home, record.id).spool,
          this.#clock.now(),
          DONE_MAX_AGE_MS,
        );
        // A session that does not run keeps no credential file (add-continuity, decision 15).
        if (record.state !== "running") await this.#removeCredentials(record);
      }
      await this.sync(true);
    } catch (error) {
      this.#log.error({ err: error }, "The first session check failed");
    }
    void this.#loop();
  }

  async #loop(): Promise<void> {
    while (!this.#closed) {
      await this.#clock.sleep(TICK_MS);
      if (this.#closed) break;
      this.#ticks++;
      await this.sync(this.#ticks % PANE_CHECK_TICKS === 0).catch((error: unknown) => {
        this.#log.error({ err: error }, "The session check failed");
      });
    }
  }

  /** One check: spools, claims, panes (full), gates and deliveries. One at a time. */
  sync(full = false): Promise<void> {
    if (this.#closed) return Promise.resolve();
    // A waiting check reads the newest state: a second one adds nothing.
    if (this.#queue.size > 0 && !full) return this.#queue.onIdle();
    return this.#queue.add(async () => {
      try {
        await this.#drainSpools();
        if (!this.service.ready) return;
        await this.#claims();
        await this.#removedProjects();
        if (full) await this.#panes();
        await this.#gatesAndDeliveries();
        if (full) await this.#work.tick();
        if (full) await this.#fullContinuity();
      } finally {
        this.#checks++;
      }
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#pusher.idle();
    await this.#queue.onIdle();
    await this.#buffer.close();
  }

  /**
   * Saves the record. A record that leaves `running` (stopped, moved, replaced, ended, failed)
   * revokes the session token at once (add-mcp-server, decision 3).
   */
  async #save(record: SessionRecord): Promise<void> {
    this.#records.set(record.id, record);
    if (record.state !== "running") {
      await this.#tokens.revoke(record.id);
      await this.#removeCredentials(record);
    }
    await saveRecord(this.#settings.home, record);
  }

  /** Removes the credential files of a session that does not run (add-continuity). */
  async #removeCredentials(record: SessionRecord): Promise<void> {
    await rm(sessionPaths(this.#settings.home, record.id).credentials, {
      recursive: true,
      force: true,
    }).catch((error: unknown) => {
      this.#log.warn({ err: error, session: record.id }, "The credential files were not removed");
    });
  }

  #task(id: string): TaskView | undefined {
    return this.service.view.tasks.find((t) => t.id === id);
  }

  /** A task that a project removal took out of the view (openspec project-remove). */
  #removedTask(id: string): TaskView | undefined {
    return this.service.view.removed_tasks.find((t) => t.id === id);
  }

  #rows(task: string): EventRow[] {
    return this.service.index.find<EventRow>("events", { task }).sort((a, b) => compareOrder(a, b));
  }

  #running(): SessionRecord[] {
    return this.records.filter((r) => r.state === "running");
  }

  /** The working sessions of the agent in this workspace: running, not paused, no open gate. */
  working(): number {
    return this.#running().filter(
      (r) => r.agent === this.#tools.adapter.name && isWorking(this.#task(r.task)),
    ).length;
  }

  // ---- Session hosts (add-orca-session-host) ------------------------------------------------

  /** The host of a session: a running session keeps the host that it started in. */
  #hostOf(record: SessionRecord): SessionHost {
    if (record.host === this.#tools.host.name) return this.#tools.host;
    const host = this.#tools.hosts?.get(record.host);
    if (!host) throw new Error(`The session host ${record.host} is not set up in awd`);
    return host;
  }

  /** False for a host whose screen AW must not read (Orca). */
  #readsScreen(record: SessionRecord): boolean {
    return this.#hostOf(record).readsScreen !== false;
  }

  /** Where a person opens the terminal of a session, for the comments. */
  #terminalHint(record: SessionRecord): string {
    // Only the worktree: the program in an Orca terminal can change the terminal title.
    if (record.host === "orca") return `Open the Orca worktree aw-${record.task}`;
    return `Open the terminal: tmux -L ${this.#settings.sessions.tmuxSocket} attach -t aw`;
  }

  /** The header fields of a terminal snapshot of a session and its screen. */
  #snapshotInput(record: SessionRecord, screen: string): SnapshotInput {
    return {
      task: record.task,
      session: record.id,
      device: this.#me,
      host: record.host,
      socket: record.host === "tmux" ? this.#settings.sessions.tmuxSocket : null,
      window: record.host === "tmux" ? `aw-${record.task}` : null,
      screen,
    };
  }

  /**
   * The running or failed session of a task whose terminal the person sees: the session of the
   * claim, else a running one, else the newest. An old failed record never hides a new session.
   */
  #terminalRecord(task: string): SessionRecord | undefined {
    const live = this.records.filter(
      (r) => r.task === task && (r.state === "running" || r.state === "failed"),
    );
    const claimed = this.#task(task)?.claim?.session;
    return (
      live.find((r) => r.id === claimed) ??
      live.find((r) => r.state === "running") ??
      live.sort((a, b) => (b.opened_at ?? 0) - (a.opened_at ?? 0))[0]
    );
  }

  /**
   * The terminal snapshot at a gate open (openspec task-terminal-view): at once, for the session of
   * the task on this device whose host shows its screen (tmux; never Orca).
   */
  async #gateSnapshot(task: string): Promise<void> {
    const record = this.#terminalRecord(task);
    if (!record?.pane || !this.#readsScreen(record)) return;
    const screen = await this.#hostOf(record).capture(record.pane, 0);
    await this.#snapshots.gate(this.#snapshotInput(record, screen), this.#clock.now());
  }

  /**
   * The local target of "Open the terminal" for a session of this device (openspec
   * task-terminal-view): the tmux binary, socket and window, or the Orca worktree and binary.
   */
  async localTerminal(task: string): Promise<LocalTerminal | null> {
    const record = this.#terminalRecord(task);
    if (!record) return null;
    const host = this.#hostOf(record);
    const info = await host.detect().catch(() => null);
    if (record.host === "orca") {
      return { host: "orca", binary: info?.binary ?? null, worktree: record.cwd, socket: null };
    }
    return {
      host: record.host,
      binary: info?.binary ?? null,
      worktree: record.cwd,
      socket: this.#settings.sessions.tmuxSocket,
    };
  }

  /**
   * The pane of a session as its host shows it, or undefined when the host does not show it with
   * the stored pid. It throws when the host cannot tell (Orca does not answer).
   */
  async #paneOf(record: SessionRecord, tmuxPanes?: PaneState[]): Promise<PaneState | undefined> {
    const ref = record.pane;
    if (!ref) return undefined;
    const host = this.#hostOf(record);
    if (host.find) {
      const pane = await host.find(ref);
      return pane && pane.pid === ref.pid ? pane : undefined;
    }
    const panes = tmuxPanes ?? (await host.list());
    return panes.find((p) => p.pane === ref.pane && p.pid === ref.pid);
  }

  /**
   * Can a new session of this device run in Orca (the desktop host choice, integrate-ui)? The
   * checks of #chooseHost except `use_orca`: the Orca host is found, and AW covers the agent.
   */
  async orcaState(): Promise<{
    available: boolean;
    version: string | null;
    reason: string | null;
  }> {
    const agent = this.#tools.agent;
    const info = await this.#orca();
    if (!info) {
      return { available: false, version: null, reason: "the Orca host is not set up" };
    }
    if (!info.available) {
      return { available: false, version: info.version, reason: info.reason ?? null };
    }
    if (!agent.covered) {
      return {
        available: false,
        version: info.version,
        reason: `AW does not cover Claude Code ${agent.version ?? "of an unknown version"} in Orca`,
      };
    }
    return { available: true, version: info.version, reason: null };
  }

  async #orca(): Promise<HostInfo | null> {
    const host = this.#tools.hosts?.get("orca");
    if (!host) return null;
    const now = this.#clock.now();
    if (this.#orcaInfo && now - this.#orcaInfo.at < ORCA_DETECT_MS) return this.#orcaInfo.info;
    const info = await host.detect().catch((error: unknown): HostInfo => ({
      name: "orca",
      available: false,
      binary: null,
      version: null,
      survivesDaemonRestart: true,
      reason: (error as Error).message,
    }));
    this.#orcaInfo = { at: now, info };
    return info;
  }

  /**
   * The `session_host` that the task asks for: the newest applied `task.assigned` or `task.created`
   * that names one. An assignment with no host keeps the host of an earlier event.
   */
  #askedHost(task: string): string | undefined {
    const rows = this.#rows(task).filter(
      (r) => (r.type === "task.assigned" && r.applied) || r.type === "task.created",
    );
    for (const row of rows.reverse()) {
      const asked = data(row).session_host;
      if (typeof asked === "string") return asked;
    }
    return undefined;
  }

  /**
   * The host of a new session (design decision 8): the `session_host` of the task (#askedHost),
   * the checkout binding, then "Use Orca on this device". Orca that is off or missing, or a Claude
   * Code version that the contract tests do not cover, gives tmux and one comment with the cause:
   * AW does not read the Orca screen, so it cannot answer the trust screen of such a version.
   */
  async #chooseHost(task: TaskView, binding: Binding): Promise<string> {
    const wanted =
      this.#askedHost(task.id) ??
      binding.sessionHost ??
      (binding.useOrca ? "orca" : this.#tools.host.name);
    if (wanted !== "orca") return this.#tools.host.name;
    let cause: string | null = null;
    const agent = this.#tools.agent;
    if (!binding.useOrca) {
      cause = `Orca is off on ${this.#me}. Turn it on with 'aw binding orca on' on ${this.#me}, or with "Use Orca on this device" in the project Settings`;
    } else if (!agent.covered) {
      cause = `Orca needs a Claude Code version that AW covers, and ${this.#me} has ${agent.version ?? "an unknown version"}: AW cannot answer its trust screen in Orca`;
    } else {
      const info = await this.#orca();
      if (!info?.available) {
        cause = `Orca is not available on ${this.#me} (${info?.reason ?? "the Orca host is not set up"})`;
      }
    }
    if (cause === null) {
      // A later fallback with the same cause gets its comment again.
      this.#hostNotices.delete(task.id);
      return "orca";
    }
    await this.#tmuxNotice(task.id, cause);
    return this.#tools.host.name;
  }

  /** One comment for each new cause that makes a session of the task run in tmux, not in Orca. */
  async #tmuxNotice(task: string, cause: string): Promise<void> {
    if (this.#hostNotices.get(task) === cause) return;
    this.#log.warn({ task, cause }, "The session runs in tmux, not in Orca");
    await this.#buffer.now(
      task,
      "comment.added",
      { text: `${cause}. AW starts the session in tmux.` },
      this.#aw,
    );
    this.#hostNotices.set(task, cause);
  }

  /**
   * The worktree of the checkout where the branch is checked out, or null (also when the checkout
   * is not a git repository).
   */
  async #branchFolder(checkout: string, branch: string): Promise<string | null> {
    const listed = await git(checkout, ["worktree", "list", "--porcelain"], {
      timeoutMs: LOCAL_GIT_TIMEOUT_MS,
    });
    let path: string | null = null;
    for (const line of listed.stdout.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      if (line === `branch refs/heads/${branch}`) return path;
    }
    return null;
  }

  /**
   * The folder as AW wrote it before (git lists the real path), when AW made it for the task: the
   * git worktree of the tmux host, or the Orca worktree `aw-<task-id>` (Orca adds `-<n>` to a
   * taken folder name). Null for another folder.
   */
  async #taskFolder(folder: string, task: TaskView): Promise<string | null> {
    const real = (path: string) => realpath(path).catch(() => path);
    const target = await real(folder);
    const known = [
      join(this.#settings.home, "worktrees", task.id),
      ...this.records.filter((r) => r.task === task.id).map((r) => r.cwd),
    ];
    for (const path of known) if ((await real(path)) === target) return path;
    const name = basename(folder);
    for (const base of this.#folderNames(task)) {
      const suffix = name.startsWith(base) ? name.slice(base.length) : null;
      if (suffix === "" || (suffix !== null && /^-[0-9]+$/.test(suffix))) return folder;
    }
    return null;
  }

  /**
   * The folder names of a task: `aw-<key>` (openspec session-options, ux-1), the key of
   * `task.created` after a rekey, and `aw-<task id>` of an older AW. The first is the name of a
   * new folder.
   */
  #folderNames(task: TaskView): string[] {
    const keys = [task.key, task.created_key].filter((k): k is string => k !== null);
    return [...new Set([...keys.map((k) => `aw-${k}`), `aw-${task.id}`])];
  }

  /**
   * The AW worktree of the task on this device (tmux): the folder of an earlier session of the
   * task in `worktrees/`, the folder of an older AW (`worktrees/<task id>`), else a new folder
   * `worktrees/aw-<key>` (`-2`, `-3` when another task has that name).
   */
  async #ownWorktree(task: TaskView): Promise<string> {
    const root = join(this.#settings.home, "worktrees");
    const exists = (path: string) =>
      stat(path).then(
        () => true,
        () => false,
      );
    const earlier = this.records
      .filter((r) => r.task === task.id && within(r.cwd, root) && r.cwd !== root)
      .map((r) => r.cwd)
      .at(-1);
    if (earlier !== undefined && (await exists(earlier))) return earlier;
    const legacy = join(root, task.id);
    if (await exists(legacy)) return legacy;
    const base = this.#folderNames(task)[0]!;
    // The repository of a folder: its git common folder. Another workspace of this device can have
    // the same key, so the folder name and the branch alone do not name the task (check soc-6).
    const repository = async (folder: string): Promise<string | null> => {
      const dir = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      return dir.exitCode === 0 ? realpath(dir.stdout).catch(() => dir.stdout) : null;
    };
    const checkout = (await this.#binding(task.project)).checkout;
    const ours = checkout === null ? null : await repository(checkout);
    for (let n = 1; ; n++) {
      const path = join(root, n === 1 ? base : `${base}-${n}`);
      if (!(await exists(path))) return path;
      // A folder of this name that git has on the task branch, in the repository of the project
      // checkout, is the folder of this task.
      const head = await git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      if (
        head.exitCode === 0 &&
        head.stdout === this.#branch(task) &&
        ours !== null &&
        (await repository(path)) === ours
      ) {
        return path;
      }
    }
  }

  // ---- Claims (design decision 10) ----------------------------------------------------------

  async #claims(): Promise<void> {
    const view = this.service.view;
    // A revoked device runs no session (add-continuity, decision 15). Its later events do not
    // count for the other devices (the merge ignores them after `revoked_at`). A revoke in another
    // workspace counts too: that awd drops this device as a peer of each folder (fix list 0-43).
    if (
      view.devices.find((d) => d.slug === this.#me)?.revoked === true ||
      this.#revokedElsewhere()
    ) {
      if (!this.#revoked) this.#log.warn("This device is revoked: AW stops its sessions");
      this.#revoked = true;
      for (const record of this.#running()) {
        try {
          await this.#stopSession(record, "stopped");
        } catch (error) {
          this.#log.error({ err: error, session: record.id }, "The session did not stop");
        }
      }
      return;
    }
    this.#revoked = false;
    const notStopped = new Map<string, string>();
    for (const record of this.#running()) {
      const task = view.tasks.find((t) => t.id === record.task);
      const reason = this.#stopReason(record, task);
      if (reason === null) continue;
      try {
        await this.#stopSession(record, reason);
        this.#stopWaitNoticed.delete(record.id);
      } catch (error) {
        this.#log.error({ err: error, session: record.id }, "The session did not stop");
        notStopped.set(record.id, (error as Error).message);
      }
    }
    const candidates: TaskView[] = [];
    for (const task of view.tasks) {
      if (task.archived || task.stage === "done" || task.created === null) continue;
      if (assigneeDevice(task.assignee) !== this.#me) continue;
      if (agentOf(task.assignee) !== this.#tools.adapter.name) continue;
      // A task starts only when its dependencies are done (docs/workflow.md 4.6.4).
      if (task.open_dependencies.length > 0) continue;
      if (!this.#needsClaim(task)) continue;
      // Two agents must never work in one folder. A session of the task that did not stop (its
      // host does not answer, and its agent can still run) keeps the task: the new session starts
      // only after that stop, at a later check.
      const old = this.#running().find((r) => r.task === task.id);
      if (old) {
        await this.#stopWaitNotice(task, old, notStopped.get(old.id));
        continue;
      }
      // One task that cannot start never blocks the other sessions of the workspace.
      const last = this.#startErrors.get(task.id);
      if (last && this.#clock.now() - last.at < this.#startRetryMs) continue;
      candidates.push(task);
    }
    if (candidates.length === 0) return;
    // The agent queue (docs/architecture.md 4.6.8): the order, the maximum of working sessions,
    // the login, the usage window and the disk.
    const agent = `${this.#tools.adapter.name}@${this.#me}`;
    const ordered = queueOrder(
      candidates,
      view.queues.find((q) => q.agent === agent),
    );
    let working = this.#deviceWorking();
    for (const task of ordered) {
      const block = startBlock(
        {
          working,
          max: this.#settings.sessions.maxWorking,
          loginValid: this.#auth()?.valid ?? null,
          fiveHour: fiveHourUse([...this.#usage.values()], this.#clock.now()),
          disk: await this.#diskUse(),
          diskLimit: this.#settings.sessions.diskFullPercent,
        },
        QUEUE_USAGE_LIMIT,
      );
      if (block !== null) {
        if (block !== this.#queueBlock) {
          this.#log.info({ task: task.id, cause: block }, "A queued task waits");
        }
        this.#queueBlock = block;
        break;
      }
      this.#queueBlock = null;
      try {
        await this.#startSession(task);
        this.#startErrors.delete(task.id);
        working++;
      } catch (error) {
        await this.#startFailed(task, error);
      }
    }
  }

  /** The disk use of AW_HOME in percent, read at most once per minute. */
  async #diskUse(): Promise<number | null> {
    const now = this.#clock.now();
    if (this.#disk && now - this.#disk.at < DISK_CHECK_MS) return this.#disk.value;
    const value = await diskUse(this.#settings.home);
    this.#disk = { at: now, value };
    if (value !== null && value >= this.#settings.sessions.diskFullPercent) {
      this.#log.warn({ disk: Math.round(value) }, "The disk is full: AW starts no session");
    }
    return value;
  }

  /**
   * Why a running session must stop, or null: `moved` when the task is now of another device (or
   * gone), `replaced` when a person assigned it again on this device (another agent, or the same
   * agent: then a new session claims it).
   */
  #stopReason(
    record: SessionRecord,
    task: TaskView | undefined,
  ): "moved" | "replaced" | "stopped" | null {
    // A person removed the project: stop with no wake branch push (openspec project-remove).
    if (!task && this.#removedTask(record.task)) return "stopped";
    if (!task) return "moved";
    // A person archived the task: a stop of a person, so the claim stays and an unarchive starts
    // no new session until a person starts one (openspec task-actions).
    if (task.archived) return "stopped";
    if (assigneeDevice(task.assignee) !== this.#me) return "moved";
    // "Stop session" of a person on any device: the merge applies the request only from a person
    // (openspec session-options, task-actions).
    const stop = this.#rows(task.id).some(
      (r) => r.type === "session.stop_requested" && r.applied && data(r).session === record.id,
    );
    if (stop) return "stopped";
    if (task.claim !== null && task.claim.session !== record.id) {
      return task.claim.device === this.#me ? "replaced" : "moved";
    }
    if (agentOf(task.assignee) !== record.agent) return "replaced";
    const rows = this.#rows(task.id);
    const claimRow = rows.find((r) => r.id === record.claim_event);
    const assigned = rows.filter((r) => r.type === "task.assigned" && r.applied).at(-1);
    if (assigned && claimRow && compareOrder(assigned, claimRow) > 0) return "replaced";
    return null;
  }

  /** One comment for each session that did not stop and so keeps a new session of its task waiting. */
  async #stopWaitNotice(
    task: TaskView,
    old: SessionRecord,
    cause: string | undefined,
  ): Promise<void> {
    if (this.#stopWaitNoticed.has(old.id)) return;
    this.#log.warn({ task: task.id, session: old.id, cause }, "The new session waits for a stop");
    if (cause === undefined) return;
    await this.#buffer.now(
      task.id,
      "comment.added",
      {
        text: `The new session waits: the session ${old.id} of this task still runs on ${this.#me}, and AW could not stop it. ${cause.slice(0, 1000)} AW starts the new session after that session stops. ${this.#terminalHint(old)}.`,
      },
      this.#aw,
    );
    this.#stopWaitNoticed.add(old.id);
  }

  async #startFailed(task: TaskView, error: unknown): Promise<void> {
    const message = (error as Error)?.message ?? String(error);
    const last = this.#startErrors.get(task.id);
    this.#startErrors.set(task.id, { at: this.#clock.now(), message });
    if (last?.message === message) return;
    this.#log.error({ err: error, task: task.id }, "The session did not start");
    try {
      await this.#buffer.now(
        task.id,
        "comment.added",
        {
          text: `The session did not start on ${this.#me}: ${message.slice(0, 1000)}. AW tries again in ${Math.round(this.#startRetryMs / 1000)} s.`,
        },
        this.#aw,
      );
    } catch (second) {
      this.#log.error({ err: second, task: task.id }, "The start error was not written");
    }
  }

  #needsClaim(task: TaskView): boolean {
    const claim = task.claim;
    if (claim === null) return true;
    // A notice for a parent whose session ended: a new session (docs/workflow.md 4.10.4).
    if (this.#restarts.has(task.id) && claim.device === this.#me) {
      const record = this.#records.get(claim.session);
      if (record?.state !== "running") return true;
      this.#restarts.delete(task.id);
    }
    const rows = this.#rows(task.id);
    const claimRow = rows.find((r) => r.id === claim.event);
    const assigned = rows.filter((r) => r.type === "task.assigned" && r.applied).at(-1);
    if (assigned && claimRow && compareOrder(assigned, claimRow) > 0) return true;
    if (claim.device === this.#me) {
      // The record of the claim decides: running, or ended by the human or a failure. With no
      // record (a new AW_HOME), this device claims again.
      return !this.#records.has(claim.session);
    }
    // AW never moves a task by itself (docs/decisions/2026-11-23-manual-move.md): a claim of
    // another device ends only with its release, never because that device is offline.
    return task.released_epoch !== null && task.released_epoch >= claim.epoch;
  }

  #maxEpoch(task: TaskView): number {
    let max = task.claim?.epoch ?? 0;
    for (const row of this.#rows(task.id)) {
      if (row.type !== "task.claimed") continue;
      const epoch = data(row).epoch;
      if (typeof epoch === "number" && epoch > max) max = epoch;
    }
    return max;
  }

  /** The bindings of this device for a project: the checkout, its host and "Use Orca". */
  async #binding(project: string | null): Promise<Binding> {
    const none: Binding = { checkout: null, sessionHost: undefined, useOrca: false };
    if (project === null) return none;
    try {
      const doc = await this.service.files.readDocument<"bindings">(
        `tasks/devices/${this.#me}/bindings.yaml`,
      );
      const checkout = doc.value.checkouts.find((c) => c.project === project);
      return {
        checkout: checkout?.path ?? null,
        sessionHost: checkout?.session_host,
        useOrca: doc.value.use_orca,
      };
    } catch {
      return none;
    }
  }

  /** The checkpoint branch of a task (the name rule after a rekey is in checkpoint.ts). */
  #branch(task: TaskView): string {
    return checkpointBranch(task, this.service.view.tasks);
  }

  /**
   * The local task branch: the branch of the git worktree that AW made for the task on this
   * device when it is a branch of the task (a rekeyed task keeps its old local name), else the
   * checkpoint branch. Another branch there (the agent ran `git checkout main`) is never the task
   * branch: AW would move it and push it to `aw/<key>` (fix list 0-0d).
   */
  async #localBranch(task: TaskView): Promise<string> {
    const own = await this.#ownWorktree(task);
    const head = await git(own, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const branch = this.#branch(task);
    const name = head.exitCode === 0 ? head.stdout : "";
    return name === branch || (name !== "" && name === task.branch) ? name : branch;
  }

  /**
   * Bases the local branch on the checkpoint branch of `origin` before a session starts (decision
   * D10): a move continues from the last pushed commit. Returns the remote commit that the branch
   * has, for the lease of the first push.
   */
  async #prepare(checkout: string, task: TaskView, local: string): Promise<string | null> {
    const folder = await this.#branchFolder(checkout, local);
    // The branch is checked out in a folder that AW did not make (the checkout of the person): AW
    // changes nothing there, and the start names the folder (fix list 0-0e).
    if (folder !== null && (await this.#taskFolder(folder, task)) === null) return null;
    const prepared = await prepareBranch({
      checkout,
      local,
      remote: this.#branch(task),
      folder,
      device: this.#me,
    });
    const note = prepared.comment;
    if (note !== null && !this.#prepareNotes.has(`${task.id}\n${note}`)) {
      this.#prepareNotes.add(`${task.id}\n${note}`);
      this.#log.warn({ task: task.id }, note);
      await this.#buffer.now(task.id, "comment.added", { text: note }, this.#aw);
    }
    return prepared.base;
  }

  /**
   * A git worktree `<AW_HOME>/worktrees/<task-id>` on `aw/<key>`, based on `origin/aw/<key>`. A
   * checkout that is not a git repository gets no session: AW trusts only a folder that it
   * created (docs/architecture.md 4.6.2), and 2 tasks must not share one folder. The start error
   * says so in the thread.
   */
  async #worktree(
    checkout: string,
    task: TaskView,
    host: SessionHost,
    taken: string | null,
    branch: string,
  ): Promise<{ cwd: string; branch: string; base: string | null }> {
    // Each git command of awd is tracked and has a time limit: a hook of the repository runs with
    // it (final check fc1-6, fc1-7).
    const inCheckout = (args: string[]) => git(checkout, args, { timeoutMs: LOCAL_GIT_TIMEOUT_MS });
    if ((await inCheckout(["rev-parse", "--is-inside-work-tree"])).exitCode !== 0) {
      throw new Error(
        `${checkout} is not a git repository. AW runs a session only in a git worktree that it creates: make the checkout a git repository, or bind another one with 'aw binding set <project> <path>' on ${this.#me}`,
      );
    }
    const base = await this.#prepare(checkout, task, branch);
    if (host.worktree) {
      // Orca shows a terminal only in an Orca worktree: the host makes it (2-step open), or finds
      // the one of the task. It refuses a branch that is checked out in another folder. The
      // prepare made the local branch, so Orca checks it out with --base-branch.
      const [name, ...aliases] = this.#folderNames(task);
      const made = await host.worktree({ name: name!, aliases, checkout, branch });
      return { cwd: made.path, branch: made.branch, base };
    }
    if (taken !== null) {
      // The branch is checked out already: the folder of an earlier session of the task (also an
      // Orca worktree, when the task ran in Orca before). git cannot check it out twice.
      const folder = await this.#taskFolder(taken, task);
      if (folder !== null) return { cwd: folder, branch, base };
      throw new Error(
        `The branch ${branch} is checked out in ${taken}, a folder that AW did not make for this task. Check out another branch there, or remove that worktree`,
      );
    }
    const path = await this.#ownWorktree(task);
    const exists = await stat(path).then(
      () => true,
      () => false,
    );
    if (exists) {
      // The folder of AW has another branch (the agent checked it out): check out the task branch
      // again, so the session never works on a branch of the person (fix list 0-0d).
      const head = await git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      if (head.exitCode !== 0 || head.stdout !== branch) {
        const known =
          (await inCheckout(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]))
            .exitCode === 0;
        const moved = await git(
          path,
          ["checkout", "--quiet", ...(known ? [branch] : ["-b", branch])],
          { timeoutMs: LOCAL_GIT_TIMEOUT_MS },
        );
        if (moved.exitCode !== 0) {
          throw new Error(
            `The AW worktree ${path} has another branch checked out, and git checkout ${branch} failed: ${moved.timedOut ? "no end in 5 minutes" : moved.stderr}. Commit or remove the changes there`,
          );
        }
      }
    } else {
      await mkdir(join(this.#settings.home, "worktrees"), { recursive: true, mode: 0o700 });
      const known =
        (await inCheckout(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]))
          .exitCode === 0;
      const result = await inCheckout(
        known ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"],
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `git worktree add failed: ${result.timedOut ? "no end in 5 minutes" : result.stderr}`,
        );
      }
    }
    return { cwd: path, branch, base };
  }

  /** The text of a proposal version: `proposal/v<n>.md`, or `approach/v<n>.md` from before the rename. */
  async #proposalVersion(task: string, version: number): Promise<string | null> {
    const read = (folder: string) =>
      this.service.files.readText(`tasks/${task}/${folder}/v${version}.md`).catch(() => null);
    return (await read("proposal")) ?? (await read("approach"));
  }

  async #proposalText(task: TaskView): Promise<string | null> {
    const read = async (t: TaskView): Promise<string | null> => {
      const version = t.proposal.approved;
      if (version === null) return null;
      return this.#proposalVersion(t.id, version);
    };
    const own = await read(task);
    if (own !== null) return own;
    const parent = task.parent ? this.#task(task.parent) : undefined;
    return parent ? read(parent) : null;
  }

  /**
   * The knowledge part of the SessionStart context: the context builder of the knowledge store
   * (a short header and the file list, at most 9,000 characters), else the cause. The task paths
   * are the paths named in the approved proposal and the changed files of the worktree
   * (agent-learning), so a `files` knowledge file that matches one is in "Read now".
   */
  async #knowledge(task: TaskView, cwd: string | null): Promise<string> {
    try {
      const paths = await taskPaths({
        proposal: await this.#proposalText(task),
        cwd,
        checkout: (await this.#binding(task.project)).checkout,
      });
      return (await this.service.knowledge.context(task, { paths })).text;
    } catch (error) {
      this.#log.warn({ err: error, task: task.id }, "The knowledge context was not built");
      return knowledgeUnavailable(task, (error as Error).message);
    }
  }

  async #startSession(task: TaskView): Promise<void> {
    const binding = await this.#binding(task.project);
    const checkout = binding.checkout;
    const project = this.service.view.projects.find((p) => p.slug === task.project);
    const options = effectiveSessionOptions(task, project);
    if (checkout === null && options.work_in !== "folder") {
      if (!this.#noCheckout.has(task.id)) {
        this.#noCheckout.add(task.id);
        this.#log.warn({ task: task.id }, "No checkout of the project on this device");
        await this.#buffer.now(
          task.id,
          "comment.added",
          {
            text: `No checkout of ${task.project ?? "the project"} on ${this.#me}. Bind it with 'aw binding set ${task.project ?? "<project>"} <path>' on ${this.#me} (or in the project Settings), then assign the task again.`,
          },
          this.#aw,
        );
      }
      return;
    }
    const { cwd, branch, base, hostName } = await this.#folder(task, binding, options);
    const id = newId(this.#clock);
    const claim = await this.#buffer.now(
      task.id,
      "task.claimed",
      {
        epoch: this.#maxEpoch(task) + 1,
        device: this.#me,
        session: id,
        based_on: task.claim?.event ?? null,
      },
      this.#aw,
    );
    if (!claim.applied) {
      // A start failure: AW tries again after START_RETRY_MS, not at each tick.
      throw new Error(`The merge did not apply the claim (${claim.reason ?? "no reason"})`);
    }
    if (task.stage === "backlog") {
      await this.#buffer.now(
        task.id,
        "task.stage_changed",
        { from: "backlog", to: this.#work.firstStage(task) },
        this.#aw,
      );
    }
    const notice = this.#restarts.get(task.id) ?? null;
    this.#restarts.delete(task.id);
    const record: SessionRecord = {
      kind: "aw-session",
      schema: 1,
      id,
      workspace: this.service.id,
      task: task.id,
      key: task.key,
      agent: this.#tools.adapter.name,
      epoch: (claim.event.data as { epoch: number }).epoch,
      claim_event: claim.event.id,
      cwd,
      branch,
      state: "running",
      launch: {
        name: task.key ?? task.id,
        plugin_dir: this.#tools.pluginDir,
        settings_file: sessionPaths(this.#settings.home, id).settings,
        permission_mode: options.permission_mode,
        model: this.#settings.sessions.claudeModel,
        agent_teams: options.agent_teams,
      },
      work_in: options.work_in,
      host: hostName,
      pane: null,
      resumes: 0,
      resume_times: [],
      launch_waits: 0,
      restart_boot: null,
      continues: 0,
      usage_pause: null,
      auto_resume_disabled: false,
      agent_errors: 0,
      agent_retry: null,
      restarts: 0,
      checkpoint: base,
      pending_tool: null,
      notification: null,
      started: false,
      first_seen: false,
      busy: false,
      busy_deliveries: [],
      failed_deliveries: [],
      first_delivery: notice?.id ?? null,
      rules: [],
      approvals: [],
      foreign_sessions: [],
    };
    const paths = sessionPaths(this.#settings.home, id);
    await prepareSessionFolder(paths);
    const fresh = this.#task(task.id) ?? task;
    await writePrivate(
      paths.firstInput,
      notice?.text ?? firstInput(fresh, await this.#proposalText(fresh)),
    );
    await writePrivate(
      paths.settings,
      sessionSettingsFile(this.#tools, {
        permissionMode: options.permission_mode,
        agentTeams: options.agent_teams,
      }),
    );
    await this.#save(record);
    try {
      await this.#open(record, "new");
    } catch (error) {
      // No window, so no agent: AW forgets this record. The claim in the log then has no session
      // of this device, and the next try (after the start wait) claims again with a new epoch.
      this.#records.delete(record.id);
      await this.#tokens.revoke(record.id).catch(() => undefined);
      await rm(paths.dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    if (notice) {
      // The notice is the first input: the thread shows it as delivered by that input.
      await this.#work.notice(
        task.id,
        id,
        notice.id,
        notice.text.replace(/^\[AW notice [^\]]+\] /, ""),
      );
    }
    this.#log.info(
      { task: task.id, session: id, cwd, host: hostName, mode: options.permission_mode },
      "Session started",
    );
  }

  /**
   * The working folder of a new session (openspec session-options, design decision 6): an AW
   * worktree (the default), the project checkout on the task branch, or a folder that a person
   * chose. A refusal throws: the start error is one comment in the thread.
   */
  async #folder(
    task: TaskView,
    binding: Binding,
    options: EffectiveSessionOptions,
  ): Promise<{ cwd: string; branch: string | null; base: string | null; hostName: string }> {
    const checkout = binding.checkout;
    if (options.work_in === "folder") {
      const folder = await this.#chosenFolder(options.folder, task.id);
      return {
        cwd: folder,
        branch: null,
        base: null,
        hostName: await this.#plainHost(task, binding),
      };
    }
    if (checkout === null) throw new Error(`No checkout of ${task.project ?? "the project"}`);
    if (options.work_in === "checkout") {
      const local = await this.#localBranch(task);
      const { branch, base } = await this.#inCheckout(checkout, task, local);
      return { cwd: checkout, branch, base, hostName: await this.#plainHost(task, binding) };
    }
    let hostName = await this.#chooseHost(task, binding);
    // A task keeps its branch and its folder when it changes host. Orca opens a terminal only in
    // an Orca worktree, and it cannot make one on a branch that is checked out in another folder:
    // then the session runs in tmux in that folder.
    const local = await this.#localBranch(task);
    const taken = await this.#branchFolder(checkout, local);
    if (taken !== null) {
      const real = (path: string) => realpath(path).catch(() => path);
      // An earlier session of the task worked in the checkout (a record names it). A branch that
      // the person checked out there keeps the refusal of #worktree (fix list 0-0e).
      const ownCheckout = this.records.some((r) => r.task === task.id && r.work_in === "checkout");
      if (ownCheckout && (await real(taken)) === (await real(checkout))) {
        throw new Error(
          `The branch ${local} is checked out in the project checkout ${checkout} (an earlier session worked there). A separate worktree needs the branch: check out another branch in the checkout, or start the session with "Project checkout"`,
        );
      }
    }
    if (hostName !== this.#tools.host.name && taken !== null) {
      const own = await this.#ownWorktree(task);
      const real = (path: string) => realpath(path).catch(() => path);
      if ((await real(taken)) === (await real(own))) {
        await this.#tmuxNotice(
          task.id,
          `The branch ${local} is checked out in ${taken}, and Orca opens a terminal only in an Orca worktree. To use Orca, remove that worktree when no session runs in it`,
        );
        hostName = this.#tools.host.name;
      }
    }
    const host =
      hostName === this.#tools.host.name ? this.#tools.host : this.#tools.hosts!.get(hostName)!;
    const made = await this.#worktree(checkout, task, host, taken, local);
    return { ...made, hostName };
  }

  /**
   * Removes the tmux worktree that AW made for an earlier session of the task, so the project
   * checkout can take the branch (openspec session-options). Only a folder in
   * `<AW_HOME>/worktrees/` of this task with no running session; `git worktree remove` with no
   * force refuses local changes, and the branch keeps its commits. True when it is gone.
   */
  async #releaseOwnWorktree(
    checkout: string,
    folder: string,
    task: TaskView,
    branch: string,
  ): Promise<boolean> {
    const real = (path: string) => realpath(path).catch(() => path);
    const target = await real(folder);
    const root = await real(join(this.#settings.home, "worktrees"));
    if (!within(target, root) || target === root) return false;
    if ((await this.#taskFolder(folder, task)) === null) return false;
    for (const record of this.#running()) if ((await real(record.cwd)) === target) return false;
    const removed = await git(checkout, ["worktree", "remove", folder]);
    if (removed.exitCode !== 0) return false;
    await this.#buffer.now(
      task.id,
      "comment.added",
      {
        text: `AW removed the worktree ${folder} of an earlier session: the task works in the project checkout now. The branch ${branch} keeps its commits.`,
      },
      this.#aw,
    );
    return true;
  }

  /**
   * The host of a session in the checkout or another folder: tmux. Orca opens a terminal only in
   * an Orca worktree, so a task that asks for Orca gets one comment.
   */
  async #plainHost(task: TaskView, binding: Binding): Promise<string> {
    const wanted =
      this.#askedHost(task.id) ?? binding.sessionHost ?? (binding.useOrca ? "orca" : null);
    if (wanted === "orca") {
      await this.#tmuxNotice(
        task.id,
        "Orca opens a terminal only in an Orca worktree, and this task works in a folder that AW did not make",
      );
    }
    return this.#tools.host.name;
  }

  /**
   * A folder that a person chose (`work_in: folder`): an absolute folder that exists, outside the
   * AW state folder and the workspace folders, and that does not hold one of them. AW makes no worktree and changes no branch there.
   */
  async #chosenFolder(folder: string | null, task: string): Promise<string> {
    if (folder === null || !isAbsolute(folder)) {
      throw new Error(
        `The task works in another folder, but it has no absolute folder. Start a new session with "Work in" set to a folder of ${this.#me}`,
      );
    }
    const info = await stat(folder).catch(() => null);
    if (!info?.isDirectory()) {
      throw new Error(
        `The folder ${folder} does not exist on ${this.#me}. Choose a folder of ${this.#me}, or another "Work in"`,
      );
    }
    const real = await realpath(folder).catch(() => folder);
    const homeReal = await realpath(this.#settings.home).catch(() => this.#settings.home);
    const forbidden = [this.#settings.home, homeReal, ...this.#workspaceFolders()];
    for (const root of forbidden) {
      if (within(folder, root) || within(real, root)) {
        throw new Error(
          `A session cannot work in ${folder}: it is in ${root}, which only awd changes. Choose a folder outside it`,
        );
      }
      // A folder that holds AW_HOME or a workspace folder (the user home, for example) gives the
      // agent the keys and the event logs by a relative path.
      const rootReal = await realpath(root).catch(() => root);
      if (within(root, folder) || within(rootReal, real)) {
        throw new Error(
          `A session cannot work in ${folder}: it holds ${root}, which only awd changes. Choose a folder inside a project, not one that holds ${root}`,
        );
      }
    }
    // Two agents never work in one folder: the folder of a running session of another task (a
    // project checkout too), a folder in it, or a folder that holds it (check soc-9).
    for (const other of this.#running()) {
      if (other.task === task) continue;
      const cwd = await realpath(other.cwd).catch(() => other.cwd);
      if (within(real, cwd) || within(cwd, real)) {
        const key = this.#task(other.task)?.key ?? other.task;
        throw new Error(
          `The session of ${key} works in ${other.cwd}. AW runs one session at a time in a folder: stop that session, or choose another folder`,
        );
      }
    }
    return folder;
  }

  /**
   * The project checkout on the task branch (`work_in: checkout`): one session at a time in a
   * checkout. AW prepares the branch from `origin` as for a worktree, then runs `git switch` in
   * the checkout. Local changes that conflict stop the start (git refuses), and so does a branch
   * that is checked out in another folder.
   */
  async #inCheckout(
    checkout: string,
    task: TaskView,
    local: string,
  ): Promise<{ branch: string; base: string | null }> {
    const real = (path: string) => realpath(path).catch(() => path);
    const target = await real(checkout);
    if ((await git(checkout, ["rev-parse", "--is-inside-work-tree"])).exitCode !== 0) {
      throw new Error(
        `${checkout} is not a git repository. A session in the project checkout works on the branch ${local}: make the checkout a git repository, or use "Separate worktree"`,
      );
    }
    for (const other of this.#running()) {
      if (other.task !== task.id && (await real(other.cwd)) === target) {
        const key = this.#task(other.task)?.key ?? other.task;
        throw new Error(
          `The checkout ${checkout} has the session of ${key}. AW runs one session at a time in a project checkout: stop that session, or use "Separate worktree"`,
        );
      }
    }
    let taken = await this.#branchFolder(checkout, local);
    if (taken !== null && (await real(taken)) !== target) {
      // The AW worktree of an earlier session of this task gives the branch free when it is clean.
      if (!(await this.#releaseOwnWorktree(checkout, taken, task, local))) {
        throw new Error(
          `The branch ${local} is checked out in ${taken}. git cannot check it out in ${checkout} too: remove that worktree when no session runs in it, or use "Separate worktree"`,
        );
      }
      taken = null;
    }
    const base = taken === null ? await this.#prepare(checkout, task, local) : null;
    if (taken === null) {
      const known =
        (await git(checkout, ["rev-parse", "--verify", "--quiet", `refs/heads/${local}`]))
          .exitCode === 0;
      const switched = await git(
        checkout,
        ["switch", "--quiet", ...(known ? [local] : ["-c", local])],
        { timeoutMs: LOCAL_GIT_TIMEOUT_MS },
      );
      if (switched.exitCode !== 0) {
        throw new Error(
          `git switch ${local} failed in ${checkout}: ${switched.timedOut ? "no end in 5 minutes" : switched.stderr}. Commit or stash your changes there, or use "Separate worktree"`,
        );
      }
    }
    return { branch: local, base };
  }

  /**
   * Writes the context and the launch file, then opens the window. The message is the first input
   * (new) or the continue message (resume), unless `messageFile` names another one.
   */
  async #open(record: SessionRecord, mode: "new" | "resume", messageFile?: string): Promise<void> {
    const paths = sessionPaths(this.#settings.home, record.id);
    // The token before the window: aw-launch reads it. A resume keeps the token of the session.
    await this.#tokens.ensure(record.id);
    const task = this.#task(record.task);
    if (task) {
      const knowledge = await this.#knowledge(task, record.cwd);
      await writePrivate(paths.context, sessionContext(task, knowledge));
    }
    const credentialsDir = await this.#writeCredentials(record, task);
    const userStatusline = await this.#userStatusline();
    const launch: LaunchFile = {
      mode,
      binary: this.#settings.sessions.claude,
      args: this.#tools.adapter.launchArgs({
        mode,
        sessionId: record.id,
        name: record.launch.name,
        pluginDir: record.launch.plugin_dir,
        settingsFile: record.launch.settings_file,
        permissionMode: record.launch.permission_mode,
        model: record.launch.model,
      }),
      message_file: messageFile ?? (mode === "new" ? paths.firstInput : paths.continueInput),
      socket: this.#settings.socketPath,
      env: {
        AW_SESSION: record.id,
        AW_TASK: record.task,
        AW_WORKSPACE: record.workspace,
        AW_HOME: this.#settings.home,
        AW_NODE: process.execPath,
        AW_CLI: this.#tools.awCli,
        AW_HOOK: this.#tools.awHook,
        HOME: this.#settings.userHome,
        PATH: `${join(record.launch.plugin_dir, "bin")}:${this.#settings.sessions.path}`,
        CLAUDE_CODE_NONBLOCKING_STDOUT: "1",
        AW_CREDENTIALS_DIR: credentialsDir,
        // The same transcript folder for awd and the agent (review item 6). Only when awd has
        // the variable: it also moves the state file of Claude Code (add-continuity, decision 7).
        ...(this.#settings.sessions.claudeConfigEnv
          ? { CLAUDE_CONFIG_DIR: this.#settings.sessions.claudeConfigEnv }
          : {}),
        ...(this.#tools.awStatusline ? { AW_STATUSLINE: this.#tools.awStatusline } : {}),
        ...(userStatusline ? { AW_USER_STATUSLINE: userStatusline } : {}),
      },
      trust: this.#tools.agent.covered,
      state_file: join(
        this.#settings.sessions.claudeConfigEnv ?? this.#settings.userHome,
        ".claude.json",
      ),
      backup_dir: join(this.#settings.home, "backups"),
      // The AW guard of the PreToolUse hook (openspec session-options): it runs with no awd call.
      guard: {
        home: this.#settings.home,
        user_home: this.#settings.userHome,
        workspaces: this.#workspaceFolders(),
        credentials_dir: credentialsDir,
        cwd: record.cwd,
      },
    };
    await writePrivate(paths.launch, `${JSON.stringify(launch, null, 2)}\n`);
    record.pane = await this.#hostOf(record).open({
      name: `aw-${record.task}`,
      cwd: record.cwd,
      command: [this.#tools.awLaunch, record.id],
      env: { AW_NODE: process.execPath, AW_HOME: this.#settings.home },
    });
    record.opened_at = this.#clock.now();
    record.notification = null;
    record.busy = false;
    await this.#save(record);
  }

  /**
   * The statusLine command of the user settings of Claude Code: `aw-statusline` runs it after it
   * read the usage windows, so the user keeps the own statusline (add-continuity, decision 9).
   */
  async #userStatusline(): Promise<string | null> {
    try {
      const text = await readFile(
        join(this.#settings.sessions.claudeConfigDir, "settings.json"),
        "utf8",
      );
      const command = (JSON.parse(text) as { statusLine?: { command?: unknown } }).statusLine
        ?.command;
      return typeof command === "string" && command.length > 0 ? command : null;
    } catch {
      return null;
    }
  }

  /** Stops the session by its process group and records why (docs/phase-1.md 9.7). */
  async #stopSession(
    record: SessionRecord,
    reason: "moved" | "replaced" | "stopped",
  ): Promise<void> {
    const pane = record.pane;
    // Only a pane that the host still lists with the stored pid: after a reboot the stored window
    // id can name the window of another session. A host that cannot tell (Orca does not answer)
    // throws: the session stays running, the stop gives `not_ready`, and the next check tries again.
    if (pane) {
      const host = this.#hostOf(record);
      let shown: PaneState | undefined;
      try {
        shown = await this.#paneOf(record);
      } catch (error) {
        throw new ServiceError(
          "not_ready",
          `The session host ${record.host} does not answer: ${(error as Error).message}. The session still runs.`,
        );
      }
      if (shown) {
        await host.stop(pane).catch((error: unknown) => {
          throw new ServiceError(
            "not_ready",
            `The session did not stop: ${(error as Error).message}. The session can still run.`,
          );
        });
      }
      // The agent is stopped. The close only removes the window: a failure must not keep the
      // record running, because the next check would then resume the stopped agent. A host that
      // knows the handle with another process (another incarnation) gets a close with no signal.
      if (shown || host.find) {
        await host.close(pane).catch((error: unknown) => {
          this.#log.warn(
            { err: error, session: record.id },
            "The window of the stopped session did not close",
          );
        });
      }
    }
    record.state = reason;
    await this.#save(record);
    await this.#buffer.flush(record.task);
    // The task of a removed project keeps its thread: its `session.ended` goes to its log too.
    const task = this.#task(record.task) ?? this.#removedTask(record.task);
    // Outside the queue: the commit hooks and the push of the wake branch never block a claim, a
    // gate or a delivery of another session (fix list 0-0e). It catches its own errors.
    // A folder of the person ("Other folder") is not a folder of AW: AW commits and pushes nothing
    // there, also on a move (check soc-8).
    if (reason === "moved" && record.work_in !== "folder") void this.#wakeBranch(record, task);
    if (task?.owner === this.#me) {
      await this.#buffer.now(
        record.task,
        "session.ended",
        { session: record.id, reason },
        this.#aw,
      );
      if (reason !== "stopped") {
        await this.#buffer.now(record.task, "task.released", { epoch: record.epoch }, this.#aw);
      }
    }
    this.#log.info({ session: record.id, reason }, "Session stopped");
  }

  /**
   * The checkpoint push at a Stop (decision D10): only the session with the highest claim epoch
   * pushes. It runs outside the queue, so a slow remote blocks no claim, gate or delivery.
   */
  #checkpoint(record: SessionRecord): void {
    const task = this.#task(record.task);
    if (!task || !pushesCheckpoint(record, this.#maxEpoch(task))) return;
    this.#pusher.push(record, this.#branch(task)).catch((error: unknown) => {
      this.#log.error({ err: error, session: record.id }, "The checkpoint push failed");
    });
  }

  /**
   * The unpushed work of a session whose task a person moved to another device: a branch
   * `aw/<key>-<device>-<HHMM>` on origin and a system comment (manual-move decision, item 5).
   */
  async #wakeBranch(record: SessionRecord, task: TaskView | undefined): Promise<void> {
    try {
      const now = this.#clock.now();
      const result = await pushUnpushedWork({
        cwd: record.cwd,
        key: record.key ?? record.task,
        branch: record.branch,
        device: this.#me,
        now,
        // The local time zone of this device at that time (getTimezoneOffset is UTC - local).
        utcOffsetMinutes: -new Date(now).getTimezoneOffset(),
      });
      const text = wakeComment(result, this.#me, assigneeDevice(task?.assignee ?? null));
      if (text === null) return;
      this.#log.info({ session: record.id, result }, "Unpushed work of a moved task saved");
      await this.#buffer.now(record.task, "comment.added", { text }, this.#aw);
    } catch (error) {
      this.#log.error({ err: error, session: record.id }, "The unpushed work was not saved");
    }
  }

  // ---- Removed projects (openspec project-remove) -----------------------------------------------

  /** The file of the done removals of this workspace: a restart does not clean or comment again. */
  get #removedFile(): string {
    return join(this.#settings.home, "removed", `${this.service.id}.json`);
  }

  async #loadRemovedDone(): Promise<Map<string, CleanupItem[]>> {
    if (this.#removedDone) return this.#removedDone;
    const text = await readFile(this.#removedFile, "utf8").catch(() => "{}");
    let parsed: Record<string, CleanupItem[]> = {};
    try {
      parsed = JSON.parse(text) as Record<string, CleanupItem[]>;
    } catch {
      this.#log.warn({ file: this.#removedFile }, "The file of the done removals is not JSON");
    }
    this.#removedDone = new Map(Object.entries(parsed));
    return this.#removedDone;
  }

  /**
   * For each new removal of a project: once the sessions of its tasks on this device stopped (the
   * claims check stops them), removes the clean worktrees and branches and keeps the others. A kept
   * item gets a system comment on its task and a log line.
   */
  async #removedProjects(): Promise<void> {
    const removals = this.service.view.removed_projects;
    if (removals.length === 0) return;
    const done = await this.#loadRemovedDone();
    let changed = false;
    for (const removal of removals) {
      if (done.has(removal.removed.event)) continue;
      const tasks = new Set(
        this.service.view.removed_tasks.filter((t) => t.project === removal.slug).map((t) => t.id),
      );
      const records = this.records.filter((r) => tasks.has(r.task));
      // A session that did not stop keeps its folder: the next check tries again.
      if (records.some((r) => r.state === "running")) continue;
      const targets = new Map<string, CleanupTarget>();
      for (const r of records) {
        targets.set(`${r.cwd}\0${r.branch ?? ""}`, {
          task: r.task,
          key: r.key,
          cwd: r.cwd,
          branch: r.branch,
          workIn: r.work_in ?? "worktree",
          host: r.host,
        });
      }
      const items: CleanupItem[] = [];
      for (const target of targets.values()) {
        try {
          items.push(
            await cleanupTarget(target, {
              removeHostWorktree: async (name, input) => {
                const host =
                  name === this.#tools.host.name ? this.#tools.host : this.#tools.hosts?.get(name);
                if (!host?.removeWorktree) return false;
                await host.removeWorktree(input);
                return true;
              },
            }),
          );
        } catch (error) {
          items.push({
            task: target.task,
            key: target.key,
            path: target.cwd,
            branch: target.branch,
            result: "kept",
            reason: (error as Error).message,
          });
        }
      }
      for (const task of tasks) {
        const text = keptComment(items.filter((i) => i.task === task));
        if (text !== null) await this.#buffer.now(task, "comment.added", { text }, this.#aw);
      }
      this.#log.info({ project: removal.slug, items }, "Cleaned the folders of a removed project");
      done.set(removal.removed.event, items);
      changed = true;
    }
    if (changed) {
      await mkdir(join(this.#settings.home, "removed"), { recursive: true, mode: 0o700 });
      await writeFile(this.#removedFile, `${JSON.stringify(Object.fromEntries(done))}\n`, {
        mode: 0o600,
      });
    }
  }

  /**
   * The cleanup of this device for one removal, after a check: the stop of the sessions, then the
   * worktrees and branches. Null when the check could not run it yet (a session did not stop).
   */
  async projectRemoved(event: string): Promise<CleanupItem[] | null> {
    await this.sync();
    return (await this.#loadRemovedDone()).get(event) ?? null;
  }

  /** A forced stop by a person (`aw session stop`). */
  stop(id: string): Promise<SessionRecord> {
    return this.#queue.add(async () => {
      const record = this.#records.get(id);
      if (!record) throw new ServiceError("not_found", `Session ${id}`);
      if (record.state === "running") await this.#stopSession(record, "stopped");
      return record;
    });
  }

  // ---- Reconcile and resume (design decision 15) -------------------------------------------

  async #panes(): Promise<void> {
    const running = this.#running();
    if (running.length === 0) return;
    // Only the tmux sessions need the tmux list; a host with find() (Orca) shows one pane.
    const panes = running.some((r) => !this.#tools.hosts?.has(r.host))
      ? await this.#tools.host.list()
      : [];
    const now = this.#clock.now();
    for (const record of running) {
      const task = this.#task(record.task);
      if (!task || task.claim?.session !== record.id) continue;
      try {
        // A host that cannot tell throws (Orca does not answer): AW neither resumes nor stops the
        // session then, because its agent can still run (design decision 4).
        let pane: PaneState | undefined;
        try {
          pane = await this.#paneOf(record, panes);
        } catch (error) {
          await this.#hostNotAnswering(record, error);
          continue;
        }
        await this.#hostAnswers(record);
        if (pane && !pane.dead) {
          // 10 min alive is progress: the resume count goes back to 0 (add-continuity, decision 2).
          if (
            (record.resumes > 0 || record.launch_waits > 0) &&
            record.opened_at !== undefined &&
            now - record.opened_at >= PROGRESS_ALIVE_MS
          ) {
            record.resumes = 0;
            record.launch_waits = 0;
            await this.#save(record);
          }
          continue;
        }
        // A usage limit: the resumed agent would stop at the limit again. AW waits for the reset.
        const usage = record.usage_pause;
        if (usage?.resets_at && now < usage.resets_at + CONTINUE_AFTER_RESET_MS) continue;
        // The adopt check reads the windows of tmux only: an Orca terminal has no `aw-<task>` name.
        await this.#resume(record, pane, this.#hostOf(record) === this.#tools.host ? panes : []);
      } catch (error) {
        this.#log.error({ err: error, session: record.id }, "The session did not resume");
      }
    }
  }

  /**
   * A host that cannot tell the state of a session (Orca does not answer): the session waits, and
   * after hostNoticeMs the task gets one comment with the cause (principle 2).
   */
  async #hostNotAnswering(record: SessionRecord, error: unknown): Promise<void> {
    const now = this.#clock.now();
    const message = ((error as Error)?.message ?? String(error)).slice(0, 500);
    const down = this.#hostDown.get(record.id) ?? { since: now, error: message, noticed: false };
    down.error = message;
    this.#hostDown.set(record.id, down);
    this.#log.warn({ session: record.id, err: error }, "The session host does not answer");
    if (down.noticed || now - down.since < this.#hostNoticeMs) return;
    const since = new Date(down.since).toISOString().slice(0, 16).replace("T", " ");
    await this.#buffer.now(
      record.task,
      "comment.added",
      {
        text: `${hostLabel(record.host)} does not answer on ${this.#me} since ${since} UTC: the session waits, and AW neither stops nor resumes it. Last error: ${message}`,
      },
      this.#aw,
    );
    // Only a written comment counts: after a failed write, the next check tries again.
    down.noticed = true;
  }

  async #hostAnswers(record: SessionRecord): Promise<void> {
    const down = this.#hostDown.get(record.id);
    if (!down) return;
    this.#hostDown.delete(record.id);
    if (!down.noticed) return;
    await this.#buffer.now(
      record.task,
      "comment.added",
      { text: `${hostLabel(record.host)} answers again on ${this.#me}: the session goes on.` },
      this.#aw,
    );
  }

  /** The agent has a conversation of the session: true, false, or undefined (cannot tell). */
  async #conversation(record: SessionRecord): Promise<boolean | undefined> {
    return this.#tools.adapter
      .hasConversation?.({ sessionId: record.id, cwd: record.cwd })
      .catch(() => undefined);
  }

  async #failed(record: SessionRecord, text: string): Promise<void> {
    record.state = "failed";
    await this.#save(record);
    // The agent process ended and no person stopped it: the session crashed (decision 37). Only the
    // owner writes the state, and only for the session that the task shows.
    const task = this.#task(record.task);
    if (task?.owner === this.#me && task.session?.session === record.id) {
      await this.#buffer.now(
        record.task,
        "session.ended",
        { session: record.id, reason: "crashed" },
        this.#aw,
      );
    }
    // The terminal of the session host: tmux attach, or the Orca worktree (integrate-continuity).
    const hint = this.#terminalHint(record);
    await this.#buffer.now(record.task, "comment.added", { text: `${text} ${hint}.` }, this.#aw);
    // The human decides (docs/architecture.md 4.6.4 item 4): "Resume again" sets the session
    // running again, and the next pane check resumes it.
    await this.#takeOverGate(
      record,
      `${text}\n\n${hint}. Fix the cause, then answer "Resume again", or "Leave it stopped".`,
      ["Resume again", "Leave it stopped"],
    );
  }

  /** Opens "Take over terminal" for the session, unless one is open. */
  async #takeOverGate(record: SessionRecord, text: string, options: string[]): Promise<void> {
    const task = this.#task(record.task);
    if (task?.gates.some((g) => g.kind === "take_over_terminal" && g.state === "open")) return;
    await this.#buffer.now(
      record.task,
      "gate.opened",
      {
        gate: newId(this.#clock),
        kind: "take_over_terminal",
        version: 1,
        title: "Take over terminal",
        text,
        options,
      },
      this.#aw,
    );
  }

  /**
   * A live window of the task that is not the stored pane (awd was killed between the window open
   * and the record save): AW adopts it when its process runs this session id, else stops it, so one
   * task never has 2 windows (review item 5). Returns true when AW adopted a window.
   */
  async #adoptOrStop(record: SessionRecord, panes: PaneState[]): Promise<boolean> {
    const name = `aw-${record.task}`;
    for (const pane of panes) {
      if (pane.name !== name || pane.dead) continue;
      if (record.pane && pane.pane === record.pane.pane && pane.pid === record.pane.pid) continue;
      const info = await processInfo(pane.pid);
      if (info === null) continue;
      const ref: PaneRef = {
        host: this.#tools.host.name,
        window: pane.window,
        pane: pane.pane,
        pid: pane.pid,
        pgid: info.pgid,
      };
      if (runsSession(info.args, record.id)) {
        record.pane = ref;
        record.opened_at = this.#clock.now();
        await this.#save(record);
        this.#log.info({ session: record.id, pane: pane.pane }, "Session window adopted");
        return true;
      }
      this.#log.warn(
        { session: record.id, pane: pane.pane },
        "An unknown window of the task stops",
      );
      await this.#tools.host.stop(ref, { graceMs: 1000 });
      await this.#tools.host.close(ref);
    }
    return false;
  }

  /**
   * Resumes a session whose pane is dead (`pane`) or gone (no pane), by the resume policy
   * (add-continuity, decisions 2 to 6). A session with no conversation yet starts again with
   * `--session-id` and its first input (not a resume).
   */
  async #resume(
    record: SessionRecord,
    pane: PaneState | undefined,
    panes: PaneState[],
  ): Promise<void> {
    const now = this.#clock.now();
    const plan = resumePlan({
      now,
      status: pane ? (pane.status ?? -1) : null,
      firstSeen: record.first_seen,
      started: record.started,
      conversation: await this.#conversation(record),
      resumes: record.resumes,
      resumeTimes: record.resume_times,
      restarts: record.restarts,
      launchWaits: record.launch_waits,
      openedAt: record.opened_at,
    });
    if (plan.action === "wait") return;
    if (plan.action === "failed") {
      await this.#failed(record, plan.text);
      return;
    }
    const why = pane ? `exit ${pane.status ?? "?"}` : "no window";
    const host = this.#hostOf(record);
    if (record.pane && pane) {
      // A background command of the dead agent keeps running in its process group: stop it, so
      // the resumed agent does not run the same step twice (docs/phase-1.md 9.7). With no window
      // (a reboot, a tmux kill-server), the stored pids can belong to other programs now: AW
      // signals nothing then.
      await host.stop(record.pane, { graceMs: 1000 });
      await host.close(record.pane);
    } else if (record.pane && host.find) {
      // The host still knows the handle, but with another process (another incarnation): close it
      // with no signal, so the old terminal does not stay next to the new one.
      await host.close(record.pane);
    }
    if (await this.#adoptOrStop(record, panes)) return;
    record.launch_waits = plan.counted ? 0 : record.launch_waits + 1;
    // The window opened before the boot of this computer: a reboot (the restart comment).
    const opened = record.pane?.opened;
    if (!pane && opened !== undefined && this.#bootMs > 0 && opened < this.#bootMs) {
      record.restart_boot = this.#bootMs;
      await this.#pause(record.task, {
        cause: "device_restart",
        next_step: `${this.#me} restarted at ${shortTime(this.#bootMs, now)}. AW resumes the session.`,
        resumes_at: null,
        needs_human: false,
      });
    }
    const paths = sessionPaths(this.#settings.home, record.id);
    const pending = record.pending_tool;
    record.pending_tool = null;
    if (plan.action === "fresh") {
      if (plan.counted) record.restarts++;
      if (plan.lost) {
        // The transcript is gone: the first input again, with a note (review item 3).
        const first = await readFile(paths.firstInput, "utf8").catch(() => "");
        await writePrivate(
          paths.continueInput,
          `${first}\n\n${lostNote(record.key ?? record.task)}`,
        );
        record.resumes = 0;
        record.resume_times = [];
        this.#log.info(
          { session: record.id, why },
          "Session starts again: the conversation is lost",
        );
        await this.#open(record, "new", paths.continueInput);
        return;
      }
      this.#log.info(
        { session: record.id, why, restarts: record.restarts },
        "Session starts again",
      );
      await this.#open(record, "new");
      return;
    }
    if (plan.message === "continue") {
      const at = new Date(now).toISOString();
      await writePrivate(paths.continueInput, continueMessage(at, pending));
    }
    if (plan.counted) {
      record.resumes++;
      record.resume_times = [...recentResumes(record.resume_times, now), now];
    }
    this.#log.info({ session: record.id, why, resumes: record.resumes }, "Session resumes");
    // No prompt reached the agent yet: the first input is the message (review item 4).
    await this.#open(record, "resume", plan.message === "first" ? paths.firstInput : undefined);
  }

  // ---- Pauses (add-continuity, decision 8) ---------------------------------------------------

  /** Writes `task.paused` when the cause or the text changed. */
  async #pause(task: string, input: PauseInput): Promise<void> {
    const view = this.#task(task);
    if (!view || view.owner !== this.#me || !pauseChanged(view.paused, input)) return;
    await this.#buffer.now(task, "task.paused", pauseData(input), this.#aw);
  }

  /** Writes `task.resumed` when the task has a pause of one of these causes. */
  async #unpause(task: string, causes: readonly PauseCause[]): Promise<void> {
    const view = this.#task(task);
    if (!view || view.owner !== this.#me || !pausedBy(view.paused, causes)) return;
    await this.#buffer.now(task, "task.resumed", {}, this.#aw);
  }

  // ---- Spool and hooks (design decisions 2 to 5) -------------------------------------------

  async #drainSpools(): Promise<void> {
    for (const record of this.records) {
      if (!(await this.#drainSpool(record))) return;
    }
  }

  /**
   * Handles the spool files of one session in name order. A file moves to `spool/done/` only after
   * each event of it is in the log (no event is lost when awd is killed). Returns false when the
   * workspace is not ready.
   */
  async #drainSpool(record: SessionRecord): Promise<boolean> {
    const dir = sessionPaths(this.#settings.home, record.id).spool;
    const files = await readSpool(dir);
    if (files.length === 0) return true;
    // The watchdog counts from the last hook event (add-continuity).
    this.#lastEvent.set(record.id, this.#clock.now());
    if (!this.service.ready) return false;
    for (const file of files) {
      if (file.entry) {
        try {
          await this.#hook(
            record,
            file.entry.event,
            file.entry.payload,
            file.entry.gate,
            this.#hookWrite(record, file.name, file.entry.at),
            file.entry.denied,
          );
        } catch (error) {
          this.#log.error({ err: error, file: file.name }, "A hook event was not written");
          if (!(error instanceof ServiceError && error.code === "written_not_merged")) {
            // The file stays first in the queue: the next tick tries again. A file that always
            // fails moves to spool/failed/, so the later events of the session go on.
            const tries = (this.#spoolFailures.get(file.name) ?? 0) + 1;
            this.#spoolFailures.set(file.name, tries);
            if (tries < SPOOL_ATTEMPTS) break;
            this.#spoolFailures.delete(file.name);
            this.#spoolSteps.delete(file.name);
            await markFailed(dir, file.name);
            await this.#buffer
              .now(
                record.task,
                "comment.added",
                {
                  text: `AW could not handle the ${file.entry.event} hook event of session ${record.id} after ${SPOOL_ATTEMPTS} tries: ${((error as Error)?.message ?? String(error)).slice(0, 1000)}. The file is in spool/failed/${file.name}.`,
                },
                this.#aw,
              )
              .catch((second: unknown) => {
                this.#log.error({ err: second }, "The spool failure was not written");
              });
            continue;
          }
        }
      } else {
        this.#log.warn({ file: file.name }, "A spool file does not parse");
      }
      this.#spoolFailures.delete(file.name);
      this.#spoolSteps.delete(file.name);
      await markDone(dir, file.name);
    }
    await this.#save(record);
    return true;
  }

  /**
   * The event writes of one spool file: each one at once (not in the 1-second buffer), and each
   * step once. The event id of a step comes from the spool file and the step name, so a retry of
   * the file (a later step failed, or awd was killed before the file moved to `spool/done/`) finds
   * the event of the first try in the log and does not write it again.
   */
  #hookWrite(record: SessionRecord, file: string, at: number): HookWrite {
    const eventId = (step: string) => hookEventId(at, `${record.id}/${file}/${step}`);
    const write = async <T extends EventType>(
      step: string,
      type: T,
      data: EventData<T>,
      by: string,
    ): Promise<void> => {
      const steps = this.#spoolSteps.get(file) ?? new Set<string>();
      if (steps.has(step)) return;
      const id = eventId(step);
      const written = this.service.index
        .find<EventRow>("events", { task: record.task })
        .some((r) => r.id === id);
      if (!written) {
        try {
          await this.#buffer.now(record.task, type, data, by, { id });
        } catch (error) {
          // The event is in the log of this device; the next merge applies it.
          if (!(error instanceof ServiceError && error.code === "written_not_merged")) throw error;
        }
      }
      steps.add(step);
      this.#spoolSteps.set(file, steps);
    };
    return Object.assign(write, { eventId });
  }

  /**
   * Warns once for each agent session id that is not the id of this session: the hook events of
   * another Claude session (a child process with `AW_SESSION`, a new conversation) come into this
   * task. awd keeps the events (openspec agent-pushes-updates, the decision of the maintainer).
   */
  async #checkHookSession(record: SessionRecord, payload: unknown, write: HookWrite) {
    const id = this.#tools.adapter.hookSessionId?.(payload) ?? null;
    if (id === null || id === record.id || record.foreign_sessions.includes(id)) return;
    await write(
      `foreign-session/${id}`,
      "comment.added",
      {
        text: `Hook events of another Claude session (${id.slice(0, 8)}) arrive in this session. AW keeps them. Check the terminal of this task.`,
      },
      this.#aw,
    );
    record.foreign_sessions.push(id);
  }

  async #hook(
    record: SessionRecord,
    event: string,
    payload: unknown,
    gate: string | null,
    write: HookWrite,
    denied: string | null = null,
  ) {
    const parsed: AgentHookEvent = this.#tools.adapter.parseHook(event, payload);
    const task = record.task;
    const agent = this.#agentActor(record);
    await this.#checkHookSession(record, payload, write);
    if (parsed.kind !== "notification" && parsed.kind !== "permission") record.notification = null;
    // The agent works again: a usage or agent-error pause ends (add-continuity, decision 8).
    if (parsed.kind === "prompt" || parsed.kind === "tool_start" || parsed.kind === "tool_end") {
      await this.#active(record);
    }
    switch (parsed.kind) {
      case "session_start": {
        // A SessionStart alone is no progress: an agent that dies after it must not resume
        // forever (review item 1). Progress is a Stop or a PostToolUse hook, or 10 min alive.
        record.busy = false;
        if (record.restart_boot !== null) {
          const boot = record.restart_boot;
          record.restart_boot = null;
          await this.#unpause(task, ["device_restart"]);
          const now = this.#clock.now();
          await write(
            "restarted",
            "comment.added",
            {
              text: `${this.#me} restarted at ${shortTime(boot, now)}. AW resumed the session at ${shortTime(now, now)}.`,
            },
            this.#aw,
          );
        }
        if (record.pane) {
          this.#startedPanes.set(record.id, record.pane.pane);
          record.ready_pane = record.pane.pane;
        }
        if (parsed.source === "startup" && !record.started) {
          const t = this.#task(task);
          await write(
            "started",
            "session.started",
            {
              session: record.id,
              host: record.host === "orca" ? "orca" : "tmux",
              cwd: record.cwd,
              plugin_dir: record.launch.plugin_dir,
              branch: record.branch,
              credentials: t?.credentials ?? [],
              pids: {
                pane: record.pane?.pid ?? null,
                claude: record.pane?.pid ?? null,
                pgid: record.pane?.pgid ?? null,
              },
              permission_mode: permissionModeOf(record.launch.permission_mode),
              agent_teams: record.launch.agent_teams ?? false,
              work_in: record.work_in ?? "worktree",
              // The link of the task to its agent session and terminal (agent-pushes-updates).
              name: record.launch.name || null,
              terminal: { window: record.pane?.window || null, pane: record.pane?.pane || null },
            },
            this.#aw,
          );
          record.started = true;
        } else if (parsed.source === "compact") {
          const time = new Date(this.#clock.now()).toISOString().slice(11, 16);
          await write(
            "compact",
            "comment.added",
            { text: `Context compacted at ${time} UTC.` },
            this.#aw,
          );
        }
        return;
      }
      case "prompt":
        return this.#prompt(record, parsed.text, write);
      case "tool_start":
        if (denied !== null) {
          // The AW guard denied the call in the hook: no tool runs (openspec session-options).
          const summary = toolSummary(parsed.tool, parsed.input, this.#redact);
          await write(
            "denied",
            "comment.added",
            { text: `AW denied ${parsed.tool}: ${summary}. Reason: ${denied}.`.slice(0, 2000) },
            this.#aw,
          );
          return;
        }
        record.pending_tool = {
          tool: parsed.tool,
          summary: toolSummary(parsed.tool, parsed.input, this.#redact),
          id: parsed.toolUseId,
        };
        if (parsed.gate && gate) await this.#toolGate(record, parsed.gate, gate, write);
        return;
      case "tool_end":
        this.#progress(record);
        if (
          record.pending_tool &&
          (!parsed.toolUseId || record.pending_tool.id === parsed.toolUseId)
        ) {
          record.pending_tool = null;
        }
        return;
      case "notification":
        record.notification = parsed.type || null;
        // An idle prompt: the turn ended, also after an interrupt with no Stop hook.
        if (parsed.type === "idle_prompt") record.busy = false;
        await this.#quotaNotification(record, parsed.type);
        return;
      case "stop": {
        record.pending_tool = null;
        record.busy = false;
        this.#progress(record);
        if (record.agent_errors > 0 || record.agent_retry !== null) {
          record.agent_errors = 0;
          record.agent_retry = null;
          await this.#unpause(task, ["agent_error"]);
        }
        // The text of the turn: Session only. The agent sends its updates with AW calls (openspec
        // agent-pushes-updates).
        await write(
          "message",
          "message.agent",
          { text: parsed.text, session: record.id, source: "turn" },
          agent,
        );
        this.#checkpoint(record);
        // Done at the first Stop after "Result approved", or after `aw done` (docs/workflow.md 4.10).
        const ended = await this.#work.stopped(record, write);
        // The next Stop ends a turn that started after each of these texts.
        record.busy_deliveries = [];
        if (ended) return;
        if (!this.#turnGateOpen(record) && endsWithQuestion(parsed.text)) {
          // A new question replaces the older open questions (openspec proposal-and-discussion).
          await this.#replaceQuestions(record.task, "Replaced by a newer question");
          await write(
            "reply",
            "gate.opened",
            {
              gate: newId(this.#clock),
              kind: "reply",
              version: 1,
              title: this.#redact(parsed.text).trim().split("\n").at(-1)!.slice(0, 500),
              text: parsed.text,
            },
            agent,
          );
          return;
        }
        await this.#nudge(record, write);
        return;
      }
      case "stop_failure":
        record.busy = false;
        if (/rate_limit/i.test(parsed.error)) await this.#usageLimit(record, write);
        else await this.#agentError(record, parsed.error, write);
        return;
      case "session_end":
        if (parsed.reason === "prompt_input_exit" || parsed.reason === "logout") {
          record.state = "ended";
          await write(
            "ended",
            "session.ended",
            { session: record.id, reason: "stopped" },
            this.#aw,
          );
        }
        return;
      default:
        return;
    }
  }

  // ---- Usage limits and agent errors (add-continuity, decisions 9 and 10) -------------------

  /** Progress of the agent: the resume count goes back to 0 (review item 1). */
  #progress(record: SessionRecord): void {
    record.resumes = 0;
    record.launch_waits = 0;
  }

  /** The agent works again: the usage and agent-error pauses end. */
  async #active(record: SessionRecord): Promise<void> {
    if (record.usage_pause && record.usage_pause.cause !== "continue_cap") {
      record.usage_pause = null;
    }
    record.agent_retry = null;
    const task = this.#task(record.task);
    if (task && pausedBy(task.paused, ACTIVE_ENDS) && record.usage_pause === null) {
      await this.#unpause(record.task, ACTIVE_ENDS);
    }
  }

  async #usageLimit(record: SessionRecord, write: HookWrite): Promise<void> {
    const now = this.#clock.now();
    const usage = await readUsage(sessionPaths(this.#settings.home, record.id).usage);
    this.#usage.set(record.id, usage);
    const plan = limitPlan(usage, now);
    // AW continues by itself for a weekly limit, or when the auto continue of Claude Code is off.
    let continueAt = plan.continueAt;
    if (continueAt === null && record.auto_resume_disabled && plan.resetsAt !== null) {
      continueAt = plan.resetsAt + CONTINUE_AFTER_RESET_MS;
    }
    if (continueAt !== null && record.continues >= MAX_CONTINUES) {
      record.usage_pause = { cause: "continue_cap", resets_at: plan.resetsAt, continue_at: null };
      const at =
        plan.resetsAt === null ? "" : ` The limit resets ${shortTime(plan.resetsAt, now)}.`;
      await this.#pause(record.task, {
        cause: "continue_cap",
        next_step: `${MAX_CONTINUES} automatic continues used.${at} Answer "Continue after usage limit".`,
        resumes_at: plan.resetsAt,
        needs_human: true,
      });
      const task = this.#task(record.task);
      if (!task?.gates.some((g) => g.kind === "continue_after_limit" && g.state === "open")) {
        await write(
          "cap-gate",
          "gate.opened",
          {
            gate: newId(this.#clock),
            kind: "continue_after_limit",
            version: 1,
            title: "Continue after usage limit",
            text: `AW continued this session ${MAX_CONTINUES} times after a usage limit.${at} "Continue" sends the agent on after the reset; "Wait" leaves it paused.`,
            options: ["Continue", "Wait"],
          },
          this.#aw,
        );
      }
      return;
    }
    record.usage_pause = { cause: plan.cause, resets_at: plan.resetsAt, continue_at: continueAt };
    const text =
      continueAt !== null && plan.cause === "usage_limit"
        ? `Usage limit. Resumes at ${shortTime(plan.resetsAt!, now)}: AW continues the session (continue ${record.continues + 1} of ${MAX_CONTINUES}).`
        : limitText(plan, now, record.continues);
    await this.#pause(record.task, {
      cause: plan.cause,
      next_step: text,
      resumes_at: plan.resetsAt,
      needs_human: false,
    });
  }

  async #agentError(record: SessionRecord, error: string, write: HookWrite): Promise<void> {
    const now = this.#clock.now();
    record.agent_errors++;
    const hint = this.#terminalHint(record);
    if (record.agent_errors >= AGENT_RETRY_MS.length) {
      record.agent_retry = null;
      await this.#pause(record.task, {
        cause: "agent_error",
        next_step: `Agent error (${error}) ${record.agent_errors} times in a row. Take over the terminal. ${hint}.`,
        resumes_at: null,
        needs_human: true,
      });
      const task = this.#task(record.task);
      if (!task?.gates.some((g) => g.kind === "take_over_terminal" && g.state === "open")) {
        await write(
          "error-gate",
          "gate.opened",
          {
            gate: newId(this.#clock),
            kind: "take_over_terminal",
            version: 1,
            title: "Take over terminal",
            text: `The agent failed ${record.agent_errors} times in a row (${error}). ${hint}. Send the agent on, then answer "Done".`,
            options: ["Done"],
          },
          this.#aw,
        );
      }
      return;
    }
    const at = now + AGENT_RETRY_MS[record.agent_errors - 1]!;
    record.agent_retry = { at, error: error.slice(0, 200) };
    await this.#pause(record.task, {
      cause: "agent_error",
      next_step: `Agent error (${error.slice(0, 200)}). AW retries at ${shortTime(at, now)}.`,
      resumes_at: at,
      needs_human: false,
    });
  }

  /** The quota notifications of Claude Code (docs/architecture.md 4.6.6 items 2 and 3). */
  async #quotaNotification(record: SessionRecord, type: string): Promise<void> {
    if (type === "quota_auto_resume_fired") {
      // Claude Code continued by itself after the reset.
      record.usage_pause = null;
      await this.#unpause(record.task, ["usage_limit", "usage_limit_weekly"]);
    } else if (type === "quota_auto_resume_stale" && record.pane && this.#readsScreen(record)) {
      await this.#hostOf(record).keys(record.pane, ["Enter"]);
    } else if (type === "quota_auto_resume_disabled" || type === "quota_auto_resume_stale") {
      // A host that sends no keys (Orca) cannot press Enter: AW continues after the reset, as for
      // a disabled auto continue (integrate-continuity).
      record.auto_resume_disabled = true;
      const pause = record.usage_pause;
      if (
        pause?.cause === "usage_limit" &&
        pause.resets_at !== null &&
        pause.continue_at === null
      ) {
        pause.continue_at = pause.resets_at + CONTINUE_AFTER_RESET_MS;
      }
    }
  }

  /**
   * The notice after a turn with no AW update (openspec agent-pushes-updates, design D3 and D4):
   * the text of a turn goes only to the Session tab, so the agent sends its update through AW. At
   * most one per turn, never after the turn of a nudge, and not when a person typed in the terminal
   * (that person reads the terminal) or an open gate already waits for the person.
   */
  async #nudge(record: SessionRecord, write: HookWrite): Promise<void> {
    const task = this.#task(record.task);
    if (!task || task.stage === "done" || task.archived) return;
    if (task.gates.some((g) => g.state === "open")) return;
    const rows = this.#rows(task.id);
    let at = rows.length - 1;
    while (at >= 0) {
      const r = rows[at]!;
      if (
        (r.type === "message.human" || r.type === "session.resumed") &&
        data(r).session === record.id
      )
        break;
      at--;
    }
    if (at < 0) return;
    const start = rows[at]!;
    if (start.type === "message.human") {
      const { source, delivery_id: delivery } = data(start);
      if (source === "typed" && (delivery === null || delivery === undefined)) return;
      const nudged = (r: EventRow) =>
        r.type === "message.sent" && data(r).id === delivery && data(r).kind === "nudge";
      if (source === "notice" && rows.some(nudged)) return;
    }
    const actor = this.#agentActor(record);
    const updated = rows
      .slice(at + 1)
      .some(
        (r) =>
          (r.event as { by?: string }).by === actor &&
          UPDATE_TYPES.has(r.type) &&
          (r.type !== "message.agent" || data(r).source === "tool"),
      );
    if (updated) return;
    const id = write.eventId("nudge");
    await write(
      "nudge",
      "message.sent",
      { id, text: NUDGE_TEXT, to_session: record.id, kind: "nudge" },
      this.#aw,
    );
  }

  /**
   * True when a gate that waits for the answer to this turn is open: a question, a proposal or a
   * reply of this session, opened after its last `message.human` (the start of the turn). An
   * "Approve command" gate after its timeout, or a gate that the human answered in the terminal,
   * does not stop the Reply gate of a later turn.
   */
  #turnGateOpen(record: SessionRecord): boolean {
    const task = this.#task(record.task);
    if (!task) return false;
    const rows = this.#rows(task.id);
    const start =
      rows.filter((r) => r.type === "message.human" && data(r).session === record.id).at(-1) ??
      rows.find((r) => r.id === record.claim_event);
    return task.gates.some((g) => {
      if (g.state !== "open" || !TURN_GATES.has(g.kind)) return false;
      if (!start) return true;
      return compareOrder({ hlc: g.opened.hlc, dev: g.opened.dev, id: g.opened.event }, start) > 0;
    });
  }

  async #prompt(record: SessionRecord, text: string, write: HookWrite): Promise<void> {
    const task = record.task;
    const wasBusy = record.busy;
    record.busy = true;
    if (text.startsWith(RESUME_PREFIX)) {
      await write(
        "resumed",
        "session.resumed",
        {
          session: record.id,
          text,
          // The new pane of the resume (agent-pushes-updates).
          terminal: { window: record.pane?.window || null, pane: record.pane?.pane || null },
          pids: {
            pane: record.pane?.pid ?? null,
            claude: record.pane?.pid ?? null,
            pgid: record.pane?.pgid ?? null,
          },
        },
        this.#aw,
      );
      return;
    }
    const answer = /^\[AW answer ([0-9a-f-]{36})\]/.exec(text);
    const message = /^\[AW message ([0-9a-f-]{36}) from ([a-z0-9-]+)\]/.exec(text);
    const notice = /^\[AW notice ([0-9a-f-]{36})\]/.exec(text);
    let source: "first" | "typed" | "answer" | "phone" | "notice" = "typed";
    let delivery: string | null = null;
    let actor = `human@${this.#me}`;
    if (answer) {
      source = "answer";
      delivery = answer[1]!;
      actor = this.#answerAuthor(task, delivery) ?? actor;
    } else if (notice) {
      // A text of AW itself (add-task-loop decision 3), also a notice that is the first input.
      source = "notice";
      delivery = notice[1]!;
      actor = this.#aw;
    } else if (message) {
      delivery = message[1]!;
      const device = message[2]!;
      const role = this.service.view.devices.find((d) => d.slug === device)?.role;
      source = role === "mobile" ? "phone" : "typed";
      actor = `human@${device}`;
    } else if (!record.first_seen) {
      const file = sessionPaths(this.#settings.home, record.id).firstInput;
      const first = await readFile(file, "utf8").catch(() => null);
      // A long first input reaches the agent as a short text that names its file (aw-launch).
      if (first !== null && (first === text || launchMessage(first, file) === text)) {
        source = "first";
      }
    }
    record.first_seen = true;
    if (delivery) this.#attempts.delete(delivery);
    // A message of the person after "Wait" of "Continue after usage limit" ends that pause (0h).
    if (
      (source === "typed" || source === "phone") &&
      record.usage_pause?.cause === "continue_cap"
    ) {
      record.usage_pause = null;
      record.continues = 0;
      await this.#unpause(task, ["continue_cap"]);
    }
    if (delivery && wasBusy) record.busy_deliveries = [...record.busy_deliveries, delivery];
    await write(
      "human",
      "message.human",
      { text, source, session: record.id, delivery_id: delivery },
      actor,
    );
  }

  /** The person of the answer that resolved the gate, else of the denial. */
  #answerAuthor(task: string, gate: string): string | null {
    const view = this.#task(task)?.gates.find((g) => g.gate === gate);
    const used = view?.answers.find((a) => a.use === "used") ?? view?.answers.at(-1);
    return used?.by ?? null;
  }

  async #toolGate(
    record: SessionRecord,
    gate: ToolGate,
    id: string,
    write: HookWrite,
  ): Promise<void> {
    const task = this.#task(record.task);
    if (!task || task.gates.some((g) => g.gate === id)) return;
    const agent = this.#agentActor(record);
    if (gate.kind === "question") {
      await this.#replaceQuestions(record.task, "Replaced by a newer question");
      await write(
        "gate",
        "gate.opened",
        {
          gate: id,
          kind: "question",
          version: 1,
          // Redact the full title first, then cut it (fix list 0-41).
          title: this.#redact(gate.title).slice(0, 500),
          text: gate.text,
          options: gate.options,
          // Each question with its options and descriptions, cut to the schema limits after the
          // redaction (openspec gate-context).
          questions: (gate.questions ?? []).slice(0, 10).map((q) => ({
            question: this.#redact(q.question).slice(0, 2000),
            header: q.header === null ? null : this.#redact(q.header).slice(0, 100),
            multi_select: q.multi_select,
            options: q.options.slice(0, 20).map((o) => ({
              label: o.label.slice(0, 500),
              description: this.#redact(o.description).slice(0, 2000),
            })),
          })),
        },
        agent,
      );
      return;
    }
    // Idempotent: a retry of this spool file finds the version file of the first try (the
    // proposal files are write-once) and does not write it again.
    const read = (version: number) => this.#proposalVersion(record.task, version);
    const latest = task.proposal.latest;
    let version = latest + 1;
    // The version file is redacted (docs/phase-1.md 3.3.5): compare it with the redacted plan.
    const plan = this.service.files.redactText(gate.plan);
    if (latest > 0 && (await read(latest)) === plan) {
      version = latest;
    } else {
      const existing = await read(version);
      if (existing === null) {
        await this.service.writeTaskFile(`tasks/${record.task}/proposal/v${version}.md`, gate.plan);
      } else if (existing !== plan) {
        throw new Error(`proposal/v${version}.md exists with another text`);
      }
      // The plan is a new proposal: it replaces the open proposal and the open questions.
      await replaceOpen(
        { task, host: this.#loopHost() },
        "approve_proposal",
        `Replaced by proposal v${version}`,
      );
      await this.#replaceQuestions(record.task, `Replaced by proposal v${version}`);
      await write(
        "proposal",
        "proposal.proposed",
        { version, file: `proposal/v${version}.md` },
        agent,
      );
    }
    const file = `proposal/v${version}.md`;
    await write(
      "gate",
      "gate.opened",
      {
        gate: id,
        kind: "approve_proposal",
        version: 1,
        title: gate.title,
        text: gate.plan,
        options: [APPROVE],
        file,
      },
      agent,
    );
  }

  /** Resolves the open questions of a task: a new question or a proposal replaces them. */
  async #replaceQuestions(task: string, answer: string): Promise<void> {
    const view = this.#task(task);
    if (view) await replaceOpen({ task: view, host: this.#loopHost() }, "questions", answer);
  }

  // ---- Gates and delivery (design decisions 7 to 9) ----------------------------------------

  async #gatesAndDeliveries(): Promise<void> {
    for (const record of this.#running()) {
      const task = this.#task(record.task);
      if (!task || task.claim?.session !== record.id) continue;
      try {
        await this.#trust(record);
        await this.#resolveGates(record, task);
        await this.#continuity(record);
        const checked = this.#task(record.task);
        if (checked) await this.#work.check(record, checked);
        const fresh = this.#task(record.task);
        if (fresh) await this.#deliver(record, fresh);
      } catch (error) {
        this.#log.error({ err: error, session: record.id }, "The gate or delivery check failed");
      }
    }
  }

  /**
   * Answers the trust screen once per window, before the first SessionStart (design decision 13).
   * aw-launch writes the trust entry only for a covered Claude Code version: another version shows
   * the screen, and no hook reports it. The option order of that version is not known: AW presses
   * Enter only when the cursor is on "Yes, I trust this folder", and moves it down once at most
   * (one check per tick, so the screen can draw the move).
   */
  async #trust(record: SessionRecord): Promise<void> {
    const pane = record.pane;
    if (!pane || record.opened_at === undefined) return;
    if (!this.#readsScreen(record)) {
      await this.#noStartNotice(record, pane);
      return;
    }
    const host = this.#hostOf(record);
    const state = this.#trustAnswered.get(pane.pane);
    if (this.#startedPanes.get(record.id) === pane.pane || state === "done") return;
    if (this.#clock.now() - record.opened_at > TRUST_WINDOW_MS) return;
    const screen = await host.capture(pane, 0).catch(() => "");
    const cursor = trustCursor(screen);
    if (cursor === null) return;
    if (cursor === "yes") {
      // AW created this worktree: "Yes, I trust this folder".
      this.#trustAnswered.set(pane.pane, "done");
      await host.keys(pane, ["Enter"]);
      this.#log.info({ session: record.id }, "Trust screen answered");
      return;
    }
    if (state === undefined) {
      this.#trustAnswered.set(pane.pane, "down");
      await host.keys(pane, ["Down"]);
      return;
    }
    // The cursor is not on "Yes" after one move: AW does not guess, the human answers.
    this.#trustAnswered.set(pane.pane, "done");
    this.#log.warn({ session: record.id }, "The trust screen has an unknown layout");
    await this.#buffer.now(
      record.task,
      "comment.added",
      {
        text: `The agent shows a trust screen that AW cannot answer. Answer it in the terminal. ${this.#terminalHint(record)}.`,
      },
      this.#aw,
    );
  }

  /**
   * AW never reads the screen of Orca: aw-launch pre-trusts the worktree, and only a covered
   * Claude Code version runs in Orca (docs/phase-1.md 9.9.4). A window with no SessionStart after
   * hostNoticeMs gets one comment: something on the screen (a dialog) can wait for a person.
   */
  async #noStartNotice(record: SessionRecord, pane: PaneRef): Promise<void> {
    if (record.ready_pane === pane.pane || this.#trustAnswered.get(pane.pane) === "done") return;
    if (this.#clock.now() - record.opened_at! <= this.#hostNoticeMs) return;
    this.#trustAnswered.set(pane.pane, "done");
    this.#log.warn({ session: record.id }, "No SessionStart in the window");
    await this.#buffer.now(
      record.task,
      "comment.added",
      {
        text: `The agent did not start in ${Math.round(this.#hostNoticeMs / 1000)} s: AW does not read the screen of ${hostLabel(record.host)}, so a dialog there can wait for an answer. ${this.#terminalHint(record)}.`,
      },
      this.#aw,
    );
  }

  async #resolveGates(record: SessionRecord, task: TaskView): Promise<void> {
    for (const gate of task.gates) {
      if (gate.state !== "open") continue;
      // The work loop resolves these with the knowledge store, also with no session.
      if (gate.kind === "approve_knowledge") continue;
      const answer = gate.answers.find((a) => a.use === "pending" && a.version === gate.version);
      if (!answer) continue;
      await this.#buffer.now(
        task.id,
        "gate.resolved",
        {
          gate: gate.gate,
          version: gate.version,
          answer_event: answer.event,
          answer: answer.answer,
        },
        this.#aw,
      );
      await this.#work.resolved(this.#task(task.id) ?? task, gate, answer.answer);
      await this.#continuityResolved(record, gate, answer.answer);
      if (gate.kind === "approve_command") {
        const decision = decisionOf(answer.answer, answer.by, answer.comment);
        const answered = this.#waits.settle(record.id, gate.gate, decision);
        if (answered === 0 && isAllow(answer.answer)) await this.#approve(record, task, gate);
        if (/^allow for this task/i.test(answer.answer)) await this.#addRule(record, task, gate);
      }
    }
  }

  /** The tool and the input hash of a permission gate, from its `gate.opened` event. */
  #gateRequest(task: string, gate: string): { tool: string; hash: string } | null {
    const row = this.#rows(task).find((r) => r.type === "gate.opened" && data(r).gate === gate);
    const request = row
      ? (data(row).request as
          { tool?: string; input_sha256?: string; input?: Record<string, unknown> } | undefined)
      : undefined;
    if (!request?.tool) return null;
    const hash =
      request.input_sha256 ?? (request.input ? inputHash(request.tool, request.input) : null);
    return hash ? { tool: request.tool, hash } : null;
  }

  /** The full input of a permission gate, from the session folder (written at the gate open). */
  async #requestInput(
    record: SessionRecord,
    gate: string,
  ): Promise<Record<string, unknown> | null> {
    const file = join(sessionPaths(this.#settings.home, record.id).requests, `${gate}.json`);
    try {
      return (JSON.parse(await readFile(file, "utf8")) as { input: Record<string, unknown> }).input;
    } catch {
      return null;
    }
  }

  /** A late "Allow": a one-time approval of the same tool and input. */
  async #approve(record: SessionRecord, task: TaskView, gate: GateView): Promise<void> {
    const request = this.#gateRequest(task.id, gate.gate);
    if (!request || record.approvals.some((a) => a.gate === gate.gate)) return;
    record.approvals.push({
      gate: gate.gate,
      tool: request.tool,
      input: request.hash,
      used: false,
    });
    await this.#save(record);
  }

  async #addRule(record: SessionRecord, task: TaskView, gate: GateView): Promise<void> {
    const request = this.#gateRequest(task.id, gate.gate);
    if (!request) return;
    // A rule is for one command, one file or one input: with no stored input, AW adds no rule
    // (never "any Bash" or "any Write", final check fc1-9).
    const input = await this.#requestInput(record, gate.gate);
    if (input === null) {
      this.#log.warn({ session: record.id, gate: gate.gate }, "No stored input for the rule");
      return;
    }
    const command = ruleKey(request.tool, input);
    if (!record.rules.some((r) => r.tool === request.tool && r.command === command)) {
      record.rules.push({ tool: request.tool, command });
      await this.#save(record);
    }
  }

  /** The texts that the session must get: answers of its gates and messages to it, in order. */
  #deliveries(record: SessionRecord, task: TaskView): DeliveryItem[] {
    const rows = this.#rows(task.id);
    const confirmed = new Set(
      rows
        .filter((r) => r.type === "message.human")
        .map((r) => data(r).delivery_id)
        .filter((id): id is string => typeof id === "string"),
    );
    const claimRow = rows.find((r) => r.id === record.claim_event);
    const items: DeliveryItem[] = [];
    for (const gate of task.gates) {
      if (gate.state !== "resolved" || gate.resolved_by !== this.#me || confirmed.has(gate.gate))
        continue;
      const resolved = rows.find(
        (r) => r.type === "gate.resolved" && r.applied && data(r).gate === gate.gate,
      );
      if (!resolved) continue;
      // AW closed the gate with no answer of a person (a new proposal or result replaced it):
      // the agent made that change itself, so no "[AW answer]" goes to it (gate-full-context
      // open issue 2).
      // The same for a gate that AW closed because no session can use it (openspec stale-gates).
      const closeAnswer = String(data(resolved).answer);
      if (
        data(resolved).answer_event === null &&
        (gate.answers.length === 0 || isCloseAnswer(closeAnswer) || isReplacedAnswer(closeAnswer))
      ) {
        continue;
      }
      if (claimRow) {
        const opened = { hlc: gate.opened.hlc, dev: gate.opened.dev, id: gate.opened.event };
        const earlier = compareOrder(opened, claimRow) < 0;
        // A gate of an earlier session that was resolved before this claim: that session got
        // its answer. A permission gate of an earlier session: its tool call ended with that
        // agent. An answer that came after the claim (a move, or a new session on this device)
        // goes to this session: the gate is open in its SessionStart context.
        if (earlier && (compareOrder(resolved, claimRow) < 0 || gate.kind === "approve_command")) {
          continue;
        }
      }
      const text = this.#answerText(task, gate, resolved);
      if (text !== null) items.push({ id: gate.gate, text, order: resolved });
    }
    for (const row of rows) {
      if (row.type !== "message.sent") continue;
      const d = data(row);
      if (d.to_session !== record.id || typeof d.id !== "string" || confirmed.has(d.id)) continue;
      // A notice that was the first input of this session is not pasted again.
      if (record.first_delivery === d.id) continue;
      const by = (row.event as { by?: string }).by ?? "";
      const body = typeof d.text === "string" ? d.text : "";
      items.push({
        id: d.id,
        text: by.startsWith("aw@")
          ? `[AW notice ${d.id}] ${body}`
          : `[AW message ${d.id} from ${row.dev}] ${body}`,
        order: row,
      });
    }
    return items.sort((a, b) => compareOrder(a.order, b.order));
  }

  #answerText(task: TaskView, gate: GateView, resolved: EventRow): string | null {
    // The human took over the terminal: no text goes into it (add-continuity). "Continue after
    // usage limit" acts on the session itself: a text would start a turn before the reset (0h).
    if (gate.kind === "take_over_terminal" || gate.kind === "continue_after_limit") return null;
    const used = gate.answers.find((a) => a.use === "used");
    const answer = used?.answer ?? gate.answer ?? "";
    const prefix = `[AW answer ${gate.gate}]`;
    if (gate.kind === "approve_command") {
      const late = hlcMs(resolved.hlc) - hlcMs(gate.opened.hlc) > this.#waits.timeoutMs;
      if (isAllow(answer)) return late ? `${prefix} Approved: run it again.` : null;
      const decision = decisionOf(answer, used?.by ?? null, used?.comment ?? null) as {
        message: string;
      };
      return `${prefix} ${decision.message}`;
    }
    const note = this.#work.answerNote(task, gate, answer);
    const body = used?.comment ? `${prefix} ${answer}\n\n${used.comment}` : `${prefix} ${answer}`;
    return note ? `${body}\n\n${note}` : body;
  }

  /**
   * Why a text cannot go in now: `permission` while the permission hook waits or Claude Code
   * reported a permission or input dialog, `screen` for a dialog on the visible screen, or null.
   */
  async #dialogOpen(
    record: SessionRecord,
    pane: PaneRef,
  ): Promise<"permission" | "screen" | "busy" | null> {
    if (this.#waits.waiting(record.id)) return "permission";
    if (
      record.notification === "permission_prompt" ||
      record.notification === "elicitation_dialog"
    ) {
      return "permission";
    }
    // A host whose screen AW does not read (Orca): AW sends only after the SessionStart of the
    // current pane (before it, aw-launch or a loading Claude Code would get the text raw), and
    // only while the hooks say that the agent is idle (docs/phase-1.md 9.9.3).
    if (!this.#readsScreen(record)) {
      return record.busy || record.ready_pane !== pane.pane ? "busy" : null;
    }
    // Only the visible screen: a closed dialog stays in the scrollback. Only the layout of a
    // dialog: the agent text on the screen can hold the same words.
    const screen = await this.#hostOf(record)
      .capture(pane, 0)
      .catch(() => "");
    return dialogOnScreen(screen) ? "screen" : null;
  }

  async #deliver(record: SessionRecord, task: TaskView): Promise<void> {
    const pane = record.pane;
    if (!pane) return;
    // A text that AW gave up does not block the texts after it.
    const failed = new Set(record.failed_deliveries);
    const item = this.#deliveries(record, task).find((i) => !failed.has(i.id));
    if (!item) return;
    const now = this.#clock.now();
    const attempt = this.#attempts.get(item.id) ?? { count: 0, last: 0 };
    if (attempt.count > 0 && record.busy) {
      // Claude Code queues a text that arrives during a turn and submits it when the turn ends:
      // the retry wait starts only after the turn.
      attempt.last = now;
      this.#attempts.set(item.id, attempt);
      return;
    }
    if (attempt.count > 0 && now - attempt.last < DELIVERY_RETRY_MS) return;
    if (attempt.count >= DELIVERY_ATTEMPTS) {
      record.failed_deliveries = [...record.failed_deliveries, item.id];
      await this.#save(record);
      this.#attempts.delete(item.id);
      const screen = this.#readsScreen(record)
        ? await this.#hostOf(record)
            .capture(pane, 40)
            .catch(() => "")
        : "";
      const lines = screen.trim()
        ? ` Last terminal lines:\n${screen.trimEnd()}`
        : ` ${this.#terminalHint(record)}.`;
      await this.#buffer.now(
        task.id,
        "comment.added",
        {
          text: `Answer not delivered: ${item.id} after ${DELIVERY_ATTEMPTS} attempts.${lines}`,
        },
        this.#aw,
      );
      return;
    }
    const host = this.#hostOf(record);
    if (!(await host.alive(pane))) return;
    const dialog = await this.#dialogOpen(record, pane);
    if (dialog !== null) {
      await this.#dialogBlocks(record, task, item, dialog, now);
      return;
    }
    this.#dialogSince.delete(item.id);
    attempt.count++;
    attempt.last = now;
    this.#attempts.set(item.id, attempt);
    if (host.submit) {
      await host.submit(pane, item.text);
    } else {
      await host.paste(pane, item.text);
      await host.keys(pane, ["Enter"]);
    }
    this.#log.info(
      { session: record.id, delivery: item.id, attempt: attempt.count },
      "Text delivered to the session",
    );
  }

  /** A dialog on the screen that blocks a delivery for long gets one comment (principle 9). */
  async #dialogBlocks(
    record: SessionRecord,
    task: TaskView,
    item: DeliveryItem,
    dialog: "permission" | "screen" | "busy",
    now: number,
  ): Promise<void> {
    // The permission gate shows a permission dialog already; a busy turn ends by itself.
    if (dialog !== "screen") return;
    const since = this.#dialogSince.get(item.id) ?? now;
    this.#dialogSince.set(item.id, since);
    if (now - since < DIALOG_NOTICE_MS || this.#dialogNoticed.has(item.id)) return;
    this.#dialogNoticed.add(item.id);
    const screen = await this.#hostOf(record)
      .capture(record.pane!, 0)
      .catch(() => "");
    await this.#buffer.now(
      task.id,
      "comment.added",
      {
        text: `Answer waits: ${item.id} is not delivered because a dialog is open in the terminal for ${Math.round((now - since) / 1000)} s. Answer the dialog. ${this.#terminalHint(record)}. Last terminal lines:\n${screen.trimEnd()}`,
      },
      this.#aw,
    );
  }

  // ---- Continuity checks (add-continuity) ----------------------------------------------------

  /** The effects of a continuity gate answer on the running session. */
  async #continuityResolved(record: SessionRecord, gate: GateView, answer: string): Promise<void> {
    if (gate.kind === "continue_after_limit") {
      // "Continue": AW sends the continue notice at the reset + 2 min (at once when the reset
      // passed). "Wait": the pause stays until the next message of the person (fix list 0h).
      if (/^continue/i.test(answer.trim())) {
        const now = this.#clock.now();
        const reset = record.usage_pause?.resets_at ?? null;
        record.continues = 0;
        if (reset !== null && reset > now) {
          record.usage_pause = {
            cause: "usage_limit",
            resets_at: reset,
            continue_at: reset + CONTINUE_AFTER_RESET_MS,
          };
          await this.#pause(record.task, {
            cause: "usage_limit",
            next_step: `Usage limit. Resumes at ${shortTime(reset, now)}: AW continues the session.`,
            resumes_at: reset,
            needs_human: false,
          });
        } else {
          record.usage_pause = { cause: "usage_limit", resets_at: reset, continue_at: now };
          await this.#unpause(record.task, ["continue_cap"]);
        }
        await this.#save(record);
      }
    } else if (gate.kind === "take_over_terminal") {
      record.agent_errors = 0;
      record.agent_retry = null;
      await this.#unpause(record.task, ["agent_error"]);
      await this.#save(record);
    }
  }

  /** The timed continues of one running session: after a usage reset, after an agent error. */
  async #continuity(record: SessionRecord): Promise<void> {
    const now = this.#clock.now();
    const usage = record.usage_pause;
    if (
      usage?.continue_at !== null &&
      usage?.continue_at !== undefined &&
      now >= usage.continue_at
    ) {
      const id = hookEventId(usage.continue_at, `usage-continue/${record.id}/${record.continues}`);
      record.continues++;
      usage.continue_at = null;
      await this.#save(record);
      await this.#work.notice(
        record.task,
        record.id,
        id,
        `The usage limit was reset. Continue the task where you stopped (automatic continue ${record.continues} of ${MAX_CONTINUES}).`,
      );
    }
    const retry = record.agent_retry;
    if (retry !== null && now >= retry.at) {
      const id = hookEventId(retry.at, `agent-retry/${record.id}/${record.agent_errors}`);
      record.agent_retry = null;
      await this.#save(record);
      await this.#work.notice(
        record.task,
        record.id,
        id,
        `The last turn failed with an agent error (${retry.error}). Continue the task where you stopped.`,
      );
    }
    await this.#login(record);
  }

  /** The sign-in state for one running session (docs/architecture.md 4.6.7). */
  async #login(record: SessionRecord): Promise<void> {
    const auth = this.#auth();
    if (auth === null) return;
    const now = this.#clock.now();
    if (!auth.valid) {
      await this.#pause(record.task, {
        cause: "login_expired",
        next_step: `Login expired on ${this.#me}. Sign in: run \`claude auth login\` in a terminal on ${this.#me}.`,
        resumes_at: null,
        needs_human: true,
      });
      if (!this.#loginPushed.has(record.task)) {
        this.#loginPushed.add(record.task);
        const task = this.#task(record.task);
        await this.#push?.send(
          this.service,
          loginPush(
            "login_expired",
            record.task,
            task?.key ?? null,
            `${task?.key ?? "A task"} · Login expired on ${this.#me}`,
          ),
        );
      }
      return;
    }
    this.#loginPushed.delete(record.task);
    await this.#unpause(record.task, ["login_expired"]);
    if (!loginEndsSoon(auth, now) || auth.expiresAt === null) return;
    const key = `${record.task}/${auth.expiresAt}`;
    if (this.#loginWarned.has(key)) return;
    this.#loginWarned.add(key);
    const end = shortTime(Date.parse(auth.expiresAt), now);
    await this.#buffer.now(
      record.task,
      "comment.added",
      {
        text: `The agent login on ${this.#me} ends ${end}. Sign in again before it ends: run \`claude auth login\` in a terminal on ${this.#me}.`,
      },
      this.#aw,
    );
    const pushKey = `login-ends/${auth.expiresAt}`;
    if (!this.#loginWarned.has(pushKey)) {
      this.#loginWarned.add(pushKey);
      const task = this.#task(record.task);
      await this.#push?.send(
        this.service,
        loginPush(
          "login_ends",
          record.task,
          task?.key ?? null,
          `Agent login on ${this.#me} ends ${end}`,
        ),
      );
    }
  }

  /** The checks of the full tick: usage files, watchdog, slots, failed sessions, health. */
  async #fullContinuity(): Promise<void> {
    const parts: [string, () => Promise<void>][] = [
      ["usage", () => this.#readUsageFiles()],
      ["watchdog", () => this.#watchdog()],
      ["slots", () => this.#slots.expire(this.#bootMs).then(() => undefined)],
      ["failed sessions", () => this.#failedGates()],
      ["health", () => this.#writeHealth()],
    ];
    for (const [what, run] of parts) {
      try {
        await run();
      } catch (error) {
        this.#log.error({ err: error }, `The continuity check failed in its ${what}`);
      }
    }
  }

  async #readUsageFiles(): Promise<void> {
    for (const record of this.records) {
      if (record.state !== "running") {
        this.#usage.delete(record.id);
        continue;
      }
      this.#usage.set(
        record.id,
        await readUsage(sessionPaths(this.#settings.home, record.id).usage),
      );
    }
  }

  /** "No recent update" after 2 min of quiet, and the 15-min check (docs/architecture.md 4.6.9). */
  async #watchdog(): Promise<void> {
    const now = this.#clock.now();
    if (now - this.#lastWatch < WATCHDOG_CHECK_MS) return;
    this.#lastWatch = now;
    for (const record of this.#running()) {
      const task = this.#task(record.task);
      const pane = record.pane;
      if (!task || task.claim?.session !== record.id || !pane) continue;
      // The host of the session. Orca gives no screen: its quiet time counts from the hooks only.
      const host = this.#hostOf(record);
      if (!(await host.alive(pane).catch(() => false))) continue;
      const reads = this.#readsScreen(record);
      // A failed capture is null: the watchdog reads it as an empty screen, the snapshot skips it.
      const captured = reads ? await host.capture(pane, 0).catch(() => null) : null;
      const screen = captured ?? "";
      if (reads) {
        // The periodic terminal snapshot: 30 s and a screen change (openspec task-terminal-view).
        await this.#snapshots
          .check({ ...this.#snapshotInput(record, screen), screen: captured }, now)
          .catch((error: unknown) => {
            this.#log.error({ err: error, task: record.task }, "The terminal snapshot failed");
          });
      }
      const state = this.#watch.get(record.id) ?? newWatchState(record.opened_at ?? now);
      const lastEvent = Math.max(
        this.#lastEvent.get(record.id) ?? this.#startedAt,
        record.opened_at ?? 0,
      );
      const waiting = task.paused !== null || task.gates.some((g) => g.state === "open");
      // The agent ended its turn and waits for input: no warning (verify-journeys finding 9).
      const idle = record.first_seen && !record.busy && record.pending_tool === null;
      // The watchdog cuts the last line: it gets the redacted screen, also a wrapped value (0-41).
      const shown = redactScreen(screen, this.#redact);
      const step = watchStep(state, { now, lastEvent, screen: shown, waiting, idle });
      this.#watch.set(record.id, step.state);
      if (step.action.kind === "quiet") {
        const line = step.action.line ? ` Last terminal line: ${step.action.line}` : "";
        await this.#buffer.now(
          record.task,
          "task.progress",
          { text: `No recent update for 2 min.${line}` },
          this.#aw,
        );
      } else if (step.action.kind === "long") {
        if (record.pending_tool) {
          await this.#buffer.now(
            record.task,
            "task.progress",
            { text: `Busy for 15 min: ${record.pending_tool.summary}` },
            this.#aw,
          );
        } else if (reads && dialogOnScreen(screen) && !this.#waits.waiting(record.id)) {
          // A prompt that no hook reported waits in the terminal (tmux: AW reads the screen).
          await this.#takeOverGate(
            record,
            `A prompt that AW cannot answer waits in the terminal for 15 min. Answer it. ${this.#terminalHint(record)}. Then answer "Done".`,
            ["Done"],
          );
        } else if (!reads && record.busy && !this.#waits.waiting(record.id)) {
          // AW does not read the Orca screen: a turn with no hook for 15 min can wait at a dialog.
          await this.#takeOverGate(
            record,
            `The agent gave no update for 15 min in a turn. AW does not read the screen of ${hostLabel(record.host)}, so a dialog there can wait for an answer. ${this.#terminalHint(record)}. Then answer "Done".`,
            ["Done"],
          );
        }
      }
    }
  }

  /** A failed session whose "Take over terminal" got "Resume again" runs again (4.6.4 item 4). */
  async #failedGates(): Promise<void> {
    for (const record of this.records) {
      if (record.state !== "failed") continue;
      const task = this.#task(record.task);
      if (!task || task.claim?.session !== record.id) continue;
      for (const gate of task.gates) {
        if (gate.kind !== "take_over_terminal" || gate.state !== "open") continue;
        const answer = gate.answers.find((a) => a.use === "pending" && a.version === gate.version);
        if (!answer) continue;
        await this.#buffer.now(
          task.id,
          "gate.resolved",
          {
            gate: gate.gate,
            version: gate.version,
            answer_event: answer.event,
            answer: answer.answer,
          },
          this.#aw,
        );
        if (/^resume/i.test(answer.answer.trim())) {
          record.state = "running";
          record.resumes = 0;
          record.resume_times = [];
          record.restarts = 0;
          record.launch_waits = 0;
          await this.#save(record);
          // The crashed session runs again: the task shows it running before the next window opens.
          if (task.session?.session === record.id && task.session.state === "ended") {
            await this.#buffer.now(
              task.id,
              "session.resumed",
              { session: record.id, text: "" },
              this.#aw,
            );
          }
          this.#log.info({ session: record.id }, "A failed session runs again (the human answer)");
        }
      }
    }
  }

  /** `health.yaml` of this device, at most once per 60 s (docs/architecture.md 4.6.12). */
  async #writeHealth(): Promise<void> {
    const now = this.#clock.now();
    if (this.#health && now - this.#health.at < 60_000) return;
    const usage =
      [...this.#usage.values()]
        .filter((u): u is UsageState => u !== null)
        .sort((a, b) => b.at - a.at)[0] ?? null;
    const auth = this.#auth();
    const versions: Record<string, string> = { aw: AW_VERSION };
    if (this.#tools.agent.version) versions[this.#tools.adapter.name] = this.#tools.agent.version;
    const doc = healthDocument({
      device: this.#me,
      updated: this.service.files.hlc.now(),
      bootTime: new Date(this.#bootMs).toISOString(),
      versions,
      sessions: this.records
        .filter((r) => r.state === "running")
        .map((r) => ({ session: r.id, task: r.task, state: sessionState(r, this.#task(r.task)) })),
      usage,
      loginExpiresAt: auth?.expiresAt ?? null,
      disk: await this.#diskUse(),
      queue: {
        maxWorking: this.#settings.sessions.maxWorking,
        diskFullPercent: this.#settings.sessions.diskFullPercent,
        loginValid: auth?.valid ?? null,
      },
    });
    const key = healthKey(doc);
    if (
      !healthDue({
        now,
        lastWrite: this.#health?.at ?? null,
        lastKey: this.#health?.key ?? null,
        key,
      })
    ) {
      return;
    }
    await this.service.writeOwnDocument<"health">(`tasks/devices/${this.#me}/health.yaml`, doc);
    this.#health = { at: now, key };
  }

  // ---- Test slots (add-continuity, decision 13) -----------------------------------------------

  async slotAcquire(id: string, input: { resource: string }): Promise<AcquireResult> {
    const record = this.#records.get(id);
    if (!record || record.state !== "running") {
      throw new ServiceError("refused", `Session ${id} does not run on this device`);
    }
    return this.#slots.acquire({ resource: input.resource, task: record.task, session: id });
  }

  async slotRelease(id: string, input: { resource: string }) {
    const record = this.#records.get(id);
    if (!record || record.state !== "running") {
      throw new ServiceError("refused", `Session ${id} does not run on this device`);
    }
    return this.#slots.release({ resource: input.resource, session: id });
  }

  // ---- Agent commands (design decision 16) --------------------------------------------------

  /**
   * The caller of a local API request with the token of this session: the agent of the
   * session and its task. A session that does not run here is refused.
   */
  agentCaller(id: string): { agent: string; session: string; task: string; workspace: string } {
    const record = this.#records.get(id);
    if (!record || record.state !== "running") {
      throw new ServiceError("refused", `Session ${id} does not run on this device`);
    }
    return {
      agent: this.#agentActor(record),
      session: record.id,
      task: record.task,
      workspace: record.workspace,
    };
  }

  /** The record and the task of an agent command. The task must be the task of the session. */
  agentSession(id: string, ref: string): { record: SessionRecord; task: TaskView } {
    const record = this.#records.get(id);
    if (!record || record.state !== "running") {
      throw new ServiceError("refused", `Session ${id} does not run on this device`);
    }
    const task = this.service.showTask(ref);
    if (task.id !== record.task) {
      throw new ServiceError(
        "refused",
        `Session ${id} runs ${record.key ?? record.task}, not ${task.key ?? task.id}`,
        {
          session_task: record.task,
        },
      );
    }
    return { record, task };
  }

  /**
   * The task whose thread a session may read: its task or a parent task of it (the read rule of the
   * `thread` tool and of the thread route for a session caller). Another task is refused.
   */
  readableTask(id: string, ref: string): TaskView {
    const record = this.#records.get(id);
    if (!record || record.state !== "running") {
      throw new ServiceError("refused", `Session ${id} does not run on this device`);
    }
    const target = this.service.showTask(ref);
    if (!this.service.ancestry(record.task).some((t) => t.id === target.id)) {
      throw new ServiceError(
        "refused",
        `This session reads only its task and the parent tasks, not ${target.key ?? target.id}`,
        { session_task: record.task },
      );
    }
    return target;
  }

  async ask(id: string, input: AskGateInput & { task: string }) {
    const { record, task } = this.agentSession(id, input.task);
    // The hook events of the turn first: the prompt that started the turn sorts before the gate.
    await this.#queue.add(() => this.#drainSpool(record));
    // A new question replaces the older open questions (openspec proposal-and-discussion).
    await this.#replaceQuestions(task.id, "Replaced by a newer question");
    const gate = newId(this.#clock);
    const { data, file } = askGate(input, gate, this.service.device.slug, this.#redact);
    // The full details first: the gate names the file (the files layer redacts it).
    if (file) await this.service.writeTaskFile(`tasks/${task.id}/${file.path}`, file.text);
    const result = await this.#buffer.now(task.id, "gate.opened", data, this.#agentActor(record));
    return { gate, ...result };
  }

  async message(id: string, input: { task: string; text: string }) {
    const { record, task } = this.agentSession(id, input.task);
    // The hook events of the turn first: the prompt that started the turn sorts before the
    // message, so the context of a later gate stops at that prompt (openspec gate-context).
    await this.#queue.add(() => this.#drainSpool(record));
    const event = this.#buffer.later(
      task.id,
      "message.agent",
      { text: input.text, session: record.id, source: "tool" },
      this.#agentActor(record),
    );
    return { event, buffered: true, path: null };
  }

  async stage(id: string, input: { task: string; text: string }) {
    const { record, task } = this.agentSession(id, input.task);
    await this.#queue.add(() => this.#drainSpool(record));
    const event = this.#buffer.later(
      task.id,
      "task.progress",
      { text: input.text },
      this.#agentActor(record),
    );
    return { event, buffered: true, path: null };
  }

  /**
   * Reads a file of `aw artifact add` or `aw handoff`. The file must be in the working folder of
   * the session after each symlink, and at most MAX_AGENT_FILE_BYTES: the copy goes to every
   * device of the workspace, so the agent cannot copy a key or a token of this computer with no
   * person in the loop (principle 4).
   */
  async #readAgentFile(record: SessionRecord, source: string): Promise<Buffer> {
    const cannot = (error: unknown) =>
      new ServiceError(
        "invalid_input",
        `Cannot read ${source}: ${(error as NodeJS.ErrnoException).code ?? "error"}`,
      );
    let real: string;
    let root: string;
    try {
      real = await realpath(source);
      root = await realpath(record.cwd);
    } catch (error) {
      throw cannot(error);
    }
    if (real !== root && !real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      throw new ServiceError(
        "refused",
        `${source} is not in the working folder of the session (${record.cwd}). AW copies only a file of that folder to the devices of the workspace.`,
      );
    }
    let handle;
    try {
      handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw cannot(error);
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new ServiceError("refused", `${source} is not a file`);
      const tooLarge = () =>
        new ServiceError(
          "refused",
          `${source} is larger than ${MAX_AGENT_FILE_BYTES / 1024 / 1024} MB. Add a smaller file.`,
        );
      if (info.size > MAX_AGENT_FILE_BYTES) throw tooLarge();
      const bytes = await handle.readFile();
      if (bytes.length > MAX_AGENT_FILE_BYTES) throw tooLarge();
      return bytes;
    } finally {
      await handle.close();
    }
  }

  async #copyFile(
    record: SessionRecord,
    task: TaskView,
    source: string,
    name: string,
  ): Promise<{ path: string; bytes: Buffer }> {
    const bytes = await this.#readAgentFile(record, source);
    const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "") || "file";
    const folder = `artifacts/${this.#me}`;
    let path = `${folder}/${safe}`;
    for (
      let n = 2;
      await stat(join(this.service.root, "tasks", task.id, ...path.split("/"))).then(
        () => true,
        () => false,
      );
      n++
    ) {
      path = `${folder}/${n}-${safe}`;
    }
    // A text file is redacted: the size and the sha256 of artifact.added are of the written bytes.
    const written = await this.service.writeTaskFile(`tasks/${task.id}/${path}`, bytes);
    return { path, bytes: Buffer.from(written) };
  }

  async addArtifact(id: string, input: { task: string; path: string }) {
    const { record, task } = this.agentSession(id, input.task);
    const { path, bytes } = await this.#copyFile(record, task, input.path, basename(input.path));
    const event = this.#buffer.later(
      task.id,
      "artifact.added",
      { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
      this.#agentActor(record),
    );
    return { event, buffered: true, path };
  }

  async handoff(id: string, input: { task: string; path: string }) {
    const { record, task } = this.agentSession(id, input.task);
    const stamp = new Date(this.#clock.now()).toISOString().replace(/[-:.]/g, "").slice(0, 15);
    const { path } = await this.#copyFile(record, task, input.path, `handoff-${stamp}.md`);
    const event = this.#buffer.later(
      task.id,
      "handoff.written",
      { file: path },
      this.#agentActor(record),
    );
    return { event, buffered: true, path };
  }

  /** The PermissionRequest hook (design decision 9). */
  async permission(
    id: string,
    input: { request_id: string; tool: string; input: Record<string, unknown> },
  ): Promise<{ decision: PermissionDecision; gate: string | null }> {
    const record = this.#records.get(id);
    if (!record || record.state !== "running") {
      throw new ServiceError("refused", `Session ${id} does not run on this device`);
    }
    const key = ruleKey(input.tool, input.input);
    if (record.rules.some((r) => r.tool === input.tool && r.command === key)) {
      return { decision: { behavior: "allow" }, gate: null };
    }
    const hash = inputHash(input.tool, input.input);
    const approval = record.approvals.find(
      (a) => !a.used && a.tool === input.tool && a.input === hash,
    );
    if (approval) {
      approval.used = true;
      await this.#save(record);
      return { decision: { behavior: "allow" }, gate: approval.gate };
    }
    const gate = this.#rows(record.task).find(
      (r) => r.type === "gate.opened" && data(r).request_id === input.request_id,
    );
    let gateId = gate ? String(data(gate).gate) : null;
    // A retry of the hook (after an awd restart) waits only the rest of the time since the open.
    let waitMs = this.#waits.timeoutMs;
    if (gate) waitMs = remainingWaitMs(hlcMs(gate.hlc), this.#clock.now(), this.#waits.timeoutMs);
    if (gateId === null) {
      gateId = newId(this.#clock);
      const summary = toolSummary(input.tool, input.input, this.#redact);
      // The event keeps a hash of the input: a Write of a large file does not fit in a log line.
      // The full input stays in the session folder for the rule of "Allow for this task".
      const paths = sessionPaths(this.#settings.home, record.id);
      await privateFolder(paths.requests);
      await writePrivate(
        join(paths.requests, `${gateId}.json`),
        `${JSON.stringify({ tool: input.tool, input: input.input })}\n`,
      );
      await this.#buffer.now(
        record.task,
        "gate.opened",
        {
          gate: gateId,
          kind: "approve_command",
          version: 1,
          title: `${input.tool}: ${summary}`.slice(0, 500),
          text: `${input.tool}: ${summary}`,
          options: PERMISSION_OPTIONS,
          request_id: input.request_id,
          request: { tool: input.tool, input_sha256: hash },
        },
        this.#agentActor(record),
      );
    }
    const view = this.#task(record.task)?.gates.find((g) => g.gate === gateId);
    if (view?.state === "resolved" && view.answer !== null) {
      const used = view.answers.find((a) => a.use === "used");
      return {
        decision: decisionOf(view.answer, used?.by ?? null, used?.comment ?? null),
        gate: gateId,
      };
    }
    if (waitMs <= 0) return { decision: timeoutDecision(this.#waits.timeoutMs), gate: gateId };
    const wait = this.#waits.wait(record.id, gateId, waitMs);
    // An answer that is already in the log resolves the gate at the next check.
    void this.sync();
    const decision = await wait;
    if (decision === null) throw new ServiceError("not_ready", "awd stops. Ask again.");
    return { decision, gate: gateId };
  }

  // ---- Work loop (add-task-loop) -----------------------------------------------------------

  /** Ends a done session: closes its window and records the state `ended`. */
  async #finish(record: SessionRecord): Promise<void> {
    const pane = record.pane;
    // The host of the session (tmux or Orca). A host that knows the handle with another process
    // (another Orca incarnation) gets a close with no signal, as in #stopSession.
    if (pane) {
      const host = this.#hostOf(record);
      const shown = await this.#paneOf(record);
      if (shown) await host.stop(pane, { graceMs: 1000 });
      if (shown || host.find) await host.close(pane);
    }
    record.state = "ended";
    await this.#save(record);
    this.#log.info({ session: record.id }, "Session ended: the task is done");
  }

  /**
   * Writes the credential files of the session (docs/workflow.md 4.8.5) and returns their folder.
   * A credential name with no value on this device gets one comment per session.
   */
  async #writeCredentials(record: SessionRecord, task: TaskView | undefined): Promise<string> {
    const dir = join(sessionPaths(this.#settings.home, record.id).dir, "credentials");
    const names = task?.credentials ?? [];
    let values = new Map<string, string>();
    try {
      values = await this.#credentials.values(this.service.id, names);
    } catch (error) {
      this.#log.error({ err: error, session: record.id }, "The credential values were not read");
    }
    const missing = await writeCredentialFiles(dir, names, values);
    if (missing.length > 0 && !this.#credentialNoticed.has(record.id)) {
      this.#credentialNoticed.add(record.id);
      await this.#buffer.now(
        record.task,
        "comment.added",
        {
          text: `Credential ${missing.join(", ")} has no value on ${this.#me}: the session starts without it. Add the credential on a computer of the workspace.`,
        },
        this.#aw,
      );
    }
    return dir;
  }

  /** The context of an agent command of the work loop, after the hook events of the turn. */
  async #agentContext(id: string, ref: string): Promise<AgentContext> {
    const { record } = this.agentSession(id, ref);
    // The hook events of the turn first: the prompt that started the turn sorts before the gate.
    await this.#queue.add(() => this.#drainSpool(record));
    const task = this.#task(record.task)!;
    return {
      record,
      task,
      actor: this.#agentActor(record),
      host: this.#loopHost(),
      copyFile: (source, name) => this.#copyFile(record, task, source, name),
    };
  }

  #afterAgentCommand<T>(result: T): T {
    // The next check runs the ready checks and the deliveries at once.
    void this.sync().catch(() => undefined);
    return result;
  }

  async proposal(id: string, input: { task: string; content: string }) {
    return this.#afterAgentCommand(
      await proposeProposal(await this.#agentContext(id, input.task), input),
    );
  }

  async ready(id: string, input: { task: string; missing?: string[] | undefined }) {
    return this.#afterAgentCommand(
      await reportReady(await this.#agentContext(id, input.task), input),
    );
  }

  async createSubtask(id: string, input: SubtaskInput & { parent?: string | undefined }) {
    const { record } = this.agentSession(id, input.parent ?? this.#records.get(id)?.task ?? "");
    return createSubtask(await this.#agentContext(id, record.task), input);
  }

  async gate(
    id: string,
    input: {
      task: string;
      content: string;
      options?: string[] | undefined;
    },
  ) {
    return openCustomGate(await this.#agentContext(id, input.task), input);
  }

  async result(
    id: string,
    input: { task: string; path: string; artifacts?: string[] | undefined },
  ) {
    return this.#afterAgentCommand(
      await postResult(await this.#agentContext(id, input.task), input),
    );
  }

  async done(id: string, input: { task: string }) {
    return this.#afterAgentCommand(await markTaskDone(await this.#agentContext(id, input.task)));
  }

  /** The session list of the API. */
  info(record: SessionRecord) {
    return {
      id: record.id,
      workspace: record.workspace,
      task: record.task,
      key: record.key,
      agent: record.agent,
      host: record.host,
      epoch: record.epoch,
      state: record.state,
      cwd: record.cwd,
      window: record.pane?.window ?? null,
      pid: record.pane?.pid ?? null,
      resumes: record.resumes,
    };
  }
}

export type { WriteResult };
