// The message route of the local API (add-desktop-app-shell): a person sends a message to the
// running session of a task. The route calls the workspace service. It is a person route: an
// agent sends its messages with the agent route `POST /v1/sessions/{session}/message`.
import { errorReplies, sendMessageBody, taskParams, taskWriteReply } from "@aw/client/schemas";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../log.ts";
import type { Daemon } from "../service/daemon.ts";

export function registerMessageRoutes(
  app: FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, Logger>,
  daemon: Daemon,
): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.post(
    "/v1/workspaces/:ws/tasks/:task/messages",
    {
      // A message of the person: a session caller gets 403 refused (add-mcp-server, decision 5).
      config: { access: "person" },
      schema: {
        tags: ["tasks"],
        operationId: "sendMessage",
        summary: "Send a message to the running session of the task (event message.sent)",
        params: taskParams,
        body: sendMessageBody,
        response: { 201: taskWriteReply, ...errorReplies },
      },
    },
    async (request, reply) => {
      const ws = request.params.ws;
      const result = await daemon
        .workspace(ws === "-" ? undefined : ws)
        .sendMessage(request.params.task, request.body.text);
      void reply.code(201);
      return result as never;
    },
  );
}
