package com.agentworkspace.shared.merge

import com.agentworkspace.schema.ProjectV1
import com.agentworkspace.shared.model.LineResult
import com.agentworkspace.shared.model.LogReader
import com.agentworkspace.shared.runMergeCase
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/** `SessionOptions.effective`: the port of `effectiveSessionOptions` (openspec session-options). */
class SessionOptionsTest {
    /** AW-7 of the merge case: a task of a person with no options. */
    private suspend fun task(): TaskView =
        runMergeCase("session-options")
            .update.view.tasks
            .single { it.key == "AW-7" }

    private fun options(
        mode: String? = null,
        teams: Boolean = false,
        workIn: String = "worktree",
        folder: String? = null,
    ) = SessionOptionsView(mode, teams, workIn, folder)

    @Test
    fun noOptionsGiveTheDefaults() =
        runTest {
            assertEquals(
                EffectiveSessionOptions("default", false, "worktree", null),
                SessionOptions.effective(task(), null),
            )
        }

    @Test
    fun theTaskModeWinsOverTheProjectDefault() =
        runTest {
            val task = task().copy(sessionOptions = options(mode = "accept_edits", teams = true))
            assertEquals(
                EffectiveSessionOptions("accept_edits", true, "worktree", null),
                SessionOptions.effective(task, "skip"),
            )
        }

    @Test
    fun aTaskWithNoModeTakesTheProjectDefault() =
        runTest {
            val task = task().copy(sessionOptions = options(workIn = "checkout"))
            assertEquals("accept_edits", SessionOptions.effective(task, "accept_edits").permissionMode)
            assertEquals("checkout", SessionOptions.effective(task, "accept_edits").workIn)
        }

    @Test
    fun aProjectSkipCountsOnlyForATaskOfAPerson() =
        runTest {
            val person = task().copy(createdBy = "human@macbook-pro")
            assertEquals("skip", SessionOptions.effective(person, "skip").permissionMode)
            val agent = person.copy(createdBy = "claude@ubuntu-01")
            assertEquals("default", SessionOptions.effective(agent, "skip").permissionMode)
            assertEquals("default", SessionOptions.effective(agent.copy(createdBy = null), "skip").permissionMode)
            // Another project default counts for an agent task too.
            assertEquals("accept_edits", SessionOptions.effective(agent, "accept_edits").permissionMode)
        }

    @Test
    fun theFolderCountsOnlyForWorkInFolder() =
        runTest {
            val folder = task().copy(sessionOptions = options(workIn = "folder", folder = "/work/api"))
            assertEquals("/work/api", SessionOptions.effective(folder, null).folder)
            val checkout = task().copy(sessionOptions = options(workIn = "checkout", folder = "/work/api"))
            assertEquals(null, SessionOptions.effective(checkout, null).folder)
        }

    @Test
    fun aCheckoutKeepsItsBranchOnlyWithSwitchBranchFalse() =
        runTest {
            assertEquals(true, SessionOptions.effective(task(), null).switchBranch)
            val keep = task().copy(sessionOptions = options(workIn = "checkout").copy(switchBranch = false))
            assertEquals(false, SessionOptions.effective(keep, null).switchBranch)
            val fold = TaskFold(TASK)
            val created = """"key":"AW-1","project":"billing-api","title":"T","first_message":"T""""
            fold.apply(line(1, "task.created", "human@pixel-9", "{$created,$NO_SWITCH}"), NO_CONTEXT)
            assertEquals(SessionOptionsView(null, false, "checkout", null, false), fold.toView().sessionOptions)
            // An older event has no field: the session switches the branch.
            fold.apply(
                line(2, "task.assigned", "human@pixel-9", """{"assignee":"claude@ubuntu-01",$FOLDER}"""),
                NO_CONTEXT,
            )
            assertEquals(true, fold.toView().sessionOptions?.switchBranch)
        }

    @Test
    fun theProjectViewGivesItsPermissionMode() =
        runTest {
            val view = runMergeCase("session-options").update.view
            assertEquals("skip", view.projects.single { it.slug == "billing-api" }.permissionMode)
            // A project with no value has the product default skip (openspec polish-skip-default),
            // but an agent task of that project still gets default.
            val old = ProjectView(JsonObject(mapOf("slug" to JsonPrimitive("billing-api"))), emptyList())
            assertEquals("skip", old.permissionMode)
            val agent = task().copy(createdBy = "claude@ubuntu-01")
            assertEquals("default", SessionOptions.effective(agent, old.permissionMode).permissionMode)
            val person = task().copy(createdBy = "human@macbook-pro")
            assertEquals("skip", SessionOptions.effective(person, old.permissionMode).permissionMode)
        }

    @Test
    fun theFoldKeepsTheFolderOnlyForWorkInFolderAndTheNewestOptionsOfAPerson() {
        val fold = TaskFold(TASK)
        val context =
            object : TaskContext {
                override fun project(slug: String): ProjectV1? = null

                override fun ownerAt(
                    task: String,
                    key: OrderKey,
                ): String? = null
            }
        val created = """"key":"AW-1","project":"billing-api","title":"T","first_message":"T""""
        val lines =
            listOf(
                line(1, "task.created", "human@pixel-9", "{$created,$CHECKOUT}"),
                line(2, "task.assigned", "claude@pixel-9", """{"assignee":"claude@ubuntu-01",$FOLDER}"""),
                line(3, "task.assigned", "human@pixel-9", """{"assignee":"claude@ubuntu-01"}"""),
            )
        lines.forEach { fold.apply(it, context) }
        val view = fold.toView()
        assertEquals(SessionOptionsView("skip", true, "checkout", null), view.sessionOptions)
        assertEquals("human@pixel-9", view.createdBy)
        assertEquals(Decision(true, null), fold.decisions.getValue(lines[0].event.id))
        assertEquals(Decision(false, "assignment_not_allowed"), fold.decisions.getValue(lines[1].event.id))
        val person = line(4, "task.assigned", "human@pixel-9", """{"assignee":"claude@ubuntu-01",$FOLDER}""")
        fold.apply(person, context)
        assertEquals(SessionOptionsView(null, false, "folder", "/work/api"), fold.toView().sessionOptions)
    }

    private fun line(
        n: Int,
        type: String,
        by: String,
        data: String,
    ): LogLine {
        val id = "01a20400-0000-7002-8000-00000000000$n"
        val text =
            """{"v":1,"id":"$id","hlc":"2026-11-24T09:0$n:00.000Z#0000","dev":"pixel-9","type":"$type",""" +
                """"by":"$by","data":$data,"task":"$TASK"}"""
        val event = assertIs<LineResult.Event>(LogReader.validate(Json.parseToJsonElement(text))).event
        return LogLine(event, "tasks/$TASK/log/pixel-9.jsonl", n)
    }

    private companion object {
        const val TASK = "01a20400-0000-7001-8000-000000000009"
        const val CHECKOUT =
            """"session_options":{"permission_mode":"skip","agent_teams":true,"work_in":"checkout","folder":"/x"}"""
        const val FOLDER = """"session_options":{"work_in":"folder","folder":"/work/api"}"""
        const val NO_SWITCH = """"session_options":{"work_in":"checkout","switch_branch":false}"""

        val NO_CONTEXT =
            object : TaskContext {
                override fun project(slug: String): ProjectV1? = null

                override fun ownerAt(
                    task: String,
                    key: OrderKey,
                ): String? = null
            }
    }
}
