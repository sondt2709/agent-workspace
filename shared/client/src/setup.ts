// The setup routes (openspec gap-setup): rename and remove a workspace, edit a project, the bindings
// of this device and the community switch. awd checks each request with these schemas and
// generates contracts/openapi.yaml from them. The reply types are in views.ts.
import { deviceSlug, entryName, permissionMode, projectSlug, sessionHost } from "@aw/schema";
import { z } from "zod";
import type { AwClient } from "./index.ts";
import { projectView, workspaceSummary } from "./schemas.ts";
import type { AddProjectInput, InitWorkspaceInput, Project, WorkspaceSummary } from "./types.ts";
import type {
  BindingsView,
  EditBindingsInput,
  EditProjectInput,
  EditWorkspaceInput,
  SyncSettingsView,
  WorkspaceRemoveReply,
} from "./views.ts";

const selector = z.string().min(1).max(128);

// ---- Inputs -------------------------------------------------------------------------------

export const setupWsParams = z.object({
  ws: selector.describe("The workspace id or name. `-` selects the only workspace."),
});
export const projectParams = setupWsParams.extend({
  project: projectSlug.describe("The project slug"),
});

/** The fields of `tasks/workspace.yaml` that a person changes (openspec permissions-default). */
export const editWorkspaceBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional().describe("The name in tasks/workspace.yaml"),
    new_project_permission_mode: permissionMode
      .optional()
      .describe("The permission mode of new projects; skip counts only for tasks of a person"),
  })
  .meta({ id: "EditWorkspaceInput" });

const link = z.string().min(1).max(2000);

export const editProjectBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    devices: z
      .array(deviceSlug)
      .max(100)
      .optional()
      .describe("The implementing devices in priority order"),
    default_agent: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional(),
    links: z.array(link).max(100).optional(),
    main_repo: link
      .nullable()
      .optional()
      .describe("The main repository. awd adds it to the front of `links` when it is missing."),
    test_servers: z.array(entryName).max(100).optional(),
    switches: z
      .object({ assign_new_subtasks_to_default_device: z.boolean().optional() })
      .optional(),
    archived: z.boolean().optional().describe("An archived project gets no new tasks"),
    permission_mode: permissionMode
      .optional()
      .describe("The permission mode of new sessions; skip counts only for tasks of a person"),
  })
  .meta({ id: "EditProjectInput" });

export const editBindingsBody = z
  .object({
    use_orca: z.boolean().optional().describe("Use Orca on this device"),
    resources: z
      .record(entryName, z.int().min(1).max(1000))
      .optional()
      .describe("The full map of the test slot resources and their capacity"),
    checkouts: z
      .array(
        z.object({
          project: projectSlug,
          path: z
            .string()
            .min(1)
            .max(4096)
            .nullable()
            .describe("The absolute folder of the checkout; null removes the checkout"),
          session_host: sessionHost
            .nullable()
            .optional()
            .describe("Not set: keep the host of the old entry; null: the default host"),
        }),
      )
      .max(200)
      .optional(),
  })
  .meta({ id: "EditBindingsInput" });

export const syncSettingsBody = z.object({
  community: z.boolean().describe('"Use community discovery and relay servers"'),
});

// ---- Replies ------------------------------------------------------------------------------

export const workspaceRemoveReply = z
  .looseObject({
    id: z.string(),
    name: z.string().nullable(),
    path: z.string(),
    files_kept: z.boolean(),
    /** The keys of the open tasks that stay assigned to an agent of this device. */
    tasks: z.array(z.string()).default([]),
    message: z.string(),
  })
  .meta({ id: "WorkspaceRemove" });

const removalTask = z.looseObject({
  id: z.string(),
  key: z.string().nullable(),
  title: z.string().nullable(),
  stage: z.string(),
});
const removalSession = z.looseObject({
  task: z.string(),
  key: z.string().nullable(),
  session: z.string(),
  device: z.string(),
});

/** What a remove of the project stops (openspec project-remove). */
export const projectRemovalView = z
  .looseObject({
    project: z.looseObject({ slug: z.string(), name: z.string() }),
    tasks: z.array(removalTask).describe("The tasks that are not done and not archived"),
    sessions: z.array(removalSession).describe("The running sessions, on each device"),
  })
  .meta({ id: "ProjectRemoval" });
export type ProjectRemovalView = z.infer<typeof projectRemovalView>;

export const cleanupItem = z.looseObject({
  task: z.string(),
  key: z.string().nullable(),
  path: z.string().nullable(),
  branch: z.string().nullable(),
  result: z.enum(["removed", "kept"]),
  reason: z.string().nullable(),
});

export const removeProjectReply = projectRemovalView
  .extend({
    removed: z.looseObject({ event: z.string(), hlc: z.string() }),
    cleanup: z
      .array(cleanupItem)
      .describe(
        "The worktrees and branches of this device. Each other device cleans its own when it syncs.",
      ),
  })
  .meta({ id: "ProjectRemove" });
export type RemoveProjectReply = z.infer<typeof removeProjectReply>;

export const bindingsView = z
  .looseObject({
    device: z.string(),
    may_run: z.boolean(),
    use_orca: z.boolean(),
    checkouts: z.array(
      z.looseObject({
        project: z.string(),
        path: z.string(),
        session_host: z.enum(["tmux", "orca"]).optional(),
        bound_at: z.string().optional(),
      }),
    ),
    resources: z.record(z.string(), z.int()),
  })
  .meta({ id: "Bindings" });

export const syncSettingsView = z
  .looseObject({
    community: z.boolean(),
    source: z.enum(["env", "config", "default"]),
    text: z.string(),
    applied: z.enum(["now", "next_start"]).optional(),
  })
  .meta({ id: "SyncSettings" });

// ---- Client -------------------------------------------------------------------------------

const encode = encodeURIComponent;

export class SetupClient {
  readonly #client: AwClient;

  constructor(client: AwClient) {
    this.#client = client;
  }

  /** Creates or registers a workspace; no path gives `~/AW/<name>` ("Personal" by default). */
  initWorkspace = (body: InitWorkspaceInput) => this.#client.initWorkspace(body);
  addProject = (ws: string, body: AddProjectInput) => this.#client.addProject(ws, body);
  renameWorkspace = (ws: string, name: string) =>
    this.#client.request<WorkspaceSummary>(
      "PATCH",
      `/v1/workspaces/${encode(ws)}`,
      workspaceSummary,
      { body: { name } },
    );
  editWorkspace = (ws: string, body: EditWorkspaceInput) =>
    this.#client.request<WorkspaceSummary>(
      "PATCH",
      `/v1/workspaces/${encode(ws)}`,
      workspaceSummary,
      { body },
    );
  removeWorkspace = (ws: string) =>
    this.#client.request<WorkspaceRemoveReply>(
      "DELETE",
      `/v1/workspaces/${encode(ws)}`,
      workspaceRemoveReply,
    );
  editProject = (ws: string, project: string, body: EditProjectInput) =>
    this.#client.request<Project>(
      "PATCH",
      `/v1/workspaces/${encode(ws)}/projects/${encode(project)}`,
      projectView,
      { body },
    );
  projectRemoval = (ws: string, project: string) =>
    this.#client.request<ProjectRemovalView>(
      "GET",
      `/v1/workspaces/${encode(ws)}/projects/${encode(project)}/removal`,
      projectRemovalView,
    );
  removeProject = (ws: string, project: string) =>
    this.#client.request<RemoveProjectReply>(
      "POST",
      `/v1/workspaces/${encode(ws)}/projects/${encode(project)}/remove`,
      removeProjectReply,
      { body: {} },
    );
  bindings = (ws: string) =>
    this.#client.request<BindingsView>(
      "GET",
      `/v1/workspaces/${encode(ws)}/bindings`,
      bindingsView,
    );
  editBindings = (ws: string, body: EditBindingsInput) =>
    this.#client.request<BindingsView>(
      "PATCH",
      `/v1/workspaces/${encode(ws)}/bindings`,
      bindingsView,
      { body },
    );
  syncSettings = () =>
    this.#client.request<SyncSettingsView>("GET", "/v1/sync/settings", syncSettingsView);
  setSyncSettings = (community: boolean) =>
    this.#client.request<SyncSettingsView>("PUT", "/v1/sync/settings", syncSettingsView, {
      body: { community },
    });
}
