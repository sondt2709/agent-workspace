package com.agentworkspace.control

import com.agentworkspace.shared.merge.EventRow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Activity rule of the phone (openspec phone-task-focus): the same table, rule, lines and cut as
 * the desktop, from the shared fixture `contracts/fixtures/activity/cases.json`; and a Session row for
 * each event type of the contract (principle 8).
 */
class ActivityRuleTest {
    private val contracts = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
    private val fixture: JsonObject by lazy {
        Json.parseToJsonElement(Files.readString(contracts.resolve("fixtures/activity/cases.json"))).jsonObject
    }
    private val samples: JsonObject by lazy {
        Json.parseToJsonElement(Files.readString(contracts.resolve("samples/schema-samples.json"))).jsonObject
    }
    private val contractTypes: List<String> by lazy {
        samples.getValue("event_types").jsonArray.map {
            it.jsonObject
                .getValue("type")
                .jsonPrimitive.content
        }
    }

    private fun row(
        n: Int,
        type: String,
        dev: String,
        by: String,
        data: JsonObject,
    ): EventRow =
        EventRow(
            id = "e$n",
            task = "t1",
            hlc = "2026-11-24T10:00:${(n % 60).toString().padStart(2, '0')}.000Z#${n.toString().padStart(4, '0')}",
            dev = dev,
            type = type,
            path = "tasks/t1/log/$dev.jsonl",
            line = n,
            applied = true,
            reason = null,
            event =
                buildJsonObject {
                    put("type", type)
                    put("by", by)
                    put("data", data)
                },
        )

    @Test
    fun theTableIsThePlacesOfTheSharedFixture() {
        val places =
            fixture.getValue("places").jsonObject.mapValues { (_, v) ->
                ActivityPlace.valueOf(v.jsonPrimitive.content.uppercase())
            }
        assertEquals(places, ActivityRule.PLACES)
        assertTrue(contractTypes.size > 30)
        assertEquals(contractTypes.sorted(), ActivityRule.PLACES.keys.sorted())
    }

    @Test
    fun eachSharedCaseHasTheExpectedPlaceAndLine() {
        for (case in fixture.getValue("cases").jsonArray.map { it.jsonObject }) {
            val name = case.getValue("name").jsonPrimitive.content
            val type = case.getValue("type").jsonPrimitive.content
            val dev = case.getValue("dev").jsonPrimitive.content
            val data = case.getValue("data").jsonObject
            val expected = case.getValue("in_activity").jsonPrimitive.boolean
            assertEquals(expected, ActivityRule.inActivity(type, data), name)
            assertEquals((case["line"] as? JsonPrimitive)?.contentOrNull, ActivityRule.line(type, dev, data), name)
            // The phone rows: a case in Activity gives one Activity row with the line, if it has one.
            val by = case.getValue("by").jsonPrimitive.content
            val activity = ThreadItems.activity(listOf(row(1, type, dev, by, data)))
            assertEquals(if (expected) 1 else 0, activity.size, name)
            (case["line"] as? JsonPrimitive)?.contentOrNull?.let { assertEquals(it, activity.single().text, name) }
        }
    }

    @Test
    fun theCutOfALongAgentMessageIsTheCutOfTheDesktop() {
        assertEquals(fixture.getValue("clamp_lines").jsonPrimitive.int, ActivityRule.CLAMP_LINES)
        for (case in fixture.getValue("clamp").jsonArray.map { it.jsonObject }) {
            val name = case.getValue("name").jsonPrimitive.content
            val clamp = ActivityRule.clamp(case.getValue("text").jsonPrimitive.content)
            assertEquals(case.getValue("head").jsonPrimitive.content, clamp.head, name)
            assertEquals(case.getValue("cut").jsonPrimitive.boolean, clamp.cut, name)
        }
    }

    @Test
    fun theSessionViewHasARowForEachContractTypeAndAnUnknownType() {
        val events =
            samples.getValue("event_types").jsonArray.map { it.jsonObject.getValue("valid").jsonObject } +
                samples.getValue("unknown_type").jsonObject
        val rows =
            events.mapIndexed { i, event ->
                val type = event.getValue("type").jsonPrimitive.content
                EventRow(
                    id = "e$i",
                    task = "t1",
                    hlc = "2026-11-24T10:00:00.000Z#${i.toString().padStart(4, '0')}",
                    dev = "ubuntu-01",
                    type = type,
                    path = "tasks/t1/log/ubuntu-01.jsonl",
                    line = i + 1,
                    applied = true,
                    reason = null,
                    event = event,
                )
            }
        val items = ThreadItems.of(rows)
        assertEquals(rows.map { it.type }, items.map { it.type })
        assertTrue(items.all { it.text.isNotEmpty() || it.kind != ThreadKind.SYSTEM })
    }

    @Test
    fun activityShowsTheTaskAndNotTheSession() {
        val session = """{"session":"01a2038e-8100-7000-8000-000000000001""""
        val rows =
            listOf(
                row(
                    1,
                    "task.created",
                    "macbook-pro",
                    "human@macbook-pro",
                    obj("""{"first_message":"Add rate limits"}"""),
                ),
                row(2, "task.claimed", "ubuntu-01", "aw@ubuntu-01", obj("""{"device":"ubuntu-01","epoch":1}""")),
                row(3, "session.started", "ubuntu-01", "aw@ubuntu-01", obj("""$session,"host":"tmux","cwd":"~/x"}""")),
                row(
                    4,
                    "message.human",
                    "ubuntu-01",
                    "human@macbook-pro",
                    obj("""$session,"text":"Add rate limits","source":"first"}"""),
                ),
                row(
                    5,
                    "message.agent",
                    "ubuntu-01",
                    "claude@ubuntu-01",
                    obj("""{"text":"1\n2\n3\n4\n5\n6\n7\n8\n9"}"""),
                ),
                row(
                    6,
                    "message.human",
                    "ubuntu-01",
                    "human@ubuntu-01",
                    obj("""$session,"text":"Use cents.","source":"typed"}"""),
                ),
                row(7, "session.ended", "ubuntu-01", "aw@ubuntu-01", obj("""$session,"reason":"stopped"}""")),
            )
        val activity = ThreadItems.activity(rows)
        assertEquals(listOf("e1", "e5", "e6", "e7"), activity.map { it.id })
        assertEquals("Created by human@macbook-pro", activity[0].text)
        assertEquals(ThreadKind.SYSTEM, activity[0].kind)
        assertEquals("1\n2\n3\n4\n5\n6\n7\n8\n9", activity[1].text)
        assertEquals("typed in the terminal", activity[2].note)
        assertTrue(activity[3].text.startsWith("Session stopped on ubuntu-01: "))
        // The Session view keeps each event, also the first message as its row.
        val session7 = ThreadItems.of(rows)
        assertEquals(7, session7.size)
        assertEquals("Add rate limits", session7[0].text)
        assertEquals("Session ended: stopped", session7[6].text)
    }

    @Test
    fun eachMessageRowOfActivityIsMarkdownAndATaskLineIsNot() {
        val rows =
            listOf(
                row(1, "task.created", "macbook-pro", "human@macbook-pro", obj("""{"first_message":"x"}""")),
                row(2, "message.agent", "ubuntu-01", "claude@ubuntu-01", obj("""{"text":"Use **cents**"}""")),
                row(3, "message.sent", "macbook-pro", "human@macbook-pro", obj("""{"id":"d1","text":"**Yes**"}""")),
                row(4, "comment.added", "macbook-pro", "human@macbook-pro", obj("""{"text":"See `a.ts`"}""")),
                row(
                    5,
                    "gate.opened",
                    "ubuntu-01",
                    "claude@ubuntu-01",
                    obj("""{"gate":"g1","kind":"question","title":"Store?","text":"- **A**","options":["A"]}"""),
                ),
                row(6, "gate.answered", "macbook-pro", "human@macbook-pro", obj("""{"gate":"g1","answer":"A"}""")),
                row(7, "task.done", "macbook-pro", "human@macbook-pro", obj("{}")),
            )
        val activity = ThreadItems.activity(rows)
        assertEquals(listOf("e1", "e2", "e3", "e4", "e5", "e6", "e7"), activity.map { it.id })
        assertEquals(
            listOf(false, true, true, true, true, true, false),
            activity.map { ActivityRule.markdown(it.kind) },
        )
    }

    @Test
    fun anActivityRowThatTheMergeIgnoredKeepsItsNote() {
        val session = """{"session":"01a2038e-8100-7000-8000-000000000001""""
        val rows =
            listOf(
                row(
                    1,
                    "task.created",
                    "macbook-pro",
                    "human@macbook-pro",
                    obj("""{"first_message":"Add rate limits"}"""),
                ),
                row(
                    2,
                    "message.human",
                    "ubuntu-01",
                    "human@ubuntu-01",
                    obj("""$session,"text":"x","source":"typed"}"""),
                ),
            ).map { it.copy(applied = false, reason = "not_owner") }
        val activity = ThreadItems.activity(rows)
        assertEquals(listOf("Ignored: not_owner", "Ignored: not_owner"), activity.map { it.note })
        assertEquals("Created by human@macbook-pro", activity[0].text)
    }

    private fun obj(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject
}
