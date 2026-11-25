package com.agentworkspace.control

import com.agentworkspace.engine.SyncRules

/** The texts of the screens: the same words as the desktop app (desktop/src/renderer/src/model.ts). */
object Texts {
    val STAGES = listOf("backlog", "discuss", "ready", "implement", "review", "done")

    private val STAGE_LABEL =
        mapOf(
            "backlog" to "Backlog",
            "discuss" to "Discuss",
            "ready" to "Ready",
            "implement" to "Implement",
            "review" to "Review",
            "done" to "Done",
        )

    private val PAUSE_TEXT =
        mapOf(
            "usage_limit" to "usage limit",
            "usage_limit_weekly" to "weekly usage limit",
            "continue_cap" to "continue limit",
            "device_offline" to "device offline",
            "device_restart" to "device restart",
            "device_revoked" to "device revoked",
            "network_lost" to "network lost",
            "waiting_for_sync" to "waiting for sync",
            "task_moving" to "moving to another device",
            "agent_error" to "agent error",
            "login_expired" to "login expired",
        )

    private val GATE_LABEL =
        mapOf(
            // One reason for both kinds, as on the desktop (openspec proposal-and-discussion).
            "question" to "Reply to a question",
            "reply" to "Reply to a question",
            "approve_proposal" to "Approve proposal",
            "assign" to "Assign task",
            "approve_command" to "Approve command",
            "approve_result" to "Approve result",
            "approve_knowledge" to "Approve knowledge change",
            "approve_device" to "Approve device",
            "continue_after_limit" to "Continue after usage limit",
            "take_over_terminal" to "Take over terminal",
            "fix_file" to "Fix a file",
            "custom" to "Decision",
        )

    private val ROLE_LABEL = mapOf("local" to "Local", "remote" to "Remote", "mobile" to "Mobile")

    private const val TITLE_MAX = 120
    private const val SHORT_ID = 8

    fun stageLabel(stage: String): String = STAGE_LABEL[stage] ?: stage

    fun pauseText(cause: String): String = PAUSE_TEXT[cause] ?: cause.replace('_', ' ')

    fun gateLabel(kind: String): String = GATE_LABEL[kind] ?: kind.replace('_', ' ')

    fun roleLabel(role: String?): String = role?.let { ROLE_LABEL[it] ?: it } ?: "Unknown role"

    /** "12 s ago", "5 min ago", "3 h ago", "2 d ago" (the rule of the sync texts). */
    fun ago(
        fromMs: Long,
        nowMs: Long,
    ): String = SyncRules.ago(fromMs, nowMs)

    /** The key, else the first 8 characters of the id. */
    fun taskLabel(
        id: String,
        key: String?,
    ): String = key ?: id.take(SHORT_ID)

    /** The title of a new task: the first line of the first message that is not empty, at most 120 chars. */
    fun titleFromFirstMessage(text: String): String {
        val line = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: return ""
        return if (line.length > TITLE_MAX) line.take(TITLE_MAX - 1).trimEnd() + "…" else line
    }
}
