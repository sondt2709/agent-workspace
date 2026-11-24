// The queues route (openspec queue-and-assign): the queue of each agent with the position and the
// cause of each waiting task, and the tasks that need an assignee. A thin adapter over
// `queuesView`; a person route, so a session caller gets 403 refused.
import { presenceParams } from "@aw/client/desktop";
import { queuesReply } from "@aw/client/queues";
import { errorReplies } from "@aw/client/schemas";
import type { Daemon } from "../service/daemon.ts";
import { queuesView } from "../service/queues.ts";
import type { ZodApi } from "./knowledge.ts";

export function registerQueueRoutes(api: ZodApi, daemon: Daemon): void {
  api.get(
    "/v1/workspaces/:ws/queues",
    {
      config: { access: "person" },
      schema: {
        tags: ["workspaces"],
        operationId: "listQueues",
        summary:
          "The agent queues (position and cause of each waiting task) and the tasks with no assignee",
        params: presenceParams,
        response: { 200: queuesReply, ...errorReplies },
      },
    },
    (request) => {
      const ws = daemon.workspace(request.params.ws === "-" ? undefined : request.params.ws);
      return queuesView(ws, daemon.clock.now()) as never;
    },
  );
}
