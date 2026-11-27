package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.GATE
import com.agentworkspace.control.TestWorkspace.Companion.SESSION
import com.agentworkspace.schema.ProjectRemovedV1
import com.agentworkspace.schema.TaskCreatedV1
import com.agentworkspace.shared.merge.nextFreeKey
import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Each phone action writes one event that the real merge accepts (android-ui test plan, JVM part). */
class PhoneActionsTest {
    @Test
    fun anAnswerFromThePhoneWaitsForTheOwner() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", TestWorkspace.questionLine())
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                ws.clock.time += 5_000
                val result = actions.answerGate(AW7, GATE, "1000/min")
                assertIs<ActionResult.Done>(result)
                assertEquals(listOf("tasks/$AW7/log/pixel-9.jsonl"), ws.written)
                ws.refresh()
                val snapshot = model.reload()
                val gate = snapshot.task(AW7)!!.gates.first { it.gate == GATE }
                val answer = gate.answers.single()
                assertEquals("pixel-9", answer.dev)
                assertEquals("human@pixel-9", answer.by)
                assertEquals("pending", answer.use)
                val card = ScreenStates.gateCards(snapshot.task(AW7)!!, snapshot).single()
                val sent = assertIs<CardStatus.Sent>(card.status)
                assertEquals("Answer sent, waiting for ubuntu-01", sent.text)
            }
        }

    @Test
    fun requestChangesNeedsAComment() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw(
                    "tasks/$AW7/log/ubuntu-01.jsonl",
                    TestWorkspace
                        .questionLine(
                            options = "\"Approve\",\"Request changes\"",
                        ).replace("\"question\"", "\"approve_result\""),
                )
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                val refused = actions.answerGate(AW7, GATE, "Request changes", "  ")
                assertEquals(ActionResult.Refused("\"Request changes\" needs a comment."), refused)
                assertEquals(ActionResult.Refused("Select one of the options."), actions.answerGate(AW7, GATE, "Maybe"))
                assertTrue(ws.written.isEmpty())
                assertIs<ActionResult.Done>(actions.answerGate(AW7, GATE, "Request changes", "Add a test"))
            }
        }

    @Test
    fun aMessageGoesToTheRunningSession() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(ws.actions(model).sendMessage(AW7, "Also log the limit"))
                ws.refresh()
                val thread = model.thread(AW7).items
                val sent = thread.last { it.kind == ThreadKind.SENT }
                assertEquals("Also log the limit", sent.text)
                assertEquals("Not delivered yet", sent.note)
                assertTrue(sent.applied)
                val row = ws.index.thread(AW7, limit = 500).last { it.type == "message.sent" }
                assertTrue(row.event.toString().contains(SESSION))
            }
        }

    @Test
    fun aNewTaskGetsTheNextKeyAndNeedsAnAssignee() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                assertEquals(ActionResult.Refused("Select a project."), actions.createTask(NewTaskDraft("nope", "Hi")))
                assertEquals(
                    ActionResult.Refused("Write the first message."),
                    actions.createTask(NewTaskDraft("billing-api", " ")),
                )
                ws.clock.time += 1_000
                val done =
                    assertIs<ActionResult.Done>(
                        actions.createTask(NewTaskDraft("billing-api", "Add a rate limit\n\nPer client.")),
                    )
                ws.refresh()
                val snapshot = model.reload()
                val task = snapshot.task(done.task)!!
                assertEquals("AW-8", task.key)
                assertEquals("Add a rate limit", task.title)
                assertEquals("Add a rate limit\n\nPer client.", task.firstMessage)
                assertEquals("backlog", task.stage)
                assertTrue(ScreenStates.needsAssign(task))
                assertEquals(
                    "Needs you: Assign task",
                    ScreenStates.inbox(snapshot).single { it.id == done.task }.reason,
                )

                // Assign from the Assign card: a human task.assigned.
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.assign(done.task, "claude@ubuntu-01"))
                ws.refresh()
                assertEquals("claude@ubuntu-01", model.reload().task(done.task)!!.assignee)
                assertIs<ActionResult.Refused>(actions.assign(done.task, "not an agent"))
            }
        }

    @Test
    fun anArchivedProjectGetsNoNewTask() =
        runTest {
            TestWorkspace().use { ws ->
                // The person archived billing-api on a computer (gap-setup M3, fix list 0-15).
                val project = ws.root.resolve("tasks/projects/billing-api/project.yaml")
                java.nio.file.Files
                    .writeString(
                        project,
                        java.nio.file.Files
                            .readString(project) + "archived: true\n",
                    )
                ws.refresh()
                val model = ws.model(backgroundScope)
                val snapshot = model.reload()
                assertTrue(snapshot.projects.single { it.slug == "billing-api" }.archived)
                assertTrue(snapshot.openProjects.none { it.slug == "billing-api" })
                assertEquals(
                    ActionResult.Refused("billing-api is archived: it gets no new tasks."),
                    ws.actions(model).createTask(NewTaskDraft("billing-api", "Add a rate limit")),
                )
                assertTrue(ws.written.isEmpty())
            }
        }

    @Test
    fun noMessageWithoutASession() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                val created = assertIs<ActionResult.Done>(actions.createTask(NewTaskDraft("billing-api", "Later")))
                ws.refresh()
                model.reload()
                assertEquals(
                    ActionResult.Refused("No session runs for this task. Assign it to start one."),
                    actions.sendMessage(created.task, "Hello"),
                )
            }
        }

    @Test
    fun theRekeyOfADuplicateKeyOfThePhoneIsWrittenOnce() =
        runTest {
            TestWorkspace().use { ws ->
                // Offline, the phone created a task with AW-7, the key of the macbook-pro task.
                val task = "01a2038e-7f00-7000-8000-00000000c001"
                val created =
                    TaskCreatedV1(
                        key = "AW-7",
                        project = "billing-api",
                        title = "From the phone",
                        firstMessage = "Created offline",
                    )
                ws.writer.write("tasks/$task/log/pixel-9.jsonl", "task.created", TaskCreatedV1.serializer(), created)
                ws.refresh()
                val model = ws.model(backgroundScope)
                val before = model.reload()
                assertEquals("duplicate", before.task(task)!!.keyState)
                val next = nextFreeKey(before.tasks, before.keyPrefix!!)
                val actions = ws.actions(model)
                ws.clock.time += 1_000
                val done = ActionResult.Done(task, "tasks/$task/log/pixel-9.jsonl")
                assertEquals(listOf<ActionResult>(done), actions.rekeyDuplicates())
                // The index is not refreshed yet: the same plan writes nothing again.
                assertEquals(emptyList(), actions.rekeyDuplicates())
                ws.refresh()
                val after = model.reload()
                assertEquals(next, after.task(task)!!.key)
                assertEquals("ok", after.task(task)!!.keyState)
                assertEquals("AW-7", after.task(AW7)!!.key)
                assertEquals(emptyList(), actions.rekeyDuplicates())
                val rows = ws.index.thread(task, limit = 500).filter { it.type == "task.rekeyed" }
                assertEquals(1, rows.size)
                assertTrue(rows.single().applied)
                assertTrue(
                    rows
                        .single()
                        .event
                        .toString()
                        .contains("\"by\":\"aw@pixel-9\""),
                )
                val line = model.thread(task).items.last()
                assertEquals("AW-7 is now $next", line.text)
            }
        }

    @Test
    fun twoCreatesBeforeARefreshGetTwoKeys() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                // A double tap on "Create task": the index is not refreshed between the 2 calls (android-ui M3).
                val first = assertIs<ActionResult.Done>(actions.createTask(NewTaskDraft("billing-api", "One")))
                val second = assertIs<ActionResult.Done>(actions.createTask(NewTaskDraft("billing-api", "Two")))
                ws.refresh()
                val snapshot = model.reload()
                assertEquals(listOf("AW-8", "AW-9"), listOf(first, second).map { snapshot.task(it.task)!!.key })
                assertTrue(snapshot.tasks.none { it.keyState == "duplicate" })
            }
        }

    @Test
    fun aNewTaskNeverTakesTheKeyOfARemovedTask() =
        runTest {
            TestWorkspace().use { ws ->
                // AW-12 of web-app, then a person removes web-app (openspec project-remove).
                val task = "01a2038e-7f00-7000-8000-00000000c010"
                val created = TaskCreatedV1(key = "AW-12", project = "web-app", title = "Web", firstMessage = "x")
                ws.writer.write("tasks/$task/log/pixel-9.jsonl", "task.created", TaskCreatedV1.serializer(), created)
                val document =
                    ProjectRemovedV1.Document(
                        kind = "project",
                        schema = 1,
                        slug = "web-app",
                        name = "Web app",
                    )
                val removed = ProjectRemovedV1(project = "web-app", name = "Web app", document = document)
                ws.writer.write("tasks/log/pixel-9.jsonl", "project.removed", ProjectRemovedV1.serializer(), removed)
                ws.refresh()
                val model = ws.model(backgroundScope)
                val before = model.reload()
                assertEquals(null, before.task(task))
                assertTrue(before.projects.none { it.slug == "web-app" })
                val actions = ws.actions(model)
                val made = assertIs<ActionResult.Done>(actions.createTask(NewTaskDraft("billing-api", "New")))
                ws.refresh()
                assertEquals("AW-13", model.reload().task(made.task)!!.key)
                // The phone New task cannot select the removed project.
                assertIs<ActionResult.Refused>(actions.createTask(NewTaskDraft("web-app", "Again")))
            }
        }

    @Test
    fun aRekeyAfterACreateTakesTheNextKey() =
        runTest {
            TestWorkspace().use { ws ->
                val task = "01a2038e-7f00-7000-8000-00000000c002"
                val created =
                    TaskCreatedV1(key = "AW-7", project = "billing-api", title = "Offline", firstMessage = "x")
                ws.writer.write("tasks/$task/log/pixel-9.jsonl", "task.created", TaskCreatedV1.serializer(), created)
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                // The person creates a task before the rekey collector runs (offline-task-keys low 3).
                val made = assertIs<ActionResult.Done>(actions.createTask(NewTaskDraft("billing-api", "New")))
                assertEquals(1, actions.rekeyDuplicates().size)
                ws.refresh()
                val snapshot = model.reload()
                assertEquals("AW-8", snapshot.task(made.task)!!.key)
                assertEquals("AW-9", snapshot.task(task)!!.key)
                assertTrue(snapshot.tasks.none { it.keyState == "duplicate" })
            }
        }

    @Test
    fun aFailedRekeyIsWrittenAtTheNextSnapshot() =
        runTest {
            TestWorkspace().use { ws ->
                val task = "01a2038e-7f00-7000-8000-00000000c003"
                val created =
                    TaskCreatedV1(key = "AW-7", project = "billing-api", title = "Offline", firstMessage = "x")
                ws.writer.write("tasks/$task/log/pixel-9.jsonl", "task.created", TaskCreatedV1.serializer(), created)
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                // The write fails once: a folder in the place of the log of the phone (offline-task-keys finding 1).
                val log = ws.root.resolve("tasks/$task/log/pixel-9.jsonl")
                val saved =
                    java.nio.file.Files
                        .readAllBytes(log)
                java.nio.file.Files
                    .delete(log)
                java.nio.file.Files
                    .createDirectories(log)
                assertIs<ActionResult.Refused>(actions.rekeyDuplicates().single())
                java.nio.file.Files
                    .delete(log)
                java.nio.file.Files
                    .write(log, saved)
                assertIs<ActionResult.Done>(actions.rekeyDuplicates().single())
            }
        }

    @Test
    fun noCreateAndNoRekeyBeforeTheKeyPrefixIsKnown() =
        runTest {
            TestWorkspace().use { ws ->
                // The phone has the task logs, but workspace.yaml did not sync yet: awd refuses with
                // not_ready and writes no rekey (fix list fc1-a3), so the phone does not guess "AW".
                val task = "01a2038e-7f00-7000-8000-00000000c001"
                val created =
                    TaskCreatedV1(key = "AW-7", project = "billing-api", title = "Offline", firstMessage = "Hi")
                ws.writer.write("tasks/$task/log/pixel-9.jsonl", "task.created", TaskCreatedV1.serializer(), created)
                Files.delete(ws.root.resolve("tasks/workspace.yaml"))
                ws.refresh()
                val model = ws.model(backgroundScope)
                val snapshot = model.reload()
                assertNull(snapshot.keyPrefix)
                assertEquals("duplicate", snapshot.task(task)!!.keyState)
                val actions = ws.actions(model)
                ws.clock.time += 1_000
                assertEquals(
                    ActionResult.Refused(
                        "The phone does not have workspace.yaml of this workspace yet. " +
                            "Wait for the sync, then try again.",
                    ),
                    actions.createTask(NewTaskDraft("billing-api", "Add a rate limit")),
                )
                assertEquals(emptyList(), actions.rekeyDuplicates())
                assertTrue(ws.written.isEmpty())
            }
        }
}
