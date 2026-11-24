package com.agentworkspace.shared.merge

import com.agentworkspace.shared.FakeClock
import com.agentworkspace.shared.Fixtures
import com.agentworkspace.shared.SeededRandom
import com.agentworkspace.shared.files.FileEntry
import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.files.ReadableFile
import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.jsonDiff
import com.agentworkspace.shared.model.AwJson
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import java.io.IOException
import java.nio.file.Files
import kotlin.io.path.readText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Test plan 1 (property test): the incremental path equals a full merge after random appends, with
 * the seeds of the TypeScript test; and a truncated, replaced or removed log makes a full read.
 */
class IncrementalTest {
    private val ws = TestWorkspace()

    @AfterTest
    fun cleanup() = ws.remove()

    private fun viewOf(update: MergeUpdate) = AwJson.encodeToJsonElement(WorkspaceView.serializer(), update.view)

    private suspend fun randomRun(
        seed: Long,
        rounds: Int,
    ): Pair<Int, MergeUpdate> {
        val random = SeededRandom(seed)
        val clock = FakeClock("2026-11-22T14:30:00.000Z")
        val gen = RandomEvents(random, clock, seed)
        val files = NioWorkspaceFiles(ws.root)
        val engine = MergeEngine(files, clock)
        engine.update()
        val pending = LinkedHashMap<String, String>()
        var fullUpdates = 0
        var last: MergeUpdate? = null
        for (round in 0 until rounds) {
            appendRandomRound(ws, gen, random, pending, clock)
            val incremental = engine.update()
            last = incremental
            if (incremental.full) fullUpdates++
            val full = mergeWorkspace(files, clock)
            assertNull(jsonDiff(viewOf(full), viewOf(incremental)), "seed $seed, round $round")
        }
        return fullUpdates to last!!
    }

    private fun randomProperty(seed: Long) =
        runTest {
            val (fullUpdates, last) = randomRun(seed, 60)
            // Appends never need a full read.
            assertEquals(0, fullUpdates)
            // The random events reach the rules: many tasks, and each kind of issue.
            assertTrue(last.view.tasks.size > 10, "tasks: ${last.view.tasks.size}")
            val codes =
                last.view.issues
                    .map { it.code }
                    .toSet()
            for (code in listOf(
                "ignored",
                "unknown_type",
                "bad_line",
                "duplicate_event",
            )) {
                assertTrue(code in codes, code)
            }
            assertTrue(last.view.tasks.any { it.keyState == "duplicate" })
            assertTrue(last.view.tasks.any { task -> task.gates.any { it.answers.isNotEmpty() } })
        }

    @Test
    fun equalsAFullMergeAfterRandomAppendsSeed20261122() = randomProperty(20261122)

    @Test
    fun equalsAFullMergeAfterRandomAppendsSeed7() = randomProperty(7)

    @Test
    fun equalsAFullMergeAfterRandomAppendsSeed4242() = randomProperty(4242)

    private val comment =
        event(
            "01a203a3-0000-7000-8000-000000000c01",
            "pixel-9",
            "comment.added",
            at("14:25:00"),
            json("text" to "new"),
            Fixtures.FIXTURE_TASK,
            "human@pixel-9",
        )

    @Test
    fun continuesASavedFoldAndReadsOnlyTheNewBytes() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            engine.update()
            ws.append("tasks/${Fixtures.FIXTURE_TASK}/log/pixel-9.jsonl", comment)
            val update = engine.update()
            assertFalse(update.full)
            assertEquals(listOf(Fixtures.FIXTURE_TASK), update.changedTasks)
            assertEquals(
                listOf("new"),
                update.view.tasks[0]
                    .comments
                    .map { it.text }
                    .filter { it == "new" },
            )
        }

    @Test
    fun readsAllFilesAgainAfterATruncatedLog() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            engine.update()
            val path = "tasks/${Fixtures.FIXTURE_TASK}/log/ubuntu-01.jsonl"
            val text = ws.root.resolve(path).readText()
            ws.write(path, text.lines().take(3).joinToString("\n") + "\n")
            val update = engine.update()
            assertTrue(update.full)
            assertEquals(listOf(MergeNotice("truncated", path)), update.notices)
            assertNull(jsonDiff(viewOf(mergeWorkspace(NioWorkspaceFiles(ws.root), clock)), viewOf(update)))
        }

    @Test
    fun readsAllFilesAgainAfterAReplacedOrRemovedLog() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            engine.update()
            val path = "tasks/${Fixtures.FIXTURE_TASK}/log/pixel-9.jsonl"
            val text = ws.root.resolve(path).readText()
            ws.write(path, text.replaceFirst("\"v\":1", "\"v\": 1"))
            val replaced = engine.update()
            assertEquals(listOf(MergeNotice("replaced", path)), replaced.notices)
            assertTrue(replaced.full)
            Files.delete(ws.root.resolve(path))
            val removed = engine.update()
            assertEquals(listOf(MergeNotice("removed", path)), removed.notices)
            assertNull(jsonDiff(viewOf(mergeWorkspace(NioWorkspaceFiles(ws.root), clock)), viewOf(removed)))
        }

    /** Files that fail one read of one path with an I/O error, or with another throwable. */
    private class FailingFiles(
        private val inner: WorkspaceFiles,
        private val failPath: String,
        private val error: () -> Throwable = { IOException("EIO") },
    ) : WorkspaceFiles {
        var fail = false

        override fun list(path: String): List<FileEntry> = inner.list(path)

        override fun exists(path: String): Boolean = inner.exists(path)

        override fun readText(path: String): String? = inner.readText(path)

        override fun open(path: String): ReadableFile? {
            if (fail && path == failPath) {
                fail = false
                throw error()
            }
            return inner.open(path)
        }
    }

    @Test
    fun losesNoEventWhenAReadFails() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val files = FailingFiles(NioWorkspaceFiles(ws.root), "tasks/${Fixtures.FIXTURE_TASK}/log/ubuntu-01.jsonl")
            val engine = MergeEngine(files, clock)
            engine.update()
            ws.append("tasks/${Fixtures.FIXTURE_TASK}/log/pixel-9.jsonl", comment)
            files.fail = true
            // One log that cannot be read is an issue (fc1-a2): the other logs still merge.
            val failed = engine.update()
            assertEquals(listOf("read_error"), failed.view.issues.map { it.code })
            assertTrue(
                failed.view.tasks[0]
                    .comments
                    .any { it.text == "new" },
            )
            val next = engine.update()
            assertTrue(next.view.issues.isEmpty())
            assertNull(jsonDiff(viewOf(mergeWorkspace(NioWorkspaceFiles(ws.root), clock)), viewOf(next)))
        }

    @Test
    fun losesNoEventWhenAReadFailsWithAnError() =
        runTest {
            // An Error (not an Exception) after the read of another log, for example a stack overflow.
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val files =
                FailingFiles(NioWorkspaceFiles(ws.root), "tasks/${Fixtures.FIXTURE_TASK}/log/ubuntu-01.jsonl") {
                    StackOverflowError()
                }
            val engine = MergeEngine(files, clock)
            engine.update()
            ws.append("tasks/${Fixtures.FIXTURE_TASK}/log/pixel-9.jsonl", comment)
            files.fail = true
            assertFailsWith<StackOverflowError> { engine.update() }
            val next = engine.update()
            assertTrue(next.full)
            assertTrue(
                next.view.tasks[0]
                    .comments
                    .any { it.text == "new" },
            )
            assertNull(jsonDiff(viewOf(mergeWorkspace(NioWorkspaceFiles(ws.root), clock)), viewOf(next)))
        }

    @Test
    fun readsALineWithDeepNesting() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            engine.update()
            val path = "tasks/${Fixtures.FIXTURE_TASK}/log/pixel-9.jsonl"
            // A broken device writes an unclosed line of 100,000 "[", and a valid event with a deep
            // unknown key: 2 bad lines, as on awd.
            ws.appendText(path, "[".repeat(100_000) + "\n")
            val deep = "[".repeat(100_000) + "]".repeat(100_000)
            ws.appendText(
                path,
                AwJson.encodeToString(JsonObject.serializer(), comment).replace("\"new\"", "\"x\",\"x_deep\":$deep") +
                    "\n",
            )
            val update = engine.update()
            assertEquals(
                listOf("Unexpected end of JSON input", "JSON nesting is deeper than 64 levels"),
                update.view.issues
                    .filter { it.code == "bad_line" }
                    .map { it.message },
            )
            assertNull(jsonDiff(viewOf(mergeWorkspace(NioWorkspaceFiles(ws.root), clock)), viewOf(update)))
        }

    @Test
    fun skipsTheBlankLinesOfJavaScriptTrim() =
        runTest {
            // awd skips a line when `text.trim() === ""`: a line with only U+FEFF is skipped, a line
            // with only U+001C is a bad line (Kotlin isBlank has the other result for both).
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            engine.update()
            ws.appendText("tasks/${Fixtures.FIXTURE_TASK}/log/pixel-9.jsonl", "\uFEFF\n \u3000\u2001\r\n\u001c\n")
            val bad =
                engine
                    .update()
                    .view.issues
                    .filter { it.code == "bad_line" }
            assertEquals(listOf("Unexpected token '\u001c', \"\u001c\" is not valid JSON"), bad.map { it.message })
        }

    @Test
    fun skipsATaskFolderThatIsASymlink() =
        runTest {
            // findSources of TypeScript reads `Dirent.isDirectory()`, which does not follow a symlink.
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val before = viewOf(mergeWorkspace(NioWorkspaceFiles(ws.root), clock))
            Files.createSymbolicLink(
                ws.root.resolve("tasks/01a2038e-7f00-7000-8000-0000000000aa"),
                ws.root.resolve("tasks/${Fixtures.FIXTURE_TASK}"),
            )
            val after = mergeWorkspace(NioWorkspaceFiles(ws.root), clock)
            assertTrue(after.view.issues.isEmpty(), after.view.issues.toString())
            assertNull(jsonDiff(before, viewOf(after)))
        }

    @Test
    fun runsOverlappingUpdatesOneAtATime() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            val a = async { engine.update() }
            val b = async { engine.update() }
            val c = async { engine.rebuild() }
            assertTrue(
                a
                    .await()
                    .view.issues
                    .isEmpty(),
            )
            assertTrue(b.await().notices.isEmpty())
            assertTrue(
                c
                    .await()
                    .view.issues
                    .isEmpty(),
            )
        }
}
