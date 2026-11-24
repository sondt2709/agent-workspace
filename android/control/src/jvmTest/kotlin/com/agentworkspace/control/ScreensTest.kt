package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.GATE
import com.agentworkspace.engine.PeerStatus
import com.agentworkspace.engine.SyncRules
import com.agentworkspace.shared.merge.NeedsYouReason
import com.agentworkspace.shared.model.IsoTime
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The screen states from the real index of the shared fixture. */
class ScreensTest {
    @Test
    fun homeAndTasksOfTheFixture() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                assertEquals("AW", snapshot.keyPrefix)
                val groups = ScreenStates.tasksByStage(snapshot)
                assertEquals(Texts.STAGES, groups.map { it.stage })
                val aw7 = groups.first { it.stage == "implement" }.tasks.single()
                assertEquals("AW-7", aw7.label)
                assertNull(aw7.pause)

                val peer = PeerStatus("ubuntu-01", true, null, 0, 0, true, null, ws.clock.time - 12_000, emptyList())
                val home = ScreenStates.home(snapshot, listOf(peer), ws.clock.time)
                assertEquals(listOf("AW-7"), home.working.map { it.label })
                assertTrue(home.needsYou.isEmpty())
                val ubuntu = home.devices.first { it.slug == "ubuntu-01" }
                assertTrue(ubuntu.online)
                assertEquals("Last heartbeat 30 s ago", ubuntu.heartbeat)
                assertEquals("Synced 12 s ago", ubuntu.sync)
                assertTrue(home.devices.none { it.isThisPhone })
                assertEquals(
                    "Not a sync peer of this phone",
                    home.devices.first { it.slug == "macbook-pro" }.sync,
                )
            }
        }

    @Test
    fun anOpenQuestionIsInTheInboxWithItsCard() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", TestWorkspace.questionLine())
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val inbox = ScreenStates.inbox(snapshot)
                assertEquals(listOf("AW-7"), inbox.map { it.label })
                assertEquals("Needs you: Answer question", inbox.single().reason)
                val card = ScreenStates.gateCards(snapshot.task(AW7)!!, snapshot).single()
                assertEquals(GATE, card.gate.gate)
                assertEquals("Answer question", card.label)
                assertEquals("Which limit per client?", card.title)
                assertEquals("The API has no limit now.", card.text)
                assertEquals(listOf("100/min", "1000/min"), card.options)
                assertTrue(card.freeText)
                assertEquals(CardStatus.Open, card.status)
            }
        }

    @Test
    fun aSessionDeviceWithNoHeartbeatPausesTheTask() =
        runTest {
            // 90 s after the last heartbeat of ubuntu-01 (14:21:00) plus a margin.
            TestWorkspace("2026-11-22T14:25:00.000Z").use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val row =
                    ScreenStates
                        .tasksByStage(snapshot)
                        .first { it.stage == "implement" }
                        .tasks
                        .single()
                assertEquals(PauseChip("Paused: ubuntu-01 offline", true), row.pause)
                val home = ScreenStates.home(snapshot, emptyList(), ws.clock.time)
                assertEquals(listOf("AW-7"), home.paused.map { it.label })
                assertTrue(home.working.isEmpty())
                assertEquals(false, home.devices.first { it.slug == "ubuntu-01" }.online)
            }
        }

    @Test
    fun aMoveListsOnlyTheOtherDevices() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                // The task of claude@macbook-pro is paused: macbook-pro is offline (verify-journeys low 21).
                assertEquals(
                    listOf("claude@ubuntu-01"),
                    ScreenStates.agentChoices(snapshot, "billing-api", except = "macbook-pro"),
                )
            }
        }

    @Test
    fun createTaskNeedsAProjectAMessageAndNoCreateInProgress() {
        assertTrue(NewTaskDraft.canCreate("billing-api", "Add a CSV export", creating = false))
        assertFalse(NewTaskDraft.canCreate(null, "Add a CSV export", creating = false))
        assertFalse(NewTaskDraft.canCreate("", "Add a CSV export", creating = false))
        assertFalse(NewTaskDraft.canCreate("billing-api", "  \n ", creating = false))
        assertFalse(NewTaskDraft.canCreate("billing-api", "Add a CSV export", creating = true))
    }

    @Test
    fun agentChoicesLeaveOutMobileDevices() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                assertEquals(
                    listOf("claude@ubuntu-01", "claude@macbook-pro"),
                    ScreenStates.agentChoices(snapshot, "billing-api", "claude@pixel-9"),
                )
            }
        }

    @Test
    fun fieldsAndThreadOfATask() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                val snapshot = model.reload()
                val fields = ScreenStates.fields(snapshot.task(AW7)!!).toMap()
                assertEquals("AW-7", fields["Key"])
                assertEquals("Implement", fields["Stage"])
                assertEquals("claude@ubuntu-01", fields["Assignee"])
                assertEquals("v1 confirmed (latest v1)", fields["Approach"])
                // The session rows are in the session summary of the Session view, not in the properties.
                assertTrue("Session" !in fields && "Branch" !in fields && "Owner device" !in fields)
                val task = snapshot.task(AW7)!!
                val summary = TaskDetail.sessionSummary(task).toMap()
                assertEquals("ubuntu-01", summary["Owner device"])
                assertEquals(task.claim!!.epoch.toString(), summary["Claim epoch"])
                assertEquals(task.session?.session ?: task.claim!!.session, summary["Session id"])
                assertEquals(task.id, summary["Task id"])
                assertTrue(summary.getValue("Session").contains("on ubuntu-01"))
                // An open gate or Assign shows as one line on the other tabs (the gate of AW-7 is answered).
                val gate = task.gates.first()
                val none = task.copy(needsYouReasons = emptyList())
                assertEquals(null, TaskDetail.needsYouLine(none))
                assertEquals(
                    "1 item needs you",
                    TaskDetail.needsYouLine(none.copy(gates = listOf(gate.copy(state = "open")))),
                )
                // A gate that a person answered waits for the owner: nothing is left to do (ptfc-r1).
                val answered = gate.copy(state = "open", answers = gate.answers.map { it.copy(use = "pending") })
                assertTrue(answered.answers.isNotEmpty())
                assertEquals(null, TaskDetail.needsYouLine(none.copy(gates = listOf(answered))))
                assertEquals(
                    "2 items need you",
                    TaskDetail.needsYouLine(
                        task.copy(
                            gates = listOf(gate.copy(state = "open")),
                            needsYouReasons = listOf(NeedsYouReason.Assign),
                        ),
                    ),
                )
                val thread = model.thread(AW7).items
                assertEquals(ThreadKind.HUMAN, thread.first().kind)
                assertEquals("First message", thread.first().note)
                assertTrue(thread.any { it.kind == ThreadKind.AGENT })
                assertTrue(thread.any { it.kind == ThreadKind.GATE && it.note == "Answer question" })
                assertTrue(thread.any { it.kind == ThreadKind.COMMENT && it.who == "human@pixel-9" })
                assertTrue(thread.none { it.text.isEmpty() && it.kind != ThreadKind.SYSTEM })
            }
        }

    @Test
    fun aStoppedPhoneEngineBlamesNoPeer() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val offline = SyncRules.peerStatus("ubuntu-01", null, emptyList(), null, null)
                val rows = ScreenStates.devices(snapshot, listOf(offline), 0, engineDown = "stopped")
                assertEquals(
                    "No sync state: the sync engine of this phone is stopped",
                    rows.single { it.slug == "ubuntu-01" }.sync,
                )
            }
        }

    @Test
    fun textsAndTime() {
        assertEquals("Add a rate limit", Texts.titleFromFirstMessage("\n  Add a rate limit  \nmore"))
        assertEquals(120, Texts.titleFromFirstMessage("x".repeat(300)).length)
        assertEquals("", Texts.titleFromFirstMessage("  \n "))
        val t = IsoTime.parseMillis("2026-11-22T14:00:00.000Z")!!
        assertEquals("8 s ago", Texts.ago(t, t + 8_000))
        assertEquals("5 min ago", Texts.ago(t, t + 300_000))
        assertEquals("Confirm approach", Texts.gateLabel("confirm_approach"))
        assertEquals("new kind", Texts.gateLabel("new_kind"))
        assertNotNull(Texts.pauseText("usage_limit"))
        // The pause causes of the continuity rules (add-continuity) have their own chip text.
        assertEquals("weekly usage limit", Texts.pauseText("usage_limit_weekly"))
        assertEquals("continue limit", Texts.pauseText("continue_cap"))
        assertEquals("agent error", Texts.pauseText("agent_error"))
        assertEquals("device restart", Texts.pauseText("device_restart"))
        assertEquals("login expired", Texts.pauseText("login_expired"))
    }
}
