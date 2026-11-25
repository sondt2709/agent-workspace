// @aw/client: the typed client of the awd local API on the Unix socket (docs/tech-stack.md 2.3).
// axios with `socketPath` for HTTP and `ws` with `ws+unix:` for the event stream. No TCP port.
import axios, { AxiosError, type AxiosInstance, type Method } from "axios";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { z } from "zod";
import * as S from "./schemas.ts";
import type * as T from "./types.ts";

export type * from "./types.ts";

/** An error reply of awd: the HTTP status and the error envelope. */
export class AwApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly traceId: string | null;

  constructor(status: number, envelope: T.ErrorEnvelope | null, fallback: string) {
    super(envelope?.error.message ?? fallback);
    this.name = "AwApiError";
    this.status = status;
    this.code = envelope?.error.code ?? (status >= 500 ? "internal" : "invalid_input");
    this.details = envelope?.error.details;
    this.traceId = envelope?.trace_id ?? null;
  }
}

/** awd does not answer on the socket: it does not run, or the socket is not this user's. */
export class AwUnreachableError extends Error {
  readonly socketPath: string;
  readonly reason: string;

  constructor(socketPath: string, reason: string) {
    super(`awd is not reachable on ${socketPath} (${reason})`);
    this.name = "AwUnreachableError";
    this.socketPath = socketPath;
    this.reason = reason;
  }
}

/**
 * A reply that is not from a compatible awd: it has no `X-AW-Version` header (the socket is not an
 * awd socket), or its body does not match the reply schema (a version skew of aw and awd).
 */
export class AwProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwProtocolError";
  }
}

const UNREACHABLE = new Set([
  "ENOENT",
  "ECONNREFUSED",
  "EACCES",
  "EPERM",
  "ENOTSOCK",
  "ECONNRESET",
]);

export interface ClientOptions {
  socketPath: string;
  /** Makes the trace id of each request. Default: `aw-<uuid>`. */
  traceId?: () => string;
  /** Time limit of a request in ms. Default 30 s. */
  timeoutMs?: number;
  /**
   * The session token of the caller (`AW_MCP_TOKEN`). Each request then has the header
   * `Authorization: Bearer <token>`, and awd treats the caller as the agent of that session, not
   * as the person. The token is the only source of the agent identity (add-mcp-server).
   */
  token?: string | null;
}

export interface ReplyMeta {
  /** The `X-AW-Version` of the last reply. */
  version: string | null;
  traceId: string | null;
}

/** Parses a reply body with its schema (docs/engineering-rules.md 5.2). */
function parseReply<R>(schema: z.ZodType, data: unknown, what: string, version: string): R {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AwProtocolError(
      `The reply of ${what} does not match the API of this client (awd ${version}): ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data as R;
}

const encode = encodeURIComponent;

export class AwClient {
  readonly socketPath: string;
  readonly #http: AxiosInstance;
  readonly #traceId: () => string;
  readonly #token: string | null;
  /** The headers of the last reply. */
  readonly last: ReplyMeta = { version: null, traceId: null };

  constructor(options: ClientOptions) {
    this.socketPath = options.socketPath;
    this.#traceId = options.traceId ?? (() => `aw-${randomUUID()}`);
    this.#token = options.token ?? null;
    this.#http = axios.create({
      socketPath: options.socketPath,
      baseURL: "http://awd",
      adapter: "http",
      timeout: options.timeoutMs ?? 30_000,
      proxy: false,
      validateStatus: () => true,
    });
  }

  /**
   * Sends one request and parses the reply body with `schema`. A reply that does not match gives
   * AwProtocolError. `okStatus` lists the error statuses whose body is a reply, not an error.
   */
  async request<R>(
    method: Method,
    path: string,
    schema: z.ZodType,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      okStatus?: number[];
    } = {},
  ): Promise<R> {
    const params = Object.fromEntries(
      Object.entries(options.query ?? {}).filter(([, value]) => value !== undefined),
    );
    let response;
    try {
      response = await this.#http.request({
        method,
        url: path,
        params,
        // A POST with no body still sends `{}` as JSON, so each write has one content type.
        ...(options.body !== undefined
          ? { data: options.body }
          : method.toUpperCase() === "GET"
            ? {}
            : { data: {} }),
        headers: {
          "X-Trace-Id": this.#traceId(),
          ...(this.#token !== null ? { Authorization: `Bearer ${this.#token}` } : {}),
        },
      });
    } catch (error) {
      const code = (error as AxiosError).code ?? (error as NodeJS.ErrnoException).code;
      if (code && UNREACHABLE.has(code)) throw new AwUnreachableError(this.socketPath, code);
      throw error;
    }
    const version = response.headers["x-aw-version"] as string | undefined;
    this.last.version = version ?? null;
    this.last.traceId = (response.headers["x-trace-id"] as string | undefined) ?? null;
    if (version === undefined) {
      throw new AwProtocolError(
        `${this.socketPath} answered with no X-AW-Version header: it is not awd`,
      );
    }
    const what = `${method.toUpperCase()} ${path}`;
    if (response.status >= 400 && !options.okStatus?.includes(response.status)) {
      const envelope = S.errorEnvelope.safeParse(response.data);
      throw new AwApiError(
        response.status,
        envelope.success ? envelope.data : null,
        `awd answered HTTP ${response.status}`,
      );
    }
    return parseReply<R>(schema, response.data, what, version);
  }

  // ---- Probes ----
  health = () =>
    this.request<{ status: "ok" }>("GET", "/healthz", z.object({ status: z.literal("ok") }));
  version = () => this.request<T.VersionReply>("GET", "/version", S.versionReply);
  status = () => this.request<T.StatusReply>("GET", "/v1/status", S.statusReply);

  /** `/readyz` gives 503 while awd starts: this returns the body in both cases. */
  ready = () => this.request<T.ReadyReply>("GET", "/readyz", S.readyReply, { okStatus: [503] });

  // ---- Workspaces and projects ----
  workspaces = () =>
    this.request<T.WorkspaceSummary[]>("GET", "/v1/workspaces", z.array(S.workspaceSummary));
  initWorkspace = (body: T.InitWorkspaceInput) =>
    this.request<T.InitWorkspaceReply>("POST", "/v1/workspaces", S.initWorkspaceReply, { body });
  projects = (ws: string) =>
    this.request<T.Project[]>(
      "GET",
      `/v1/workspaces/${encode(ws)}/projects`,
      z.array(S.projectView),
    );
  addProject = (ws: string, body: T.AddProjectInput) =>
    this.request<T.Project>("POST", `/v1/workspaces/${encode(ws)}/projects`, S.projectView, {
      body,
    });
  issues = (ws: string) =>
    this.request<T.Issue[]>("GET", `/v1/workspaces/${encode(ws)}/issues`, z.array(S.issueView));

  // ---- Tasks ----
  tasks = (ws: string, query: T.TaskListQuery = {}) =>
    this.request<T.Task[]>("GET", `/v1/workspaces/${encode(ws)}/tasks`, z.array(S.taskView), {
      query,
    });
  createTask = (ws: string, body: T.CreateTaskInput) =>
    this.request<T.TaskWriteReply>("POST", `/v1/workspaces/${encode(ws)}/tasks`, S.taskWriteReply, {
      body,
    });
  task = (ws: string, task: string) =>
    this.request<T.Task>("GET", `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}`, S.taskView);
  editTask = (ws: string, task: string, body: T.EditTaskInput) =>
    this.request<T.TaskEditReply>(
      "PATCH",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}`,
      S.taskEditReply,
      { body },
    );
  assignTask = (
    ws: string,
    task: string,
    assignee: string,
    sessionHost?: "tmux" | "orca",
    sessionOptions?: T.SessionOptionsInput,
  ) =>
    this.request<T.TaskWriteReply>(
      "POST",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/assign`,
      S.taskWriteReply,
      {
        body: {
          assignee,
          ...(sessionHost ? { session_host: sessionHost } : {}),
          ...(sessionOptions ? { session_options: sessionOptions } : {}),
        },
      },
    );
  /** Archives the task; `stop` stops a running session first (openspec task-actions). */
  archiveTask = (ws: string, task: string, options: { stop?: boolean } = {}) =>
    this.request<T.TaskWriteReply>(
      "POST",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/archive`,
      S.taskWriteReply,
      { body: options.stop === undefined ? {} : { stop: options.stop } },
    );
  /** Makes an archived task active again (event `task.unarchived`). */
  unarchiveTask = (ws: string, task: string) =>
    this.request<T.TaskWriteReply>(
      "POST",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/unarchive`,
      S.taskWriteReply,
    );
  /** Asks the session device to stop the running session of the task (`session.stop_requested`). */
  stopTaskSession = (ws: string, task: string) =>
    this.request<T.TaskWriteReply>(
      "POST",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/stop`,
      S.taskWriteReply,
    );
  /** Sends a message to the running session of the task (event `message.sent`). */
  sendMessage = (ws: string, task: string, text: string) =>
    this.request<T.TaskWriteReply>(
      "POST",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/messages`,
      S.taskWriteReply,
      { body: { text } },
    );
  thread = (ws: string, task: string, query: T.ThreadQuery = {}) =>
    this.request<T.ThreadReply>(
      "GET",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/thread`,
      S.threadReply,
      { query },
    );

  // ---- Sessions: the agent commands of a session and the PermissionRequest hook ----
  sessions = () => this.request<T.SessionInfo[]>("GET", "/v1/sessions", z.array(S.sessionInfo));
  stopSession = (session: string) =>
    this.request<T.SessionInfo>("POST", `/v1/sessions/${encode(session)}/stop`, S.sessionInfo);
  ask = (session: string, body: T.AskInput) =>
    this.request<T.AskReply>("POST", `/v1/sessions/${encode(session)}/ask`, S.askReply, { body });
  agentMessage = (session: string, body: { task: string; text: string }) =>
    this.request<T.AgentWriteReply>(
      "POST",
      `/v1/sessions/${encode(session)}/message`,
      S.agentWriteReply,
      { body },
    );
  stage = (session: string, body: { task: string; text: string }) =>
    this.request<T.AgentWriteReply>(
      "POST",
      `/v1/sessions/${encode(session)}/stage`,
      S.agentWriteReply,
      { body },
    );
  addArtifact = (session: string, body: { task: string; path: string }) =>
    this.request<T.AgentWriteReply>(
      "POST",
      `/v1/sessions/${encode(session)}/artifacts`,
      S.agentWriteReply,
      { body },
    );
  handoff = (session: string, body: { task: string; path: string }) =>
    this.request<T.AgentWriteReply>(
      "POST",
      `/v1/sessions/${encode(session)}/handoff`,
      S.agentWriteReply,
      { body },
    );
  // The work loop (add-task-loop).
  proposal = (session: string, body: T.ProposalInput) =>
    this.request<T.LoopReply>("POST", `/v1/sessions/${encode(session)}/proposal`, S.loopReply, {
      body,
    });
  reportReady = (session: string, body: T.ReadyInput) =>
    this.request<T.LoopReply>("POST", `/v1/sessions/${encode(session)}/ready`, S.loopReply, {
      body,
    });
  createSubtask = (session: string, body: T.SubtaskInput) =>
    this.request<T.SubtaskReply>("POST", `/v1/sessions/${encode(session)}/tasks`, S.subtaskReply, {
      body,
    });
  openGate = (session: string, body: T.CustomGateInput) =>
    this.request<T.LoopReply>("POST", `/v1/sessions/${encode(session)}/gate`, S.loopReply, {
      body,
    });
  result = (session: string, body: T.ResultInput) =>
    this.request<T.LoopReply>("POST", `/v1/sessions/${encode(session)}/result`, S.loopReply, {
      body,
    });
  done = (session: string, body: { task: string }) =>
    this.request<T.LoopReply>("POST", `/v1/sessions/${encode(session)}/done`, S.loopReply, {
      body,
    });
  /** `aw slot acquire`: a lease of a test slot, a renewal, or the queue position. */
  slotAcquire = (session: string, body: { resource: string }) =>
    this.request<T.SlotAcquireReply>(
      "POST",
      `/v1/sessions/${encode(session)}/slots/acquire`,
      S.slotAcquireReply,
      { body },
    );
  /** `aw slot release`: ends the lease of the session. */
  slotRelease = (session: string, body: { resource: string }) =>
    this.request<T.SlotReleaseReply>(
      "POST",
      `/v1/sessions/${encode(session)}/slots/release`,
      S.slotReleaseReply,
      { body },
    );
  /** The PermissionRequest hook: awd answers when the human answers, or after its timeout. */
  permission = (
    session: string,
    body: { request_id: string; tool: string; input: Record<string, unknown> },
  ) =>
    this.request<T.PermissionReply>(
      "POST",
      `/v1/sessions/${encode(session)}/permission`,
      S.permissionReply,
      { body },
    );

  // ---- Gates ----
  gates = (ws: string, query: T.GateListQuery = {}) =>
    this.request<T.GateEntry[]>("GET", `/v1/workspaces/${encode(ws)}/gates`, z.array(S.gateEntry), {
      query,
    });
  answerGate = (ws: string, gate: string, body: T.AnswerInput) =>
    this.request<T.GateAnswerReply>(
      "POST",
      `/v1/workspaces/${encode(ws)}/gates/${encode(gate)}/answer`,
      S.gateAnswerReply,
      { body },
    );

  // ---- Sync ----
  syncStatus = () => this.request<T.SyncStatusReply>("GET", "/v1/sync", S.syncStatusReply);
  syncNow = (body: { timeout_ms?: number } = {}) =>
    this.request<T.SyncNowReply>("POST", "/v1/sync/now", S.syncNowReply, { body });
  syncPause = () => this.request<T.SyncStatusReply>("POST", "/v1/sync/pause", S.syncStatusReply);
  syncResume = () => this.request<T.SyncStatusReply>("POST", "/v1/sync/resume", S.syncStatusReply);
  addPeer = (body: T.AddPeerInput) =>
    this.request<T.SyncStatusReply>("POST", "/v1/sync/peers", S.syncStatusReply, { body });
  removePeer = (device: string) =>
    this.request<T.SyncStatusReply>(
      "DELETE",
      `/v1/sync/peers/${encode(device)}`,
      S.syncStatusReply,
    );

  /**
   * Opens the event stream. Each message is parsed with the stream schema; a message that does not
   * match is skipped. An error of `onMessage` is not caught here. Close it with `close()`.
   */
  events(
    onMessage: (message: T.StreamMessage) => void,
  ): Promise<{ close(): void; socket: WebSocket }> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws+unix:${this.socketPath}:/v1/events`, {
        headers: { "X-Trace-Id": this.#traceId() },
      });
      socket.on("message", (data) => {
        let message: T.StreamMessage;
        try {
          const parsed = S.streamMessage.safeParse(
            JSON.parse(Buffer.from(data as Buffer).toString("utf8")),
          );
          if (!parsed.success) return;
          message = parsed.data;
        } catch {
          // A message that is not JSON is not from awd: skip it.
          return;
        }
        onMessage(message);
      });
      socket.once("open", () => resolve({ socket, close: () => socket.close() }));
      socket.once("error", (error: NodeJS.ErrnoException) => {
        reject(
          error.code && UNREACHABLE.has(error.code)
            ? new AwUnreachableError(this.socketPath, error.code)
            : error,
        );
      });
    });
  }
}
