package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.GATE
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** A gate notification goes away when its gate is resolved (verify-journeys low 15). */
class ResolvedNotificationsTest {
    private val opened = "01a203a2-0000-7000-8000-00000000b001"

    @Test
    fun aResolvedGateRemovesItsNotificationOnly() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", TestWorkspace.questionLine())
                ws.refresh()
                val model = ws.model(backgroundScope)
                val tags = listOf(opened, "01a203a2-0000-7000-8000-00000000ffff", AW7)
                assertEquals(emptyList(), ResolvedNotifications.of(model.reload(), tags))
                ws.appendRaw(
                    "tasks/$AW7/log/ubuntu-01.jsonl",
                    "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000b002\"," +
                        "\"hlc\":\"2026-11-22T14:22:10.000Z#0000\"," +
                        "\"dev\":\"ubuntu-01\",\"type\":\"gate.resolved\",\"task\":\"$AW7\",\"by\":\"aw@ubuntu-01\"," +
                        "\"data\":{\"gate\":\"$GATE\",\"version\":1,\"answer_event\":null,\"answer\":\"100/min\"}}",
                )
                ws.refresh()
                assertEquals(listOf(opened), ResolvedNotifications.of(model.reload(), tags))
            }
        }
}
