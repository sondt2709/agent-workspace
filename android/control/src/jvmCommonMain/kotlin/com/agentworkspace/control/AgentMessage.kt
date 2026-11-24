package com.agentworkspace.control

/**
 * A typed `message.human` that is a message of another agent of the session (openspec
 * task-review-layout, design decision 5). TypeScript: `agentMessage` of `@aw/client/gates`.
 */
data class AgentMessage(
    val kind: Kind,
    val from: String,
    /** The text of the agent, with the frame of Claude Code and the common indent removed. */
    val body: String,
) {
    /** [json]: the kind of the shared fixture; [label]: the label of the Activity row. */
    enum class Kind(
        val json: String,
        val label: String,
    ) {
        /** The final report of a subagent. */
        SUBAGENT_REPORT("subagent_report", "Subagent report"),

        /** A message of a teammate. */
        AGENT_MESSAGE("agent_message", "Agent message"),
    }

    companion object {
        /** The note of the Activity row: Claude Code sent the text into the terminal of the session. */
        const val ARRIVED = "arrived in the terminal"
    }
}

private val OPEN_TAG = Regex("^<agent-message from=\"([^\"]*)\">\\s*$")
private const val CLOSE_TAG = "</agent-message>"
private const val HAND_BACK = "[Subagent hand-back]"
private const val REPORT_FOLLOWS = "The report follows:"

/**
 * The message of another agent in the text of a typed `message.human`, or null for a person
 * message. Claude Code sends a subagent report or a teammate message to the UserPromptSubmit hook
 * as `<agent-message from="<id>">` … `</agent-message>`; the transcript form has one prefix line
 * ending in ":" and a note after the tag. `contracts/fixtures/activity/agent-message.json`.
 */
fun ActivityRule.agentMessage(text: String): AgentMessage? {
    val lines = text.split("\n")
    val open = lines.indexOfFirst { OPEN_TAG.matches(it.trim()) }
    if (open < 0 || open > 1) return null
    if (open == 1 && !lines[0].trim().endsWith(":")) return null
    val close = (lines.lastIndex downTo open + 1).firstOrNull { lines[it].trim() == CLOSE_TAG } ?: return null
    val from =
        OPEN_TAG
            .matchEntire(lines[open].trim())
            ?.groupValues
            ?.get(1)
            .orEmpty()
    var inner = lines.subList(open + 1, close)
    var kind = AgentMessage.Kind.AGENT_MESSAGE
    if (inner.firstOrNull()?.startsWith(HAND_BACK) == true) {
        kind = AgentMessage.Kind.SUBAGENT_REPORT
        val follows = inner.indexOfFirst { it.trimEnd().endsWith(REPORT_FOLLOWS) }
        inner = inner.drop(if (follows < 0) 1 else follows + 1)
    }
    return AgentMessage(kind, from, dedent(inner))
}

/** The lines with the common indent of the non-empty lines removed, and no empty first or last line. */
private fun dedent(lines: List<String>): String {
    val filled = lines.filter { it.isNotBlank() }
    if (filled.isEmpty()) return ""
    val indent = filled.minOf { it.length - it.trimStart().length }
    val cut = lines.map { if (it.isBlank()) "" else it.substring(indent) }
    return cut.dropWhile { it.isEmpty() }.dropLastWhile { it.isEmpty() }.joinToString("\n")
}
