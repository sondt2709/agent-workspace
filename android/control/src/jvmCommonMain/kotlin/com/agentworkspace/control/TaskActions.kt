package com.agentworkspace.control

import com.agentworkspace.shared.merge.TaskView

/** The texts of a confirm dialog of the task actions menu. */
data class ConfirmText(
    val title: String,
    val body: String,
    val action: String,
)

/**
 * The "⋯" menu of the task header (openspec task-actions): which items show, and the confirm texts.
 * The desktop has the same items and texts (`desktop/src/renderer/src/components/TaskActions.tsx`).
 */
object TaskActions {
    /** The device of the running session, or null when no session runs. */
    fun runningDevice(task: TaskView): String? = task.session?.takeIf { ScreenStates.canMessage(task) }?.device

    fun canStop(task: TaskView): Boolean = runningDevice(task) != null

    fun stopConfirm(task: TaskView): ConfirmText {
        val device = runningDevice(task) ?: "its device"
        return ConfirmText(
            title = "Stop the session on $device?",
            body =
                "$device stops the agent of ${Texts.taskLabel(task.id, task.key)} when it syncs. " +
                    "AW starts no new session until you start one with New session or Assign.",
            action = "Stop session",
        )
    }

    fun archiveConfirm(task: TaskView): ConfirmText {
        val label = Texts.taskLabel(task.id, task.key)
        val device =
            runningDevice(task)
                ?: return ConfirmText(
                    title = "Archive $label?",
                    body =
                        "The task leaves the lists and shows in the Archived group of Tasks. " +
                            "AW keeps its files. You can unarchive it.",
                    action = "Archive",
                )
        return ConfirmText(
            title = "Stop the session and archive $label?",
            body =
                "A session of this task runs on $device. AW stops that session first, then archives the task. " +
                    "$device stops it when it syncs. AW keeps the files, and you can unarchive the task.",
            action = "Stop and archive",
        )
    }
}
