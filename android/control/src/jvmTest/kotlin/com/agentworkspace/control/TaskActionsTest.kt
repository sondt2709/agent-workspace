package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.SESSION
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Archive and unarchive from the phone (openspec task-actions). */
class TaskActionsTest {
    @Test
    fun archiveStopsTheRunningSessionFirstAndUnarchiveMakesTheTaskActive() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                val running = model.reload().task(AW7)!!
                assertEquals("ubuntu-01", TaskActions.runningDevice(running))
                assertEquals("Stop the session on ubuntu-01?", TaskActions.stopConfirm(running).title)
                val confirm = TaskActions.archiveConfirm(running)
                assertEquals("Stop the session and archive AW-7?", confirm.title)
                assertTrue(confirm.body.startsWith("A session of this task runs on ubuntu-01."))
                assertEquals("Stop and archive", confirm.action)
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.archiveTask(AW7))
                ws.refresh()
                val rows =
                    ws.index
                        .thread(AW7, limit = 500)
                        .filter { it.dev == "pixel-9" }
                        .takeLast(2)
                assertEquals(listOf("session.stop_requested", "task.archived"), rows.map { it.type })
                assertTrue(rows.all { it.applied })
                assertTrue(
                    rows
                        .first()
                        .event
                        .toString()
                        .contains(SESSION),
                )
                var snapshot = model.reload()
                assertTrue(snapshot.task(AW7)!!.archived)
                // The Tasks list shows no empty stage group and adds the group Archived at the end.
                val groups = ScreenStates.tasksByStage(snapshot)
                assertEquals(listOf(ScreenStates.ARCHIVED_GROUP), groups.map { it.stage })
                assertEquals("Archived", groups.last().label)
                assertEquals(listOf("AW-7"), groups.last().tasks.map { it.label })
                assertEquals(ActionResult.Refused("The task is already archived."), actions.archiveTask(AW7))
                assertEquals(null, TaskActions.runningDevice(snapshot.task(AW7)!!.copy(session = null)))
                assertEquals(
                    "Archive AW-7?",
                    TaskActions.archiveConfirm(snapshot.task(AW7)!!.copy(session = null)).title,
                )

                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.unarchiveTask(AW7))
                ws.refresh()
                snapshot = model.reload()
                assertEquals(false, snapshot.task(AW7)!!.archived)
                assertEquals(listOf("implement"), ScreenStates.tasksByStage(snapshot).map { it.stage })
                assertEquals(ActionResult.Refused("The task is not archived."), actions.unarchiveTask(AW7))
            }
        }
}
