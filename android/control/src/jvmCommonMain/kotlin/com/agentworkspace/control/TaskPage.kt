package com.agentworkspace.control

import com.agentworkspace.shared.merge.NeedsYouReason
import com.agentworkspace.shared.merge.TaskView

/**
 * The need-you navigation of the task page (openspec task-review-layout, design decision 3), as the
 * desktop `needYouNav`: "1 of 2 need you" with Previous and Next, "2 need you" with Next to the first
 * when the task is not one of them, and no text when no task needs the person.
 */
data class NeedYouNav(
    val text: String?,
    val previous: String?,
    val next: String?,
) {
    companion object {
        /** [inbox]: the task ids of the Inbox in its order ([ScreenStates.inbox]). */
        fun of(
            inbox: List<String>,
            current: String,
        ): NeedYouNav {
            if (inbox.isEmpty()) return NeedYouNav(null, null, null)
            val verb = if (inbox.size == 1) "needs you" else "need you"
            val at = inbox.indexOf(current)
            if (at < 0) return NeedYouNav("${inbox.size} $verb", null, inbox.first())
            return NeedYouNav("${at + 1} of ${inbox.size} $verb", inbox.getOrNull(at - 1), inbox.getOrNull(at + 1))
        }
    }
}

/**
 * The layout of the task page for its own width in dp (openspec task-review-layout, design decisions
 * 1 and 2): "Show list" from 700 dp, the task list of 300 dp, and the Properties panel of 280 dp
 * when the page without the task list is 1,000 dp or wider. The width is the width of the task page,
 * not of the window.
 */
data class TaskPageLayout(
    val canList: Boolean,
    val list: Boolean,
    val propertiesPanel: Boolean,
) {
    /** The tabs of the page: no Properties tab next to the Properties panel. */
    val tabs: List<TaskTab> get() = TaskTab.of(propertiesPanel)

    companion object {
        const val TASK_LIST_DP = 300
        const val LIST_FROM_DP = 700
        const val PROPERTIES_PANEL_DP = 280
        const val PANEL_FROM_DP = 1000

        /** The widest the content of a tab and the message box grow; the content is centred. */
        const val CONTENT_MAX_DP = 840

        fun of(
            widthDp: Int,
            listOn: Boolean,
        ): TaskPageLayout {
            val canList = widthDp >= LIST_FROM_DP
            val list = canList && listOn
            val rest = widthDp - if (list) TASK_LIST_DP else 0
            return TaskPageLayout(canList, list, rest >= PANEL_FROM_DP)
        }
    }
}

/** The stage progress bar of the task page: 6 segments and "Discuss · stage 2 of 6". */
data class StageProgress(
    /** The index of the stage in [Texts.STAGES], or -1 for an unknown stage. */
    val index: Int,
    val count: Int,
    val text: String,
) {
    companion object {
        fun of(stage: String): StageProgress {
            val index = Texts.STAGES.indexOf(stage)
            val label = Texts.stageLabel(stage)
            val text = if (index < 0) label else "$label · stage ${index + 1} of ${Texts.STAGES.size}"
            return StageProgress(index, Texts.STAGES.size, text)
        }
    }
}

/** One group of the task list of the task page, for example "Needs you · 2". */
data class TaskListGroup(
    val label: String,
    val rows: List<TaskRowState>,
)

/** The parts of the task page that the desktop also has (openspec task-review-layout). */
object TaskPage {
    /**
     * The task list of "Show list": the tasks that need the person first, in the Inbox order, then
     * the running, paused and queued tasks, as the desktop `switchGroups`. Empty groups are left out.
     */
    fun listGroups(snapshot: WorkspaceSnapshot): List<TaskListGroup> {
        val needsYou = ScreenStates.inbox(snapshot)
        val rest =
            snapshot.tasks
                .filter { !it.archived && !it.needsYouLane && it.stage != "done" }
                .map { it to ScreenStates.row(it, snapshot) }
                .sortedByDescending { it.second.lastHlc.orEmpty() }
        val paused = rest.filter { it.second.pause != null }
        val running = (rest - paused.toSet()).filter { it.first.session?.state == "running" }
        val queued = (rest - paused.toSet() - running.toSet()).filter { it.second.queue != null }
        return listOf(
            "Needs you" to needsYou,
            "Running" to running.map { it.second },
            "Paused" to paused.map { it.second },
            "Queued" to queued.map { it.second },
        ).filter { it.second.isNotEmpty() }.map { (label, rows) -> TaskListGroup("$label · ${rows.size}", rows) }
    }

    /**
     * The state chip of the header: the first "Needs you" reason (a gate shows its kind, for example
     * "Confirm approach"), or null. The pause and queue chips show under the title.
     */
    fun stateChip(task: TaskView): String? =
        when (val reason = task.needsYouReasons.firstOrNull()) {
            null -> null
            is NeedsYouReason.Gate -> Texts.gateLabel(reason.kind)
            else -> ScreenStates.reasonOf(task)
        }
}
