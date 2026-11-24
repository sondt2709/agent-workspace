// The terminal route (openspec task-terminal-view): the newest terminal snapshot of a task and the
// targets of "Open the terminal" and "Sign in". A thin adapter over `terminalView`; a person route,
// so a session caller gets 403 refused.
import { taskFilesParams } from "@aw/client/desktop";
import { errorReplies } from "@aw/client/schemas";
import { terminalReply } from "@aw/client/terminal";
import type { Daemon } from "../service/daemon.ts";
import { terminalView } from "../service/terminal.ts";
import type { ZodApi } from "./knowledge.ts";

export function registerTerminalRoutes(api: ZodApi, daemon: Daemon): void {
  api.get(
    "/v1/workspaces/:ws/tasks/:task/terminal",
    {
      config: { access: "person" },
      schema: {
        tags: ["tasks"],
        operationId: "getTaskTerminal",
        summary:
          "The newest terminal snapshot of a task, and how to open its terminal and sign in on its device",
        params: taskFilesParams,
        response: { 200: terminalReply, ...errorReplies },
      },
    },
    async (request) => {
      const ws = daemon.workspace(request.params.ws === "-" ? undefined : request.params.ws);
      return (await terminalView(ws, request.params.task, daemon.sessions)) as never;
    },
  );
}
