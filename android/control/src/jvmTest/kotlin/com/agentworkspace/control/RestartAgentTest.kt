package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.SESSION
import com.agentworkspace.shared.merge.StartFailureView
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** "Restart agent" of the phone (openspec restart-agent): the header text, the rule and the event. */
class RestartAgentTest {
    private val comment = "The session did not start on ubuntu-01: tmux is not installed. AW tries again in 60 s."

    @Test
    fun theCauseIsTheTextAfterThePrefixWithNoRetrySentence() {
        assertEquals("tmux is not installed", TaskActions.startCause("ubuntu-01", comment))
        assertEquals(
            "tmux is not installed.",
            TaskActions.startCause("ubuntu-01", "The session did not start on ubuntu-01: tmux is not installed."),
        )
        // Another device in the prefix, or no prefix: the full text stays, with no retry sentence.
        assertEquals(
            "The session did not start on mac-mini-lab: no tmux.",
            TaskActions.startCause("ubuntu-01", "The session did not start on mac-mini-lab: no tmux."),
        )
        assertEquals("No tmux", TaskActions.startCause("ubuntu-01", "No tmux. AW tries again in 5 s."))
    }

    @Test
    fun theHeaderShowsTheFailureThenTheRetry() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val task = ws.model(backgroundScope).reload().task(AW7)!!
                assertNull(TaskActions.startText(task))
                val failed = task.copy(startFailure = StartFailureView("ubuntu-01", comment, HLC, retrying = false))
                assertEquals("Did not start on ubuntu-01: tmux is not installed", TaskActions.startText(failed))
                val retrying = failed.copy(startFailure = failed.startFailure!!.copy(retrying = true))
                assertEquals("Starting again on ubuntu-01…", TaskActions.startText(retrying))
            }
        }

    @Test
    fun restartFitsAnAssignedTaskWithNoRunningSession() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val running = ws.model(backgroundScope).reload().task(AW7)!!
                assertEquals("running", running.session!!.state)
                assertFalse(TaskActions.canRestart(running))
                val ended = running.copy(session = running.session!!.copy(state = "ended"))
                assertTrue(TaskActions.canRestart(ended))
                assertTrue(TaskActions.canRestart(ended.copy(session = null)))
                assertFalse(TaskActions.canRestart(ended.copy(assignee = null)))
                // The button shows after a failure, and not while the device starts again.
                val failure = StartFailureView("ubuntu-01", comment, HLC, retrying = false)
                assertFalse(TaskActions.showRestart(ended))
                assertTrue(TaskActions.showRestart(ended.copy(startFailure = failure)))
                assertFalse(TaskActions.showRestart(ended.copy(startFailure = failure.copy(retrying = true))))
                assertFalse(TaskActions.showRestart(running.copy(startFailure = failure)))
            }
        }

    @Test
    fun restartWritesAPersonAssignmentOfTheSameAssigneeWithNoOptions() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", ENDED)
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", failedLine(comment))
                ws.refresh()
                val model = ws.model(backgroundScope)
                val before = model.reload().task(AW7)!!
                assertEquals("Did not start on ubuntu-01: tmux is not installed", TaskActions.startText(before))
                val actions = ws.actions(model)
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.restartAgent(AW7))
                ws.refresh()
                val row = ws.index.thread(AW7, limit = 500).last { it.type == "task.assigned" }
                assertEquals("pixel-9", row.dev)
                assertTrue(row.applied)
                val event = row.event
                assertEquals("\"human@pixel-9\"", event["by"].toString())
                val data = event["data"]!!.jsonObject
                assertEquals(setOf("assignee"), data.keys)
                assertEquals("\"${before.assignee}\"", data["assignee"].toString())
                val after = model.reload().task(AW7)!!
                assertEquals(before.assignee, after.assignee)
                assertEquals(before.sessionOptions, after.sessionOptions)
                assertEquals("Starting again on ubuntu-01…", TaskActions.startText(after))
            }
        }

    @Test
    fun noRestartWhileASessionRuns() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                assertEquals(ActionResult.Refused("A session of this task runs."), ws.actions(model).restartAgent(AW7))
                assertTrue(ws.written.isEmpty())
            }
        }

    private companion object {
        const val HLC = "2026-11-22T14:21:21.000Z#0000"

        const val ENDED =
            "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000c001\"," +
                "\"hlc\":\"2026-11-22T14:21:20.000Z#0000\",\"dev\":\"ubuntu-01\"," +
                "\"type\":\"session.ended\",\"task\":\"$AW7\",\"by\":\"aw@ubuntu-01\"," +
                "\"data\":{\"session\":\"$SESSION\",\"reason\":\"stopped\"}}"

        fun failedLine(text: String) =
            "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000c002\"," +
                "\"hlc\":\"$HLC\",\"dev\":\"ubuntu-01\"," +
                "\"type\":\"comment.added\",\"task\":\"$AW7\",\"by\":\"aw@ubuntu-01\"," +
                "\"data\":{\"text\":\"$text\",\"kind\":\"start_failed\"}}"
    }
}
