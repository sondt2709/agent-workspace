package com.agentworkspace.shared.merge

import com.agentworkspace.schema.TaskV1
import com.agentworkspace.shared.Fixtures
import com.agentworkspace.shared.SeededRandom
import com.agentworkspace.shared.expectedOf
import com.agentworkspace.shared.jsonDiff
import com.agentworkspace.shared.model.AwJson
import com.agentworkspace.shared.model.DocumentReader
import com.agentworkspace.shared.runMergeCase
import com.agentworkspace.shared.shuffle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Test plan 1 of android-shared: each merge case of contracts/fixtures/merge gives the
 * `expected.json` of the TypeScript engine, for each read order of the log files.
 */
class MergeCasesTest {
    private val cases = Fixtures.caseNames()

    @Test
    fun coversEachCase() {
        assertEquals(
            listOf(
                "base",
                "claim-epochs",
                "claim-not-assignee",
                "device-offline",
                "device-revoked",
                "far-future-hlc",
                "gate-answered-twice",
                "project-removed",
                "session-options",
                "task-key-collision",
                "task-rules",
                "truncated-log-line",
                "workspace-rules",
            ),
            cases,
        )
    }

    @Test
    fun eachCaseEqualsExpectedJson() =
        runTest {
            for (name in cases) {
                val run = runMergeCase(name)
                try {
                    val expected = Fixtures.json(Fixtures.mergeCases.resolve(name).resolve("expected.json"))
                    assertNull(jsonDiff(expected, expectedOf(run.update)), "case $name")
                } finally {
                    Fixtures.remove(run.root)
                }
            }
        }

    @Test
    fun eachCaseGivesTheSameViewFor40ReadOrders() =
        runTest {
            for (name in cases) {
                val random = SeededRandom(20261122)
                val expected = Fixtures.json(Fixtures.mergeCases.resolve(name).resolve("expected.json"))
                val orders: List<(List<String>) -> List<String>> =
                    listOf<(List<String>) -> List<String>> { it.reversed() } +
                        List(39) { { paths: List<String> -> shuffle(paths, random) } }
                orders.forEachIndexed { index, order ->
                    val run = runMergeCase(name, order)
                    try {
                        assertNull(jsonDiff(expected, expectedOf(run.update)), "case $name, order $index")
                    } finally {
                        Fixtures.remove(run.root)
                    }
                }
            }
        }

    @Test
    fun removesTheProjectAndItsTasksAsTypeScript() =
        runTest {
            val run = runMergeCase("project-removed")
            try {
                val view = run.update.view
                assertEquals(listOf("billing-api", "docs-site"), view.projects.map { it.slug })
                assertEquals(listOf("AW-21", "AW-22", "AW-25"), view.tasks.map { it.key }.sortedBy { it })
                assertEquals(
                    listOf("AW-20", "AW-23", "AW-24", "AW-7"),
                    view.removedTasks.map { it.key }.sortedBy { it },
                )
                assertEquals(listOf("billing-api", "web-app"), view.removedProjects.map { it.slug })
                // The removed tasks count for the next key (AW-25 is the highest of the case).
                assertEquals("AW-26", nextFreeKey(view.tasks + view.removedTasks, "AW"))
            } finally {
                Fixtures.remove(run.root)
            }
        }

    @Test
    fun givesTheNextFreeKeyWithTheSafeIntegersOfTypeScript() =
        runTest {
            val run = runMergeCase("task-rules")
            try {
                val tasks = run.update.view.tasks
                // AW-24 was AW-20 before a rekey: the created keys count too.
                assertEquals("AW-25", nextFreeKey(tasks, "AW"))
                // TypeScript counts only a safe integer (Number.isSafeInteger) and adds 1 to it.
                val big = tasks[0].copy(key = "AW-9007199254740993")
                assertEquals("AW-25", nextFreeKey(tasks + big, "AW"))
                val max = tasks[0].copy(key = "AW-9007199254740991")
                assertEquals("AW-9007199254740992", nextFreeKey(tasks + max, "AW"))
            } finally {
                Fixtures.remove(run.root)
            }
        }

    @Test
    fun givesTheRekeyPlanOfEachDeviceOfRekeysJson() =
        runTest {
            val file =
                Fixtures
                    .json(
                        Fixtures.mergeCases.resolve("task-key-collision").resolve("rekeys.json"),
                    ).jsonObject
            val prefix = file.getValue("prefix").jsonPrimitive.content
            val run = runMergeCase("task-key-collision")
            try {
                for ((device, plan) in file.getValue("plans").jsonObject) {
                    val expected =
                        plan.jsonArray.map {
                            val item = it.jsonObject
                            RekeyItem(
                                item.getValue("task").jsonPrimitive.content,
                                item.getValue("from").jsonPrimitive.content,
                                item.getValue("to").jsonPrimitive.content,
                            )
                        }
                    assertEquals(expected, rekeyPlan(run.update.view.tasks, prefix, device), "plan of $device")
                }
            } finally {
                Fixtures.remove(run.root)
            }
        }

    @Test
    fun baseSnapshotEqualsTheFixtureTaskYaml() =
        runTest {
            val run = runMergeCase("base")
            try {
                val task =
                    run.update.view.tasks
                        .first { it.id == Fixtures.FIXTURE_TASK }
                val text = Fixtures.workspace.resolve("tasks/${Fixtures.FIXTURE_TASK}/task.yaml").readText()
                val fixture = DocumentReader.parse(text, "task").value
                val snapshot = AwJson.encodeToJsonElement(TaskV1.serializer(), toTaskDocument(task)!!)
                assertNull(jsonDiff(fixture, snapshot))
            } finally {
                Fixtures.remove(run.root)
            }
        }
}
