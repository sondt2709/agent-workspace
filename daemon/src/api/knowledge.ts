// The knowledge routes of the local API (add-knowledge-store, design decision 14). A thin adapter:
// each route parses its input with zod and calls one method of the knowledge service.
import {
  changeResultView,
  contextView,
  digestView,
  historyEntryView,
  kbAcceptBody,
  kbCallerHeaders,
  kbChangeParams,
  kbContextBody,
  kbDigestQuery,
  kbFileQuery,
  kbHistoryQuery,
  kbLearnBody,
  kbListQuery,
  kbRejectBody,
  kbSearchQuery,
  kbSuggestionParams,
  kbSuggestionQuery,
  kbWriteBody,
  kbWsParams,
  knowledgeFileView,
  knowledgeVersionView,
  learnResultView,
  searchHitView,
  suggestionView,
} from "@aw/client/knowledge";
import { errorReplies } from "@aw/client/schemas";
import type { KnowledgeScope } from "@aw/plugin-api";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { z } from "zod";
import type { Logger } from "../log.ts";
import type { Daemon } from "../service/daemon.ts";
import { invalid, ServiceError } from "../service/errors.ts";
import type { KnowledgeCaller } from "../service/knowledge.ts";
import { recordLearning } from "../service/learning.ts";
import type { WorkspaceService } from "../service/workspace.ts";
import type { RequestCaller } from "./caller.ts";

const tags = ["knowledge"];

/** The fastify app of the local API with the zod type provider. */
export type ZodApi = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  Logger,
  ZodTypeProvider
>;

/**
 * The views of the store are interfaces with no index signature; the reply schemas are loose
 * objects. The serializer checks each reply against its schema at run time (as in app.ts).
 */
async function reply(value: Promise<unknown>): Promise<never> {
  return (await value) as never;
}

function scopeOf(query: {
  scope?: "all" | "shared" | "project" | undefined;
  project?: string | undefined;
}): KnowledgeScope {
  if (query.scope === "shared") return { kind: "shared" };
  if (query.scope === "project" || (query.scope === undefined && query.project)) {
    if (!query.project) {
      throw invalid("Give the project of the scope project", [
        { path: "project", message: "required" },
      ]);
    }
    return { kind: "project", project: query.project };
  }
  return { kind: "all" };
}

/**
 * The caller of a knowledge write: the person, or the agent of a running session of this device in
 * this workspace (the caller rule of caller.ts: the session token, or a process of the session).
 */
export function knowledgeCaller(service: WorkspaceService, caller: RequestCaller): KnowledgeCaller {
  if (caller === null) return null;
  if (caller.workspace !== service.id) {
    throw new ServiceError("refused", `Session ${caller.session} runs in another workspace`, {
      session_workspace: caller.workspace,
    });
  }
  const project = service.view.tasks.find((t) => t.id === caller.task)?.project ?? null;
  return { agent: caller.agent, session: caller.session, task: caller.task, project };
}

/** Adds the routes under `/v1/workspaces/:ws/knowledge`. */
export function registerKnowledgeRoutes(api: ZodApi, daemon: Daemon): void {
  const workspace = (selector: string) => daemon.workspace(selector === "-" ? undefined : selector);
  const kb = (selector: string) => workspace(selector).knowledge;
  /** The knowledge service and the caller of a write route. */
  const write = (selector: string, caller: RequestCaller) => {
    const service = workspace(selector);
    return { service, knowledge: service.knowledge, caller: knowledgeCaller(service, caller) };
  };
  const base = "/v1/workspaces/:ws/knowledge";

  api.get(
    base,
    {
      schema: {
        tags,
        operationId: "listKnowledge",
        summary: "List the knowledge files with their apply mode and last change",
        params: kbWsParams,
        querystring: kbListQuery,
        response: { 200: z.array(knowledgeFileView), ...errorReplies },
      },
    },
    (request) => reply(kb(request.params.ws).list(scopeOf(request.query))),
  );

  api.get(
    `${base}/file`,
    {
      schema: {
        tags,
        operationId: "readKnowledgeFile",
        summary: "Read a knowledge file, or a version from the history store",
        params: kbWsParams,
        querystring: kbFileQuery,
        response: { 200: knowledgeVersionView, ...errorReplies },
      },
    },
    (request) => reply(kb(request.params.ws).read(request.query.path, request.query.version)),
  );

  api.put(
    `${base}/file`,
    {
      config: { access: "caller" },
      schema: {
        tags,
        operationId: "writeKnowledgeFile",
        summary: "Write a knowledge file as the person, or as the agent of the session token",
        params: kbWsParams,
        headers: kbCallerHeaders,
        body: kbWriteBody,
        response: { 200: changeResultView, ...errorReplies },
      },
    },
    (request) => {
      const { knowledge, caller } = write(request.params.ws, request.caller);
      return reply(knowledge.write(request.body, caller));
    },
  );

  api.get(
    `${base}/history`,
    {
      schema: {
        tags,
        operationId: "getKnowledgeHistory",
        summary: "The changes of a path from all devices in merge order, with diffs",
        params: kbWsParams,
        querystring: kbHistoryQuery,
        response: { 200: z.array(historyEntryView), ...errorReplies },
      },
    },
    (request) => reply(kb(request.params.ws).history(request.query.path)),
  );

  api.post(
    `${base}/changes/:change/undo`,
    {
      config: { access: "caller" },
      schema: {
        tags,
        operationId: "undoKnowledgeChange",
        summary: "Undo a change: write its base content as a new change of kind undo",
        params: kbChangeParams,
        headers: kbCallerHeaders,
        response: { 200: changeResultView, ...errorReplies },
      },
    },
    (request) => {
      const { knowledge, caller } = write(request.params.ws, request.caller);
      return reply(knowledge.undo(request.params.change, caller));
    },
  );

  api.get(
    `${base}/search`,
    {
      schema: {
        tags,
        operationId: "searchKnowledge",
        summary: "Find the files that have each term of the query",
        params: kbWsParams,
        querystring: kbSearchQuery,
        response: { 200: z.array(searchHitView), ...errorReplies },
      },
    },
    (request) =>
      reply(
        kb(request.params.ws).search(request.query.q, scopeOf(request.query), request.query.limit),
      ),
  );

  api.post(
    `${base}/learn`,
    {
      config: { access: "caller" },
      schema: {
        tags,
        operationId: "learnKnowledge",
        summary:
          'The learning step of a task: a learned item in a new file (or a suggestion when it needs approval), or "Nothing new"; both write task.learned',
        params: kbWsParams,
        headers: kbCallerHeaders,
        body: kbLearnBody,
        response: { 200: learnResultView, ...errorReplies },
      },
    },
    (request) => {
      const { service, caller } = write(request.params.ws, request.caller);
      const task = service.liveTask(request.body.task);
      return reply(recordLearning(service, { ...request.body, task }, caller));
    },
  );

  api.get(
    `${base}/suggestions`,
    {
      schema: {
        tags,
        operationId: "listKnowledgeSuggestions",
        summary: "The agent changes that wait for approval (all with state=all)",
        params: kbWsParams,
        querystring: kbSuggestionQuery,
        response: { 200: z.array(suggestionView), ...errorReplies },
      },
    },
    (request) => reply(kb(request.params.ws).suggestions(request.query.state)),
  );

  api.post(
    `${base}/suggestions/:suggestion/accept`,
    {
      config: { access: "person" },
      schema: {
        tags,
        operationId: "acceptKnowledgeSuggestion",
        summary: "Accept a suggestion: apply it, then write knowledge.suggestion_resolved",
        params: kbSuggestionParams,
        headers: kbCallerHeaders,
        body: kbAcceptBody,
        response: { 200: changeResultView, ...errorReplies },
      },
    },
    (request) => {
      const { knowledge, caller } = write(request.params.ws, request.caller);
      return reply(knowledge.accept(request.params.suggestion, request.body, caller));
    },
  );

  api.post(
    `${base}/suggestions/:suggestion/reject`,
    {
      config: { access: "person" },
      schema: {
        tags,
        operationId: "rejectKnowledgeSuggestion",
        summary: "Reject a suggestion (knowledge.suggestion_resolved)",
        params: kbSuggestionParams,
        headers: kbCallerHeaders,
        body: kbRejectBody,
        response: { 200: suggestionView, ...errorReplies },
      },
    },
    (request) => {
      const { knowledge, caller } = write(request.params.ws, request.caller);
      return reply(knowledge.reject(request.params.suggestion, request.body, caller));
    },
  );

  api.get(
    `${base}/digest`,
    {
      schema: {
        tags,
        operationId: "getKnowledgeDigest",
        summary: "The daily digest: what the agents learned on a UTC date, and the pending changes",
        params: kbWsParams,
        querystring: kbDigestQuery,
        response: { 200: digestView, ...errorReplies },
      },
    },
    (request) => reply(kb(request.params.ws).digest(request.query.date)),
  );

  api.post(
    `${base}/context`,
    {
      // A read with a body: any caller (caller.ts).
      config: { access: "read" },
      schema: {
        tags,
        operationId: "buildKnowledgeContext",
        summary: "The knowledge context of a session of a task: files, budget, warnings, text",
        params: kbWsParams,
        body: kbContextBody,
        response: { 200: contextView, ...errorReplies },
      },
    },
    (request) => {
      const service = workspace(request.params.ws);
      const task = service.showTask(request.body.task);
      return reply(
        service.knowledge.context(task, {
          paths: request.body.paths,
          load_limit: request.body.load_limit,
        }),
      );
    },
  );
}
