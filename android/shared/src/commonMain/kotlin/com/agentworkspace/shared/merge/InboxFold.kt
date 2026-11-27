package com.agentworkspace.shared.merge

import com.agentworkspace.shared.model.AwEvent
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The event types of the sources and the Inbox (`inbox.ts`, openspec inbox-mattermost). */
val INBOX_EVENT_TYPES =
    setOf(
        "source.configured",
        "inbox.run_requested",
        "inbox.card_added",
        "inbox.card_updated",
        "inbox.card_set",
        "inbox.card_project",
        "inbox.ask",
        "inbox.answer",
        "inbox.reply_requested",
        "inbox.reply_result",
        "inbox.task_created",
    )

/** The event types that awd writes (not a person). */
private val AGENT_TYPES = setOf("inbox.card_added", "inbox.card_updated", "inbox.answer", "inbox.reply_result")

private const val FIRST_MESSAGE_MAX = 20000
private const val MINUTE_END = 16

private fun JsonObject.str(key: String): String = getValue(key).jsonPrimitive.content

/** The fold of the inbox events, on the zod output of each event (the same JSON as `inbox.ts`). */
class InboxAccumulator {
    private val sources = LinkedHashMap<String, MutableMap<String, JsonElement>>()
    private val cards = LinkedHashMap<String, MutableMap<String, JsonElement>>()
    private val replies = LinkedHashMap<String, MutableMap<String, JsonElement>>()

    /** The cards whose category or project a person set: the triage agent no longer changes it. */
    private val personCategory = mutableSetOf<String>()
    private val personProject = mutableSetOf<String>()

    /** True when the device collects the source at this point of the merge order (design 4). */
    private fun collects(
        source: String,
        dev: String,
    ): Boolean = sources[source]?.get("collector")?.let { (it as? JsonPrimitive)?.contentOrNull } == dev

    /** Applies one inbox event, in merge order. */
    fun apply(e: AwEvent): Decision {
        val data = e.json["data"] as JsonObject
        val human = e.by?.let { isHuman(it) } ?: false
        // A person writes the configuration and the card actions; awd writes the rest (design 3).
        val wantsHuman = e.type !in AGENT_TYPES
        if (human != wantsHuman) return Decision.reject(if (wantsHuman) "not_human" else "not_agent")
        return when (e.type) {
            "source.configured" -> configure(e, data)
            "inbox.run_requested" -> run(e, data)
            "inbox.card_added" -> add(e, data)
            "inbox.reply_result" -> replyResult(e, data)
            else -> cardEvent(e, data)
        }
    }

    private fun configure(
        e: AwEvent,
        data: JsonObject,
    ): Decision {
        val id = data.str("source")
        val view = data.toMutableMap()
        view["configured"] = refJson(e)
        view["run_requested"] = sources[id]?.get("run_requested") ?: JsonNull
        sources[id] = view
        return Decision.OK
    }

    private fun run(
        e: AwEvent,
        data: JsonObject,
    ): Decision {
        val source = sources[data.str("source")] ?: return Decision.reject("unknown_source")
        source["run_requested"] = refJson(e)
        return Decision.OK
    }

    private fun add(
        e: AwEvent,
        data: JsonObject,
    ): Decision {
        if (!collects(data.str("source"), e.dev)) return Decision.reject("not_collector")
        if (cards.containsKey(data.str("card"))) return Decision.reject("duplicate_card")
        val messages = data.getValue("messages").jsonArray
        val card =
            linkedMapOf(
                "card" to data.getValue("card"),
                "source" to data.getValue("source"),
                "conversation" to data.getValue("conversation"),
                "thread" to data.getValue("thread"),
                "project" to data.getValue("project"),
                "category" to data.getValue("category"),
                "urgency" to data.getValue("urgency"),
                "title" to data.getValue("title"),
                "summary" to data.getValue("summary"),
                "task" to data.getValue("task"),
                "answer" to data.getValue("answer"),
                "messages" to JsonArray(emptyList()),
                "last_message_at" to messages[0].jsonObject.getValue("at"),
                "read" to JsonPrimitive(false),
                "done" to JsonPrimitive(false),
                "added" to refJson(e),
                "updated_hlc" to JsonPrimitive(e.hlc),
                "chat" to JsonArray(emptyList()),
                "replies" to JsonArray(emptyList()),
                "tasks" to JsonArray(emptyList()),
            )
        addMessages(card, messages)
        cards[data.str("card")] = card
        return Decision.OK
    }

    /** The events of one card that exists: update, set, ask, answer, task, reply request. */
    private fun cardEvent(
        e: AwEvent,
        data: JsonObject,
    ): Decision {
        val card = cards[data.str("card")] ?: return Decision.reject("unknown_card")
        if (e.type in AGENT_TYPES && !collects(card.getValue("source").jsonPrimitive.content, e.dev)) {
            return Decision.reject("not_collector")
        }
        return when (e.type) {
            "inbox.card_updated" -> update(e, data, card)
            "inbox.card_set" -> set(e, data, card)
            "inbox.card_project" -> project(e, data, card)
            "inbox.reply_requested" -> replyRequested(e, data)
            else -> chat(e, data, card)
        }
    }

    private fun update(
        e: AwEvent,
        data: JsonObject,
        card: MutableMap<String, JsonElement>,
    ): Decision {
        val id = card.getValue("card").jsonPrimitive.content
        // A category or a project of a person wins over each later change of the agent.
        val kept = setOfNotNull("project".takeIf { id in personProject }, "category".takeIf { id in personCategory })
        for (key in listOf("project", "category", "urgency", "title", "summary", "task", "answer")) {
            if (key !in kept && key in e.dataKeys) data[key]?.let { card[key] = it }
        }
        if (addMessages(card, data.getValue("messages").jsonArray)) {
            // A new message brings the card back (spec inbox-cards "Cards").
            card["read"] = JsonPrimitive(false)
            card["done"] = JsonPrimitive(false)
        }
        card["updated_hlc"] = JsonPrimitive(e.hlc)
        return Decision.OK
    }

    private fun set(
        e: AwEvent,
        data: JsonObject,
        card: MutableMap<String, JsonElement>,
    ): Decision {
        fun given(key: String): JsonElement? = if (key in e.dataKeys) data[key] else null
        given("read")?.let { card["read"] = it }
        given("done")?.let { card["done"] = it }
        given("category")?.let { category ->
            card["category"] = category
            personCategory.add(card.getValue("card").jsonPrimitive.content)
            if (category.jsonPrimitive.content == "action" && card["task"] is JsonNull) {
                card["task"] =
                    JsonObject(
                        linkedMapOf(
                            "title" to card.getValue("title"),
                            "project" to card.getValue("project"),
                            "first_message" to JsonPrimitive(firstMessage(card)),
                        ),
                    )
            }
        }
        card["updated_hlc"] = JsonPrimitive(e.hlc)
        return Decision.OK
    }

    /** A person sets the project of a card, or null (`inbox.card_project`). */
    private fun project(
        e: AwEvent,
        data: JsonObject,
        card: MutableMap<String, JsonElement>,
    ): Decision {
        val project = data.getValue("project")
        // A task suggestion with no project, or with the old project, follows the new project.
        val task = card["task"] as? JsonObject
        if (task != null) {
            val taskProject = task.getValue("project")
            if (taskProject is JsonNull || taskProject == card.getValue("project")) {
                card["task"] = JsonObject(task + ("project" to project))
            }
        }
        card["project"] = project
        personProject.add(card.getValue("card").jsonPrimitive.content)
        card["updated_hlc"] = JsonPrimitive(e.hlc)
        return Decision.OK
    }

    /** An ask, an answer or a task line of a card. */
    private fun chat(
        e: AwEvent,
        data: JsonObject,
        card: MutableMap<String, JsonElement>,
    ): Decision {
        val chat =
            card
                .getValue("chat")
                .jsonArray
                .map { it.jsonObject }
                .toMutableList()
        val task = e.type == "inbox.task_created"
        val item = LinkedHashMap<String, JsonElement>()
        item["kind"] =
            JsonPrimitive(
                if (task) {
                    "task"
                } else if (e.type == "inbox.ask") {
                    "ask"
                } else {
                    "answer"
                },
            )
        item["id"] = if (task) data.getValue("task") else data.getValue("ask")
        item["text"] = if (task) JsonPrimitive("") else data.getValue("text")
        item["by"] = e.by?.let { JsonPrimitive(it) } ?: JsonNull
        item.putAll(refJson(e))
        if (e.type == "inbox.answer") {
            val index = chat.indexOfFirst { it["kind"]?.jsonPrimitive?.content == "ask" && it["id"] == data["ask"] }
            if (index < 0) return Decision.reject("unknown_ask")
            chat[index] = JsonObject(chat[index] + ("answered" to JsonPrimitive(true)))
        }
        if (e.type == "inbox.ask") item["answered"] = JsonPrimitive(false)
        if (task) {
            val tasks = card.getValue("tasks").jsonArray
            if (data["task"] !in tasks) card["tasks"] = JsonArray(tasks + data.getValue("task"))
        }
        chat.add(JsonObject(item))
        card["chat"] = JsonArray(chat)
        return Decision.OK
    }

    private fun replyRequested(
        e: AwEvent,
        data: JsonObject,
    ): Decision {
        if (replies.containsKey(data.str("reply"))) return Decision.reject("duplicate_reply")
        replies[data.str("reply")] =
            linkedMapOf(
                "reply" to data.getValue("reply"),
                "text" to data.getValue("text"),
                "in_thread" to data.getValue("in_thread"),
                "requested" to refJson(e),
                "by" to (e.by?.let { JsonPrimitive(it) } ?: JsonNull),
                "state" to JsonPrimitive("requested"),
                "post" to JsonNull,
                "url" to JsonNull,
                "error" to JsonNull,
                "result_hlc" to JsonNull,
                "card" to data.getValue("card"),
            )
        return Decision.OK
    }

    private fun replyResult(
        e: AwEvent,
        data: JsonObject,
    ): Decision {
        val reply = replies[data.str("reply")] ?: return Decision.reject("unknown_reply")
        if (reply["card"] != data["card"]) return Decision.reject("unknown_reply")
        val card = cards[data.str("card")] ?: return Decision.reject("unknown_reply")
        if (!collects(card.getValue("source").jsonPrimitive.content, e.dev)) return Decision.reject("not_collector")
        // A sent reply stays sent: a later failure of a retry does not undo it.
        if (reply["state"]?.jsonPrimitive?.content == "sent") return Decision.reject("already_sent")
        for (key in listOf("state", "post", "url", "error")) reply[key] = data.getValue(key)
        reply["result_hlc"] = JsonPrimitive(e.hlc)
        return Decision.OK
    }

    /** The sources by id, and the cards with the newest message first (the card id breaks a tie). */
    fun result(): Pair<List<JsonObject>, List<JsonObject>> {
        val sourceViews = sources.entries.sortedBy { it.key }.map { JsonObject(it.value) }
        val byCard = replies.values.groupBy { it.getValue("card").jsonPrimitive.content }
        val cardViews =
            cards.values
                .map { card ->
                    val list =
                        byCard[card.getValue("card").jsonPrimitive.content]
                            .orEmpty()
                            .map { JsonObject(it - "card") }
                    JsonObject(card + ("replies" to JsonArray(list)))
                }.sortedWith(
                    Comparator { a, b ->
                        val x = a.getValue("last_message_at").jsonPrimitive.content
                        val y = b.getValue("last_message_at").jsonPrimitive.content
                        if (x != y) {
                            -x.compareTo(y)
                        } else {
                            a
                                .getValue("card")
                                .jsonPrimitive.content
                                .compareTo(b.getValue("card").jsonPrimitive.content)
                        }
                    },
                )
        return sourceViews to cardViews
    }

    companion object {
        private fun refJson(e: AwEvent): JsonObject =
            JsonObject(
                linkedMapOf(
                    "event" to JsonPrimitive(e.id),
                    "dev" to JsonPrimitive(e.dev),
                    "hlc" to JsonPrimitive(e.hlc),
                ),
            )

        /** Adds the messages that the card does not have yet; true when one was new. */
        private fun addMessages(
            card: MutableMap<String, JsonElement>,
            messages: JsonArray,
        ): Boolean {
            val list = card.getValue("messages").jsonArray.toMutableList()
            val known =
                list
                    .map {
                        it.jsonObject
                            .getValue("id")
                            .jsonPrimitive.content
                    }.toMutableSet()
            var added = false
            for (message in messages) {
                val id =
                    message.jsonObject
                        .getValue("id")
                        .jsonPrimitive.content
                if (!known.add(id)) continue
                list.add(message)
                added = true
            }
            if (added) {
                val sorted =
                    list.sortedBy {
                        it.jsonObject
                            .getValue("at")
                            .jsonPrimitive.content
                    }
                card["messages"] = JsonArray(sorted)
                card["last_message_at"] = sorted.last().jsonObject.getValue("at")
            }
            return added
        }

        /** The first message of a task made from a card with no suggestion: the quoted messages. */
        fun firstMessage(card: Map<String, JsonElement>): String {
            val quoted =
                card.getValue("messages").jsonArray.joinToString("\n") {
                    val m = it.jsonObject
                    val at =
                        m
                            .getValue("at")
                            .jsonPrimitive.content
                            .take(MINUTE_END)
                            .replace("T", " ")
                    "> ${m.getValue("author").jsonPrimitive.content} ($at): ${m.getValue("text").jsonPrimitive.content}"
                }
            val name =
                card
                    .getValue("conversation")
                    .jsonObject
                    .getValue("name")
                    .jsonPrimitive.content
            return "${card.getValue("title").jsonPrimitive.content}\n\nSource: $name\n$quoted".take(FIRST_MESSAGE_MAX)
        }
    }
}

/** A boolean field of a card or a source view. */
fun JsonObject.flag(key: String): Boolean = this[key]?.jsonPrimitive?.booleanOrNull ?: false

/** A text field of a card or a source view, or null. */
fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
