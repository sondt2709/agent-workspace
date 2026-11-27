package com.agentworkspace.control

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The value of "No project" in a project filter (`NO_PROJECT` of shared/client inbox.ts). */
const val NO_PROJECT = "none"

/**
 * The project filter of Tasks and the Inbox (openspec nav-tasks-needs-you), the rules of
 * shared/client inbox.ts, tested with `contracts/fixtures/filters/projects.json`.
 */
object ProjectFilter {
    /** The items of the selected projects. An empty selection keeps all; `none` selects no project. */
    fun <T> filter(
        items: List<T>,
        selected: List<String>,
        projectOf: (T) -> String?,
    ): List<T> = if (selected.isEmpty()) items else items.filter { (projectOf(it) ?: NO_PROJECT) in selected }

    /** The text of the chip: "Project", 1 or 2 names, or "<n> projects". */
    fun label(
        selected: List<String>,
        nameOf: (String) -> String,
    ): String {
        if (selected.isEmpty()) return "Project"
        val names = selected.map { if (it == NO_PROJECT) "No project" else nameOf(it) }
        return if (names.size <= 2) names.joinToString(", ") else "${names.size} projects"
    }

    /** The rows of the list for a search text: "No project" first, then by name. */
    fun rows(
        projects: List<Pair<String, String>>,
        search: String,
        allowNone: Boolean,
    ): List<Pair<String, String>> {
        val text = search.trim().lowercase()
        val rows =
            (if (allowNone) listOf(NO_PROJECT to "No project") else emptyList()) +
                // By the lower-case name, then by the name, by UTF-16 code unit: the order of the desktop.
                projects.sortedWith(compareBy({ it.second.lowercase() }, { it.second }))
        return if (text.isEmpty()) rows else rows.filter { it.second.lowercase().contains(text) }
    }
}

/** One original message of a card. */
data class CardMessage(
    val id: String,
    val author: String,
    val at: String,
    val text: String,
    val url: String?,
    val quote: String?,
)

/** An ask, an answer or a task line of a card. */
data class CardChat(
    val kind: String,
    val id: String,
    val text: String,
    val answered: Boolean?,
)

/** A reply of the person and its state (`requested`, `sent`, `failed`). */
data class CardReply(
    val reply: String,
    val text: String,
    val state: String,
    val url: String?,
    val error: String?,
)

/** A card of the Inbox (`CardView` of shared/core), read from the index of the phone. */
data class InboxCard(
    val card: String,
    val source: String,
    val conversationId: String,
    val conversationName: String,
    val thread: String?,
    val project: String?,
    val category: String,
    val urgency: String,
    val title: String,
    val summary: String,
    val taskTitle: String?,
    val taskProject: String?,
    val taskFirstMessage: String?,
    val answer: String?,
    val answerFrom: String?,
    val messages: List<CardMessage>,
    val lastMessageAt: String,
    val read: Boolean,
    val done: Boolean,
    val chat: List<CardChat> = emptyList(),
    val replies: List<CardReply> = emptyList(),
    val tasks: List<String> = emptyList(),
) {
    companion object {
        private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

        /** A required text field: the merge always writes it. */
        private fun JsonObject.req(key: String): String = str(key) ?: error("The card view has no $key")

        private fun JsonObject.flag(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

        private fun JsonObject.list(key: String): List<JsonObject> =
            (this[key] as? JsonArray)?.map { it.jsonObject }.orEmpty()

        /** A card from its view JSON (the zod output of the merge). */
        fun of(json: JsonObject): InboxCard {
            val conversation = json.getValue("conversation").jsonObject
            val task = json["task"] as? JsonObject
            val answer = json["answer"] as? JsonObject
            return InboxCard(
                card = json.req("card"),
                source = json.req("source"),
                conversationId = conversation.req("id"),
                conversationName = conversation.req("name"),
                thread = json.str("thread"),
                project = json.str("project"),
                category = json.req("category"),
                urgency = json.str("urgency") ?: "normal",
                title = json.req("title"),
                summary = json.str("summary").orEmpty(),
                taskTitle = task?.str("title"),
                taskProject = task?.str("project"),
                taskFirstMessage = task?.str("first_message"),
                answer = answer?.str("text"),
                answerFrom = answer?.str("from"),
                messages =
                    json.list("messages").map {
                        CardMessage(
                            it.req("id"),
                            it.req("author"),
                            it.req("at"),
                            it.req("text"),
                            it.str("url"),
                            it.str("quote"),
                        )
                    },
                lastMessageAt = json.req("last_message_at"),
                read = json.flag("read"),
                done = json.flag("done"),
                chat =
                    json.list("chat").map {
                        CardChat(
                            it.req("kind"),
                            it.req("id"),
                            it.str("text").orEmpty(),
                            (it["answered"] as? JsonPrimitive)?.booleanOrNull,
                        )
                    },
                replies =
                    json.list("replies").map {
                        CardReply(
                            it.req("reply"),
                            it.req("text"),
                            it.req("state"),
                            it.str("url"),
                            it.str("error"),
                        )
                    },
                tasks = (json["tasks"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty(),
            )
        }
    }
}

/** The filter of the Inbox list: category, projects, unread, done, sort. */
data class CardFilter(
    val category: String = "all",
    val projects: List<String> = emptyList(),
    val unread: Boolean = false,
    val done: Boolean = false,
    val sort: String = "urgency",
)

/**
 * The rows and the counts of the Inbox (spec inbox-cards "Phone Inbox"), the rules of shared/client
 * inbox.ts, tested with `contracts/fixtures/inbox/cards.json`.
 */
object InboxCards {
    private val rank = mapOf("high" to 0, "normal" to 1, "low" to 2)

    private val newest =
        Comparator<InboxCard> { a, b ->
            if (a.lastMessageAt !=
                b.lastMessageAt
            ) {
                -a.lastMessageAt.compareTo(b.lastMessageAt)
            } else {
                a.card.compareTo(b.card)
            }
        }

    fun rows(
        cards: List<InboxCard>,
        filter: CardFilter,
    ): List<InboxCard> {
        var rows = cards.filter { filter.done || !it.done }
        rows = ProjectFilter.filter(rows, filter.projects) { it.project }
        if (filter.category != "all") rows = rows.filter { it.category == filter.category }
        if (filter.unread) rows = rows.filter { !it.read }
        val order =
            if (filter.sort == "urgency") {
                compareBy<InboxCard> { rank[it.urgency] ?: 1 }.then(newest)
            } else {
                newest
            }
        return rows.sortedWith(order)
    }

    /** The open cards of each category, and the unread open cards. */
    fun counts(cards: List<InboxCard>): Map<String, Int> {
        val open = cards.filter { !it.done }
        return mapOf(
            "action" to open.count { it.category == "action" },
            "question" to open.count { it.category == "question" },
            "info" to open.count { it.category == "info" },
            "unread" to open.count { !it.read },
        )
    }

    /** The cards of an index view (`view/inbox`), or none. */
    fun fromView(view: JsonObject?): List<InboxCard> =
        (view?.get("cards") as? JsonArray)?.map { InboxCard.of(it.jsonObject) }.orEmpty()
}
