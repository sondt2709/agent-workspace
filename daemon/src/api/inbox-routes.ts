// The inbox and source routes (openspec inbox-mattermost, spec local-api "Inbox routes"): thin
// adapters over the inbox service. Each one is a person route, so a session caller gets 403.
import {
  askReply,
  cardAskBody,
  cardListQuery,
  cardParams,
  cardReplyBody,
  cardStateBody,
  cardTaskBody,
  cardTaskReply,
  cardView,
  conversationsReply,
  inboxParams,
  okReply,
  replyReply,
  runBody,
  sourceBody,
  sourceParams,
  sourceStatus,
  sourceView,
} from "@aw/client/inbox-api";
import { errorReplies } from "@aw/client/schemas";
import { MattermostSource } from "@aw/source-mattermost";
import { z } from "zod";
import {
  askCard,
  configureSource,
  createTaskFromCard,
  getSource,
  listCards,
  listSources,
  replyCard,
  requestRun,
  setCardState,
  showCard,
} from "../inbox/service.ts";
import type { Daemon } from "../service/daemon.ts";
import { ServiceError } from "../service/errors.ts";
import type { ZodApi } from "./knowledge.ts";

export function registerInboxRoutes(api: ZodApi, daemon: Daemon): void {
  const ws = (id: string) => daemon.workspace(id === "-" ? undefined : id);
  const person = { access: "person" } as const;

  api.get(
    "/v1/workspaces/:ws/inbox/cards",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "listInboxCards",
        summary: "The Inbox cards, the newest message first",
        params: inboxParams,
        querystring: cardListQuery,
        response: { 200: z.array(cardView), ...errorReplies },
      },
    },
    (request) =>
      listCards(ws(request.params.ws), {
        ...(request.query.state ? { state: request.query.state } : {}),
        ...(request.query.unread ? { unread: request.query.unread === "true" } : {}),
      }) as never,
  );

  api.get(
    "/v1/workspaces/:ws/inbox/cards/:card",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "getInboxCard",
        summary: "One Inbox card with its messages, asks and replies",
        params: cardParams,
        response: { 200: cardView, ...errorReplies },
      },
    },
    (request) => showCard(ws(request.params.ws), request.params.card) as never,
  );

  api.post(
    "/v1/workspaces/:ws/inbox/cards/:card/state",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "setInboxCardState",
        summary: "Mark a card read or unread, done or not done; change its category or project",
        params: cardParams,
        body: cardStateBody,
        response: { 200: cardView, ...errorReplies },
      },
    },
    async (request) =>
      (await setCardState(ws(request.params.ws), request.params.card, request.body)) as never,
  );

  api.post(
    "/v1/workspaces/:ws/inbox/cards/:card/ask",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "askInboxCard",
        summary: "Ask the triage agent about a card (event inbox.ask)",
        params: cardParams,
        body: cardAskBody,
        response: { 200: askReply, ...errorReplies },
      },
    },
    async (request) =>
      (await askCard(ws(request.params.ws), request.params.card, request.body.text)) as never,
  );

  api.post(
    "/v1/workspaces/:ws/inbox/cards/:card/reply",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "replyInboxCard",
        summary: "Send a reply to the source; the collecting device posts it once",
        params: cardParams,
        body: cardReplyBody,
        response: { 200: replyReply, ...errorReplies },
      },
    },
    async (request) =>
      (await replyCard(
        ws(request.params.ws),
        request.params.card,
        request.body.text,
        request.body.in_thread ?? true,
      )) as never,
  );

  api.post(
    "/v1/workspaces/:ws/inbox/cards/:card/task",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "createTaskFromInboxCard",
        summary: "Create the task of a card (a task always has a project)",
        params: cardParams,
        body: cardTaskBody,
        response: { 201: cardTaskReply, ...errorReplies },
      },
    },
    async (request, reply) => {
      const result = await createTaskFromCard(
        ws(request.params.ws),
        request.params.card,
        request.body,
      );
      void reply.code(201);
      return result as never;
    },
  );

  api.post(
    "/v1/workspaces/:ws/inbox/run",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "runInbox",
        summary: "Run now: the collecting device reads the source and sends a batch",
        params: inboxParams,
        body: runBody,
        response: { 200: okReply, ...errorReplies },
      },
    },
    async (request) => {
      await requestRun(ws(request.params.ws), request.body.source);
      return { ok: true };
    },
  );

  api.get(
    "/v1/workspaces/:ws/sources",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "listSources",
        summary: "The sources of the Inbox",
        params: inboxParams,
        response: { 200: z.array(sourceView), ...errorReplies },
      },
    },
    (request) => listSources(ws(request.params.ws)) as never,
  );

  api.put(
    "/v1/workspaces/:ws/sources/:source",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "setSource",
        summary: "Write the whole configuration of a source (event source.configured)",
        params: sourceParams,
        body: sourceBody,
        response: { 200: sourceView, ...errorReplies },
      },
    },
    async (request) => {
      const service = ws(request.params.ws);
      const body = { ...request.body };
      // The account of the token, for "As @alex" on the reply form: read once here, on a computer.
      if (!body.username && service.device.role !== "mobile") {
        try {
          const token = await daemon.credentials.value(service, body.credential);
          body.username = (
            await new MattermostSource({ url: body.server_url, token }).me()
          ).username;
        } catch {
          // No token or no server yet: the source still saves; the status route shows the error.
        }
      }
      return (await configureSource(service, request.params.source, body)) as never;
    },
  );

  /** A source client on this computer, with the token of the credential. */
  const open = async (wsId: string, id: string) => {
    const service = ws(wsId);
    const source = getSource(service, id);
    if (service.device.role === "mobile") {
      throw new ServiceError("not_available", "A phone does not read a source");
    }
    const token = await daemon.credentials.value(service, source.credential);
    return new MattermostSource({ url: source.server_url, token });
  };

  api.get(
    "/v1/workspaces/:ws/sources/:source/conversations",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "listSourceConversations",
        summary: "The conversations that the account of the source can read",
        params: sourceParams,
        response: { 200: conversationsReply, ...errorReplies },
      },
    },
    async (request) => {
      const source = await open(request.params.ws, request.params.source);
      try {
        return (await source.conversations()) as never;
      } catch (error) {
        throw new ServiceError("not_available", (error as Error).message);
      }
    },
  );

  api.get(
    "/v1/workspaces/:ws/sources/:source/status",
    {
      config: person,
      schema: {
        tags: ["inbox"],
        operationId: "getSourceStatus",
        summary: "The collecting device, its health of the source, and a connection test here",
        params: sourceParams,
        response: { 200: sourceStatus, ...errorReplies },
      },
    },
    async (request) => {
      const service = ws(request.params.ws);
      const source = getSource(service, request.params.source);
      const health =
        source.collector === null
          ? null
          : ((
              service.lastValidDocument(`tasks/devices/${source.collector}/health.yaml`)?.value as
                { inbox?: unknown } | undefined
            )?.inbox ?? null);
      let user: { id: string; username: string } | null = null;
      let error: string | null = null;
      if (service.device.role !== "mobile") {
        try {
          user = await (await open(request.params.ws, request.params.source)).me();
        } catch (e) {
          error = (e as Error).message;
        }
      }
      return { source: source.source, collector: source.collector, health, user, error } as never;
    },
  );
}
