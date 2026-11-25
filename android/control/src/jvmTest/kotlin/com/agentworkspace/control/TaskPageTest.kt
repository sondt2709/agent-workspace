package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The header and the task list of the phone task page (openspec task-review-layout). */
class TaskPageTest {
    @Test
    fun theNeedYouNavigationUsesTheInboxOrder() {
        // AW-1 and AW-4 need the person, in this Inbox order.
        val inbox = listOf("aw-1", "aw-4")
        assertEquals(NeedYouNav("1 of 2 need you", null, "aw-4"), NeedYouNav.of(inbox, "aw-1"))
        assertEquals(NeedYouNav("2 of 2 need you", "aw-1", null), NeedYouNav.of(inbox, "aw-4"))
        // A task that is not in the Inbox: the count, and Next opens the first.
        assertEquals(NeedYouNav("2 need you", null, "aw-1"), NeedYouNav.of(inbox, "aw-2"))
        assertEquals(NeedYouNav("1 of 1 needs you", null, null), NeedYouNav.of(listOf("aw-1"), "aw-1"))
        assertEquals(NeedYouNav("1 needs you", null, "aw-1"), NeedYouNav.of(listOf("aw-1"), "aw-2"))
        // No task needs the person: no text.
        assertEquals(NeedYouNav(null, null, null), NeedYouNav.of(emptyList(), "aw-1"))
    }

    @Test
    fun theStageProgress() {
        assertEquals(StageProgress(1, 6, "Discuss · stage 2 of 6"), StageProgress.of("discuss"))
        assertEquals(StageProgress(5, 6, "Done · stage 6 of 6"), StageProgress.of("done"))
        assertEquals(-1, StageProgress.of("later").index)
    }

    @Test
    fun theTaskListHasTheTasksThatNeedYouFirst() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val working = ws.model(backgroundScope).reload()
                assertEquals(
                    listOf("Running · 1" to listOf("AW-7")),
                    TaskPage.listGroups(working).map { g -> g.label to g.rows.map { it.label } },
                )
                assertNull(TaskPage.stateChip(working.task(AW7)!!))
                // An open question moves AW-7 to "Needs you", in the Inbox order.
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", TestWorkspace.questionLine())
                ws.refresh()
                val asked = ws.model(backgroundScope).reload()
                assertEquals(
                    listOf("Needs you · 1" to listOf("AW-7")),
                    TaskPage.listGroups(asked).map { g -> g.label to g.rows.map { it.label } },
                )
                assertEquals(ScreenStates.inbox(asked).map { it.id }, TaskPage.listGroups(asked)[0].rows.map { it.id })
                assertEquals("Answer question", TaskPage.stateChip(asked.task(AW7)!!))
            }
        }
}
