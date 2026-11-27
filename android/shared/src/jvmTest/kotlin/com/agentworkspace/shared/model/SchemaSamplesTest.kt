package com.agentworkspace.shared.model

import com.agentworkspace.schema.EventEnvelopeV1
import com.agentworkspace.schema.EventTypesV1
import com.agentworkspace.schema.GateOpenedV1
import com.agentworkspace.schema.TaskClaimedV1
import com.agentworkspace.schema.TaskV1
import com.agentworkspace.shared.Fixtures
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import kotlin.io.path.extension
import kotlin.io.path.readText
import kotlin.io.path.relativeTo
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Test plan 1: the generated Kotlin classes accept each valid schema sample and each fixture file, and
 * refuse each invalid sample (contracts/samples/schema-samples.json, written from the
 * samples of the TypeScript schema tests).
 */
class SchemaSamplesTest {
    private val samples = Fixtures.json(Fixtures.schemaSamples).jsonObject

    /** The last name of a zod issue path: `servers.0.name` → `name`, `credentials.0` → `credentials`. */
    private fun fieldOf(path: String): String = path.split(".").last { it.toIntOrNull() == null }

    @Test
    fun documentSamples() {
        val documents = samples.getValue("documents").jsonArray.map { it.jsonObject }
        assertEquals(44, documents.size)
        for (sample in documents) {
            val name = sample.getValue("name").jsonPrimitive.content
            val kind =
                sample
                    .getValue("schema")
                    .jsonPrimitive.content
                    .substringBefore(".v")
            val invalid = sample["invalid_path"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
            if (invalid == null) {
                DocumentReader.validate(sample.getValue("value"), kind)
            } else {
                val error =
                    assertFailsWith<DocumentException>(name) { DocumentReader.validate(sample.getValue("value"), kind) }
                assertEquals("schema_error", error.code, name)
                assertTrue(error.message!!.contains(fieldOf(invalid)), "$name: ${error.message}")
            }
        }
    }

    @Test
    fun keepsAnUnknownFieldAndAppliesDefaults() {
        val task =
            DocumentReader
                .validate(
                    JsonObject(
                        mapOf(
                            "kind" to JsonPrimitive("task"),
                            "schema" to JsonPrimitive(1),
                            "id" to JsonPrimitive(Fixtures.FIXTURE_TASK),
                            "key" to JsonPrimitive("AW-1"),
                            "project" to JsonPrimitive("billing-api"),
                            "title" to JsonPrimitive("A task"),
                            "first_message" to JsonPrimitive("Hello"),
                            "stage" to JsonPrimitive("backlog"),
                            "priority_hint" to JsonPrimitive("high"),
                        ),
                    ),
                    "task",
                ).value
        assertEquals("high", task.getValue("priority_hint").jsonPrimitive.content)
        assertEquals(JsonNull, task.getValue("paused"))
        assertEquals(TaskV1.Proposal(0, null), AwJson.decodeFromJsonElement(TaskV1.serializer(), task).proposal)
    }

    @Test
    fun eventSamples() {
        val events = samples.getValue("events").jsonArray.map { it.jsonObject }
        assertEquals(27, events.size)
        for (sample in events) {
            val name = sample.getValue("name").jsonPrimitive.content
            val invalid = sample["invalid_path"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
            val result = LogReader.validate(sample.getValue("value"))
            if (invalid == null) {
                assertTrue(assertIs<LineResult.Event>(result, name).event.known, name)
            } else {
                val bad = assertIs<LineResult.Bad>(result, name)
                assertTrue(bad.message.contains(fieldOf(invalid)), "$name: ${bad.message}")
            }
        }
    }

    @Test
    fun writesNoNullForAnOptionalField() {
        // A Kotlin writer leaves out an absent task and by, as zod needs (`.optional()`, not nullable).
        val envelope =
            EventEnvelopeV1(
                v = 1,
                id = "01a2038e-7f00-7000-8000-000000000001",
                hlc = "2026-11-22T14:20:01.123Z#0000",
                dev = "ubuntu-01",
                type = "credential.added",
                data = mapOf("name" to JsonPrimitive("github-bot")),
            )
        val json = AwJson.encodeToJsonElement(EventEnvelopeV1.serializer(), envelope).jsonObject
        assertEquals(listOf("v", "id", "hlc", "dev", "type", "data"), json.keys.toList())
        assertIs<LineResult.Event>(LogReader.validate(json))
        val withNull = JsonObject(json + ("task" to JsonNull))
        assertTrue(assertIs<LineResult.Bad>(LogReader.validate(withNull)).message.contains("task"))
    }

    @Test
    fun eachEventTypeHasValidDataAndRefusesNullData() {
        val types = samples.getValue("event_types").jsonArray.map { it.jsonObject }
        assertEquals(
            EventTypesV1.serializers.keys.sorted(),
            types.map { it.getValue("type").jsonPrimitive.content }.sorted(),
        )
        for (item in types) {
            val type = item.getValue("type").jsonPrimitive.content
            val valid = assertIs<LineResult.Event>(LogReader.validate(item.getValue("valid")), type).event
            assertEquals(type, valid.type)
            assertTrue(valid.known, type)
            assertIs<LineResult.Bad>(LogReader.validate(item.getValue("data_null")), type)
        }
    }

    @Test
    fun keepsAnUnknownTypeAsUnknown() {
        val event = assertIs<LineResult.Event>(LogReader.validate(samples.getValue("unknown_type"))).event
        assertFalse(event.known)
        assertEquals("task.teleported", event.type)
    }

    @Test
    fun appliesTheDefaultsOfEventData() {
        val line =
            """{"v":1,"id":"01a2038e-7f00-7000-8000-000000000001","hlc":"2026-11-22T14:20:01.123Z#0000",""" +
                """"dev":"ubuntu-01","type":"gate.opened","data":{"gate":"01a2038e-7f00-7000-8000-000000000002",""" +
                """"kind":"question","version":1,"x_new":true}}"""
        val event = assertIs<LineResult.Event>(LogReader.parseLine(line, "ubuntu-01", null)).event
        val data = assertIs<GateOpenedV1>(event.data)
        assertEquals("", data.title)
        assertEquals(emptyList(), data.options)
        val json = event.json.getValue("data").jsonObject
        assertEquals(JsonPrimitive(true), json["x_new"])
        assertEquals(JsonPrimitive(""), json["text"])
    }

    @Test
    fun readsAsBadLinesTheEventsOfAnotherPlace() {
        val task = Fixtures.FIXTURE_TASK
        val line =
            """{"v":1,"id":"01a2038e-7f00-7000-8000-000000000001","hlc":"2026-11-22T14:20:01.123Z#0000",""" +
                """"dev":"ubuntu-01","type":"task.done","task":"$task","data":{}}"""
        val taskScope = LogScope(LogKind.TASK, task)
        assertIs<LineResult.Event>(LogReader.parseLine(line, "ubuntu-01", taskScope))
        val device = assertIs<LineResult.Bad>(LogReader.parseLine(line, "pixel-9", taskScope))
        assertEquals("device_mismatch", device.code)
        assertEquals("sync problem: event of device ubuntu-01 in the log of pixel-9", device.message)
        val kind = assertIs<LineResult.Bad>(LogReader.parseLine(line, "ubuntu-01", LogScope(LogKind.WORKSPACE)))
        assertEquals(
            "does not match task.done.v1: type: An event of type task.done does not belong in a workspace log",
            kind.message,
        )
        val other = LogScope(LogKind.TASK, "01a2038e-7f00-7000-8000-0000000000aa")
        val wrongTask = assertIs<LineResult.Bad>(LogReader.parseLine(line, "ubuntu-01", other))
        assertTrue(wrongTask.message.contains("not of the task"), wrongTask.message)
        val newer =
            assertIs<LineResult.Bad>(LogReader.parseLine(line.replace("\"v\":1", "\"v\":2"), "ubuntu-01", taskScope))
        assertEquals("newer_version", newer.code)
    }

    @Test
    fun refusesAWrongJsonTypeLikeZod() {
        val base =
            """{"v":1,"id":"01a2038e-7f00-7000-8000-000000000001","hlc":"2026-11-22T14:20:01.123Z#0000",""" +
                """"dev":"ubuntu-01","type":"task.claimed","data":"""
        val session = "01a2038e-7f00-7000-8000-000000000002"
        for (data in listOf(
            """{"epoch":"2","device":"ubuntu-01","session":"$session"}""",
            """{"epoch":2.5,"device":"ubuntu-01","session":"$session"}""",
            """{"epoch":2,"device":7,"session":"$session"}""",
            """{"epoch":true,"device":"ubuntu-01","session":"$session"}""",
        )) {
            assertIs<LineResult.Bad>(LogReader.parseLine("$base$data}", "ubuntu-01", null), data)
        }
        val v1 = """{"epoch":2,"device":"ubuntu-01","session":"$session"}"""
        assertIs<LineResult.Event>(LogReader.parseLine("$base$v1}", "ubuntu-01", null))
        // zod reads 2.0 and 2e0 as the JavaScript number 2: a valid integer, written as 2.
        for (epoch in listOf("2.0", "2e0", "0.2e1")) {
            val line = "$base{\"epoch\":$epoch,\"device\":\"ubuntu-01\",\"session\":\"$session\"}}"
            val event = assertIs<LineResult.Event>(LogReader.parseLine(line, "ubuntu-01", null), epoch).event
            assertEquals(2L, (event.data as TaskClaimedV1).epoch)
            assertEquals(
                "2",
                event.json
                    .getValue("data")
                    .jsonObject
                    .getValue("epoch")
                    .jsonPrimitive.content,
            )
        }
        val v =
            assertIs<LineResult.Event>(
                LogReader.parseLine(base.replace("\"v\":1", "\"v\":1.0") + "$v1}", "ubuntu-01", null),
            )
        assertEquals(
            "1",
            v.event.json
                .getValue("v")
                .jsonPrimitive.content,
        )
        assertIs<LineResult.Bad>(
            LogReader.parseLine(
                "$base{\"epoch\":1e400,\"device\":\"ubuntu-01\",\"session\":\"$session\"}}",
                "ubuntu-01",
                null,
            ),
        )
    }

    @Test
    fun eachFixtureFileIsValid() {
        val root = Fixtures.workspace
        val files = Files.walk(root).use { s -> s.filter { Files.isRegularFile(it) }.toList() }.sorted()
        var documents = 0
        var lines = 0
        for (file in files) {
            val path = file.relativeTo(root).toString().replace('\\', '/')
            when (file.extension) {
                "yaml" -> {
                    DocumentReader.parse(file.readText(), null)
                    documents++
                }

                "jsonl" -> {
                    val device = file.fileName.toString().removeSuffix(".jsonl")
                    for ((index, text) in file.readText().split("\n").withIndex()) {
                        if (text.isBlank()) continue
                        val owner = if (path.contains("/heartbeat/")) path.split("/")[2] else device
                        val result = LogReader.parseLine(text, owner, null)
                        val event = assertIs<LineResult.Event>(result, "$path:${index + 1} $result").event
                        assertTrue(event.known, "$path:${index + 1}")
                        lines++
                    }
                }
            }
        }
        assertEquals(13, documents)
        assertEquals(37, lines)
    }
}
