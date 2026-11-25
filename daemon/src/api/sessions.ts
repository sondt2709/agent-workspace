// The session routes of the local API (add-claude-sessions-tmux): the agent commands of a session,
// the PermissionRequest hook, and the session list. Each route calls the session service.
import {
  agentWriteReply,
  askBody,
  askReply,
  customGateBody,
  doneBody,
  errorReplies,
  fileBody,
  loopReply,
  messageBody,
  permissionBody,
  permissionReply,
  proposalBody,
  readyBody,
  resultBody,
  sessionInfo,
  sessionParams,
  slotAcquireReply,
  slotBody,
  slotReleaseReply,
  subtaskBody,
  subtaskReply,
} from "@aw/client/schemas";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { Logger } from "../log.ts";
import type { Daemon } from "../service/daemon.ts";
import { invalid, ServiceError } from "../service/errors.ts";

function sessions(daemon: Daemon) {
  if (!daemon.sessions) throw new ServiceError("refused", "Sessions are off on this device");
  return daemon.sessions;
}

function absolute(path: string): string {
  if (!isAbsolute(path)) throw invalid(`Give an absolute path, not ${path}`);
  return path;
}

const reply = <T>(value: unknown) => value as T;

export function registerSessionRoutes(
  app: FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, Logger>,
  daemon: Daemon,
): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["sessions"];

  api.get(
    "/v1/sessions",
    {
      schema: {
        tags,
        operationId: "listSessions",
        summary: "The agent sessions of this device",
        response: { 200: z.array(sessionInfo), ...errorReplies },
      },
    },
    () => reply<never>(daemon.sessions?.list() ?? []),
  );

  api.post(
    "/v1/sessions/:session/stop",
    {
      config: { access: "person" },
      schema: {
        tags,
        operationId: "stopSession",
        summary: "Stop a session by its process group (session.ended, reason stopped)",
        params: sessionParams,
        response: { 200: sessionInfo, ...errorReplies },
      },
    },
    async (request) => reply<never>(await sessions(daemon).stopSession(request.params.session)),
  );

  api.post(
    "/v1/sessions/:session/ask",
    {
      config: { access: "agent" },
      schema: {
        tags,
        operationId: "ask",
        summary: "aw ask: open the gate Answer question (gate.opened, kind question)",
        params: sessionParams,
        body: askBody,
        response: { 200: askReply, ...errorReplies },
      },
    },
    async (request) =>
      reply<never>(
        await sessions(daemon)
          .manager(request.params.session)
          .ask(request.params.session, request.body),
      ),
  );

  api.post(
    "/v1/sessions/:session/message",
    {
      config: { access: "agent" },
      schema: {
        tags,
        operationId: "agentMessage",
        summary: "aw message: a message of the agent (message.agent, in the 1-second buffer)",
        params: sessionParams,
        body: messageBody,
        response: { 200: agentWriteReply, ...errorReplies },
      },
    },
    (request) =>
      reply<never>(
        sessions(daemon)
          .manager(request.params.session)
          .message(request.params.session, request.body),
      ),
  );

  api.post(
    "/v1/sessions/:session/stage",
    {
      config: { access: "agent" },
      schema: {
        tags,
        operationId: "stage",
        summary: "aw stage: the progress line (task.progress, in the 1-second buffer)",
        params: sessionParams,
        body: messageBody,
        response: { 200: agentWriteReply, ...errorReplies },
      },
    },
    (request) =>
      reply<never>(
        sessions(daemon)
          .manager(request.params.session)
          .stage(request.params.session, request.body),
      ),
  );

  api.post(
    "/v1/sessions/:session/artifacts",
    {
      config: { access: "agent" },
      schema: {
        tags,
        operationId: "addArtifact",
        summary: "aw artifact add: copy a file into artifacts/<device>/ (artifact.added)",
        params: sessionParams,
        body: fileBody,
        response: { 200: agentWriteReply, ...errorReplies },
      },
    },
    async (request) =>
      reply<never>(
        await sessions(daemon)
          .manager(request.params.session)
          .addArtifact(request.params.session, {
            ...request.body,
            path: absolute(request.body.path),
          }),
      ),
  );

  api.post(
    "/v1/sessions/:session/handoff",
    {
      config: { access: "agent" },
      schema: {
        tags,
        operationId: "handoff",
        summary: "aw handoff: the context for the next session (handoff.written)",
        params: sessionParams,
        body: fileBody,
        response: { 200: agentWriteReply, ...errorReplies },
      },
    },
    async (request) =>
      reply<never>(
        await sessions(daemon)
          .manager(request.params.session)
          .handoff(request.params.session, { ...request.body, path: absolute(request.body.path) }),
      ),
  );

  api.post(
    "/v1/sessions/:session/permission",
    {
      config: { access: "agent" },
      schema: {
        tags,
        operationId: "permissionRequest",
        summary:
          "The PermissionRequest hook: a rule, or the gate Approve command. The reply comes with the answer, or after 120 s.",
        params: sessionParams,
        body: permissionBody,
        response: { 200: permissionReply, ...errorReplies },
      },
    },
    async (request) =>
      reply<never>(
        await sessions(daemon)
          .manager(request.params.session)
          .permission(request.params.session, request.body),
      ),
  );

  // ---- The work loop (add-task-loop): each route acts only on the session task. ----
  const loopRoute = <B extends z.ZodType>(
    path: string,
    operationId: string,
    summary: string,
    body: B,
    response: z.ZodType,
    run: (session: string, body: z.infer<B>) => Promise<unknown>,
  ) =>
    api.post(
      `/v1/sessions/:session/${path}`,
      {
        config: { access: "agent" },
        schema: {
          tags,
          operationId,
          summary,
          params: sessionParams,
          body,
          response: { 200: response, ...errorReplies },
        },
      },
      async (request) =>
        reply<never>(await run(request.params.session, request.body as z.infer<B>)),
    );

  loopRoute(
    "proposal",
    "proposeProposal",
    "aw proposal: proposal/v<n>.md, proposal.proposed and the gate Approve proposal",
    proposalBody,
    loopReply,
    (session, body) => sessions(daemon).manager(session).proposal(session, body),
  );
  // The route of an older aw CLI (before openspec proposal-and-discussion).
  loopRoute(
    "approach",
    "proposeProposalOldRoute",
    "The old route of aw proposal, for an older aw CLI",
    proposalBody,
    loopReply,
    (session, body) => sessions(daemon).manager(session).proposal(session, body),
  );
  loopRoute(
    "ready",
    "reportReady",
    "aw ready: task.ready, a question gate per missing item, then the ready checks",
    readyBody,
    loopReply,
    (session, body) => sessions(daemon).manager(session).ready(session, body),
  );
  loopRoute(
    "tasks",
    "createSubtask",
    "aw task create in a session: a subtask of the session task (task.created by the agent)",
    subtaskBody,
    subtaskReply,
    (session, body) => sessions(daemon).manager(session).createSubtask(session, body),
  );
  loopRoute(
    "gate",
    "openGate",
    "aw gate open: a custom gate with Markdown and options",
    customGateBody,
    loopReply,
    (session, body) => sessions(daemon).manager(session).gate(session, body),
  );
  loopRoute(
    "result",
    "postResult",
    "aw result: result.posted, the gate Approve result and the stage Review",
    resultBody,
    loopReply,
    (session, body) =>
      sessions(daemon)
        .manager(session)
        .result(session, {
          ...body,
          path: absolute(body.path),
          artifacts: body.artifacts.map(absolute),
        }),
  );
  loopRoute(
    "done",
    "markDone",
    "aw done: task.done after an approved result; AW closes the session at the next Stop",
    doneBody,
    loopReply,
    (session, body) => sessions(daemon).manager(session).done(session, body),
  );

  // ---- Test slots (add-continuity): a lease of the device that has the resource. ----
  loopRoute(
    "slots/acquire",
    "acquireSlot",
    "aw slot acquire: a lease of a test slot (slot.acquired), a renewal, or the queue position",
    slotBody,
    slotAcquireReply,
    (session, body) => sessions(daemon).manager(session).slotAcquire(session, body),
  );
  loopRoute(
    "slots/release",
    "releaseSlot",
    "aw slot release: slot.released for the lease of the session",
    slotBody,
    slotReleaseReply,
    (session, body) => sessions(daemon).manager(session).slotRelease(session, body),
  );
}
