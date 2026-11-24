package com.agentworkspace.control

import com.agentworkspace.shared.merge.EventRow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

/** The thread texts of the phone that the desktop also writes (fix list 0-28). */
class ThreadTextTest {
    private fun row(
        type: String,
        data: String,
    ): EventRow =
        EventRow(
            id = "e1",
            task = "t1",
            hlc = "2026-11-24T10:00:00.000Z#0001",
            dev = "ubuntu-01",
            type = type,
            path = "tasks/t1/log/ubuntu-01.jsonl",
            line = 1,
            applied = true,
            reason = null,
            event = Json.parseToJsonElement("""{"by":"claude@ubuntu-01","data":$data}""").jsonObject,
        )

    @Test
    fun aLearningStepHasTheTextOfTheDesktop() {
        val texts =
            ThreadItems
                .of(
                    listOf(
                        row("task.learned", """{"nothing_new":true}"""),
                        row("task.learned", """{"nothing_new":false,"path":"projects/api/notes.md"}"""),
                        row(
                            "task.learned",
                            """{"nothing_new":false,"path":"shared/x.md","suggestion":"$SUGGESTION"}""",
                        ),
                    ),
                ).map { it.text }
        assertEquals(
            listOf(
                "Nothing new learned by claude@ubuntu-01",
                "Learned by claude@ubuntu-01: projects/api/notes.md",
                "Learned by claude@ubuntu-01: shared/x.md (waits for approval)",
            ),
            texts,
        )
    }

    private companion object {
        const val SUGGESTION = "01a20775-5cf4-779a-a960-5e221c27fd6a"
    }
}
