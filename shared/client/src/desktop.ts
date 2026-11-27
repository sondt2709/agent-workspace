// The routes that the desktop app needs beyond the task, identity, sync and knowledge routes
// (openspec add-desktop-devices-knowledge): presence, the session hosts of each computer
// (integrate-ui), the files of a task folder and the restore of the last valid version of a
// document. awd checks each request with these schemas and generates
// contracts/openapi.yaml from them. The reply types are in views.ts.
import { z } from "zod";
import type { AwClient } from "./index.ts";
import { queuesReplyRead, type QueuesReply } from "./queues.ts";
import { terminalReply, type TerminalReply } from "./terminal.ts";
import type {
  PresenceReply,
  RestoreReply,
  SessionHostsReply,
  TaskFileContent,
  TaskFilesReply,
} from "./views.ts";

const selector = z.string().min(1).max(128);

// ---- Inputs -------------------------------------------------------------------------------

export const presenceParams = z.object({
  ws: selector.describe("The workspace id or name. `-` selects the only workspace."),
});
export const taskFilesParams = presenceParams.extend({
  task: selector.describe("The task id, the key or an id prefix of 8+ characters"),
});
export const taskFileQuery = z.object({
  path: z
    .string()
    .min(1)
    .max(1024)
    .describe("A path from the workspace root inside tasks/<task id>/"),
});
export const restoreBody = z.object({
  path: z
    .string()
    .min(1)
    .max(1024)
    .describe("The document path from the workspace root, as the issue names it"),
});

// ---- Replies ------------------------------------------------------------------------------

export const presenceReply = z
  .looseObject({
    now: z.string(),
    devices: z.array(
      z.looseObject({
        device: z.string(),
        online: z.boolean(),
        last_heartbeat_hlc: z.string().nullable(),
        received_at: z.string().nullable(),
        offline_since: z.string().nullable(),
      }),
    ),
    offline_tasks: z.array(
      z.looseObject({
        task: z.string(),
        device: z.string(),
        cause: z.string(),
        since: z.string(),
      }),
    ),
  })
  .meta({ id: "Presence" });

const orcaState = z.looseObject({
  available: z.boolean(),
  version: z.string().nullable(),
  reason: z.string().nullable(),
});

export const sessionHostsReply = z
  .looseObject({
    device: z.string().describe("This device"),
    devices: z.array(
      z.looseObject({
        device: z.string(),
        may_run: z.boolean(),
        use_orca: z.boolean().describe("Use Orca on this device (bindings.yaml)"),
        checkouts: z.array(
          z.looseObject({
            project: z.string(),
            session_host: z.enum(["tmux", "orca"]).nullable(),
            has_commit: z
              .boolean()
              .nullable()
              .describe(
                "From health.yaml of the device: false disables Separate worktree; null: not known",
              ),
          }),
        ),
        orca: orcaState
          .nullable()
          .describe("The Orca detection of this device; null for another device (not known)"),
      }),
    ),
  })
  .meta({ id: "SessionHosts" });

export const taskFilesReply = z
  .looseObject({
    task: z.string(),
    root: z.string().describe("The task folder from the workspace root: tasks/<task id>"),
    entries: z.array(
      z.looseObject({
        path: z.string(),
        name: z.string(),
        kind: z.enum(["dir", "file"]),
        size: z.int(),
        modified: z.string(),
      }),
    ),
    truncated: z.boolean(),
  })
  .meta({ id: "TaskFiles" });

export const taskFileContent = z
  .looseObject({
    path: z.string(),
    size: z.int(),
    modified: z.string(),
    text: z.string().nullable(),
    reason: z.enum(["too_large", "binary"]).nullable(),
  })
  .meta({ id: "TaskFileContent" });

export const restoreReply = z
  .looseObject({ path: z.string(), kind: z.string(), restored: z.boolean() })
  .meta({ id: "RestoreDocument" });

// ---- Client -------------------------------------------------------------------------------

const encode = encodeURIComponent;

export class DesktopClient {
  readonly #client: AwClient;

  constructor(client: AwClient) {
    this.#client = client;
  }

  presence = (ws: string) =>
    this.#client.request<PresenceReply>(
      "GET",
      `/v1/workspaces/${encode(ws)}/presence`,
      presenceReply,
    );
  sessionHosts = (ws: string) =>
    this.#client.request<SessionHostsReply>(
      "GET",
      `/v1/workspaces/${encode(ws)}/session-hosts`,
      sessionHostsReply,
    );
  taskFiles = (ws: string, task: string) =>
    this.#client.request<TaskFilesReply>(
      "GET",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/files`,
      taskFilesReply,
    );
  taskFile = (ws: string, task: string, path: string) =>
    this.#client.request<TaskFileContent>(
      "GET",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/files/content`,
      taskFileContent,
      { query: { path } },
    );
  /** The agent queues and the tasks that need an assignee (openspec queue-and-assign). */
  queues = (ws: string) =>
    this.#client.request<QueuesReply>(
      "GET",
      `/v1/workspaces/${encode(ws)}/queues`,
      queuesReplyRead,
    );
  /** The newest terminal snapshot of a task and its open targets (openspec task-terminal-view). */
  terminal = (ws: string, task: string) =>
    this.#client.request<TerminalReply>(
      "GET",
      `/v1/workspaces/${encode(ws)}/tasks/${encode(task)}/terminal`,
      terminalReply,
    );
  restoreDocument = (ws: string, path: string) =>
    this.#client.request<RestoreReply>(
      "POST",
      `/v1/workspaces/${encode(ws)}/documents/restore`,
      restoreReply,
      { body: { path } },
    );
}
