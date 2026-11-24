// The bridge calls of the setup screens (openspec gap-setup): create, rename, edit (openspec
// permissions-default) and remove a workspace, edit and remove a project (openspec project-remove), the bindings of this device and the community switch. Types only, so
// the sandboxed preload bundle stays small. channels.ts adds them to `CallMap`.
import type { ProjectRemovalView, RemoveProjectReply } from "@aw/client/setup";
import type {
  AddProjectInput,
  InitWorkspaceReply,
  Project,
  WorkspaceSummary,
} from "@aw/client/types";
import type {
  BindingsView,
  EditBindingsInput,
  EditProjectInput,
  EditWorkspaceInput,
  SyncSettingsView,
  WorkspaceRemoveReply,
} from "@aw/client/views";

type Ws = { ws: string };

export interface SetupCallMap {
  initWorkspace: {
    args: { name?: string; path?: string; parent?: string };
    result: InitWorkspaceReply;
  };
  renameWorkspace: { args: Ws & { name: string }; result: WorkspaceSummary };
  editWorkspace: { args: Ws & { body: EditWorkspaceInput }; result: WorkspaceSummary };
  removeWorkspace: { args: Ws; result: WorkspaceRemoveReply };
  addProject: { args: Ws & { body: AddProjectInput }; result: Project };
  editProject: { args: Ws & { project: string; body: EditProjectInput }; result: Project };
  projectRemoval: { args: Ws & { project: string }; result: ProjectRemovalView };
  removeProject: { args: Ws & { project: string }; result: RemoveProjectReply };
  bindings: { args: Ws; result: BindingsView };
  editBindings: { args: Ws & { body: EditBindingsInput }; result: BindingsView };
  syncSettings: { args: Record<string, never>; result: SyncSettingsView };
  setSyncSettings: { args: { community: boolean }; result: SyncSettingsView };
}

export type SetupCallMethod = keyof SetupCallMap;

/** The names of the setup calls: main sends them to setup-calls.ts. */
export const SETUP_CALLS: readonly SetupCallMethod[] = [
  "initWorkspace",
  "renameWorkspace",
  "editWorkspace",
  "removeWorkspace",
  "addProject",
  "editProject",
  "projectRemoval",
  "removeProject",
  "bindings",
  "editBindings",
  "syncSettings",
  "setSyncSettings",
];
