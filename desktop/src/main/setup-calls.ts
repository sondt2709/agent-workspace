// Main side of the setup calls (openspec gap-setup): calls.ts sends each setup call here after the
// contract check.
import type { SetupClient } from "@aw/client/setup";
import type { CallRequest } from "../shared/contract.ts";
import { SETUP_CALLS, type SetupCallMethod } from "../shared/setup-channels.ts";

/** The parts of the clients that the setup calls use. */
export type SetupCallClient = Pick<
  SetupClient,
  | "initWorkspace"
  | "addProject"
  | "renameWorkspace"
  | "editWorkspace"
  | "removeWorkspace"
  | "editProject"
  | "projectRemoval"
  | "removeProject"
  | "bindings"
  | "editBindings"
  | "syncSettings"
  | "setSyncSettings"
>;

export type SetupCallRequest = Extract<CallRequest, { method: SetupCallMethod }>;

export function isSetupCall(request: CallRequest): request is SetupCallRequest {
  return (SETUP_CALLS as readonly string[]).includes(request.method);
}

export function runSetupCall(request: SetupCallRequest, setup: SetupCallClient): Promise<unknown> {
  switch (request.method) {
    case "initWorkspace":
      return setup.initWorkspace(request.args);
    case "renameWorkspace":
      return setup.renameWorkspace(request.args.ws, request.args.name);
    case "editWorkspace":
      return setup.editWorkspace(request.args.ws, request.args.body);
    case "removeWorkspace":
      return setup.removeWorkspace(request.args.ws);
    case "addProject":
      return setup.addProject(request.args.ws, request.args.body);
    case "editProject":
      return setup.editProject(request.args.ws, request.args.project, request.args.body);
    case "projectRemoval":
      return setup.projectRemoval(request.args.ws, request.args.project);
    case "removeProject":
      return setup.removeProject(request.args.ws, request.args.project);
    case "bindings":
      return setup.bindings(request.args.ws);
    case "editBindings":
      return setup.editBindings(request.args.ws, request.args.body);
    case "syncSettings":
      return setup.syncSettings();
    case "setSyncSettings":
      return setup.setSyncSettings(request.args.community);
  }
}
