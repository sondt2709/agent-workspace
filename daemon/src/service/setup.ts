// The setup of a workspace without a hand edit of a YAML file (openspec gap-setup): rename a
// workspace, edit or archive a project, the bindings of this device and the community switch. The
// local API and the CLI call only these functions. Each write is a read-modify-write in the write
// queue of the workspace (WorkspaceService.write), so it never runs at the same time as another
// write of the workspace.
import type { BindingsDocument, ProjectDocument, WorkspaceDocument } from "@aw/schema";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, normalize, relative, sep } from "node:path";
import type { Daemon } from "./daemon.ts";
import { invalid, notFound, ServiceError } from "./errors.ts";
import type { WorkspaceService } from "./workspace.ts";

/** The disclosure text of prd SYN-06 (decision D18), the same on each screen. */
export const COMMUNITY_TEXT =
  "Across networks, your devices use community Syncthing discovery and relay servers. They see your IP address, your device ids and the traffic volume, not your data. Turn them off to use LAN and Tailscale only.";

export interface EditProjectFields {
  name?: string | undefined;
  devices?: string[] | undefined;
  default_agent?: string | undefined;
  links?: string[] | undefined;
  main_repo?: string | null | undefined;
  test_servers?: string[] | undefined;
  switches?: { assign_new_subtasks_to_default_device?: boolean | undefined } | undefined;
  archived?: boolean | undefined;
  permission_mode?: "default" | "accept_edits" | "skip" | undefined;
}

export interface EditBindingsFields {
  use_orca?: boolean | undefined;
  resources?: Record<string, number> | undefined;
  checkouts?:
    | {
        project: string;
        path: string | null;
        /** Not set: keep the host of the old entry. null: the default host. */
        session_host?: "tmux" | "orca" | null | undefined;
      }[]
    | undefined;
}

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, i) => values.indexOf(value) !== i))];
}

export interface EditWorkspaceFields {
  name?: string | undefined;
  /** The permission mode of new projects (openspec permissions-default). */
  new_project_permission_mode?: "default" | "accept_edits" | "skip" | undefined;
}

/** The new value of `workspace.yaml` after an edit. Pure, for the tests. */
export function editedWorkspace(
  old: WorkspaceDocument,
  fields: EditWorkspaceFields,
): WorkspaceDocument {
  const next: WorkspaceDocument = structuredClone(old);
  if (fields.name !== undefined) next.name = fields.name.trim();
  if (fields.new_project_permission_mode !== undefined) {
    next.new_project_permission_mode = fields.new_project_permission_mode;
  }
  return next;
}

/**
 * Changes the given fields of `tasks/workspace.yaml` (a shared file): the name and the permission
 * mode of new projects. A person route and a person command call it (openspec permissions-default).
 */
export async function editWorkspace(service: WorkspaceService, fields: EditWorkspaceFields) {
  if (fields.name === undefined && fields.new_project_permission_mode === undefined) {
    throw invalid("Give at least one field: name or new_project_permission_mode");
  }
  if (fields.name !== undefined && fields.name.trim().length === 0) {
    throw invalid("Give a name", [{ path: "name", message: "required" }]);
  }
  await service.write(async (files) => {
    const doc = await files.readDocument<"workspace">("tasks/workspace.yaml");
    const next = editedWorkspace(doc.value, fields);
    if (JSON.stringify(next) === JSON.stringify(doc.value)) return;
    await files.writeDocument("tasks/workspace.yaml", next);
  }, "tasks/workspace.yaml");
  return service.summary();
}

/** Writes the new name to `tasks/workspace.yaml` (a shared file). */
export function renameWorkspace(service: WorkspaceService, name: string) {
  return editWorkspace(service, { name });
}

/** The new value of `project.yaml` after an edit. Pure, for the tests. */
export function editedProject(old: ProjectDocument, fields: EditProjectFields): ProjectDocument {
  const next: ProjectDocument = structuredClone(old);
  if (fields.name !== undefined) next.name = fields.name.trim();
  if (fields.devices !== undefined) next.devices = [...fields.devices];
  if (fields.default_agent !== undefined) next.default_agent = fields.default_agent;
  if (fields.links !== undefined) next.links = [...fields.links];
  if (fields.main_repo !== undefined) next.main_repo = fields.main_repo;
  if (fields.test_servers !== undefined) next.test_servers = [...fields.test_servers];
  if (fields.archived !== undefined) next.archived = fields.archived;
  if (fields.permission_mode !== undefined) next.permission_mode = fields.permission_mode;
  const subtasks = fields.switches?.assign_new_subtasks_to_default_device;
  if (subtasks !== undefined) {
    next.switches = { ...next.switches, assign_new_subtasks_to_default_device: subtasks };
  }
  // The main repository is one of the links (prd WS-07): it goes to the front when it is missing.
  if (next.main_repo && !next.links.includes(next.main_repo)) {
    next.links = [next.main_repo, ...next.links];
  }
  return next;
}

/** Changes the given fields of `tasks/projects/<slug>/project.yaml` (a shared file). */
export async function editProject(
  service: WorkspaceService,
  slug: string,
  fields: EditProjectFields,
) {
  const given = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (given.length === 0) {
    throw invalid(
      "Give at least one field: name, devices, default_agent, links, main_repo, test_servers, switches or archived",
    );
  }
  for (const [field, list] of [
    ["devices", fields.devices],
    ["links", fields.links],
    ["test_servers", fields.test_servers],
  ] as const) {
    const twice = duplicates(list ?? []);
    if (twice.length > 0) {
      throw invalid(`${field} lists ${twice.join(", ")} more than once`, [
        { path: field, message: "duplicate" },
      ]);
    }
  }
  if (!service.view.projects.some((p) => p.slug === slug)) throw notFound(`Project ${slug}`);
  const path = `tasks/projects/${slug}/project.yaml`;
  await service.write(async (files) => {
    const doc = await files.readDocument<"project">(path);
    const next = editedProject(doc.value, fields);
    if (JSON.stringify(next) === JSON.stringify(doc.value)) return;
    await files.writeDocument(path, next);
  }, path);
  const project = service.view.projects.find((p) => p.slug === slug);
  if (!project) throw notFound(`Project ${slug}`);
  return project;
}

const bindingsPath = (service: WorkspaceService) =>
  `tasks/devices/${service.device.slug}/bindings.yaml`;

/** The bindings of a device that has no `bindings.yaml` yet. */
function emptyBindings(service: WorkspaceService): BindingsDocument {
  return {
    kind: "bindings",
    schema: 1,
    device: service.device.slug,
    may_run: service.device.role !== "mobile",
    use_orca: false,
    checkouts: [],
    plugins: [],
    skills: [],
    resources: {},
    vapid_public_key: null,
  };
}

/** The bindings of this device. */
export async function readBindings(service: WorkspaceService): Promise<BindingsDocument> {
  try {
    return (await service.files.readDocument<"bindings">(bindingsPath(service))).value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyBindings(service);
    throw error;
  }
}

/** The new bindings after an edit. Pure, for the tests. */
export function editedBindings(
  old: BindingsDocument,
  fields: EditBindingsFields,
  /** The HLC of this change: each new or changed checkout gets it as `bound_at` (project-remove). */
  boundAt?: string,
): BindingsDocument {
  const next: BindingsDocument = structuredClone(old);
  if (fields.use_orca !== undefined) next.use_orca = fields.use_orca;
  if (fields.resources !== undefined) next.resources = { ...fields.resources };
  for (const change of fields.checkouts ?? []) {
    const rest = next.checkouts.filter((c) => c.project !== change.project);
    if (change.path === null) {
      next.checkouts = rest;
      continue;
    }
    // A new path keeps the host of the old entry unless the request names one (gap-setup L4).
    const host =
      change.session_host === undefined
        ? next.checkouts.find((c) => c.project === change.project)?.session_host
        : change.session_host;
    const before = next.checkouts.find((c) => c.project === change.project);
    const same = before?.path === change.path && before.session_host === (host ?? undefined);
    const stamp = same ? before.bound_at : boundAt;
    const entry = {
      project: change.project,
      path: change.path,
      ...(host ? { session_host: host } : {}),
      ...(stamp ? { bound_at: stamp } : {}),
    };
    const at = next.checkouts.findIndex((c) => c.project === change.project);
    next.checkouts =
      at < 0 ? [...rest, entry] : next.checkouts.map((c, i) => (i === at ? entry : c));
  }
  return next;
}

/** True when `folder` is `root` or a folder inside it. Both paths are absolute and normalized. */
export function isInside(folder: string, root: string): boolean {
  const rel = relative(root, folder);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Checks a checkout path: absolute, an existing folder, and not in the workspace folder `root`
 * (the devices sync that folder, so a checkout there syncs too). Symbolic links are resolved
 * before the check. Returns the normalized path.
 */
async function checkoutPath(path: string, project: string, root: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw invalid(`Give an absolute checkout path for ${project}, not ${path}`, [
      { path: "checkouts.path", message: "not absolute" },
    ]);
  }
  const clean = normalize(path);
  const info = await stat(clean).catch(() => null);
  if (!info?.isDirectory()) {
    throw invalid(`The checkout path ${clean} of ${project} is not a folder on this device`, [
      { path: "checkouts.path", message: "not a folder" },
    ]);
  }
  const [real, realRoot] = await Promise.all([
    realpath(clean),
    realpath(root).catch(() => normalize(root)),
  ]);
  if (isInside(real, realRoot)) {
    throw invalid(
      `The checkout path ${clean} of ${project} is inside the workspace folder ${root}. Your devices sync that folder, so choose a checkout outside it`,
      [{ path: "checkouts.path", message: "inside the workspace folder" }],
    );
  }
  return clean;
}

/** Changes the bindings of this device: the checkouts, the test slots and "Use Orca". */
export async function editBindings(service: WorkspaceService, fields: EditBindingsFields) {
  if (service.device.role === "mobile") {
    throw new ServiceError("refused", "A phone runs no agent: it has no checkouts or test slots");
  }
  if (
    fields.use_orca === undefined &&
    fields.resources === undefined &&
    fields.checkouts === undefined
  ) {
    throw invalid("Give at least one field: use_orca, resources or checkouts");
  }
  const projects = (fields.checkouts ?? []).map((c) => c.project);
  const twice = duplicates(projects);
  if (twice.length > 0) {
    throw invalid(`checkouts lists ${twice.join(", ")} more than once`, [
      { path: "checkouts", message: "duplicate" },
    ]);
  }
  const checkouts: NonNullable<EditBindingsFields["checkouts"]> = [];
  for (const change of fields.checkouts ?? []) {
    if (change.path === null) {
      checkouts.push(change);
      continue;
    }
    if (!service.view.projects.some((p) => p.slug === change.project)) {
      throw invalid(`The project ${change.project} does not exist. Add it with "aw project add".`, [
        { path: "checkouts.project", message: "unknown project" },
      ]);
    }
    checkouts.push({
      ...change,
      path: await checkoutPath(change.path, change.project, service.root),
    });
  }
  const path = bindingsPath(service);
  await service.write(async (files) => {
    const old = await files.readDocument<"bindings">(path).then(
      (doc) => doc.value,
      (error: NodeJS.ErrnoException) => {
        // A file that fails its schema stays an error: the person fixes or restores it first.
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    const next = editedBindings(
      old ?? emptyBindings(service),
      { ...fields, checkouts },
      files.hlc.now(),
    );
    if (old && JSON.stringify(next) === JSON.stringify(old)) return;
    await files.writeDocument(path, next);
  }, path);
  return readBindings(service);
}

/** The community switch with its source and the disclosure text. */
export function syncSettings(daemon: Daemon) {
  return { ...daemon.communitySetting(), text: COMMUNITY_TEXT };
}

/** Saves the community switch and applies it to the engine. */
export async function setSyncSettings(daemon: Daemon, community: boolean) {
  const applied = await daemon.setCommunity(community);
  return { ...syncSettings(daemon), applied };
}
