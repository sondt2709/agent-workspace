package com.agentworkspace.control

import com.agentworkspace.shared.merge.EventRow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** The kind of a thread item: who wrote the text. */
enum class ThreadKind { HUMAN, AGENT, SENT, GATE, ANSWER, COMMENT, SYSTEM }

/** One item of the raw thread (principle 8): the text as written, never a summary. */
data class ThreadItem(
    val id: String,
    /** The event type, for example `message.agent`. */
    val type: String,
    val hlc: String,
    val device: String,
    val who: String,
    val kind: ThreadKind,
    val text: String,
    /** "Not delivered yet" for a message that the session device has not delivered. */
    val note: String? = null,
    /** False when the merge ignored the event (the reason is in [note]). */
    val applied: Boolean = true,
)

/**
 * The newest items of a thread and whether older events exist (fix list 0-20): [items] has a row for
 * each event (the Session view), [activity] the rows of the Activity rule from the same events.
 */
data class ThreadWindow(
    val items: List<ThreadItem>,
    val hasOlder: Boolean,
    val activity: List<ThreadItem> = emptyList(),
) {
    companion object {
        val EMPTY = ThreadWindow(emptyList(), false)
    }
}

/** The thread items of the events of a task, in merge order. */
object ThreadItems {
    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun dataOf(row: EventRow): JsonObject = row.event["data"] as? JsonObject ?: JsonObject(emptyMap())

    private fun deliveredOf(rows: List<EventRow>): Set<String> =
        rows
            .filter { it.type == "message.human" }
            .mapNotNull { dataOf(it).text("delivery_id") }
            .toSet()

    /** Each event as a raw row (the Session view, principle 8): no event type is left out. */
    fun of(rows: List<EventRow>): List<ThreadItem> {
        val delivered = deliveredOf(rows)
        return rows.map { row -> item(row, delivered) }
    }

    /**
     * The rows of the Activity rule ([ActivityRule]): the created line without the first message (the
     * description shows it), the text typed in the terminal, and a session stop with its cause. A row
     * that the merge ignored keeps its note "Ignored: <reason>" (principle 9).
     */
    fun activity(rows: List<EventRow>): List<ThreadItem> {
        val delivered = deliveredOf(rows)
        return rows
            .filter { ActivityRule.inActivity(it.type, dataOf(it)) }
            .map { row ->
                val item = item(row, delivered)
                val data = dataOf(row)
                val line = ActivityRule.line(row.type, row.dev, data)
                when {
                    line != null -> {
                        item.copy(text = line)
                    }

                    row.type == "task.created" -> {
                        item.copy(
                            kind = ThreadKind.SYSTEM,
                            text = "Created by ${item.who}",
                            note = if (row.applied) null else item.note,
                        )
                    }

                    row.type == "message.human" -> {
                        item.copy(note = if (row.applied) "typed in the terminal" else item.note)
                    }

                    else -> {
                        item
                    }
                }
            }
    }

    private data class Content(
        val kind: ThreadKind,
        val text: String,
        val note: String?,
    )

    private fun content(
        row: EventRow,
        data: JsonObject,
        delivered: Set<String>,
    ): Content =
        when (row.type) {
            "task.created" -> Content(ThreadKind.HUMAN, data.text("first_message").orEmpty(), "First message")
            "message.human" -> Content(ThreadKind.HUMAN, data.text("text").orEmpty(), data.text("source"))
            "message.agent" -> Content(ThreadKind.AGENT, data.text("text").orEmpty(), null)
            "message.sent" -> sent(data, delivered)
            "comment.added" -> Content(ThreadKind.COMMENT, data.text("text").orEmpty(), null)
            "gate.opened" -> opened(data)
            "gate.answered" -> answered(data)
            "gate.resolved" -> Content(ThreadKind.SYSTEM, "Gate resolved: ${data.text("answer").orEmpty()}", null)
            "task.learned" -> Content(ThreadKind.SYSTEM, learned(row, data), null)
            else -> Content(ThreadKind.SYSTEM, systemText(row.type, data), null)
        }

    private fun sent(
        data: JsonObject,
        delivered: Set<String>,
    ): Content {
        val note = if (data.text("id").orEmpty() in delivered) "Delivered" else "Not delivered yet"
        return Content(ThreadKind.SENT, data.text("text").orEmpty(), note)
    }

    /** The text of a learning step, as the desktop `learnedText` (openspec agent-learning). */
    private fun learned(
        row: EventRow,
        data: JsonObject,
    ): String {
        val by = row.event.text("by") ?: row.dev
        if ((data["nothing_new"] as? JsonPrimitive)?.contentOrNull == "true") return "Nothing new learned by $by"
        val waits = if (data.text("suggestion").isNullOrEmpty()) "" else " (waits for approval)"
        return "Learned by $by: ${data.text("path")?.ifEmpty { null } ?: "-"}$waits"
    }

    private fun opened(data: JsonObject): Content {
        val body = listOf(data.text("title").orEmpty(), data.text("text").orEmpty()).filter { it.isNotBlank() }
        return Content(ThreadKind.GATE, body.joinToString("\n\n"), Texts.gateLabel(data.text("kind").orEmpty()))
    }

    private fun answered(data: JsonObject): Content {
        val comment = data.text("comment")?.let { "\n\n$it" }.orEmpty()
        return Content(ThreadKind.ANSWER, data.text("answer").orEmpty() + comment, "Answer")
    }

    private fun item(
        row: EventRow,
        delivered: Set<String>,
    ): ThreadItem {
        val data = dataOf(row)
        val who = row.event.text("by") ?: row.dev
        val (kind, text, note) = content(row, data, delivered)
        return ThreadItem(
            id = row.id,
            type = row.type,
            hlc = row.hlc,
            device = row.dev,
            who = who,
            kind = kind,
            text = text,
            note = if (row.applied) note else "Ignored: ${row.reason ?: "not applied"}",
            applied = row.applied,
        )
    }

    private fun systemText(
        type: String,
        data: JsonObject,
    ): String =
        when (type) {
            "task.assigned" -> "Assigned to ${data.text("assignee")}"

            "task.claimed" -> "Claimed by ${data.text("device")} (epoch ${data.text("epoch")})"

            "task.released" -> "Released (epoch ${data.text("epoch")})"

            "task.rekeyed" -> "${data.text("from")} is now ${data.text("to")}"

            "task.edited" -> "${data.text("field")} changed"

            "task.stage_changed" -> "Stage: ${Texts.stageLabel(
                data.text("from").orEmpty(),
            )} → ${Texts.stageLabel(data.text("to").orEmpty())}"

            "task.paused" -> "Paused: ${Texts.pauseText(
                data.text("cause").orEmpty(),
            )}. ${data.text("next_step").orEmpty()}"

            "task.resumed" -> "Resumed"

            "task.ready" -> "Ready checks passed"

            "task.progress" -> data.text("text").orEmpty()

            "task.done" -> "Done"

            "task.archived" -> "Archived"

            "task.unarchived" -> "Unarchived"

            "approach.proposed" -> "Approach v${data.text("version")}: ${data.text("file")}"

            "artifact.added" -> "Artifact: ${data.text("path")}"

            "result.posted" -> "Result: ${data.text("file")}" + artifacts(data)

            "handoff.written" -> "Handoff: ${data.text("file")}"

            "session.started" -> "Session started on ${data.text("host")}"

            "session.resumed" -> "Session resumed. ${data.text("text").orEmpty()}".trim()

            "session.stop_requested" -> "Stop of the session requested"

            "session.ended" -> "Session ended: ${data.text("reason")}"

            else -> type
        }

    private fun artifacts(data: JsonObject): String {
        val list = (data["artifacts"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
        return if (list.isEmpty()) "" else " (${list.size} artifacts)"
    }
}
