package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.shared.merge.NeedsYouReason
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Inbox of the phone (openspec proposal-and-discussion, design decision 8): the rows and groups of
 * the desktop, from the shared fixture `contracts/fixtures/inbox/items.json`.
 */
class InboxItemsTest {
    private val fixture: JsonObject by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        Json.parseToJsonElement(Files.readString(dir.resolve("fixtures/inbox/items.json"))).jsonObject
    }

    private fun reasonOf(value: JsonObject): NeedsYouReason =
        when (val reason = value.getValue("reason").jsonPrimitive.content) {
            "gate" -> NeedsYouReason.Gate("g1", value.getValue("kind").jsonPrimitive.content, false)
            "assign" -> NeedsYouReason.Assign
            "paused" -> NeedsYouReason.Paused(value.getValue("cause").jsonPrimitive.content)
            else -> error("unknown reason $reason")
        }

    private fun taskOf(value: JsonObject) =
        InboxTask(
            id = value.getValue("id").jsonPrimitive.content,
            key = value.getValue("key").jsonPrimitive.content,
            title = value.getValue("title").jsonPrimitive.content,
            project = value.getValue("project").jsonPrimitive.content,
            stage = value.getValue("stage").jsonPrimitive.content,
            archived = value.getValue("archived").jsonPrimitive.boolean,
            needsYouLane = value.getValue("needs_you_lane").jsonPrimitive.boolean,
            reasons = value.getValue("needs_you_reasons").jsonArray.map { reasonOf(it.jsonObject) },
            paused = value.getValue("paused").jsonPrimitive.boolean,
            queued = value.getValue("queued").jsonPrimitive.boolean,
        )

    @Test
    fun theRowsAndGroupsOfTheSharedCases() {
        val cases = fixture.getValue("cases").jsonArray.map { it.jsonObject }
        assertEquals(2, cases.size)
        for (case in cases) {
            val name = case.getValue("name").jsonPrimitive.content
            val tasks = case.getValue("tasks").jsonArray.map { taskOf(it.jsonObject) }
            val state = InboxItems.of(tasks)
            val rows =
                case.getValue("rows").jsonArray.map {
                    val row = it.jsonObject
                    Triple(
                        row.getValue("reason").jsonPrimitive.content,
                        row.getValue("title").jsonPrimitive.content,
                        row.getValue("key").jsonPrimitive.content,
                    )
                }
            assertEquals(rows, state.rows.map { Triple(it.reason, it.title, it.key) }, name)
            val groups =
                case.getValue("groups").jsonArray.map {
                    val group = it.jsonObject
                    Triple(
                        group.getValue("id").jsonPrimitive.content,
                        group.getValue("label").jsonPrimitive.content,
                        group.getValue("keys").jsonArray.map { k -> k.jsonPrimitive.content },
                    )
                }
            assertEquals(groups, state.groups.map { g -> Triple(g.id, g.label, g.tasks.map { it.key }) }, name)
        }
    }

    @Test
    fun theOtherReasonsOfALane() {
        val task = InboxTask("t1", null, "x", null, "implement", false, true, emptyList(), false, false)
        assertEquals("Needs you", InboxItems.reason(task))
        assertEquals(
            "Paused: usage limit",
            InboxItems.reason(task.copy(reasons = listOf(NeedsYouReason.Paused("usage_limit")))),
        )
    }

    @Test
    fun aPausedTaskInAQueueIsOnlyInPaused() {
        val task = InboxTask("t1", "AW-1", "x", null, "ready", false, false, emptyList(), paused = true, queued = true)
        val groups = InboxItems.of(listOf(task)).groups
        assertEquals(listOf("paused"), groups.map { it.id })
    }

    @Test
    fun theInboxOfASnapshotHasTheTaskOfTheLane() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", TestWorkspace.questionLine())
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val state = InboxItems.of(snapshot)
                val row = state.rows.single { it.task == AW7 }
                assertEquals("Reply to a question", row.reason)
                assertEquals("AW-7", row.key)
                assertTrue(state.groups.none { g -> g.tasks.any { it.id == AW7 } })
            }
        }

    @Test
    fun theOpenQuestionIsAMessageInItsPlaceAndNotACardOnTop() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", TestWorkspace.questionLine())
                ws.refresh()
                val model = ws.model(backgroundScope)
                val snapshot = model.reload()
                val task = snapshot.task(AW7)!!
                val content = ActivityContent.of(task, snapshot, model.thread(AW7))
                val question = content.needsYou.single()
                assertEquals(MessageKind.QUESTION, question.kind)
                assertEquals(TestWorkspace.GATE, question.gate)
                assertEquals(listOf("100/min", "1000/min"), question.options)
                assertEquals(content.rows.indexOf(question), content.needsYouRow)
                // The gate has a row: it does not show again as a card on top.
                assertTrue(content.topCards.none { it.gate.gate == TestWorkspace.GATE })
                assertTrue(TestWorkspace.GATE in content.cards)
            }
        }
}
