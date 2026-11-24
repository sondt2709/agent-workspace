// The session options of a task (openspec session-options): the permission mode, agent teams and
// where the session works. The pure rules of the dialogs and of the task Properties.
import type { Project, Task } from "../../shared/channels.ts";

export type PermissionMode = "default" | "accept_edits" | "skip";
export type WorkIn = "worktree" | "checkout" | "folder";

/** The values of the fields. `mode: "project"` keeps the default of the project. */
export interface OptionsForm {
  mode: "project" | PermissionMode;
  teams: boolean;
  workIn: WorkIn;
  /** The absolute folder of "Other folder", else "". */
  folder: string;
}

export const DEFAULT_FORM: OptionsForm = {
  mode: "project",
  teams: false,
  workIn: "worktree",
  folder: "",
};

/**
 * The start values of New task: "Skip permissions", the product default (openspec
 * polish-skip-default). Only a person fills New task, so no agent task gets skip from it.
 */
export const NEW_TASK_FORM: OptionsForm = { ...DEFAULT_FORM, mode: "skip" };

export const MODE_LABEL: Record<PermissionMode, string> = {
  default: "Default",
  accept_edits: "Accept edits",
  skip: "Skip permissions",
};

export const MODE_HELP: Record<PermissionMode, string> = {
  default: "The agent asks you before each command and each edit that has no rule.",
  accept_edits: "The agent edits files in its folder with no question. Commands still ask you.",
  skip: "The agent runs each command with no gate. Only you can set this; subtasks never get it.",
};

export const WORK_IN_LABEL: Record<WorkIn, string> = {
  worktree: "Separate worktree",
  checkout: "Project checkout",
  folder: "Other folder…",
};

export const CHECKOUT_WARNING =
  "This changes the branch and the files of your checkout. One session at a time works there.";
/**
 * The warning of "Skip permissions" (check soc-1): the AW guard blocks the plain person commands,
 * but an agent that hides a command can still act as the person in AW (SECURITY.md).
 */
export const SKIP_WARNING =
  "The agent runs each command as you, with no gate. A hidden command can still act as you in AW: use it only for a task you trust.";

/** The session options of a task, as a person set them, or null. */
export interface TaskOptions {
  permission_mode: PermissionMode | null;
  agent_teams: boolean;
  work_in: WorkIn;
  folder: string | null;
}

/** The session of the task view with the fields of `session.started` (openspec session-options). */
export interface SessionFields {
  session: string;
  device: string;
  state: "running" | "ended";
  cwd: string | null;
  branch: string | null;
  permission_mode: PermissionMode | null;
  agent_teams: boolean | null;
  work_in: WorkIn | null;
}

function fields(task: Task) {
  const t = task as Task & {
    session_options?: TaskOptions | null;
    created_by?: string | null;
    session?: Partial<SessionFields> | null;
  };
  return {
    options: t.session_options ?? null,
    createdBy: t.created_by ?? null,
    session: t.session ?? null,
  };
}

/**
 * The project default mode (`project.yaml` `permission_mode`). A project with no value has the
 * product default `skip`; with no project, `default`.
 */
export function projectMode(project: Pick<Project, "permission_mode"> | undefined): PermissionMode {
  if (!project) return "default";
  const mode = project.permission_mode;
  return mode === "accept_edits" || mode === "default" ? mode : "skip";
}

/**
 * The options of the next session of the task: the task values, else the defaults. A project
 * `skip` counts only for a task that a person created (the rule of `effectiveSessionOptions`).
 */
export function nextOptions(task: Task, project: PermissionMode) {
  const { options, createdBy } = fields(task);
  const fallback = project === "skip" && !createdBy?.startsWith("human@") ? "default" : project;
  return {
    permission_mode: options?.permission_mode ?? fallback,
    agent_teams: options?.agent_teams ?? false,
    work_in: options?.work_in ?? "worktree",
    folder: options?.work_in === "folder" ? options.folder : null,
  };
}

/** The form of New session and Assign: the options of the task now. */
export function formOf(task: Task | undefined): OptionsForm {
  const options = task ? fields(task).options : null;
  if (!options) return DEFAULT_FORM;
  return {
    mode: options.permission_mode ?? "project",
    teams: options.agent_teams,
    workIn: options.work_in,
    folder: options.folder ?? "",
  };
}

/** The problem that blocks the dialog, or null. */
export function formProblem(form: OptionsForm): string | null {
  if (form.workIn !== "folder") return null;
  if (form.folder.trim() === "") return "Choose the folder of the session.";
  if (!form.folder.startsWith("/")) return "Use an absolute folder, for example /work/billing-api.";
  return null;
}

/** The full `session_options` of the form: New session and Assign replace the task options. */
export function fullOptionsBody(form: OptionsForm) {
  return {
    permission_mode: form.mode === "project" ? null : form.mode,
    agent_teams: form.teams,
    work_in: form.workIn,
    folder: form.workIn === "folder" ? form.folder.trim() : null,
  };
}

/**
 * The `session_options` of New session and Assign: the full options when the person changed the
 * form, else undefined (the task keeps its options).
 */
export function changedOptionsBody(form: OptionsForm, task: Task | undefined) {
  const before = formOf(task);
  const same =
    form.mode === before.mode &&
    form.teams === before.teams &&
    form.workIn === before.workIn &&
    form.folder.trim() === before.folder;
  return same ? undefined : fullOptionsBody(form);
}

/** The `session_options` of New task; null when the form has only the defaults. */
export function optionsBody(form: OptionsForm) {
  const same =
    form.mode === "project" && !form.teams && form.workIn === "worktree" && form.folder === "";
  return same ? null : fullOptionsBody(form);
}

/** The values that the task shows: the running session, else the next session. */
export interface ShownOptions {
  /** True: the values of a running session; false: the next session. */
  running: boolean;
  mode: PermissionMode;
  teams: boolean;
  /** The folder of the running or last session, or null. */
  path: string | null;
  branch: string | null;
  /** The device of that session, or null. */
  device: string | null;
  workIn: WorkIn;
  /** The folder of `work_in: folder` of the next session. */
  nextFolder: string | null;
}

export function shownOptions(task: Task, project: PermissionMode): ShownOptions {
  const { session } = fields(task);
  const next = nextOptions(task, project);
  const running = session?.state === "running";
  return {
    running,
    mode: running ? (session.permission_mode ?? "default") : next.permission_mode,
    teams: running ? (session.agent_teams ?? false) : next.agent_teams,
    path: session?.cwd ?? null,
    branch: session?.cwd ? (session.branch ?? null) : null,
    device: session?.device ?? null,
    workIn: running ? (session.work_in ?? "worktree") : next.work_in,
    nextFolder: next.folder,
  };
}

/** The "Works in" line: the folder and the branch of the session, else where the next one works. */
export function worksInText(shown: ShownOptions, key: string | null): string {
  if (shown.path) {
    const where = `${shown.path}${shown.branch ? ` · branch ${shown.branch}` : " · no branch"}`;
    return shown.running ? where : `${where} (last session)`;
  }
  if (shown.workIn === "folder") return shown.nextFolder ?? "Other folder";
  return shown.workIn === "checkout"
    ? "The project checkout (next session)"
    : `A separate worktree aw-${key ?? "<key>"} (next session)`;
}

/** `{ session_options }` for a request, or nothing. */
export function optionsField(body: ReturnType<typeof fullOptionsBody> | undefined) {
  return body ? { session_options: body } : {};
}
