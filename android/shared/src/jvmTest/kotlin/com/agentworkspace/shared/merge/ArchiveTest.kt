package com.agentworkspace.shared.merge

import com.agentworkspace.shared.FakeClock
import com.agentworkspace.shared.files.NioWorkspaceFiles
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** `task.archived` and `task.unarchived`: the newest of the two wins (openspec task-actions). */
class ArchiveTest {
    private val ws = TestWorkspace()
    private val random = java.util.Random(7)
    private val task = uuid7(1_795_100_000_000L, random)

    @AfterTest
    fun cleanup() = ws.remove()

    private fun line(
        dev: String,
        type: String,
        time: String,
        data: kotlinx.serialization.json.JsonObject = json(),
    ) = event(uuid7(1_795_100_000_000L, random), dev, type, at(time), data, task, "human@$dev")

    private suspend fun archived(): Boolean {
        val clock = FakeClock("2026-11-22T16:00:00.000Z")
        return mergeWorkspace(NioWorkspaceFiles(ws.root), clock)
            .view.tasks
            .single { it.id == task }
            .archived
    }

    @Test
    fun theNewestEventWins() =
        runTest {
            ws.append(
                "tasks/$task/log/macbook-pro.jsonl",
                line("macbook-pro", "task.created", "15:00:00", createdData("AW-40")),
                line("macbook-pro", "task.archived", "15:00:01"),
            )
            ws.append("tasks/$task/log/pixel-9.jsonl", line("pixel-9", "task.unarchived", "15:00:02"))
            assertEquals(false, archived())
            ws.append("tasks/$task/log/macbook-pro.jsonl", line("macbook-pro", "task.archived", "15:00:03"))
            assertEquals(true, archived())
        }
}
