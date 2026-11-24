// The routes of the desktop screens that the other route files do not have (openspec
// add-desktop-devices-knowledge, local-api): presence, the session hosts of each computer, the
// files of a task folder, and the restore of the last valid version of a document. A thin adapter
// over the services. Each one is a person route (integrate-ui): a session caller gets 403 refused.
import {
  presenceParams,
  presenceReply,
  restoreBody,
  restoreReply,
  sessionHostsReply,
  taskFileContent,
  taskFileQuery,
  taskFilesParams,
  taskFilesReply,
} from "@aw/client/desktop";
import { errorReplies } from "@aw/client/schemas";
import type { Daemon } from "../service/daemon.ts";
import { sessionHosts } from "../service/session-hosts.ts";
import { listTaskFiles, readTaskFile, restoreDocument } from "../service/task-files.ts";
import type { ZodApi } from "./knowledge.ts";

const person = { access: "person" } as const;

async function reply(value: unknown): Promise<never> {
  return (await value) as never;
}

export function registerDesktopRoutes(api: ZodApi, daemon: Daemon): void {
  const ws = (selector: string) => daemon.workspace(selector === "-" ? undefined : selector);

  api.get(
    "/v1/workspaces/:ws/presence",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "getPresence",
        summary: "The presence of each device (heartbeats) and the tasks of offline devices",
        params: presenceParams,
        response: { 200: presenceReply, ...errorReplies },
      },
    },
    (request) => reply(ws(request.params.ws).presenceView()),
  );

  api.get(
    "/v1/workspaces/:ws/session-hosts",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "listSessionHosts",
        summary: "The session hosts of each computer: Use Orca, the checkout hosts, Orca here",
        params: presenceParams,
        response: { 200: sessionHostsReply, ...errorReplies },
      },
    },
    (request) => reply(sessionHosts(ws(request.params.ws), daemon.sessions)),
  );

  api.get(
    "/v1/workspaces/:ws/tasks/:task/files",
    {
      config: person,
      schema: {
        tags: ["tasks"],
        operationId: "listTaskFiles",
        summary: "The files and folders of the folder of a task (read-only)",
        params: taskFilesParams,
        response: { 200: taskFilesReply, ...errorReplies },
      },
    },
    (request) => reply(listTaskFiles(ws(request.params.ws), request.params.task)),
  );

  api.get(
    "/v1/workspaces/:ws/tasks/:task/files/content",
    {
      config: person,
      schema: {
        tags: ["tasks"],
        operationId: "readTaskFile",
        summary: "The text of one file of the folder of a task (at most 1 MiB, UTF-8)",
        params: taskFilesParams,
        querystring: taskFileQuery,
        response: { 200: taskFileContent, ...errorReplies },
      },
    },
    (request) =>
      reply(readTaskFile(ws(request.params.ws), request.params.task, request.query.path)),
  );

  api.post(
    "/v1/workspaces/:ws/documents/restore",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "restoreDocument",
        summary: "Write the last valid version of a document that fails its schema",
        params: presenceParams,
        body: restoreBody,
        response: { 200: restoreReply, ...errorReplies },
      },
    },
    (request) => reply(restoreDocument(ws(request.params.ws), request.body.path)),
  );
}
