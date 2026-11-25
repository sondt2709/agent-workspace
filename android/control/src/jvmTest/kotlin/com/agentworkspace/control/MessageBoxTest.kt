package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.GATE
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The message box of the phone task page (openspec proposal-and-discussion), as the desktop
 * `Composer`: an open question takes the text as its answer until an answer waits for the owner.
 */
class MessageBoxTest {
    @Test
    fun anOpenQuestionTakesTheTextUntilAnAnswerWaits() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                val before = MessageBox.of(model.reload().task(AW7)!!)
                assertNull(before.question)
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", TestWorkspace.questionLine())
                ws.refresh()
                val open = MessageBox.of(model.reload().task(AW7)!!)
                assertEquals(GATE, open.question?.gate)
                assertTrue(open.enabled)
                assertEquals("Your message answers the question “Which limit per client?”", open.hint)
                assertEquals("Reply, or ask the agent…", open.placeholder)
                // An answer of the phone waits for the owner: the next text is a message again.
                ws.clock.time += 5_000
                assertIs<ActionResult.Done>(ws.actions(model).answerGate(AW7, GATE, "1000/min"))
                ws.refresh()
                assertNull(MessageBox.of(model.reload().task(AW7)!!).question)
            }
        }
}
