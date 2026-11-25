package com.agentworkspace.control

import com.agentworkspace.shared.merge.EventRow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/** The 3 row styles of Activity, and the card of an open gate of another kind (app-style). */
enum class RowStyle { MESSAGE, PROPOSAL, LINE, CARD }

/** The author of a message row: the edge has the info color for an agent, the outline color for a person. */
enum class Author { AGENT, PERSON }

/** What a message row holds: a message, a question of the agent, or an answer of a person. */
enum class MessageKind { MESSAGE, QUESTION, ANSWER }

/** The state of the gate of the newest proposal: no gate, open, approved, or closed with another answer. */
enum class ProposalState { NONE, OPEN, APPROVED, CLOSED }

/**
 * One row of Activity (openspec proposal-and-discussion, design decision 6). [item] is the event as
 * the Session view reads it (who, time, note); the other fields are the row of the Activity rule.
 */
data class ActivityRow(
    val item: ThreadItem,
    val style: RowStyle,
    /** The author of a message row, else null. */
    val author: Author? = null,
    val kind: MessageKind = MessageKind.MESSAGE,
    /** The text of a message, the gate text of a question, the answer, or the line of a task line. */
    val text: String,
    /** The gate title of a question. */
    val title: String? = null,
    /** The options of a question while its gate is open. */
    val options: List<String> = emptyList(),
    /** The close answer of AW for a question that no person answered, for example "Replaced by a newer question". */
    val gateNote: String? = null,
    /** The label of an answer to a gate of another kind, for example "Approve result: Request changes". */
    val label: String? = null,
    /** The gate of a question, a proposal card, or a gate card. */
    val gate: String? = null,
    /** The version and the file of a proposal card. */
    val version: Long? = null,
    val file: String? = null,
    val state: ProposalState? = null,
    /** The person that approved the proposal of the card, or null. */
    val approvedBy: String? = null,
) {
    val event: String get() = item.id

    /** True for the row that waits for the person: an open question, an open proposal, or a gate card. */
    val needsYou: Boolean
        get() =
            (kind == MessageKind.QUESTION && gateNote == null && options.isNotEmpty()) ||
                state == ProposalState.OPEN ||
                style == RowStyle.CARD
}

/**
 * The Activity rows of a thread, oldest first (openspec proposal-and-discussion): the same rule as the
 * desktop `activity-model.ts`, tested with the threads of `contracts/fixtures/activity/cases.json`.
 * A row can depend on later events: an answered question has no buttons, a replaced proposal is a task
 * line, and the card of a closed gate has no row.
 */
object ActivityRows {
    /** The answer of the "Approve" option (or "Confirm" of a gate from before the rename). */
    private val APPROVE = Regex("^(approve|confirm)", RegexOption.IGNORE_CASE)

    private val ASKS = setOf("question", "reply")
    private const val PROPOSAL_GATE = "approve_proposal"

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun dataOf(row: EventRow): JsonObject = row.event["data"] as? JsonObject ?: JsonObject(emptyMap())

    private fun byOf(row: EventRow): String = (row.event["by"] as? JsonPrimitive)?.contentOrNull ?: row.dev

    /** One gate of the thread: its `gate.opened` data and its resolution. */
    private class GateTrack(
        val kind: String,
        val data: JsonObject,
        /** The proposal version of an `approve_proposal` gate. */
        val version: Long?,
    ) {
        var answer: String? = null
        var answerEvent: String? = null
        var resolved = false
    }

    /** What the rows need from the whole thread, read once in merge order. */
    private class Thread(
        rows: List<EventRow>,
    ) {
        val gates = LinkedHashMap<String, GateTrack>()

        /** The by of each `gate.answered`, by event id. */
        val answeredBy = HashMap<String, String>()

        /** The versions of the `proposal.proposed` events, sorted. */
        val versions: List<Long>

        /** The event of the newest proposal: its card. */
        var newest: String? = null
            private set

        /** The newest `approve_proposal` gate of each version. */
        val proposalGates = HashMap<Long, String>()

        private val seen = sortedSetOf<Long>()
        private var newestVersion = Long.MIN_VALUE

        init {
            for (row in rows) {
                val data = dataOf(row)
                when (row.type) {
                    "proposal.proposed" -> proposed(row, data)
                    "gate.opened" -> opened(data)
                    "gate.answered" -> answeredBy[row.id] = byOf(row)
                    "gate.resolved" -> resolved(data)
                }
            }
            versions = seen.toList()
        }

        private fun proposed(
            row: EventRow,
            data: JsonObject,
        ) {
            val v = (data["version"] as? JsonPrimitive)?.longOrNull ?: return
            seen += v
            if (v >= newestVersion) {
                newestVersion = v
                newest = row.id
            }
        }

        /** A gate of a proposal gets the version of its file, else the newest version before it. */
        private fun opened(data: JsonObject) {
            val gate = data.text("gate") ?: return
            val kind = data.text("kind").orEmpty()
            val version =
                if (kind == PROPOSAL_GATE) {
                    ProposalVersions.FILE
                        .find(data.text("file").orEmpty())
                        ?.groupValues
                        ?.get(1)
                        ?.toLongOrNull() ?: seen.lastOrNull()
                } else {
                    null
                }
            gates[gate] = GateTrack(kind, data, version)
            if (version != null) proposalGates[version] = gate
        }

        private fun resolved(data: JsonObject) {
            val track = gates[data.text("gate")] ?: return
            if (track.resolved) return
            track.resolved = true
            track.answer = data.text("answer")
            track.answerEvent = data.text("answer_event")
        }
    }

    /**
     * The answer of "Approve proposal": the option "Approve", or "Confirm" of a gate from before the
     * rename (the phone sends only an option of the gate), else "Approve".
     */
    fun approveAnswer(options: List<String>): String = options.firstOrNull { APPROVE.containsMatchIn(it) } ?: "Approve"

    /** The Activity rows of the events of a task in merge order. */
    fun of(rows: List<EventRow>): List<ActivityRow> {
        val thread = Thread(rows)
        val items = ThreadItems.of(rows)
        return rows.indices.mapNotNull { i ->
            val row = rows[i]
            val data = dataOf(row)
            if (!ActivityRule.inActivity(row.type, data, byOf(row))) null else rowOf(row, data, items[i], thread)
        }
    }

    @Suppress("CyclomaticComplexMethod") // One branch per event type of the Activity table.
    private fun rowOf(
        row: EventRow,
        data: JsonObject,
        item: ThreadItem,
        thread: Thread,
    ): ActivityRow? {
        ActivityRule.line(row.type, row.dev, data)?.let { return line(item, it) }
        return when (row.type) {
            "task.created" -> {
                line(item.copy(note = if (row.applied) null else item.note), "Created by ${item.who}")
            }

            "message.human" -> {
                val typed = ThreadItems.typed(item, row.applied)
                val author = if (typed.kind == ThreadKind.AGENT) Author.AGENT else Author.PERSON
                ActivityRow(typed, RowStyle.MESSAGE, author, text = typed.text)
            }

            "message.agent" -> {
                ActivityRow(item, RowStyle.MESSAGE, Author.AGENT, text = item.text)
            }

            "message.sent", "comment.added" -> {
                ActivityRow(item, RowStyle.MESSAGE, Author.PERSON, text = item.text)
            }

            "gate.opened" -> {
                opened(item, data, thread)
            }

            "gate.answered" -> {
                answered(row, item, data, thread)
            }

            "proposal.proposed" -> {
                proposal(row, item, data, thread)
            }

            else -> {
                if (item.kind == ThreadKind.SYSTEM) {
                    line(item, item.text)
                } else {
                    ActivityRow(item, RowStyle.MESSAGE, Author.PERSON, text = item.text)
                }
            }
        }
    }

    private fun line(
        item: ThreadItem,
        text: String,
    ) = ActivityRow(item.copy(kind = ThreadKind.SYSTEM, text = text), RowStyle.LINE, text = text)

    /** A question is an agent message; the gate of a proposal has no row; another open gate is a card. */
    private fun opened(
        item: ThreadItem,
        data: JsonObject,
        thread: Thread,
    ): ActivityRow? {
        val gate = data.text("gate") ?: return null
        val track = thread.gates[gate] ?: return null
        return when {
            track.kind in ASKS -> {
                val options =
                    (data["options"] as? JsonArray)
                        ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.contentOrNull }
                        .orEmpty()
                ActivityRow(
                    item = item.copy(kind = ThreadKind.AGENT),
                    style = RowStyle.MESSAGE,
                    author = Author.AGENT,
                    kind = MessageKind.QUESTION,
                    text = data.text("text").orEmpty(),
                    title = data.text("title").orEmpty(),
                    options = if (track.resolved) emptyList() else options,
                    gateNote = if (track.resolved && track.answerEvent == null) track.answer else null,
                    gate = gate,
                )
            }

            track.kind == PROPOSAL_GATE -> {
                null
            }

            track.resolved -> {
                null
            }

            else -> {
                ActivityRow(item, RowStyle.CARD, text = item.text, gate = gate)
            }
        }
    }

    /**
     * The answer of a question is a person message; the approval of a proposal is a task line; the
     * answer of another gate is a person message with a label when it has a comment, else a task line.
     */
    private fun answered(
        row: EventRow,
        item: ThreadItem,
        data: JsonObject,
        thread: Thread,
    ): ActivityRow {
        val answer = data.text("answer").orEmpty()
        val comment = data.text("comment")?.takeIf { it.isNotEmpty() }
        val track = thread.gates[data.text("gate")]
        val person = item.copy(kind = ThreadKind.ANSWER)
        if (track == null || track.kind in ASKS) {
            val text = if (comment == null) answer else "$answer\n\n$comment"
            return ActivityRow(person.copy(text = text), RowStyle.MESSAGE, Author.PERSON, MessageKind.ANSWER, text)
        }
        val used = !track.resolved || track.answerEvent == row.id
        if (track.kind == PROPOSAL_GATE && APPROVE.containsMatchIn(answer) && used) {
            val version = track.version?.let { "v$it" } ?: "proposal"
            return line(item, "Proposal $version approved by ${item.who}")
        }
        val label = "${Texts.gateLabel(track.kind)}: $answer"
        if (comment != null) {
            return ActivityRow(
                person.copy(text = comment),
                RowStyle.MESSAGE,
                Author.PERSON,
                MessageKind.ANSWER,
                comment,
                label = label,
            )
        }
        return line(item, "${item.who} answered $label")
    }

    /** The newest version is the proposal card; an older version is the line "Proposal v1 · replaced by v2". */
    private fun proposal(
        row: EventRow,
        item: ThreadItem,
        data: JsonObject,
        thread: Thread,
    ): ActivityRow? {
        val version = (data["version"] as? JsonPrimitive)?.longOrNull ?: return line(item, item.text)
        val newer = thread.versions.firstOrNull { it > version }
        if (newer != null) return line(item, "Proposal v$version · replaced by v$newer")
        // A second event of the newest version shows once: as the card of its last event.
        if (row.id != thread.newest) return null
        val gate = thread.proposalGates[version]
        val track = gate?.let { thread.gates[it] }
        val state =
            when {
                track == null -> ProposalState.NONE
                !track.resolved -> ProposalState.OPEN
                APPROVE.containsMatchIn(track.answer.orEmpty()) -> ProposalState.APPROVED
                else -> ProposalState.CLOSED
            }
        return ActivityRow(
            item = item.copy(kind = ThreadKind.AGENT),
            style = RowStyle.PROPOSAL,
            author = Author.AGENT,
            text = item.text,
            gate = gate,
            version = version,
            file = data.text("file"),
            state = state,
            approvedBy =
                if (state ==
                    ProposalState.APPROVED
                ) {
                    track?.answerEvent?.let { thread.answeredBy[it] }
                } else {
                    null
                },
        )
    }
}
