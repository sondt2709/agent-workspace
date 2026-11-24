// TanStack Query hooks of the setup screens (openspec gap-setup): workspaces, project settings, the
// bindings of this device and the community switch.
import { useQuery } from "@tanstack/react-query";
import type {
  EditBindingsInput,
  EditProjectInput,
  EditWorkspaceInput,
} from "../../shared/channels.ts";
import { call } from "./bridge.ts";
import { keys, useWrite } from "./queries.ts";

export const setupKeys = {
  bindings: (ws: string) => ["aw", "ws", ws, "bindings"] as const,
  syncSettings: () => ["aw", "sync-settings"] as const,
};

export const useBindings = (ws: string | undefined) =>
  useQuery({
    queryKey: setupKeys.bindings(ws ?? ""),
    queryFn: () => call("bindings", { ws: ws! }),
    enabled: !!ws,
  });

export const useSyncSettings = () =>
  useQuery({ queryKey: setupKeys.syncSettings(), queryFn: () => call("syncSettings", {}) });

export const useInitWorkspace = () =>
  useWrite(
    (args: { name?: string; path?: string; parent?: string }) => call("initWorkspace", args),
    () => [keys.workspaces(), keys.status(), keys.identity()],
  );

export const useRenameWorkspace = () =>
  useWrite(
    (args: { ws: string; name: string }) => call("renameWorkspace", args),
    () => [keys.workspaces(), keys.status()],
  );

/** Changes `tasks/workspace.yaml`: the permission mode of new projects (openspec permissions-default). */
export const useEditWorkspace = () =>
  useWrite(
    (args: { ws: string; body: EditWorkspaceInput }) => call("editWorkspace", args),
    () => [keys.workspaces(), keys.status()],
  );

export const useRemoveWorkspace = () =>
  useWrite(
    (ws: string) => call("removeWorkspace", { ws }),
    () => [keys.workspaces(), keys.status()],
  );

export const useAddProject = (ws: string) =>
  useWrite(
    (body: { slug: string; name?: string }) => call("addProject", { ws, body }),
    () => [keys.projects(ws), keys.workspaces()],
  );

export const useEditProject = (ws: string, project: string) =>
  useWrite(
    (body: EditProjectInput) => call("editProject", { ws, project, body }),
    () => [keys.projects(ws), keys.workspaces()],
  );

/** What a remove of the project stops (openspec project-remove); read when the dialog opens. */
export const useProjectRemoval = (ws: string, project: string, enabled: boolean) =>
  useQuery({
    queryKey: ["aw", "ws", ws, "projects", project, "removal"] as const,
    queryFn: () => call("projectRemoval", { ws, project }),
    enabled,
  });

export const useRemoveProject = (ws: string) =>
  useWrite(
    (project: string) => call("removeProject", { ws, project }),
    // Each view of the workspace changes: the projects, the tasks, the Inbox and the bindings.
    () => [["aw", "ws", ws] as const, keys.workspaces()],
  );

export const useEditBindings = (ws: string) =>
  useWrite(
    (body: EditBindingsInput) => call("editBindings", { ws, body }),
    () => [setupKeys.bindings(ws), keys.sessionHosts(ws)],
  );

export const useSetCommunity = () =>
  useWrite(
    (community: boolean) => call("setSyncSettings", { community }),
    () => [setupKeys.syncSettings(), keys.sync()],
  );
