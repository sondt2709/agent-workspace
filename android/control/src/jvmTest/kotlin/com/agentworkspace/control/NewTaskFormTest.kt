package com.agentworkspace.control

import com.agentworkspace.shared.merge.SessionOptions
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** The phone New task has each field of the desktop New task (openspec polish-skip-default). */
class NewTaskFormTest {
    @Test
    fun newTaskStartsWithSkipPermissionsAndShowsTheProjectDefault() {
        assertEquals(SessionOptions.SKIP, NewTaskDraft.START_OPTIONS.permissionMode)
        assertEquals("Project default · Skip permissions", SessionOptionTexts.projectDefaultLabel("skip"))
        assertEquals("Project default · Default", SessionOptionTexts.projectDefaultLabel(null))
    }

    @Test
    fun createsATaskWithTheTitleParentCredentialsAndSkip() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                var snapshot = model.reload()
                val actions = ws.actions(model)
                ws.clock.time += 1_000
                val first =
                    assertIs<ActionResult.Done>(
                        actions.createTask(
                            NewTaskDraft("billing-api", "Add a rate limit", credentials = listOf("staging-db")),
                        ),
                    )
                ws.refresh()
                snapshot = model.reload()
                // The names that the tasks use (the seed has stripe-test), sorted, once each.
                assertEquals(listOf("staging-db", "stripe-test"), NewTaskChoices.credentialNames(snapshot))
                val parent = NewTaskChoices.parentChoices(snapshot, "billing-api").single { it.first == first.task }
                assertEquals("${snapshot.task(first.task)!!.key} · Add a rate limit", parent.second)
                assertEquals(
                    ScreenStates.agentChoices(snapshot, "billing-api").first(),
                    NewTaskChoices.startAgent(snapshot, "billing-api"),
                )

                ws.clock.time += 1_000
                val draft =
                    NewTaskDraft(
                        project = "billing-api",
                        firstMessage = "Add a CSV export\n\nPer report.",
                        title = "  CSV export  ",
                        parent = first.task,
                        credentials = listOf("staging-db", "github-token"),
                        sessionOptions = NewTaskDraft.START_OPTIONS,
                    )
                val done = assertIs<ActionResult.Done>(actions.createTask(draft))
                ws.refresh()
                val task = model.reload().task(done.task)!!
                assertEquals("CSV export", task.title)
                assertEquals(first.task, task.parent)
                assertEquals(listOf("staging-db", "github-token"), task.credentials)
                assertEquals(SessionOptions.SKIP, task.sessionOptions?.permissionMode)
                // A blank title: the first line of the first message, as on the desktop.
                ws.clock.time += 1_000
                val plain = assertIs<ActionResult.Done>(actions.createTask(draft.copy(title = " ", parent = null)))
                ws.refresh()
                assertEquals("Add a CSV export", model.reload().task(plain.task)!!.title)
                assertTrue(NewTaskChoices.parentChoices(model.reload(), "web-app").none { it.first == first.task })
            }
        }
}
