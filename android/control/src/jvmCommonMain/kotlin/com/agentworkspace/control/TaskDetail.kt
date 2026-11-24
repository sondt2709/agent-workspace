package com.agentworkspace.control

import com.agentworkspace.shared.merge.TaskView
import com.agentworkspace.shared.merge.TerminalView

/** The parts of the phone task detail that the desktop also has (openspec phone-task-focus). */
object TaskDetail {
    /**
     * The session summary of the Session view, as the desktop: the state with the end reason, the
     * device and the host, the claim epoch, the session id, the branch and the task id. The session id
     * stays after the claim ends.
     */
    fun sessionSummary(task: TaskView): List<Pair<String, String>> =
        buildList {
            val session = task.session
            val state =
                when {
                    session == null -> "No session yet"

                    else -> "${session.state}${session.reason?.let {
                        " ($it)"
                    }.orEmpty()} on ${session.device} (${session.host})"
                }
            add("Session" to state)
            task.owner?.let { add("Owner device" to it) }
            task.movingTo?.let { add("Moving to" to it) }
            task.claim?.let { add("Claim epoch" to it.epoch.toString()) }
            (session?.session ?: task.claim?.session)?.let { add("Session id" to it) }
            // The link to the Claude session and its terminal (openspec agent-pushes-updates).
            session?.name?.let { add("Name" to it) }
            session?.terminal?.let { add("Terminal" to terminalLine(session.host, it)) }
            session?.pid?.let { add("Pid" to it.toString()) }
            task.branch?.let { add("Branch" to it) }
            add("Task id" to task.id)
        }

    /** "tmux window <w> · pane <p>", or "Orca terminal <p>", as the desktop. */
    private fun terminalLine(
        host: String,
        terminal: TerminalView,
    ): String =
        if (host == "orca") {
            "Orca terminal ${terminal.pane ?: terminal.window.orEmpty()}"
        } else {
            listOfNotNull(terminal.window?.let { "tmux window $it" }, terminal.pane?.let { "pane $it" })
                .joinToString(" · ")
        }

    /**
     * The line of each task tab except Activity (as the desktop, tvfc-1): "1 item needs you" when an
     * open gate or Assign waits for the person, else null. The pause chip is in the header above the tabs.
     * A gate with a pending answer waits for the owner, not for the person (`waiting_for_owner`).
     */
    fun needsYouLine(task: TaskView): String? {
        val open = task.gates.count { gate -> gate.state == "open" && gate.answers.none { it.use == "pending" } }
        val assignGate = task.gates.any { it.state == "open" && it.kind == "assign" }
        val assign = if (ScreenStates.needsAssign(task) && !assignGate) 1 else 0
        return when (val n = open + assign) {
            0 -> null
            1 -> "1 item needs you"
            else -> "$n items need you"
        }
    }
}
