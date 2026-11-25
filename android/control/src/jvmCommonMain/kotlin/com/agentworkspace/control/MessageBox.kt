package com.agentworkspace.control

import com.agentworkspace.shared.merge.GateView
import com.agentworkspace.shared.merge.TaskView

/**
 * The message box of the task page, as the desktop `Composer` (openspec proposal-and-discussion):
 * while a question or a reply of the agent is open and no device has an answer that waits for the
 * owner, the text is its free-text answer; else the text is a message to the running session.
 */
data class MessageBox(
    /** The gate that the text answers, or null: then the text is a message. */
    val question: GateView?,
    val enabled: Boolean,
    val placeholder: String,
    /** The line under the field. */
    val hint: String,
) {
    companion object {
        private val ASKS = setOf("question", "reply")

        fun of(task: TaskView): MessageBox {
            val running = ScreenStates.canMessage(task)
            val open = task.gates.filter { it.state == "open" }
            val question =
                open.lastOrNull { gate -> gate.kind in ASKS && gate.answers.none { it.use == "pending" } }
            val proposal = open.any { it.kind == "approve_proposal" }
            val device = task.session?.device
            return MessageBox(
                question = question,
                enabled = running || question != null,
                placeholder =
                    when {
                        question != null -> "Reply, or ask the agent…"
                        !running -> "No session runs: assign the task first"
                        proposal -> "Discuss the proposal, or ask the agent…"
                        else -> "It arrives as the next input of the session."
                    },
                hint =
                    when {
                        question != null -> "Your message answers the question “${question.title}”"
                        running && device != null -> "$device delivers it when no dialog is open"
                        running -> "It arrives as the next input of the session."
                        else -> "The next session reads the thread."
                    },
            )
        }
    }
}
