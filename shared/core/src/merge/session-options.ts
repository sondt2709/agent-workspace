// The effective session options of a task (openspec session-options): what the next session of
// the task uses. The Kotlin port is `SessionOptions.effective` of android/shared.
import type { PermissionMode, WorkIn } from "@aw/schema";
import { isHuman } from "./task.ts";
import type { TaskView } from "./view.ts";

export interface EffectiveSessionOptions {
  permission_mode: PermissionMode;
  agent_teams: boolean;
  work_in: WorkIn;
  folder: string | null;
  /** True: a session in the checkout checks out `aw/<key>`; false: it keeps the branch. */
  switch_branch: boolean;
}

/**
 * The options of the next session: the options of the task, else the defaults. The mode is the
 * task value, else the project default; a project default `skip` counts only for a task that a
 * person created, so an agent subtask never runs with no gate.
 */
export function effectiveSessionOptions(
  task: Pick<TaskView, "session_options" | "created_by">,
  project: { permission_mode?: PermissionMode | undefined } | null | undefined,
): EffectiveSessionOptions {
  const own = task.session_options;
  const projectMode = project?.permission_mode ?? "default";
  const fallback = projectMode === "skip" && !isHuman(task.created_by) ? "default" : projectMode;
  return {
    permission_mode: own?.permission_mode ?? fallback,
    agent_teams: own?.agent_teams ?? false,
    work_in: own?.work_in ?? "worktree",
    folder: own?.work_in === "folder" ? own.folder : null,
    switch_branch: own?.switch_branch ?? true,
  };
}
