package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.SESSION
import com.agentworkspace.shared.merge.SessionOptions
import com.agentworkspace.shared.merge.SessionOptionsView
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.nio.file.Files
import kotlin.io.path.appendText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The session options of the phone (openspec session-options): New task, New session, Stop session, the rows. */
class SessionOptionsActionsTest {
    private val skipTeamsCheckout = SessionOptionsDraft("skip", agentTeams = true, workIn = "checkout")

    @Test
    fun aNewTaskWithOptionsWritesThemAsAPerson() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val draft = NewTaskDraft("billing-api", "Add a rate limit", sessionOptions = skipTeamsCheckout)
                val done = assertIs<ActionResult.Done>(ws.actions(model).createTask(draft))
                ws.refresh()
                val task = model.reload().task(done.task)!!
                assertEquals("human@pixel-9", task.createdBy)
                assertEquals(SessionOptionsView("skip", true, "checkout", null), task.sessionOptions)
                assertTrue(SessionOptionRows.skipsPermissions(task, "default"))
                assertTrue(SessionOptionRows.agentTeams(task, "default"))
            }
        }

    @Test
    fun aNewTaskWithTheDefaultsHasNoOptions() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val draft = NewTaskDraft("billing-api", "Add a rate limit", sessionOptions = SessionOptionsDraft())
                val done = assertIs<ActionResult.Done>(ws.actions(model).createTask(draft))
                assertFalse(Files.readString(ws.root.resolve(done.path)).contains("session_options"))
                ws.refresh()
                assertNull(model.reload().task(done.task)!!.sessionOptions)
            }
        }

    @Test
    fun anOtherFolderNeedsAnAbsolutePath() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                val relative = SessionOptionsDraft(workIn = "folder", folder = "work/api")
                assertEquals(
                    ActionResult.Refused(SessionOptionsDraft.FOLDER_PROBLEM),
                    actions.createTask(NewTaskDraft("billing-api", "Hi", sessionOptions = relative)),
                )
                assertEquals(
                    ActionResult.Refused(SessionOptionsDraft.FOLDER_PROBLEM),
                    actions.assign(AW7, "claude@ubuntu-01", relative),
                )
                assertTrue(ws.written.isEmpty())
            }
        }

    @Test
    fun newSessionReplacesTheOptionsAndAPlainAssignKeepsThem() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                val folder = SessionOptionsDraft("accept_edits", workIn = "folder", folder = " /work/billing-api/api ")
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.assign(AW7, "claude@ubuntu-01", folder))
                ws.refresh()
                val expected = SessionOptionsView("accept_edits", false, "folder", "/work/billing-api/api")
                assertEquals(expected, model.reload().task(AW7)!!.sessionOptions)
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.assign(AW7, "claude@macbook-pro"))
                ws.refresh()
                val task = model.reload().task(AW7)!!
                assertEquals("claude@macbook-pro", task.assignee)
                assertEquals(expected, task.sessionOptions)
            }
        }

    @Test
    fun stopSessionWritesAStopRequestOfThePerson() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.stopSession(AW7))
                ws.refresh()
                val row = ws.index.thread(AW7, limit = 500).last { it.type == "session.stop_requested" }
                assertTrue(row.applied)
                assertTrue(row.event.toString().contains(SESSION))
                assertTrue(row.event.toString().contains("human@pixel-9"))

                val created = assertIs<ActionResult.Done>(actions.createTask(NewTaskDraft("billing-api", "Later")))
                ws.refresh()
                model.reload()
                assertEquals(ActionResult.Refused("No session runs for this task."), actions.stopSession(created.task))
            }
        }

    @Test
    fun noStopRequestForAnEndedSession() =
        runTest {
            TestWorkspace().use { ws ->
                ws.appendRaw(
                    "tasks/$AW7/log/ubuntu-01.jsonl",
                    "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000c001\"," +
                        "\"hlc\":\"2026-11-22T14:21:20.000Z#0000\",\"dev\":\"ubuntu-01\"," +
                        "\"type\":\"session.ended\",\"task\":\"$AW7\",\"by\":\"aw@ubuntu-01\"," +
                        "\"data\":{\"session\":\"$SESSION\",\"reason\":\"stopped\"}}",
                )
                ws.refresh()
                val model = ws.model(backgroundScope)
                assertEquals(
                    "ended",
                    model
                        .reload()
                        .task(AW7)!!
                        .session!!
                        .state,
                )
                assertEquals(ActionResult.Refused("No session runs for this task."), ws.actions(model).stopSession(AW7))
                assertTrue(ws.written.isEmpty())
            }
        }

    @Test
    fun theRowsShowTheRunningSession() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                // AW-7 runs a session of an older awd: no mode in session.started.
                val task =
                    snapshot
                        .task(
                            AW7,
                        )!!
                        .copy(sessionOptions = SessionOptionsView("skip", true, "worktree", null))
                assertEquals(
                    listOf(
                        "Permissions" to "Default",
                        "Agent teams" to "Off",
                        "Works in" to
                            "~/code/billing-api/.worktrees/aw-01a2038e-7f00-70eb-b429-fa86d481c263 · branch aw/AW-7",
                    ),
                    SessionOptionRows.rows(task, SessionOptionRows.projectMode(task, snapshot.projects)),
                )
                assertFalse(SessionOptionRows.skipsPermissions(task, "skip"))
                val running = task.copy(session = task.session!!.copy(permissionMode = "skip", agentTeams = true))
                assertTrue(SessionOptionRows.skipsPermissions(running, "default"))
                assertEquals("On", SessionOptionRows.rows(running, null)[1].second)
            }
        }

    @Test
    fun theRowsShowTheNextSessionWhenNoneRuns() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val aw7 = snapshot.task(AW7)!!
                val ended = aw7.copy(session = aw7.session!!.copy(state = "ended", reason = "stopped"))
                val folder = ended.copy(sessionOptions = SessionOptionsView(null, false, "folder", "/work/api"))
                assertEquals(
                    listOf(
                        "Permissions" to "Skip permissions",
                        "Agent teams" to "Off",
                        "Works in" to "/work/api",
                        "Last session in" to
                            "~/code/billing-api/.worktrees/aw-01a2038e-7f00-70eb-b429-fa86d481c263 · branch aw/AW-7",
                    ),
                    // AW-7 was created by a person: a project skip counts.
                    SessionOptionRows.rows(folder, "skip"),
                )
                val agent = folder.copy(createdBy = "claude@ubuntu-01", sessionOptions = null)
                assertEquals("Default", SessionOptionRows.rows(agent, "skip")[0].second)
                assertEquals("Separate worktree", SessionOptionRows.rows(agent, "skip")[2].second)
                val checkout = folder.copy(sessionOptions = SessionOptionsView("accept_edits", true, "checkout", null))
                assertEquals(
                    listOf("Accept edits", "On", "Project checkout"),
                    SessionOptionRows.rows(checkout, null).take(3).map { it.second },
                )
            }
        }

    @Test
    fun theFormSendsOnlyAChange() {
        val initial = SessionOptionsDraft.of(SessionOptionsView("skip", false, "folder", "/work/api"))
        assertNull(initial.copy(folder = " /work/api ").changedFrom(initial))
        assertEquals(initial.copy(agentTeams = true), initial.copy(agentTeams = true).changedFrom(initial))
        // The folder text does not count for a worktree.
        val worktree = SessionOptionsDraft()
        assertNull(worktree.copy(folder = "/old").changedFrom(worktree))
        assertEquals(
            listOf(SessionOptionTexts.SKIP_WARNING, SessionOptionTexts.CHECKOUT_WARNING),
            SessionOptionTexts.warnings(SessionOptionsDraft(workIn = "checkout"), "skip"),
        )
        assertEquals(emptyList(), SessionOptionTexts.warnings(SessionOptionsDraft("default"), "skip"))
        // The warning says what AW cannot block in skip mode (check soc-1).
        assertTrue(SessionOptionTexts.SKIP_WARNING.contains("A hidden command can still act as you in AW"))
        assertEquals("Folder on ubuntu-01", SessionOptionTexts.folderLabel("claude@ubuntu-01"))
    }

    @Test
    fun aCheckoutWithNoBranchSwitchSendsSwitchBranchFalse() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                model.reload()
                val actions = ws.actions(model)
                val keep = SessionOptionsDraft(workIn = "checkout", switchBranch = false)
                val draft = NewTaskDraft("billing-api", "Notes", sessionOptions = keep)
                val done = assertIs<ActionResult.Done>(actions.createTask(draft))
                assertTrue(Files.readString(ws.root.resolve(done.path)).contains("\"switch_branch\":false"))
                ws.refresh()
                val task = model.reload().task(done.task)!!
                assertEquals(SessionOptionsView(null, false, "checkout", null, false), task.sessionOptions)
                assertFalse(SessionOptions.effective(task, null).switchBranch)
                assertEquals(keep, SessionOptionsDraft.of(task))
                // New session sends the switch too.
                ws.clock.time += 1_000
                assertIs<ActionResult.Done>(actions.assign(done.task, "claude@ubuntu-01", keep.copy(agentTeams = true)))
                ws.refresh()
                assertEquals(
                    false,
                    model
                        .reload()
                        .task(done.task)!!
                        .sessionOptions
                        ?.switchBranch,
                )
            }
        }

    @Test
    fun theBranchSwitchCountsOnlyForACheckout() {
        // Off for a worktree: the event keeps the default, and the draft has no change.
        val worktree = SessionOptionsDraft(switchBranch = false)
        assertTrue(worktree.forCreate().switchBranch)
        assertTrue(worktree.forAssign().switchBranch)
        assertNull(worktree.changedFrom(SessionOptionsDraft()))
        val checkout = SessionOptionsDraft(workIn = "checkout")
        assertEquals(checkout.copy(switchBranch = false), checkout.copy(switchBranch = false).changedFrom(checkout))
        assertFalse(checkout.copy(switchBranch = false).forAssign().switchBranch)
        // The warning about the branch shows only with the switch on.
        assertEquals(listOf(SessionOptionTexts.CHECKOUT_WARNING), SessionOptionTexts.warnings(checkout, "default"))
        assertEquals(emptyList(), SessionOptionTexts.warnings(checkout.copy(switchBranch = false), "default"))
        assertEquals("Switch to the task branch", SessionOptionTexts.SWITCH_BRANCH)
        assertEquals(
            "The session works on the branch that is checked out. AW makes no branch.",
            SessionOptionTexts.NO_SWITCH_HELP,
        )
    }

    @Test
    fun theFormsOfAPersonStartWithAgentTeams() =
        runTest {
            assertTrue(NewTaskDraft.START_OPTIONS.agentTeams)
            assertEquals("Agent teams", SessionOptionTexts.TEAMS)
            // The schema default stays off: a draft with no change has no teams.
            assertFalse(SessionOptionsDraft().agentTeams)
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                val aw7 = model.reload().task(AW7)!!
                val none = aw7.copy(sessionOptions = null)
                assertEquals(SessionOptionsDraft(agentTeams = true), SessionOptionsDraft.forNewSession(none))
                // A task with options starts New session with them.
                val off = SessionOptionsView("skip", false, "checkout", null)
                val withOptions = aw7.copy(sessionOptions = off)
                assertEquals(
                    SessionOptionsDraft("skip", false, "checkout"),
                    SessionOptionsDraft.forNewSession(withOptions),
                )
                // The preselect is a change, so the event has agent_teams.
                val start = SessionOptionsDraft.forNewSession(none)
                assertEquals(start, start.changedFrom(SessionOptionsDraft.of(none)))
                val draft = NewTaskDraft("billing-api", "Hi", sessionOptions = NewTaskDraft.START_OPTIONS)
                val done = assertIs<ActionResult.Done>(ws.actions(model).createTask(draft))
                ws.refresh()
                assertEquals(
                    true,
                    model
                        .reload()
                        .task(done.task)!!
                        .sessionOptions
                        ?.agentTeams,
                )
            }
        }

    @Test
    fun aSeparateWorktreeNeedsACommitInTheCheckout() {
        fun health(text: String) = Json.parseToJsonElement(text).jsonObject
        val noCommit =
            health(
                """{"checkouts":[{"project":"my-notes","has_commit":false},""" +
                    """{"project":"billing-api","has_commit":true}]}""",
            )
        assertFalse(WorktreeRule.available(noCommit, "my-notes"))
        assertTrue(WorktreeRule.available(noCommit, "billing-api"))
        // Not known: no entry, no checkouts (an older awd), no health.
        assertTrue(WorktreeRule.available(noCommit, "web-app"))
        assertTrue(WorktreeRule.available(health("""{"disk":{"used_percentage":61}}"""), "my-notes"))
        assertTrue(WorktreeRule.available(null, "my-notes"))
        // A string is not a boolean: not known.
        val text = health("""{"checkouts":[{"project":"my-notes","has_commit":"false"}]}""")
        assertTrue(WorktreeRule.available(text, "my-notes"))
        // The draft goes to the project checkout; another choice stays.
        assertEquals("checkout", SessionOptionsDraft().fitting(false).workIn)
        assertEquals("worktree", SessionOptionsDraft().fitting(true).workIn)
        val folder = SessionOptionsDraft(workIn = "folder", folder = "/work/api")
        assertEquals(folder, folder.fitting(false))
        assertEquals(
            "This checkout has no commit yet. Make a first commit to use a separate worktree.",
            SessionOptionTexts.NO_COMMIT_HINT,
        )
    }

    @Test
    fun theWorktreeRuleReadsTheHealthOfTheAssigneeDevice() =
        runTest {
            TestWorkspace().use { ws ->
                ws.root
                    .resolve("tasks/devices/ubuntu-01/health.yaml")
                    .appendText("checkouts:\n  - project: billing-api\n    has_commit: false\n")
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                assertIs<JsonObject>(snapshot.health["ubuntu-01"])
                assertFalse(WorktreeRule.available(snapshot, "claude@ubuntu-01", "billing-api"))
                assertTrue(WorktreeRule.available(snapshot, "claude@ubuntu-01", "web-app"))
                assertTrue(WorktreeRule.available(snapshot, "claude@macbook-pro", "billing-api"))
                assertTrue(WorktreeRule.available(snapshot, null, "billing-api"))
            }
        }

    @Test
    fun newTaskStartsTheAgentAndFollowsTheProject() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                // "Start the agent now" is on: the first device of billing-api.
                val start = "claude@ubuntu-01"
                assertEquals(start, NewTaskChoices.assignee(snapshot, "billing-api", changed = false, picked = null))
                // A project with no device: off.
                assertNull(NewTaskChoices.assignee(snapshot, "web-app", changed = false, picked = null))
                // The person turned it off: it stays off for another project.
                assertNull(NewTaskChoices.assignee(snapshot, "web-app", changed = true, picked = null))
                assertEquals(start, NewTaskChoices.assignee(snapshot, "billing-api", changed = true, picked = start))
                // An agent that the project does not show is never sent.
                assertNull(NewTaskChoices.assignee(snapshot, "billing-api", changed = true, picked = "claude@pixel-9"))
                assertNull(NewTaskChoices.assignee(snapshot, null, changed = false, picked = null))
            }
        }
}
