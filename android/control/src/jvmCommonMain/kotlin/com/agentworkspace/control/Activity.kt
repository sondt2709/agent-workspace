package com.agentworkspace.control

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Where an event of the thread shows in the task detail: Activity, or only Session. */
enum class ActivityPlace { ACTIVITY, SESSION }

/**
 * The Activity rule of the task detail (openspec phone-task-focus, docs/design.md 8.6): the same rule
 * as the desktop `activity-model.ts`. Each event shows in the Session view (principle 8). The tests of
 * both apps compare their rule with `contracts/fixtures/activity/cases.json`.
 */
object ActivityRule {
    private val A = ActivityPlace.ACTIVITY
    private val S = ActivityPlace.SESSION

    /** One entry for each event type of the contract. A new type needs a decision here and on the desktop. */
    val PLACES: Map<String, ActivityPlace> =
        mapOf(
            // The task: what changed, as an issue shows it.
            "task.created" to A,
            "task.assigned" to A,
            "task.rekeyed" to A,
            "task.edited" to A,
            "task.stage_changed" to A,
            "task.paused" to A,
            "task.resumed" to A,
            "task.done" to A,
            "task.archived" to A,
            "task.unarchived" to A,
            "task.learned" to A,
            // The conversation and the work products.
            "message.agent" to A,
            "message.sent" to A,
            "comment.added" to A,
            "message.human" to A, // only some sources: see inActivity()
            "gate.opened" to A,
            "gate.answered" to A,
            "approach.proposed" to A,
            "result.posted" to A,
            "artifact.added" to A,
            // A stop shows its cause (principle 2, decision 37): only some reasons, see inActivity().
            "session.ended" to A,
            // The session detail.
            "task.claimed" to S,
            "task.released" to S,
            "task.ready" to S,
            "task.progress" to S,
            "gate.resolved" to S,
            "handoff.written" to S,
            "session.started" to S,
            "session.resumed" to S,
            // The stop shows in Activity as its `session.ended` (openspec session-options).
            "session.stop_requested" to S,
            // Workspace events: they do not belong to the task view.
            "slot.acquired" to S,
            "slot.renewed" to S,
            "slot.released" to S,
            "slot.revoked" to S,
            "queue.reordered" to S,
            "credential.added" to S,
            "credential.imported" to S,
            "credential.removed" to S,
            "project.removed" to S,
            "knowledge.changed" to S,
            "knowledge.undo_requested" to S,
            "knowledge.suggested" to S,
            "knowledge.suggestion_resolved" to S,
            "device.heartbeat" to S,
        )

    /** The reasons of a session end that show in Activity: the work stopped and waits for a person. */
    private val STOPS = setOf("stopped", "crashed")

    private const val NO_NEW_SESSION = "AW starts no new session until a person starts one."

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    /**
     * True when the event shows in Activity. A `message.human` shows only when the person typed it in
     * the terminal (source `typed` or `phone` with no delivery id); each other input repeats a text that
     * Activity has. A `session.ended` shows only when the session stopped or crashed. The text of an
     * agent turn (`message.agent` source `turn`) and a nudge notice show only in Session (openspec
     * agent-pushes-updates).
     */
    fun inActivity(
        type: String,
        data: JsonObject,
    ): Boolean =
        when {
            PLACES[type] != ActivityPlace.ACTIVITY -> {
                false
            }

            type == "session.ended" -> {
                data.text("reason") in STOPS
            }

            type == "message.agent" -> {
                data.text("source") != "turn"
            }

            type == "message.sent" -> {
                data.text("kind") != "nudge"
            }

            type == "message.human" -> {
                data.text("source") in setOf("typed", "phone") &&
                    data.text("delivery_id") == null
            }

            else -> {
                true
            }
        }

    /** The line of an Activity row that has its own text in Activity, or null for the usual text. */
    fun line(
        type: String,
        dev: String,
        data: JsonObject,
    ): String? {
        if (type != "session.ended") return null
        return when (data.text("reason")) {
            "stopped" -> "Session stopped on $dev: a person stopped it or ended the agent. $NO_NEW_SESSION"
            "crashed" -> "Session crashed on $dev: the agent process ended and AW did not restart it. $NO_NEW_SESSION"
            else -> null
        }
    }

    /** The lines of an agent message that Activity shows first. */
    const val CLAMP_LINES = 6

    /** The first [CLAMP_LINES] lines of [text], and whether lines were cut. */
    fun clamp(text: String): Clamp {
        val lines = text.split("\n")
        if (lines.size <= CLAMP_LINES) return Clamp(text, false)
        return Clamp(lines.take(CLAMP_LINES).joinToString("\n"), true)
    }

    data class Clamp(
        val head: String,
        val cut: Boolean,
    )
}
