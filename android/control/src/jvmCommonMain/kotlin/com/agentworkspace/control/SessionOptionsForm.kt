package com.agentworkspace.control

import com.agentworkspace.schema.TaskAssignedV1
import com.agentworkspace.schema.TaskCreatedV1
import com.agentworkspace.shared.merge.EffectiveSessionOptions
import com.agentworkspace.shared.merge.ProjectView
import com.agentworkspace.shared.merge.SessionOptions
import com.agentworkspace.shared.merge.SessionOptionsView
import com.agentworkspace.shared.merge.TaskView
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * The session options of the New task and New session forms (openspec session-options): the
 * permission mode, agent teams, the working folder and "Switch to the task branch". [permissionMode]
 * null means the project default. [folder] is the text of "Other folder"; it counts only for [workIn]
 * `folder`. [switchBranch] counts only for [workIn] `checkout`. The defaults are the defaults of the
 * schema: an event with these values has no options. The forms of a person start with [NewTaskDraft.START_OPTIONS]
 * or [forNewSession].
 */
data class SessionOptionsDraft(
    val permissionMode: String? = null,
    val agentTeams: Boolean = false,
    val workIn: String = SessionOptions.WORKTREE,
    val folder: String = "",
    val switchBranch: Boolean = true,
) {
    /** The folder of the event: the trimmed text for `folder`, else null. */
    val eventFolder: String? get() = if (workIn == SessionOptions.FOLDER) folder.trim() else null

    /** The `switch_branch` of the event: false only for `checkout` with the switch off. */
    val eventSwitchBranch: Boolean get() = workIn != SessionOptions.CHECKOUT || switchBranch

    /**
     * This draft for a checkout where "Separate worktree" is not available
     * ([WorktreeRule.available]): `worktree` becomes `checkout`. Else the same draft.
     */
    fun fitting(worktreeAvailable: Boolean): SessionOptionsDraft =
        if (!worktreeAvailable && workIn == SessionOptions.WORKTREE) copy(workIn = SessionOptions.CHECKOUT) else this

    /** This draft when the person changed it from [initial], else null: then the event has no options. */
    fun changedFrom(initial: SessionOptionsDraft): SessionOptionsDraft? = takeIf { normal() != initial.normal() }

    /** A problem that stops the write, or null. The computer checks the folder again at the start. */
    fun problem(): String? =
        when {
            permissionMode != null && permissionMode !in SessionOptionTexts.MODES -> "Select a permission mode."
            workIn !in SessionOptionTexts.WORK_IN -> "Select where the session works."
            workIn == SessionOptions.FOLDER && !eventFolder.orEmpty().startsWith("/") -> FOLDER_PROBLEM
            else -> null
        }

    internal fun forCreate() =
        TaskCreatedV1.SessionOptions(permissionMode, agentTeams, workIn, eventFolder, eventSwitchBranch)

    internal fun forAssign() =
        TaskAssignedV1.SessionOptions(permissionMode, agentTeams, workIn, eventFolder, eventSwitchBranch)

    /** The folder text and the branch switch do not count for another place. */
    private fun normal() =
        copy(
            folder = if (workIn == SessionOptions.FOLDER) folder.trim() else "",
            switchBranch = eventSwitchBranch,
        )

    companion object {
        const val FOLDER_PROBLEM = "Write the folder as an absolute path, for example /work/billing-api."

        /** The options that a task has now: the start values of the New session form. */
        fun of(task: TaskView): SessionOptionsDraft = of(task.sessionOptions)

        fun of(options: SessionOptionsView?): SessionOptionsDraft =
            options?.let {
                SessionOptionsDraft(it.permissionMode, it.agentTeams, it.workIn, it.folder.orEmpty(), it.switchBranch)
            } ?: SessionOptionsDraft()

        /**
         * The start values of New session: the options of the task. A task with no options starts
         * with "Agent teams" on (openspec session-options), so the event has the change.
         */
        fun forNewSession(task: TaskView): SessionOptionsDraft =
            task.sessionOptions?.let(::of) ?: SessionOptionsDraft(agentTeams = true)
    }
}

/**
 * The rule "Separate worktree needs a commit" (openspec session-options): a worktree needs a commit
 * in the checkout. The device writes `has_commit` of each checkout in its `health.yaml`.
 */
object WorktreeRule {
    /**
     * False only when [health] (the `health.yaml` of the device) has a `checkouts` entry for
     * [project] with `has_commit: false`. True when the value is not known (an older awd, no health).
     */
    fun available(
        health: JsonElement?,
        project: String?,
    ): Boolean {
        val checkouts = (health as? JsonObject)?.get("checkouts") as? JsonArray ?: return true
        val entry =
            checkouts.firstOrNull {
                ((it as? JsonObject)?.get("project") as? JsonPrimitive)?.contentOrNull == project
            } as? JsonObject
        val hasCommit = (entry?.get("has_commit") as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
        return hasCommit != false
    }

    /** The rule for the device of [assignee] (`agent@device`); true with no assignee. */
    fun available(
        snapshot: WorkspaceSnapshot,
        assignee: String?,
        project: String?,
    ): Boolean {
        val device = assignee?.substringAfter('@', "")?.takeIf { it.isNotEmpty() } ?: return true
        return available(snapshot.health[device], project)
    }
}

/** The texts of the session options, as the desktop shows them (openspec session-options). */
object SessionOptionTexts {
    val MODES = listOf(SessionOptions.DEFAULT, SessionOptions.ACCEPT_EDITS, SessionOptions.SKIP)
    val WORK_IN = listOf(SessionOptions.WORKTREE, SessionOptions.CHECKOUT, SessionOptions.FOLDER)

    const val TEAMS = "Agent teams"
    const val CHECKOUT_WARNING = "This changes the branch and the files of your checkout."
    const val SWITCH_BRANCH = "Switch to the task branch"
    const val NO_SWITCH_HELP = "The session works on the branch that is checked out. AW makes no branch."
    const val NO_COMMIT_HINT = "This checkout has no commit yet. Make a first commit to use a separate worktree."
    const val SKIP_WARNING =
        "The agent runs each command as you, with no gate. A hidden command can still act as you in AW: " +
            "use it only for a task you trust."
    const val SKIP_CHIP = "Skips permissions"
    const val TEAMS_CHIP = "Agent teams"

    /** The chip of the project default, as the desktop menu item "Project default · Skip permissions". */
    fun projectDefaultLabel(projectMode: String?): String =
        "Project default · ${modeLabel(projectMode ?: SessionOptions.DEFAULT)}"

    fun modeLabel(mode: String): String =
        when (mode) {
            SessionOptions.ACCEPT_EDITS -> "Accept edits"
            SessionOptions.SKIP -> "Skip permissions"
            else -> "Default"
        }

    /** The choice labels of the form. */
    fun workInLabel(workIn: String): String =
        when (workIn) {
            SessionOptions.CHECKOUT -> "Project checkout"
            SessionOptions.FOLDER -> "Other folder"
            else -> "Separate worktree"
        }

    /** The label of the folder field: the folder is on the device of the agent. */
    fun folderLabel(assignee: String?): String =
        assignee?.substringAfter('@', "")?.takeIf { it.isNotEmpty() }?.let { "Folder on $it" }
            ?: "Folder on the computer"

    /** The warning under the form, or null. */
    fun warnings(
        draft: SessionOptionsDraft,
        projectMode: String?,
    ): List<String> =
        buildList {
            if ((draft.permissionMode ?: projectMode) == SessionOptions.SKIP) add(SKIP_WARNING)
            if (draft.workIn == SessionOptions.CHECKOUT && draft.switchBranch) add(CHECKOUT_WARNING)
        }
}

/**
 * The session options that the task shows (openspec session-options, design 7): the values of the
 * running session, else the effective values for the next session.
 */
object SessionOptionRows {
    private const val RUNNING = "running"

    /** The `permission_mode` of a project, or null for no project. */
    fun projectMode(
        task: TaskView,
        projects: List<ProjectView>,
    ): String? = projects.firstOrNull { it.slug == task.project }?.permissionMode

    /** The options of the next session of the task. */
    fun next(
        task: TaskView,
        projectMode: String?,
    ): EffectiveSessionOptions = SessionOptions.effective(task, projectMode)

    /** The permission mode now: of the running session (an older session event: `default`), else of the next. */
    fun mode(
        task: TaskView,
        projectMode: String?,
    ): String {
        val session = task.session?.takeIf { it.state == RUNNING }
        return if (session !=
            null
        ) {
            session.permissionMode ?: SessionOptions.DEFAULT
        } else {
            next(task, projectMode).permissionMode
        }
    }

    /** True for the red chip "Skips permissions". */
    fun skipsPermissions(
        task: TaskView,
        projectMode: String?,
    ): Boolean = mode(task, projectMode) == SessionOptions.SKIP

    /** True for the chip "Agent teams". */
    fun agentTeams(
        task: TaskView,
        projectMode: String?,
    ): Boolean {
        val session = task.session?.takeIf { it.state == RUNNING }
        return if (session != null) session.agentTeams == true else next(task, projectMode).agentTeams
    }

    /**
     * The rows "Permissions", "Agent teams" and "Works in". A running session shows its folder and
     * branch; else the row says where the next session works.
     */
    fun rows(
        task: TaskView,
        projectMode: String?,
    ): List<Pair<String, String>> {
        val next = next(task, projectMode)
        val session = task.session?.takeIf { it.state == RUNNING }
        val worksIn =
            session?.cwd?.let { cwd -> cwd + session.branch?.let { " · branch $it" }.orEmpty() }
                ?: when (next.workIn) {
                    SessionOptions.FOLDER -> next.folder ?: SessionOptionTexts.workInLabel(SessionOptions.FOLDER)
                    else -> SessionOptionTexts.workInLabel(next.workIn)
                }
        return buildList {
            add("Permissions" to SessionOptionTexts.modeLabel(mode(task, projectMode)))
            add("Agent teams" to if (agentTeams(task, projectMode)) "On" else "Off")
            add("Works in" to worksIn)
            // An ended session: the folder of the last session stays visible.
            val last = task.session?.takeIf { it.state != RUNNING }?.cwd
            if (last != null) {
                add(
                    "Last session in" to last +
                        task.session
                            ?.branch
                            ?.let { " · branch $it" }
                            .orEmpty(),
                )
            }
        }
    }
}
