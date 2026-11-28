package com.agentworkspace.control

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The project filter and the Inbox rows of the phone (openspec nav-tasks-needs-you and
 * inbox-mattermost): the cases of `contracts/fixtures/filters/projects.json` and
 * `contracts/fixtures/inbox/cards.json`, the same as the desktop.
 */
class InboxCardsTest {
    private fun fixture(path: String): JsonObject {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        return Json.parseToJsonElement(Files.readString(dir.resolve("fixtures/$path"))).jsonObject
    }

    private fun strings(value: kotlinx.serialization.json.JsonElement?) =
        value!!.jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun projectFilterCases() {
        val f = fixture("filters/projects.json")
        val names = f.getValue("names").jsonObject.mapValues { it.value.jsonPrimitive.content }
        val items =
            f.getValue("items").jsonArray.map {
                it.jsonObject
                    .getValue("id")
                    .jsonPrimitive.content to
                    it.jsonObject["project"]?.jsonPrimitive?.contentOrNull
            }
        for (case in f.getValue("filter").jsonArray.map { it.jsonObject }) {
            val selected = strings(case["selected"])
            val name = case.getValue("name").jsonPrimitive.content
            assertEquals(
                strings(case["ids"]),
                ProjectFilter.filter(items, selected) { it.second }.map { it.first },
                name,
            )
            assertEquals(
                case.getValue("label").jsonPrimitive.content,
                ProjectFilter.label(selected) { names[it] ?: it },
                name,
            )
        }
        val projects = names.entries.map { it.key to it.value }
        for (case in f.getValue("rows").jsonArray.map { it.jsonObject }) {
            val rows =
                ProjectFilter.rows(
                    projects,
                    case.getValue("search").jsonPrimitive.content,
                    case.getValue("allow_none").jsonPrimitive.boolean,
                )
            assertEquals(strings(case["slugs"]), rows.map { it.first }, case.getValue("name").jsonPrimitive.content)
        }
    }

    @Test
    fun cardRowsAndCounts() {
        val f = fixture("inbox/cards.json")
        val cards =
            f.getValue("cards").jsonArray.map {
                val o = it.jsonObject
                InboxCard(
                    card = o.getValue("card").jsonPrimitive.content,
                    source = "mattermost",
                    conversationId = "x",
                    conversationName = "x",
                    thread = null,
                    project = o["project"]?.jsonPrimitive?.contentOrNull,
                    category = o.getValue("category").jsonPrimitive.content,
                    urgency = o.getValue("urgency").jsonPrimitive.content,
                    title = "x",
                    summary = "",
                    taskTitle = null,
                    taskProject = null,
                    taskFirstMessage = null,
                    answer = null,
                    answerFrom = null,
                    messages = emptyList(),
                    lastMessageAt = o.getValue("last_message_at").jsonPrimitive.content,
                    read = o.getValue("read").jsonPrimitive.boolean,
                    done = o.getValue("done").jsonPrimitive.boolean,
                )
            }
        val counts = f.getValue("counts").jsonObject.mapValues { it.value.jsonPrimitive.int }
        assertEquals(counts, InboxCards.counts(cards))
        for (case in f.getValue("rows").jsonArray.map { it.jsonObject }) {
            val c = case.getValue("filter").jsonObject
            val filter =
                CardFilter(
                    category = c.getValue("category").jsonPrimitive.content,
                    projects = strings(c["projects"]),
                    unread = c.getValue("unread").jsonPrimitive.boolean,
                    done = c.getValue("done").jsonPrimitive.boolean,
                    sort = c.getValue("sort").jsonPrimitive.content,
                )
            assertEquals(
                strings(case["cards"]),
                InboxCards.rows(cards, filter).map {
                    it.card
                },
                case.getValue("name").jsonPrimitive.content,
            )
        }
    }
}
