// The remove of a project (openspec project-remove): the preview, the removal event and the rule that
// drops the checkouts of a removed project from the bindings of this device. The CLI, the local API
// and the desktop app call only these functions. AW deletes no task folder, log or project file: the
// merge hides the project and its tasks (principle 8).
import type { WorkspaceView } from "@aw/core";
import type { BindingsDocument, ProjectDocument } from "@aw/schema";
import { notFound } from "./errors.ts";
import type { WorkspaceService } from "./workspace.ts";

export interface RemovalPreview {
  project: { slug: string; name: string };
  /** The tasks that are not done and not archived. */
  tasks: { id: string; key: string | null; title: string | null; stage: string }[];
  /** The running sessions of the tasks, on each device. */
  sessions: { task: string; key: string | null; session: string; device: string }[];
}

/** One worktree or branch of a removed task on this device, and what AW did with it. */
export interface CleanupItem {
  task: string;
  key: string | null;
  /** The worktree folder, or null when the session worked in no folder of AW. */
  path: string | null;
  branch: string | null;
  result: "removed" | "kept";
  /** Why AW kept it, for example "unpushed commits". Null when AW removed it. */
  reason: string | null;
}

export interface RemoveProjectReply extends RemovalPreview {
  removed: { event: string; hlc: string };
  /** The cleanup on this device. The other devices clean their own worktrees when they sync. */
  cleanup: CleanupItem[];
}

/** The cleanup of this device for one removal: the session service, or null when it has none. */
export type LocalCleanup = (event: string) => Promise<CleanupItem[] | null>;

function liveProject(service: WorkspaceService, slug: string) {
  const project = service.view.projects.find((p) => p.slug === slug);
  if (!project) throw notFound(`Project ${slug}`);
  return project;
}

/** The open tasks and the running sessions of a project: what a remove stops. */
export function projectRemoval(service: WorkspaceService, slug: string): RemovalPreview {
  const project = liveProject(service, slug);
  const tasks = service.view.tasks.filter((t) => t.project === slug);
  return {
    project: { slug, name: project.name },
    tasks: tasks
      .filter((t) => t.stage !== "done" && !t.archived)
      .map((t) => ({ id: t.id, key: t.key, title: t.title, stage: t.stage })),
    sessions: tasks.flatMap((t) =>
      t.session?.state === "running"
        ? [{ task: t.id, key: t.key, session: t.session.session, device: t.session.device }]
        : [],
    ),
  };
}

/**
 * Removes a project: one `project.removed` of the person of this device in the workspace log, with
 * a copy of `project.yaml`. Then the cleanup of this device runs (`local`): the stop of its sessions
 * of the project, and its worktrees and branches. Each other device acts when it syncs.
 */
export async function removeProject(
  service: WorkspaceService,
  slug: string,
  local?: LocalCleanup,
): Promise<RemoveProjectReply> {
  const preview = projectRemoval(service, slug);
  const path = `tasks/projects/${slug}/project.yaml`;
  const me = service.device.slug;
  const event = await service.write(async (files) => {
    const document: ProjectDocument = (await files.readDocument<"project">(path)).value;
    return files.writeEvent(
      `tasks/log/${me}.jsonl`,
      "project.removed",
      { project: slug, name: document.name, document },
      { by: `human@${me}` },
    );
  }, `tasks/log/${me}.jsonl`);
  // The event is on disk: a failed cleanup of this device must not turn the reply into an error,
  // because a retry then gets 404. The session check of this device tries the cleanup again.
  let cleanup: CleanupItem[] = [];
  try {
    cleanup = (await local?.(event.id)) ?? [];
  } catch (error) {
    service.log.warn({ err: error, project: slug }, "The cleanup after the remove failed");
  }
  return { ...preview, removed: { event: event.id, hlc: event.hlc }, cleanup };
}

/** The newest removal HLC of each removed slug of the view. */
export function removalHlcs(view: Pick<WorkspaceView, "removed_projects">): Map<string, string> {
  const out = new Map<string, string>();
  for (const removal of view.removed_projects) {
    const old = out.get(removal.slug);
    if (old === undefined || removal.removed.hlc > old) out.set(removal.slug, removal.removed.hlc);
  }
  return out;
}

/**
 * The checkouts of this device that a removal drops: a checkout of a removed slug whose `bound_at`
 * is missing or sorts before the newest removal. A checkout set after a re-add stays. Pure.
 */
export function removedCheckouts(
  view: Pick<WorkspaceView, "removed_projects">,
  bindings: Pick<BindingsDocument, "checkouts">,
): string[] {
  const removals = removalHlcs(view);
  return bindings.checkouts
    .filter((c) => {
      const removed = removals.get(c.project);
      return removed !== undefined && (c.bound_at === undefined || c.bound_at < removed);
    })
    .map((c) => c.project);
}
