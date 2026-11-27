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
    /**
     * The start state of the task header (openspec restart-agent), shown in place of the queue chip:
     * "Did not start on ubuntu-01: <cause>", or "Starting again on ubuntu-01…" after "Restart agent".
     * Null when the task view has no start failure.
     */
    fun startText(task: TaskView): String? {
        val failure = task.startFailure ?: return null
        if (failure.retrying) return "Starting again on ${failure.device}…"
        return "Did not start on ${failure.device}: ${startCause(failure.device, failure.text)}"
    }

    /**
     * The cause of a start failure: the comment text after "The session did not start on <device>: ",
     * with no sentence " AW tries again in 60 s." at the end. With no such start, the full text.
     */
    fun startCause(
        device: String,
        text: String,
    ): String {
        val cause = text.removePrefix("The session did not start on $device: ")
        return cause.replace(RETRY_SENTENCE, "").trim()
    }

    /** "Restart agent" fits a task with an assignee and no running session (openspec restart-agent). */
    fun canRestart(task: TaskView): Boolean = task.assignee != null && !ScreenStates.canMessage(task)

    /** The header shows "Restart agent" after a start failure, until the person restarts the agent. */
    fun showRestart(task: TaskView): Boolean {
        val failure = task.startFailure ?: return false
        return canRestart(task) && !failure.retrying
    }

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

    /** The last sentence of the start comment of awd: " AW tries again in 60 s." */
    private val RETRY_SENTENCE = Regex("""\.?\s*AW tries again in \d+ s\.\s*$""")
}
