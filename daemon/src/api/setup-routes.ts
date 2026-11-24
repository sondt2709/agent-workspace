// The setup routes of the local API (openspec gap-setup): edit and remove a workspace, edit a
// project, the bindings of this device and the community switch. A thin adapter over
// service/setup.ts and the daemon. Each write is a person route: a session caller gets 403 refused.
import { errorReplies, projectView, workspaceSummary } from "@aw/client/schemas";
import {
  bindingsView,
  editBindingsBody,
  editProjectBody,
  editWorkspaceBody,
  projectParams,
  projectRemovalView,
  removeProjectReply,
  setupWsParams,
  syncSettingsBody,
  syncSettingsView,
  workspaceRemoveReply,
} from "@aw/client/setup";
import type { Daemon } from "../service/daemon.ts";
import { projectRemoval, removeProject } from "../service/project-remove.ts";
import {
  editBindings,
  editProject,
  editWorkspace,
  readBindings,
  setSyncSettings,
  syncSettings,
} from "../service/setup.ts";
import type { ZodApi } from "./knowledge.ts";

const person = { access: "person" } as const;

async function reply(value: unknown): Promise<never> {
  return (await value) as never;
}

export function registerSetupRoutes(api: ZodApi, daemon: Daemon): void {
  const ws = (selector: string) => daemon.workspace(selector === "-" ? undefined : selector);

  api.patch(
    "/v1/workspaces/:ws",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "editWorkspace",
        summary:
          "Change the name or the permission mode of new projects in tasks/workspace.yaml. Give at least one field.",
        params: setupWsParams,
        body: editWorkspaceBody,
        response: { 200: workspaceSummary, ...errorReplies },
      },
    },
    (request) => reply(editWorkspace(ws(request.params.ws), request.body)),
  );

  api.delete(
    "/v1/workspaces/:ws",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "removeWorkspace",
        summary:
          "Unregister the workspace on this device. The files stay in the folder. 409 while a session of the workspace runs here.",
        params: setupWsParams,
        response: { 200: workspaceRemoveReply, ...errorReplies },
      },
    },
    async (request) => {
      const selector = request.params.ws === "-" ? undefined : request.params.ws;
      return reply(await daemon.removeWorkspace(selector ?? ""));
    },
  );

  api.patch(
    "/v1/workspaces/:ws/projects/:project",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "editProject",
        summary:
          "Change fields of tasks/projects/<slug>/project.yaml: name, devices, default agent, links, main repository, test servers, switches, archived",
        params: projectParams,
        body: editProjectBody,
        response: { 200: projectView, ...errorReplies },
      },
    },
    (request) => reply(editProject(ws(request.params.ws), request.params.project, request.body)),
  );

  api.get(
    "/v1/workspaces/:ws/projects/:project/removal",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "projectRemoval",
        summary: "What a remove of the project stops: its open tasks and its running sessions",
        params: projectParams,
        response: { 200: projectRemovalView, ...errorReplies },
      },
    },
    (request) => reply(projectRemoval(ws(request.params.ws), request.params.project)),
  );

  api.post(
    "/v1/workspaces/:ws/projects/:project/remove",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "removeProject",
        summary:
          "Remove the project (event project.removed). Its tasks leave each view, and the slug is free. Each device stops its sessions and cleans its worktrees. AW keeps the files.",
        params: projectParams,
        response: { 200: removeProjectReply, ...errorReplies },
      },
    },
    (request) => {
      const service = ws(request.params.ws);
      return reply(
        removeProject(service, request.params.project, (event) =>
          daemon.sessions
            ? daemon.sessions.projectRemoved(service.id, event)
            : Promise.resolve(null),
        ),
      );
    },
  );

  api.get(
    "/v1/workspaces/:ws/bindings",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "getBindings",
        summary: "The bindings of this device: checkouts, test slots and Use Orca",
        params: setupWsParams,
        response: { 200: bindingsView, ...errorReplies },
      },
    },
    (request) => reply(readBindings(ws(request.params.ws))),
  );

  api.patch(
    "/v1/workspaces/:ws/bindings",
    {
      config: person,
      schema: {
        tags: ["workspaces"],
        operationId: "editBindings",
        summary:
          "Change the bindings of this device: use_orca, resources (the full map) and checkouts (path null removes one)",
        params: setupWsParams,
        body: editBindingsBody,
        response: { 200: bindingsView, ...errorReplies },
      },
    },
    (request) => reply(editBindings(ws(request.params.ws), request.body)),
  );

  api.get(
    "/v1/sync/settings",
    {
      schema: {
        tags: ["sync"],
        operationId: "getSyncSettings",
        summary: "The switch 'Use community discovery and relay servers', its source and its text",
        response: { 200: syncSettingsView, ...errorReplies },
      },
    },
    () => reply(syncSettings(daemon)),
  );

  api.put(
    "/v1/sync/settings",
    {
      config: person,
      schema: {
        tags: ["sync"],
        operationId: "setSyncSettings",
        summary:
          "Save the community switch in config.yaml and apply it to the engine. 409 when AW_SYNC_COMMUNITY sets it.",
        body: syncSettingsBody,
        response: { 200: syncSettingsView, ...errorReplies },
      },
    },
    (request) => reply(setSyncSettings(daemon, request.body.community)),
  );
}
