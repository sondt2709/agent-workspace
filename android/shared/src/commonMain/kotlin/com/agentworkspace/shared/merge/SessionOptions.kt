package com.agentworkspace.shared.merge

// The effective session options of a task (openspec session-options): what the next session of the
// task uses. The port of `effectiveSessionOptions` of `shared/core/src/merge/session-options.ts`.

/** The options of the next session of a task. */
data class EffectiveSessionOptions(
    /** `default`, `accept_edits` or `skip`. */
    val permissionMode: String,
    val agentTeams: Boolean,
    /** `worktree`, `checkout` or `folder`. */
    val workIn: String,
    /** The absolute folder of `work_in: folder`, else null. */
    val folder: String?,
    /** True: a session in the checkout checks out `aw/<key>`; false: it keeps the branch. */
    val switchBranch: Boolean = true,
)

object SessionOptions {
    const val DEFAULT = "default"
    const val ACCEPT_EDITS = "accept_edits"
    const val SKIP = "skip"
    const val WORKTREE = "worktree"
    const val CHECKOUT = "checkout"
    const val FOLDER = "folder"

    /**
     * The options of the next session: the options of the task, else the defaults. The mode is the
     * task value, else the project default. A project default `skip` counts only for a task that a
     * person created, so an agent subtask never runs with no gate. `projectPermissionMode` is the
     * `permission_mode` of `project.yaml` ([ProjectView.permissionMode]), null for the default.
     */
    fun effective(
        task: TaskView,
        projectPermissionMode: String?,
    ): EffectiveSessionOptions {
        val own = task.sessionOptions
        val projectMode = projectPermissionMode ?: DEFAULT
        val fallback = if (projectMode == SKIP && !isHuman(task.createdBy)) DEFAULT else projectMode
        return EffectiveSessionOptions(
            permissionMode = own?.permissionMode ?: fallback,
            agentTeams = own?.agentTeams ?: false,
            workIn = own?.workIn ?: WORKTREE,
            folder = if (own?.workIn == FOLDER) own.folder else null,
            switchBranch = own?.switchBranch ?: true,
        )
    }
}
