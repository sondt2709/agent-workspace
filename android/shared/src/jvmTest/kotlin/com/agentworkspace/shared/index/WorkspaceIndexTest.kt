package com.agentworkspace.shared.index

import com.agentworkspace.shared.FakeClock
import com.agentworkspace.shared.Fixtures
import com.agentworkspace.shared.SeededRandom
import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.merge.MergeEngine
import com.agentworkspace.shared.merge.RandomEvents
import com.agentworkspace.shared.merge.TestWorkspace
import com.agentworkspace.shared.merge.appendRandomRound
import com.agentworkspace.shared.runMergeCase
import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** Test plan 1: the Room index on the JVM (bundled SQLite) gives the queries of the phone. */
class WorkspaceIndexTest {
    @Test
    fun answersThePhoneQueriesOnTheBaseCase() =
        runTest {
            val run = runMergeCase("base")
            val index = openWorkspaceIndex(null)
            try {
                index.write(run.update, run.engine)
                val view = run.update.view
                // AW-7 has an assignee and no open gate.
                assertEquals(emptyList(), index.needsYou())
                val task = view.tasks.first { it.id == Fixtures.FIXTURE_TASK }
                assertEquals(listOf(task), index.tasksByProjectAndStage("billing-api", task.stage))
                assertEquals(emptyList(), index.tasksByProjectAndStage("billing-api", "review"))

                val all = run.engine.eventRows(Fixtures.FIXTURE_TASK)
                assertEquals(all, index.thread(Fixtures.FIXTURE_TASK, limit = all.size + 5))
                val first = index.thread(Fixtures.FIXTURE_TASK, limit = 3)
                assertEquals(all.take(3), first)
                val last = first.last()
                assertEquals(
                    all.drop(3).take(4),
                    index.thread(Fixtures.FIXTURE_TASK, ThreadPlace(last.hlc, last.dev, last.id), 4),
                )
                assertFailsWith<IllegalArgumentException> { index.thread(Fixtures.FIXTURE_TASK, limit = -1) }
                // The newest page of the phone thread (gate-full-context, fix list 0-20).
                assertEquals(all.takeLast(3), index.threadNewest(Fixtures.FIXTURE_TASK, 3))
                assertEquals(all, index.threadNewest(Fixtures.FIXTURE_TASK, all.size + 5))
                assertEquals(
                    all.filter { it.type == "gate.opened" },
                    index.taskEvents(Fixtures.FIXTURE_TASK, "gate.opened"),
                )
                assertEquals(run.engine.documents().sortedBy { it.path }, index.documents())

                // The queries of the phone screens (android-ui).
                assertEquals(view.tasks.sortedBy { it.id }, index.tasks())
                assertEquals(view.projects.sortedBy { it.slug }, index.projects())
                assertEquals(view.devices.sortedBy { it.priority }, index.devices())
                assertEquals(run.update.presence.devices, index.presence())
                assertEquals(view.issues.size, index.issues().size)
                val workspace = index.document("tasks/workspace.yaml")
                assertEquals(view.workspace, workspace)
                assertEquals(null, index.document("tasks/no-such.yaml"))
                assertEquals(all.first(), index.event(all.first().id))
                assertEquals(null, index.event("no-such-event"))
            } finally {
                index.close()
                Fixtures.remove(run.root)
            }
        }

    @Test
    fun listsTheNeedsYouLaneAndTheStagesOfTheKeyCollisionCase() =
        runTest {
            val run = runMergeCase("task-key-collision")
            val index = openWorkspaceIndex(null)
            try {
                index.write(run.update, run.engine)
                val lane = index.needsYou()
                assertEquals(4, lane.size)
                assertEquals(
                    run.update.view.tasks
                        .filter { it.needsYouLane },
                    lane,
                )
                assertEquals(
                    listOf(
                        "AW-10",
                        "AW-8",
                        "AW-8",
                        "AW-9",
                    ),
                    index.tasksByProjectAndStage("billing-api", "backlog").map {
                        it.key
                    },
                )
                assertEquals(listOf("AW-7"), index.tasksByProjectAndStage("billing-api", "implement").map { it.key })
                val gates =
                    run.update.view.tasks
                        .flatMap { it.needsYouReasons }
                assertTrue(gates.isNotEmpty())
            } finally {
                index.close()
                Fixtures.remove(run.root)
            }
        }

    @Test
    fun incrementalIndexEqualsARebuiltIndex() =
        runTest {
            for (seed in listOf(20261122L, 7L)) {
                val ws = TestWorkspace()
                val random = SeededRandom(seed)
                val clock = FakeClock("2026-11-22T14:30:00.000Z")
                val gen = RandomEvents(random, clock, seed)
                val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
                val dir = Files.createTempDirectory("aw-index-")
                val incremental = openWorkspaceIndex(dir.resolve("a.sqlite").toString())
                val rebuilt = openWorkspaceIndex(dir.resolve("b.sqlite").toString())
                try {
                    incremental.write(engine.update(), engine)
                    val pending = LinkedHashMap<String, String>()
                    repeat(30) { round ->
                        appendRandomRound(ws, gen, random, pending, clock)
                        incremental.write(engine.update(), engine)
                        val full = MergeEngine(NioWorkspaceFiles(ws.root), clock)
                        rebuilt.rebuild(full.update(), full)
                        val a = incremental.dump()
                        val b = rebuilt.dump()
                        for (table in a.keys.filter { it != "presence" }) {
                            assertEquals(b[table], a[table], "seed $seed, round $round, table $table")
                        }
                    }
                } finally {
                    incremental.close()
                    rebuilt.close()
                    Fixtures.remove(dir)
                    ws.remove()
                }
            }
        }
}
