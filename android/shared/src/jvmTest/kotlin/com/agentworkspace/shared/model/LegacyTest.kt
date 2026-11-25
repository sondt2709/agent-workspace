package com.agentworkspace.shared.model

import com.agentworkspace.schema.GateOpenedV1
import com.agentworkspace.schema.ProposalProposedV1
import com.agentworkspace.schema.TaskV1
import com.agentworkspace.shared.Fixtures
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertSame

/**
 * The map of the old names (openspec proposal-and-discussion), against the fixture that the
 * TypeScript port tests too: `contracts/fixtures/legacy/names.json`.
 */
class LegacyTest {
    private val fixture = Fixtures.json(Fixtures.contractsDir.resolve("fixtures/legacy/names.json")).jsonObject

    private fun cases(key: String) = fixture.getValue(key).jsonArray.map { it.jsonObject }

    @Test
    fun eventsOfTheSharedFixture() {
        val events = cases("events")
        assertEquals(4, events.size)
        for (case in events) {
            val name = case.getValue("name").jsonPrimitive.content
            val upgraded = Legacy.upgradeEvent(case.getValue("input"))
            assertEquals(case.getValue("expected"), upgraded, name)
            // The upgraded line is a valid event of the current schema.
            assertIs<LineResult.Event>(LogReader.validate(upgraded), name)
        }
    }

    @Test
    fun tasksOfTheSharedFixture() {
        val tasks = cases("tasks")
        assertEquals(2, tasks.size)
        for (case in tasks) {
            val name = case.getValue("name").jsonPrimitive.content
            assertEquals(case.getValue("expected"), Legacy.upgradeTaskDocument(case.getValue("input")), name)
        }
    }

    @Test
    fun keepsTheSameObjectWhenNothingChanges() {
        val line = JsonObject(mapOf("type" to JsonPrimitive("message.agent")))
        assertSame(line, Legacy.upgradeEvent(line))
    }

    @Test
    fun theLogReaderReadsAnOldLineWithTheNewNames() {
        val (proposed, gate) = cases("events").take(2).map { it.getValue("input").toString() }
        val first = assertIs<LineResult.Event>(LogReader.parseLine(proposed, "macbook-pro", null)).event
        assertEquals("proposal.proposed", first.type)
        assertEquals("approach/v3.md", assertIs<ProposalProposedV1>(first.data).file)
        val second = assertIs<LineResult.Event>(LogReader.parseLine(gate, "macbook-pro", null)).event
        assertEquals("approve_proposal", assertIs<GateOpenedV1>(second.data).kind)
    }

    @Test
    fun theDocumentReaderReadsAnOldSnapshotWithTheNewField() {
        val text =
            """
            kind: task
            schema: 1
            id: ${Fixtures.FIXTURE_TASK}
            key: AW-1
            project: billing-api
            title: A task
            first_message: Hello
            stage: discuss
            approach:
              latest: 5
              confirmed: 3
            """.trimIndent()
        val value = DocumentReader.parse(text, "task").value
        assertEquals(TaskV1.Proposal(5, 3), AwJson.decodeFromJsonElement(TaskV1.serializer(), value).proposal)
    }
}
