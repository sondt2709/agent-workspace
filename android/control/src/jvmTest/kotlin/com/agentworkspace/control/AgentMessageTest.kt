package com.agentworkspace.control

import com.agentworkspace.shared.merge.EventRow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
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
 * The messages of other agents in Activity (openspec task-review-layout, design decision 5): the same
 * rule as the desktop, from the shared fixture `contracts/fixtures/activity/agent-message.json`.
 */
class AgentMessageTest {
    private val cases: List<JsonObject> by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        Json
            .parseToJsonElement(Files.readString(dir.resolve("fixtures/activity/agent-message.json")))
            .jsonObject
            .getValue("cases")
            .jsonArray
            .map { it.jsonObject }
    }

    private fun typed(text: String): EventRow =
        EventRow(
            id = "e1",
            task = "t1",
            hlc = "2026-11-25T10:00:00.000Z#0000",
            dev = "ubuntu-01",
            type = "message.human",
            path = "tasks/t1/log/ubuntu-01.jsonl",
            line = 1,
            applied = true,
            reason = null,
            event =
                buildJsonObject {
                    put("type", "message.human")
                    put("by", "human@ubuntu-01")
                    put(
                        "data",
                        buildJsonObject {
                            put("text", text)
                            put("source", "typed")
                        },
                    )
                },
        )

    @Test
    fun agentMessageOfTheSharedCases() {
        assertEquals(8, cases.size)
        for (case in cases) {
            val name = case.getValue("name").jsonPrimitive.content
            val actual = ActivityRule.agentMessage(case.getValue("text").jsonPrimitive.content)
            val expected = case.getValue("expected")
            if (expected is JsonNull) {
                assertEquals(null, actual, name)
            } else {
                val e = expected.jsonObject
                assertEquals(e.getValue("kind").jsonPrimitive.content, actual?.kind?.json, name)
                assertEquals(e.getValue("from").jsonPrimitive.content, actual?.from, name)
                assertEquals(e.getValue("body").jsonPrimitive.content, actual?.body, name)
            }
        }
    }

    @Test
    fun aSubagentReportShowsInTheAgentStyleAndTheSessionViewKeepsTheRawText() {
        val text =
            cases
                .first()
                .getValue("text")
                .jsonPrimitive.content
        val row = ThreadItems.activity(listOf(typed(text))).single()
        assertEquals(ThreadKind.AGENT, row.kind)
        assertEquals("Subagent report", row.who)
        assertEquals("arrived in the terminal", row.note)
        assertTrue(row.text.startsWith("## Gateway: what runs today\n"), row.text)
        val raw = ThreadItems.of(listOf(typed(text))).single()
        assertEquals(text, raw.text)
        assertEquals(ThreadKind.HUMAN, raw.kind)
    }

    @Test
    fun aTeammateMessageAndAPersonMessage() {
        val teammate = cases.first { it.getValue("name").jsonPrimitive.content == "teammate message as awd stores it" }
        val row = ThreadItems.activity(listOf(typed(teammate.getValue("text").jsonPrimitive.content))).single()
        assertEquals("Agent message", row.who)
        assertEquals(ThreadKind.AGENT, row.kind)
        val person = ThreadItems.activity(listOf(typed("Use **cents**.\n\n- one\n- two"))).single()
        assertEquals(ThreadKind.HUMAN, person.kind)
        assertEquals("human@ubuntu-01", person.who)
        assertEquals("typed in the terminal", person.note)
    }
}
