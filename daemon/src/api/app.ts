// The local API: fastify on the Unix socket (docs/architecture.md 6.3, design decision 12). It is a
// thin adapter: each route parses its input with zod and calls one method of the service layer.
import {
  addProjectBody,
  answerBody,
  archiveBody,
  assignBody,
  createTaskBody,
  editTaskBody,
  errorReplies,
  gateAnswerReply,
  gateEntry,
  gateListQuery,
  gateParams,
  initWorkspaceBody,
  initWorkspaceReply,
  issueView,
  projectView,
  readyReply,
  statusReply,
  taskEditReply,
  taskListQuery,
  taskParams,
  taskView,
  taskWriteReply,
  threadQuery,
  threadReply,
  versionReply,
  workspaceSummary,
  wsParams,
} from "@aw/client/schemas";
import { AwFileError } from "@aw/core";
import { newId } from "@aw/schema";
import fastifySwagger from "@fastify/swagger";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyError } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import type { BusMessage, Daemon } from "../service/daemon.ts";
import { ServiceError } from "../service/errors.ts";
import { API_MAJOR, AW_VERSION } from "../version.ts";
import { registerCallerRule, type Access } from "./caller.ts";
import { registerDesktopRoutes } from "./desktop-routes.ts";
import { registerDoctorRoutes } from "./doctor-routes.ts";
import { registerIdentityRoutes } from "./identity-routes.ts";
import { registerKnowledgeRoutes } from "./knowledge.ts";
import { registerMessageRoutes } from "./messages.ts";
import type { PeerTools } from "./peer.ts";
import { registerQueueRoutes } from "./queue-routes.ts";
import { registerSessionRoutes } from "./sessions.ts";
import { registerSetupRoutes } from "./setup-routes.ts";
import { registerSyncRoutes } from "./sync-routes.ts";
import { registerTerminalRoutes } from "./terminal-routes.ts";

const toBool = (value: "true" | "false" | undefined) =>
  value === undefined ? undefined : value === "true";

/** The WebSocket event stream (design decision 11). */
export const EVENTS_PATH = "/v1/events";
const EVENTS_DESCRIPTION =
  'Messages are JSON text: `{"type":"hello","version"}`, `{"type":"changed","workspace","tasks","workspace_changed","documents_changed","full"}`, `{"type":"notice","workspace","notices"}`. After a reconnect, load the state again.';
const EVENTS_OPERATION = {
  get: {
    operationId: "streamEvents",
    tags: ["events"],
    summary: "WebSocket: a hello message, then a changed message after each merge with a change",
    description: EVENTS_DESCRIPTION,
    responses: {
      "101": { description: "Switching Protocols: the WebSocket starts" },
      "404": { description: "The request is not a WebSocket upgrade" },
    },
  },
};

/**
 * Completes the OpenAPI document: the event stream, the root `security: []` (the socket mode 0600
 * is the access control, there is no token), and no unused `*Input` copy of a reply schema.
 */
function finishDocument<T>(generated: T): T {
  const document = generated as {
    paths?: Record<string, unknown>;
    components?: { schemas?: Record<string, unknown> };
    security?: unknown[];
  };
  document.paths = { ...document.paths, [EVENTS_PATH]: EVENTS_OPERATION };
  document.security = [];
  const schemas = document.components?.schemas ?? {};
  // An unused copy can refer to another one: repeat until no copy goes away.
  let removed = true;
  while (removed) {
    removed = false;
    for (const name of Object.keys(schemas)) {
      if (!name.endsWith("Input")) continue;
      const rest = { ...document, components: { schemas: { ...schemas, [name]: null } } };
      if (!JSON.stringify(rest).includes(`"#/components/schemas/${name}"`)) {
        delete schemas[name];
        removed = true;
      }
    }
  }
  return generated;
}

/** The pattern of an accepted `X-Trace-Id` (docs/engineering-rules.md 5.16). */
export const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function envelope(code: string, message: string, traceId: string, details?: unknown) {
  return {
    error: { code, message, ...(details === undefined ? {} : { details }) },
    trace_id: traceId,
  };
}

/**
 * The views of shared/core are interfaces with no index signature; the reply schemas are loose
 * objects. The serializer checks each reply against its schema at run time, so this cast only
 * bridges the 2 type styles.
 */
function asReply<T>(value: unknown): T {
  return value as T;
}

/** Builds the fastify app of the local API. `listen()` is the caller's job (server.ts). */
export interface AppOptions {
  /** Called for each route that the app adds (the OpenAPI route check, the access check). */
  onRoute?: (route: { method: string | string[]; url: string; access: Access | undefined }) => void;
  /** The tools of the peer process check (tests give fakes). */
  peerTools?: PeerTools;
}

export async function createApp(daemon: Daemon, options: AppOptions = {}) {
  const app = Fastify({
    loggerInstance: daemon.log,
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: "trace_id" }),
    genReqId: (req) => {
      const header = req.headers["x-trace-id"];
      return typeof header === "string" && TRACE_ID_PATTERN.test(header)
        ? header
        : newId(daemon.clock);
    },
    // The first message can be long; one event line stays below 64 KiB (docs/phase-1.md 3.3.3).
    bodyLimit: 1024 * 1024,
    // A request during the stop runs as usual and gets the error envelope with X-AW-Version (a
    // waiting permission request gets 503 not_ready): the default 503 of Fastify has no header,
    // so a client takes it for another program on the socket.
    return503OnClosing: false,
  });
  if (options.onRoute) {
    const onRoute = options.onRoute;
    app.addHook("onRoute", (route) =>
      onRoute({ method: route.method, url: route.url, access: route.config?.access }),
    );
  }
  // A waiting permission request holds its connection up to 120 s: end it with 503 before the
  // server waits for the open requests, so a stop does not wait and the hook asks the new awd.
  app.addHook("preClose", (done) => {
    daemon.sessions?.endWaits();
    done();
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "awd local API",
        description:
          "The local API of awd on the Unix socket `~/.aw/run/awd.sock` (mode 0600). No TCP port. Generated from the zod schemas of daemon/; do not edit by hand (`pnpm api:generate`).",
        version: `${API_MAJOR}`,
        license: { name: "MIT", identifier: "MIT" },
      },
      servers: [{ url: "http://awd", description: "The Unix socket ~/.aw/run/awd.sock" }],
      tags: [
        { name: "probes", description: "Health, readiness and version" },
        { name: "workspaces", description: "Workspace folders and projects" },
        { name: "tasks", description: "Tasks and their threads" },
        { name: "gates", description: "Gates that wait for the human" },
        { name: "events", description: "The change stream" },
        { name: "knowledge", description: "Knowledge files, history, Undo and suggestions" },
        { name: "sync", description: "The sync engine, Sync now and the peers" },
        { name: "sessions", description: "Agent sessions, the agent commands and the hooks" },
        { name: "identity", description: "Identity, devices, pairing and credentials" },
      ],
    },
    transform: jsonSchemaTransform,
    // @fastify/websocket hides its routes from the document. The event stream is part of the
    // contract, so the transform adds it back with the 101 reply.
    transformObject: (input) => finishDocument(jsonSchemaTransformObject(input)),
  });
  await app.register(fastifyWebsocket);

  app.addHook("onSend", async (request, reply) => {
    reply.header("X-AW-Version", AW_VERSION);
    reply.header("X-Trace-Id", request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send(envelope("not_found", `No route ${request.method} ${request.url}`, request.id));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        path: [error.validationContext, ...String(issue.instancePath).split("/").filter(Boolean)]
          .filter(Boolean)
          .join("."),
        field: String(issue.instancePath).split("/").filter(Boolean).join(".") || null,
        message: issue.message,
      }));
      return reply
        .code(400)
        .send(
          envelope("invalid_input", "The request does not match the schema", request.id, details),
        );
    }
    if (error instanceof ServiceError) {
      // not_ready is a known state (awd starts or stops; the client tries again), not a fault.
      if (error.code === "not_ready") request.log.info({ code: error.code }, error.message);
      else if (error.status >= 500) request.log.error({ err: error }, error.message);
      return reply
        .code(error.status)
        .send(envelope(error.code, error.message, request.id, error.details));
    }
    if (error instanceof AwFileError) {
      return reply
        .code(400)
        .send(envelope("invalid_input", error.message, request.id, { file_error: error.code }));
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "A reply does not match its schema");
      return reply.code(500).send(envelope("internal", "Internal error", request.id));
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send(envelope("invalid_input", error.message, request.id));
    }
    request.log.error({ err: error }, "Unhandled error");
    return reply.code(500).send(envelope("internal", "Internal error", request.id));
  });

  // The caller of each request: the agent of a session token, a process of a session, or the
  // person (add-mcp-server, decision 5). Before the routes, so each route has the hook.
  registerCallerRule(app, daemon, options.peerTools ? { peerTools: options.peerTools } : {});

  const api = app.withTypeProvider<ZodTypeProvider>();
  const ws = (selector: string) => daemon.workspace(selector === "-" ? undefined : selector);

  // ---- Probes ----
  api.get(
    "/healthz",
    {
      schema: {
        tags: ["probes"],
        operationId: "getHealth",
        summary: "Liveness: awd answers",
        response: { 200: z.object({ status: z.literal("ok") }) },
      },
    },
    () => ({ status: "ok" as const }),
  );

  api.get(
    "/readyz",
    {
      schema: {
        tags: ["probes"],
        operationId: "getReady",
        summary:
          "Readiness: each workspace is open. The sync engine state, the session host and the session agent are reported and do not change the readiness.",
        response: { 200: readyReply, 503: readyReply },
      },
    },
    async (_request, reply) => {
      const body = {
        ready: daemon.ready,
        checks: {
          workspaces: daemon
            .workspaces()
            .map((w) => ({ id: w.id, ready: w.ready, error: w.error ?? null })),
          sync_engine: daemon.started ? daemon.sync.state : ("not_configured" as const),
          session_host: daemon.sessions?.hostStatus ?? ("not_configured" as const),
          session_agent: daemon.sessions?.agentStatus ?? ("not_configured" as const),
        },
      };
      void reply.code(body.ready ? 200 : 503);
      return body;
    },
  );

  api.get(
    "/version",
    {
      schema: {
        tags: ["probes"],
        operationId: "getVersion",
        summary: "The version of awd and of the API",
        response: { 200: versionReply },
      },
    },
    () => ({ version: AW_VERSION, api: API_MAJOR, node: process.version }),
  );

  api.get(
    "/v1/status",
    {
      schema: {
        tags: ["probes"],
        operationId: "getStatus",
        summary: "The device, the workspaces and their counts",
        response: { 200: statusReply, ...errorReplies },
      },
    },
    () => asReply<never>(daemon.status()),
  );

  // ---- Workspaces and projects ----
  api.get(
    "/v1/workspaces",
    {
      schema: {
        tags: ["workspaces"],
        operationId: "listWorkspaces",
        summary: "List the registered workspaces",
        response: { 200: z.array(workspaceSummary), ...errorReplies },
      },
    },
    () => asReply<never>(daemon.workspaces()),
  );

  api.post(
    "/v1/workspaces",
    {
      config: { access: "person" },
      schema: {
        tags: ["workspaces"],
        operationId: "initWorkspace",
        summary:
          "Initialize a workspace folder, or register a folder that has tasks/workspace.yaml",
        body: initWorkspaceBody,
        response: { 200: initWorkspaceReply, 201: initWorkspaceReply, ...errorReplies },
      },
    },
    async (request, reply) => {
      const result = await daemon.initWorkspace(request.body);
      void reply.code(result.created ? 201 : 200);
      return asReply<never>(result);
    },
  );

  api.get(
    "/v1/workspaces/:ws/projects",
    {
      schema: {
        tags: ["workspaces"],
        operationId: "listProjects",
        summary: "List the projects",
        params: wsParams,
        response: { 200: z.array(projectView), ...errorReplies },
      },
    },
    (request) => asReply<never>(ws(request.params.ws).listProjects()),
  );

  api.post(
    "/v1/workspaces/:ws/projects",
    {
      config: { access: "person" },
      schema: {
        tags: ["workspaces"],
        operationId: "addProject",
        summary: "Add a project (a shared file tasks/projects/<slug>/project.yaml)",
        params: wsParams,
        body: addProjectBody,
        response: { 201: projectView, ...errorReplies },
      },
    },
    async (request, reply) => {
      const project = await ws(request.params.ws).addProject(request.body);
      void reply.code(201);
      return asReply<never>(project);
    },
  );

  api.get(
    "/v1/workspaces/:ws/issues",
    {
      schema: {
        tags: ["workspaces"],
        operationId: "listIssues",
        summary: "The merge issues: Sync problems and files to fix",
        params: wsParams,
        response: { 200: z.array(issueView), ...errorReplies },
      },
    },
    (request) => asReply<never>(ws(request.params.ws).issues()),
  );

  // ---- Tasks ----
  api.get(
    "/v1/workspaces/:ws/tasks",
    {
      schema: {
        tags: ["tasks"],
        operationId: "listTasks",
        summary: "List the tasks in creation order",
        params: wsParams,
        querystring: taskListQuery,
        response: { 200: z.array(taskView), ...errorReplies },
      },
    },
    (request) => {
      const q = request.query;
      return asReply<never>(
        ws(request.params.ws).listTasks({
          ...(q.project ? { project: q.project } : {}),
          ...(q.stage ? { stage: q.stage } : {}),
          ...(q.needs_you ? { needs_you: toBool(q.needs_you)! } : {}),
          ...(q.archived ? { archived: toBool(q.archived)! } : {}),
        }),
      );
    },
  );

  api.post(
    "/v1/workspaces/:ws/tasks",
    {
      config: { access: "person" },
      schema: {
        tags: ["tasks"],
        operationId: "createTask",
        summary: "Create a task with its first message (event task.created)",
        params: wsParams,
        body: createTaskBody,
        response: { 201: taskWriteReply, ...errorReplies },
      },
    },
    async (request, reply) => {
      const result = await ws(request.params.ws).createTask(request.body);
      void reply.code(201);
      return asReply<never>(result);
    },
  );

  api.get(
    "/v1/workspaces/:ws/tasks/:task",
    {
      schema: {
        tags: ["tasks"],
        operationId: "getTask",
        summary: "Show one task",
        params: taskParams,
        response: { 200: taskView, ...errorReplies },
      },
    },
    (request) => asReply<never>(ws(request.params.ws).showTask(request.params.task)),
  );

  api.patch(
    "/v1/workspaces/:ws/tasks/:task",
    {
      config: { access: "person" },
      schema: {
        tags: ["tasks"],
        operationId: "editTask",
        summary: "Edit the title, the first message or the priority (events task.edited)",
        params: taskParams,
        body: editTaskBody,
        response: { 200: taskEditReply, ...errorReplies },
      },
    },
    async (request) => {
      const result = await ws(request.params.ws).editTask(request.params.task, request.body);
      return asReply<never>({ ...result, applied: result.results.every((r) => r.applied) });
    },
  );

  api.post(
    "/v1/workspaces/:ws/tasks/:task/assign",
    {
      config: { access: "person" },
      schema: {
        tags: ["tasks"],
        operationId: "assignTask",
        summary: "Assign the task to agent@device (event task.assigned)",
        params: taskParams,
        body: assignBody,
        response: { 200: taskWriteReply, ...errorReplies },
      },
    },
    async (request) =>
      asReply<never>(
        await ws(request.params.ws).assignTask(
          request.params.task,
          request.body.assignee,
          request.body.session_host,
          request.body.session_options,
        ),
      ),
  );

  api.post(
    "/v1/workspaces/:ws/tasks/:task/archive",
    {
      config: { access: "person" },
      schema: {
        tags: ["tasks"],
        operationId: "archiveTask",
        summary:
          "Archive the task (event task.archived). A running session gives 409 conflict without stop: true; with it, session.stop_requested goes first. AW never deletes a task folder.",
        params: taskParams,
        body: archiveBody,
        response: { 200: taskWriteReply, ...errorReplies },
      },
    },
    async (request) =>
      asReply<never>(
        await ws(request.params.ws).archiveTask(request.params.task, {
          stop: request.body?.stop,
        }),
      ),
  );

  api.post(
    "/v1/workspaces/:ws/tasks/:task/unarchive",
    {
      config: { access: "person" },
      schema: {
        tags: ["tasks"],
        operationId: "unarchiveTask",
        summary: "Make an archived task active again (event task.unarchived)",
        params: taskParams,
        response: { 200: taskWriteReply, ...errorReplies },
      },
    },
    async (request) =>
      asReply<never>(await ws(request.params.ws).unarchiveTask(request.params.task)),
  );

  api.post(
    "/v1/workspaces/:ws/tasks/:task/stop",
    {
      config: { access: "person" },
      schema: {
        tags: ["tasks"],
        operationId: "stopTaskSession",
        summary:
          "Ask the session device to stop the running session of the task (event session.stop_requested), on any device",
        params: taskParams,
        response: { 200: taskWriteReply, ...errorReplies },
      },
    },
    async (request) =>
      asReply<never>(await ws(request.params.ws).stopTaskSession(request.params.task)),
  );

  api.get(
    "/v1/workspaces/:ws/tasks/:task/thread",
    {
      schema: {
        tags: ["tasks"],
        operationId: "getThread",
        summary: "The events of the task in merge order (HLC, device, id), in pages",
        params: taskParams,
        querystring: threadQuery,
        response: { 200: threadReply, ...errorReplies },
      },
    },
    (request) => {
      const service = ws(request.params.ws);
      // A session caller reads only its task and the parent tasks: the same rule as the `thread`
      // MCP tool (SessionManager.readableTask).
      const caller = request.caller;
      if (caller) {
        if (service.id !== caller.workspace) {
          throw new ServiceError("refused", `Session ${caller.session} runs in another workspace`, {
            session: caller.session,
          });
        }
        daemon.sessions!.manager(caller.session).readableTask(caller.session, request.params.task);
      }
      const options = {
        after: request.query.after,
        before: request.query.before,
        newest: toBool(request.query.newest) === true,
        types: request.query.types?.split(","),
        limit: request.query.limit,
        from: request.query.from,
      };
      const page = service.thread(request.params.task, options);
      const ancestors =
        toBool(request.query.ancestors) === true
          ? service
              .ancestry(request.params.task)
              .slice(0, -1)
              .map((task) =>
                service.thread(task.id, {
                  limit: 1000,
                  newest: options.newest,
                  types: options.types,
                }),
              )
          : [];
      return asReply<never>({ ...page, ancestors });
    },
  );

  // ---- Gates ----
  api.get(
    "/v1/workspaces/:ws/gates",
    {
      schema: {
        tags: ["gates"],
        operationId: "listGates",
        summary: "List the gates: the open gates by default",
        params: wsParams,
        querystring: gateListQuery,
        response: { 200: z.array(gateEntry), ...errorReplies },
      },
    },
    (request) => asReply<never>(ws(request.params.ws).gates(request.query)),
  );

  api.post(
    "/v1/workspaces/:ws/gates/:gate/answer",
    {
      config: { access: "person" },
      schema: {
        tags: ["gates"],
        operationId: "answerGate",
        summary: "Answer a gate (event gate.answered in the log of this device)",
        params: gateParams,
        body: answerBody,
        response: { 200: gateAnswerReply, ...errorReplies },
      },
    },
    async (request) =>
      asReply<never>(await ws(request.params.ws).answerGate(request.params.gate, request.body)),
  );

  registerKnowledgeRoutes(api, daemon);
  registerMessageRoutes(app, daemon);

  // ---- Sync ----
  registerSyncRoutes(app, daemon);

  // ---- Sessions ----
  registerSessionRoutes(app, daemon);

  // ---- Identity, devices, pairing, credentials ----
  registerIdentityRoutes(api, daemon);
  registerDesktopRoutes(api, daemon);
  registerSetupRoutes(api, daemon);
  registerDoctorRoutes(api, daemon);
  registerQueueRoutes(api, daemon);
  registerTerminalRoutes(api, daemon);

  // ---- Events ----
  app.get(
    EVENTS_PATH,
    {
      websocket: true,
      schema: {
        tags: ["events"],
        summary: EVENTS_OPERATION.get.summary,
        description: EVENTS_DESCRIPTION,
      },
    },
    (socket) => {
      socket.send(JSON.stringify({ type: "hello", version: AW_VERSION }));
      const forward = (message: BusMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      };
      daemon.bus.on("message", forward);
      socket.on("close", () => daemon.bus.off("message", forward));
    },
  );

  return app;
}

export type AwApp = Awaited<ReturnType<typeof createApp>>;
