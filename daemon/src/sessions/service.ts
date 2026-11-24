// The sessions of this device: one session manager per open workspace, the session host and the
// agent adapter, and the permission waits (docs/architecture.md 3.2, module `agents`).
import { assigneeDevice, type Clock } from "@aw/core";
import type { AgentInfo, HostInfo } from "@aw/plugin-api";
import type { FetchLike } from "@aw/push-webpush";
import { readFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { AuthMonitor } from "../continuity/auth.ts";
import type { Logger } from "../log.ts";
import type { CredentialProvider } from "../loop/credentials.ts";
import type { SyncProbe } from "../loop/loop.ts";
import { PushService } from "../loop/push.ts";
import { SessionTokens } from "../mcp/tokens.ts";
import { ServiceError } from "../service/errors.ts";
import type { WorkspaceService } from "../service/workspace.ts";
import type { Settings } from "../settings.ts";
import { SessionManager, type SessionTools } from "./manager.ts";
import { PERMISSION_TIMEOUT_MS, PermissionWaits } from "./permissions.ts";
import { makeHost, makeTools } from "./plugins.ts";
import { listRecords, privateFolder, sessionPaths, sessionsRoot } from "./records.ts";

export interface SessionServiceOptions {
  settings: Settings;
  log: Logger;
  clock: Clock;
  /** The wait of the permission hook. Default 120 s (tests give a short one). */
  permissionTimeoutMs?: number;
  /** The wait before a new try of a failed session start. Default 60 s (tests give a short one). */
  startRetryMs?: number;
  /** The wait before AW looks again for a missing host or agent. Default PREPARE_RETRY_MS. */
  prepareRetryMs?: number;
  /** The sync check of the ready checks (add-task-loop). Default: in sync (one device). */
  sync?: SyncProbe;
  /** The credential values of the sessions. Default: none. awd gives the credential service. */
  credentials?: CredentialProvider;
  /** The fetch of the Web Push sender (tests replace the push service). */
  pushFetch?: FetchLike;
  /** The wait before a session host notice on the task. Default HOST_NOTICE_MS (tests: short). */
  hostNoticeMs?: number;
  /** The boot time of the computer (ISO). Default: the clock minus the OS uptime. */
  bootTime?: string;
  /** The TTL of a test slot lease (tests give a short one). */
  slotTtlMs?: number;
  /** The period of the sign-in check. Default 1 h (add-continuity). */
  authPeriodMs?: number;
}

/** The wait before AW looks again for tmux and the agent when one of them was missing. */
export const PREPARE_RETRY_MS = 60_000;
/** The agent name of the bundled adapter: the tasks of `claude@<device>` wait for it. */
const AGENT_NAME = "claude";

export class SessionService {
  readonly #settings: Settings;
  readonly #log: Logger;
  readonly #clock: Clock;
  readonly #waits: PermissionWaits;
  readonly #startRetryMs: number | undefined;
  readonly #hostNoticeMs: number | undefined;
  readonly #prepareRetryMs: number;
  readonly #managers = new Map<string, SessionManager>();
  /** The session tokens of this device (add-mcp-server, decision 3). */
  readonly tokens: SessionTokens;
  /** Open workspaces with no manager: the host or the agent was missing at the open. */
  readonly #waiting = new Map<string, WorkspaceService>();
  /** The tasks that got the comment "AW cannot start a session", by the cause of it. */
  readonly #noticed = new Map<string, string>();
  #tools: Promise<SessionTools | null> | null = null;
  #host: HostInfo | null = null;
  #agent: AgentInfo | null = null;
  /** Why the last setup gave no session tools, for the comment. */
  #cause = "";
  #retrying = false;
  #closed = false;
  readonly #sync: SyncProbe;
  readonly #credentials: CredentialProvider | undefined;
  /** The Web Push sender of this computer (add-task-loop). */
  readonly push: PushService;
  /** The sign-in state of the agent, once the tools are ready (add-continuity). */
  #auth: AuthMonitor | null = null;
  readonly #bootMs: number;
  readonly #slotTtlMs: number | undefined;
  readonly #authPeriodMs: number | undefined;

  constructor(options: SessionServiceOptions) {
    this.#settings = options.settings;
    this.#log = options.log.child({ module: "sessions" });
    this.#clock = options.clock;
    this.#waits = new PermissionWaits(
      options.clock,
      options.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS,
    );
    this.#startRetryMs = options.startRetryMs;
    this.#hostNoticeMs = options.hostNoticeMs;
    this.#prepareRetryMs = options.prepareRetryMs ?? PREPARE_RETRY_MS;
    this.tokens = new SessionTokens(options.settings.home);
    // The session tokens are secrets of the redaction of each workspace (architecture.md 6.4.2).
    this.tokens.onChange(() => {
      for (const service of this.#services()) this.#redactTokens(service);
    });
    this.#sync = options.sync ?? (() => Promise.resolve({ ok: true }));
    this.#bootMs = options.bootTime
      ? Date.parse(options.bootTime)
      : Math.floor((options.clock.now() - uptime() * 1000) / 1000) * 1000;
    this.#slotTtlMs = options.slotTtlMs;
    this.#authPeriodMs = options.authPeriodMs;
    this.#credentials = options.credentials;
    this.push = new PushService({
      home: options.settings.home,
      log: this.#log,
      now: () => options.clock.now(),
      ...(options.pushFetch ? { fetch: options.pushFetch } : {}),
      workspaces: () => this.#services(),
    });
  }

  /** The open workspaces of the sessions: with a manager, or waiting for the host or the agent. */
  #services(): WorkspaceService[] {
    return [...[...this.#managers.values()].map((m) => m.service), ...this.#waiting.values()];
  }

  #redactTokens(service: WorkspaceService): void {
    service.setSecrets(this.tokens.secrets(), "sessions");
  }

  /**
   * Loads the tokens of the running sessions of this device before the first request: a session
   * that runs over an awd restart keeps its token. A running record with no token file gets one at
   * its next window open.
   */
  async loadTokens(): Promise<void> {
    for (const record of await listRecords(this.#settings.home)) {
      if (record.state === "running") await this.tokens.load(record.id);
    }
  }

  /** `ok` when the session host was found, `failed` when not, `not_configured` before the start. */
  get hostStatus(): "ok" | "failed" | "not_configured" {
    if (this.#host === null) return "not_configured";
    return this.#host.available ? "ok" : "failed";
  }

  /** `ok` when the agent binary answers, `failed` when not, `not_configured` before the check. */
  get agentStatus(): "ok" | "failed" | "not_configured" {
    if (this.#agent === null) return "not_configured";
    return this.#agent.available ? "ok" : "failed";
  }

  /**
   * The host, the agent and the session folder, once. A failed setup, no host or no agent binary
   * is not kept: the next try (every PREPARE_RETRY_MS) looks again, with no restart of awd.
   */
  #prepare(): Promise<SessionTools | null> {
    const prepared = (this.#tools ??= (async () => {
      const host = await makeHost(this.#settings, this.#log);
      this.#host = await host.detect();
      if (!this.#host.available) return null;
      const tools = await makeTools(this.#settings, host, this.#log);
      this.#agent = tools.agent;
      if (!tools.agent.available) return tools;
      await privateFolder(sessionsRoot(this.#settings.home));
      this.#log.info(
        { tmux: this.#host.version, agent: tools.agent.version, covered: tools.agent.covered },
        "Sessions ready",
      );
      return tools;
    })());
    return prepared.then(
      (tools) => {
        if ((!tools || !tools.agent.available) && this.#tools === prepared) this.#tools = null;
        return tools;
      },
      (error: unknown) => {
        if (this.#tools === prepared) this.#tools = null;
        throw error;
      },
    );
  }

  /**
   * Starts the manager of an open workspace: reconcile, spool drain, claims. With no host or no
   * agent, the workspace waits: AW looks for them again every 60 s and after each change, and
   * each task of the agent on this device gets one comment with the cause (principle 2).
   */
  async attach(service: WorkspaceService): Promise<void> {
    if (this.#closed || this.#managers.has(service.id)) return;
    const tools = await this.#prepare().catch((error: unknown) => {
      this.#log.error({ err: error }, "The session setup failed");
      return null;
    });
    if (this.#closed || this.#managers.has(service.id)) return;
    if (!tools || !tools.agent.available) {
      this.#waiting.set(service.id, service);
      this.#redactTokens(service);
      const cause = this.#causeOf(tools);
      if (cause !== this.#cause) this.#log.warn({ cause }, "AW starts no session");
      this.#cause = cause;
      await this.#notice(service);
      this.#scheduleRetry();
      return;
    }
    this.#waiting.delete(service.id);
    if (this.#auth === null) {
      this.#auth = new AuthMonitor({
        read: () => tools.adapter.authStatus(),
        clock: this.#clock,
        log: this.#log,
        ...(this.#authPeriodMs === undefined ? {} : { periodMs: this.#authPeriodMs }),
      });
      // The first state before the first claims: a login that ended starts no session.
      await this.#auth.check();
      this.#auth.start();
    }
    const auth = this.#auth;
    const records = (await listRecords(this.#settings.home)).filter(
      (r) => r.workspace === service.id,
    );
    const manager = new SessionManager({
      service,
      settings: this.#settings,
      clock: this.#clock,
      log: this.#log,
      tools,
      waits: this.#waits,
      tokens: this.tokens,
      records,
      loop: {
        push: this.push,
        sync: this.#sync,
        stateDir: join(this.#settings.home, "push"),
      },
      ...(this.#credentials ? { credentials: this.#credentials } : {}),
      ...(this.#startRetryMs === undefined ? {} : { startRetryMs: this.#startRetryMs }),
      ...(this.#hostNoticeMs === undefined ? {} : { hostNoticeMs: this.#hostNoticeMs }),
      auth: () => auth.state,
      bootMs: this.#bootMs,
      // The guard and the "Other folder" check protect each workspace folder of this device.
      workspaceFolders: () => this.#services().map((other) => other.root),
      ...(this.#slotTtlMs === undefined ? {} : { slotTtlMs: this.#slotTtlMs }),
      // AW_MAX_WORKING counts the sessions of the device, in each workspace (fix list 0g).
      deviceWorking: () => [...this.#managers.values()].reduce((n, m) => n + m.working(), 0),
      // A revoke of this device in any open workspace stops its sessions in each (fix list 0-43).
      revokedElsewhere: () =>
        this.#services().some(
          (other) =>
            other !== service &&
            other.ready &&
            other.view.devices.find((d) => d.slug === other.device.slug)?.revoked === true,
        ),
    });
    this.#managers.set(service.id, manager);
    this.#redactTokens(service);
    await this.push.ensureBindings(service).catch((error: unknown) => {
      this.#log.warn({ err: error, workspace: service.id }, "The VAPID key is not in the bindings");
    });
    await manager.start();
  }

  /** The cause of a missing setup, in the words of the comment. */
  #causeOf(tools: SessionTools | null): string {
    if (this.#host && !this.#host.available) {
      return `no session host (${this.#host.reason ?? "tmux not found"})`;
    }
    if (tools && !tools.agent.available) {
      return `the agent binary ${tools.agent.binary} does not answer (${tools.agent.reason ?? "no version"})`;
    }
    return "the session setup failed (see the awd log)";
  }

  /** One comment on each open task of `claude@<this device>` that waits for the setup. */
  async #notice(service: WorkspaceService): Promise<void> {
    if (!service.ready) return;
    const me = service.device.slug;
    const cause = this.#cause;
    for (const task of service.view.tasks) {
      if (task.archived || task.stage === "done" || task.created === null) continue;
      if (task.assignee !== `${AGENT_NAME}@${me}` || assigneeDevice(task.assignee) !== me) continue;
      if (task.claim !== null || this.#noticed.get(task.id) === cause) continue;
      this.#noticed.set(task.id, cause);
      try {
        await service.appendTaskEvents(task.id, [
          service.newTaskEvent(
            task.id,
            "comment.added",
            {
              text: `AW cannot start a session on ${me}: ${cause}. AW looks again every ${Math.round(this.#prepareRetryMs / 1000)} s; no restart of awd is needed.`,
            },
            `aw@${me}`,
          ),
        ]);
      } catch (error) {
        this.#log.error({ err: error, task: task.id }, "The setup comment was not written");
      }
    }
  }

  /** Tries the setup again on the clock while a workspace waits for it. */
  #scheduleRetry(): void {
    if (this.#retrying) return;
    this.#retrying = true;
    void (async () => {
      try {
        while (!this.#closed && this.#waiting.size > 0) {
          await this.#clock.sleep(this.#prepareRetryMs);
          if (this.#closed) break;
          await this.#retryWaiting();
        }
      } finally {
        this.#retrying = false;
      }
    })();
  }

  async #retryWaiting(): Promise<void> {
    for (const service of [...this.#waiting.values()]) {
      await this.attach(service).catch((error: unknown) => {
        this.#log.error({ err: error, workspace: service.id }, "The sessions did not start");
      });
    }
  }

  /**
   * The Orca state of this device for a workspace (SessionManager.orcaState), or null when the
   * workspace has no manager yet (no host or no agent): then AW cannot tell.
   */
  async orcaState(workspace: string) {
    return (await this.#managers.get(workspace)?.orcaState()) ?? null;
  }

  /**
   * The cleanup of this device after a removal of a project (openspec project-remove): the stop of
   * its sessions, then its worktrees and branches. Null when the workspace has no manager.
   */
  async projectRemoved(workspace: string, event: string) {
    return (await this.#managers.get(workspace)?.projectRemoved(event)) ?? null;
  }

  /**
   * Runs a check after a merge with a change (the event bus of awd). A workspace that waits for
   * the setup has no manager: the next setup try writes the comment on a newly assigned task.
   */
  changed(workspace: string): void {
    void this.#managers
      .get(workspace)
      ?.sync()
      .catch((error: unknown) => {
        this.#log.error({ err: error }, "The session check failed");
      });
  }

  /**
   * The manager of a session. A running session of this device whose workspace has no manager
   * yet (awd starts, or the workspace did not open) gets `not_ready` (503): its hooks and agent
   * commands try again. An unknown session gets `refused` (403).
   */
  manager(session: string): SessionManager {
    for (const manager of this.#managers.values()) if (manager.record(session)) return manager;
    if (this.#waitingForWorkspace(session)) {
      throw new ServiceError("not_ready", `Session ${session} is not ready yet. Ask again.`);
    }
    throw new ServiceError("refused", `Session ${session} does not run on this device`);
  }

  #waitingForWorkspace(session: string): boolean {
    try {
      // The route gives a uuid: the path stays in the sessions folder.
      const record = JSON.parse(
        readFileSync(sessionPaths(this.#settings.home, session).record, "utf8"),
      ) as { state?: unknown; workspace?: unknown };
      return (
        record.state === "running" &&
        typeof record.workspace === "string" &&
        !this.#managers.has(record.workspace)
      );
    } catch {
      return false;
    }
  }

  /**
   * The agent caller of a session: the agent actor, the session, its task and
   * workspace. An unknown or stopped session is refused (403); a session whose workspace is not
   * attached yet gets `not_ready` (503).
   */
  caller(session: string) {
    return this.manager(session).agentCaller(session);
  }

  /**
   * The agent caller of a session token. A missing, unknown or revoked token gives `unauthorized`
   * (401). A running session whose workspace is not attached yet gives `not_ready` (503).
   */
  callerOfToken(token: string | null) {
    const session = token === null ? null : this.tokens.session(token);
    if (session === null) {
      throw new ServiceError(
        "unauthorized",
        "The session token is missing, unknown or revoked. A token is valid only while its session runs.",
      );
    }
    return this.caller(session);
  }

  /**
   * The local target of "Open the terminal" for a task of a workspace (openspec task-terminal-view),
   * or null when no session of the task is on this device.
   */
  async localTerminal(workspace: string, task: string) {
    return (await this.#managers.get(workspace)?.localTerminal(task)) ?? null;
  }

  /** The agent binary of this device (`AW_CLAUDE`): the "Sign in" command runs `auth login`. */
  get claude(): string {
    return this.#settings.sessions.claude;
  }

  /** The tmux socket name of this device (`AW_TMUX_SOCKET`): "Open the terminal" attaches to it. */
  get tmuxSocket(): string {
    return this.#settings.sessions.tmuxSocket;
  }

  /** The pane process of each running session with a window: the peer check of the local API. */
  runningPanes(): { session: string; pid: number }[] {
    return [...this.#managers.values()].flatMap((m) =>
      m.records
        .filter((r) => r.state === "running" && r.pane !== null)
        .map((r) => ({ session: r.id, pid: r.pane!.pid })),
    );
  }

  /** Ends each waiting permission request with 503 (awd stops): the hook asks the new awd. */
  endWaits(): void {
    this.#waits.closeAll();
  }

  list() {
    return [...this.#managers.values()].flatMap((m) => m.records.map((r) => m.info(r)));
  }

  async stopSession(session: string) {
    const manager = this.manager(session);
    return manager.info(await manager.stop(session));
  }

  /**
   * Stops the manager of a workspace that awd unregisters (gap-setup), and returns the ids of its
   * sessions that still run (fix list 0-14): the records after the manager queue is idle, so a
   * session start in progress counts; for a workspace with no manager (it waits for the host or the
   * agent), each record on disk whose tmux pane still runs. The caller attaches it again when one
   * runs.
   */
  async detach(workspace: string): Promise<string[]> {
    this.#waiting.delete(workspace);
    const manager = this.#managers.get(workspace);
    if (manager) {
      this.#managers.delete(workspace);
      await manager.close();
      return manager.records.filter((r) => r.state === "running").map((r) => r.id);
    }
    const records = (await listRecords(this.#settings.home)).filter(
      (r) => r.workspace === workspace && r.state === "running" && r.pane !== null,
    );
    if (records.length === 0) return [];
    const panes = await (await makeHost(this.#settings, this.#log)).list().catch(() => []);
    const live = new Set(panes.filter((p) => !p.dead).map((p) => p.pid));
    return records.filter((r) => live.has(r.pane!.pid)).map((r) => r.id);
  }

  /** Stops the managers. The sessions keep running in tmux. */
  /** The sign-in state of the agent, or null before the first check. */
  get auth() {
    return this.#auth?.state ?? null;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#auth?.close();
    this.#waits.closeAll();
    for (const manager of this.#managers.values()) await manager.close();
    this.#managers.clear();
  }
}
