package com.agentworkspace.control

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * The card actions of the phone (openspec inbox-mattermost, spec inbox-cards "Card actions"): each
 * writes one person event to the workspace log of the phone, and the real merge applies it.
 */
class InboxActionsTest {
    private val card = "01a20400-0000-7000-8000-000000000901"

    /** The source with ubuntu-01 as the collecting device: only it writes cards. */
    private val sourceLine =
        listOf(
            "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000c000\",",
            "\"hlc\":\"2026-11-22T14:00:00.000Z#0000\",\"dev\":\"macbook-pro\",",
            "\"type\":\"source.configured\",\"by\":\"human@macbook-pro\",\"data\":{",
            "\"source\":\"mattermost\",\"kind\":\"mattermost\",\"name\":\"Mattermost\",",
            "\"server_url\":\"https://chat.example.com\",\"credential\":\"mattermost-alex\",",
            "\"collector\":\"ubuntu-01\"}}",
        ).joinToString("")

    private fun line(
        n: Int,
        hlc: String,
        dev: String,
        type: String,
        data: String,
    ): String =
        "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-0000000c${n.toString().padStart(4, '0')}\"," +
            "\"hlc\":\"$hlc\",\"dev\":\"$dev\",\"type\":\"$type\",\"by\":\"human@$dev\",\"data\":$data}"

    private val cardLine =
        listOf(
            "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000c001\",",
            "\"hlc\":\"2026-11-22T14:21:10.000Z#0000\",\"dev\":\"ubuntu-01\",",
            "\"type\":\"inbox.card_added\",\"by\":\"aw@ubuntu-01\",\"data\":{\"card\":\"$card\",",
            "\"source\":\"mattermost\",",
            "\"conversation\":{\"id\":\"dm-lan\",\"name\":\"@lan.pham\",\"kind\":\"direct\"},",
            "\"thread\":null,\"category\":\"question\",",
            "\"title\":\"Which Node version runs on staging?\",",
            "\"answer\":{\"text\":\"Node 26.\",\"from\":null},",
            "\"messages\":[{\"id\":\"m1\",\"author\":\"lan.pham\",",
            "\"at\":\"2026-11-22T14:20:00.000Z\",\"text\":\"Which Node version?\"}]}}",
        ).joinToString("")

    @Test
    fun theCardActionsWritePersonEventsThatTheMergeApplies() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/log/macbook-pro.jsonl", sourceLine)
                ws.appendRaw("tasks/log/ubuntu-01.jsonl", cardLine)
                ws.refresh()
                val model = ws.model(backgroundScope)
                val first = model.reload().cards.single()
                assertEquals(false, first.read)
                assertEquals(null, first.project)
                val actions = ws.actions(model)
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.setCard(card, read = true))
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.replyCard(card, "Staging runs Node 26."))
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.askCard(card, "Make it shorter"))
                assertEquals(
                    listOf("tasks/log/pixel-9.jsonl", "tasks/log/pixel-9.jsonl", "tasks/log/pixel-9.jsonl"),
                    ws.written,
                )
                ws.refresh()
                val after = model.reload().cards.single()
                assertEquals(true, after.read)
                assertEquals(null, after.project)
                assertEquals("requested", after.replies.single().state)
                assertEquals(listOf("ask"), after.chat.map { it.kind })
                // A task always has a project (decision of 2026-11-27).
                assertEquals(
                    ActionResult.Refused("Choose a project."),
                    actions.createTaskFromCard(card, NewTaskDraft(project = "", firstMessage = "Fix it")),
                )
            }
        }

    @Test
    fun aReadOnThePhoneKeepsTheProjectThatAnotherDeviceSet() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/log/macbook-pro.jsonl", sourceLine)
                ws.appendRaw("tasks/log/ubuntu-01.jsonl", cardLine)
                ws.refresh()
                val model = ws.model(backgroundScope)
                assertEquals(
                    null,
                    model
                        .reload()
                        .cards
                        .single()
                        .project,
                )
                // The desktop sets the project; the phone has not read that line yet.
                ws.appendRaw(
                    "tasks/log/macbook-pro.jsonl",
                    line(
                        1,
                        "2026-11-22T14:30:00.000Z#0000",
                        "macbook-pro",
                        "inbox.card_project",
                        "{\"card\":\"$card\",\"project\":\"billing-api\"}",
                    ),
                )
                ws.clock.time += 3_600_000
                assertIs<ActionResult.Done>(ws.actions(model).setCard(card, read = true))
                ws.refresh()
                val after = model.reload().cards.single()
                assertEquals(true, after.read)
                assertEquals("billing-api", after.project)
            }
        }

    @Test
    fun theProjectOfACardIsItsOwnEventAlsoForNoProject() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/log/macbook-pro.jsonl", sourceLine)
                ws.appendRaw("tasks/log/ubuntu-01.jsonl", cardLine)
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(ws.actions(model).setCardProject(card, null))
                ws.refresh()
                assertEquals(
                    null,
                    model
                        .reload()
                        .cards
                        .single()
                        .project,
                )
            }
        }

    @Test
    fun aCardGivesOneTaskAndOneReplyAtATime() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw("tasks/log/macbook-pro.jsonl", sourceLine)
                ws.appendRaw("tasks/log/ubuntu-01.jsonl", cardLine)
                ws.appendRaw(
                    "tasks/log/macbook-pro.jsonl",
                    line(
                        2,
                        "2026-11-22T14:31:00.000Z#0000",
                        "macbook-pro",
                        "inbox.task_created",
                        "{\"card\":\"$card\",\"task\":\"01a203a2-0000-7000-8000-00000000d001\"}",
                    ),
                )
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                assertEquals(
                    ActionResult.Refused("This card already has a task."),
                    actions.createTaskFromCard(card, NewTaskDraft(project = "billing-api", firstMessage = "Fix it")),
                )
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.replyCard(card, "Node 26."))
                ws.refresh()
                model.reload()
                assertEquals(
                    ActionResult.Refused("A reply of this card is not sent yet. Wait for it."),
                    actions.replyCard(card, "Node 26."),
                )
            }
        }
}
