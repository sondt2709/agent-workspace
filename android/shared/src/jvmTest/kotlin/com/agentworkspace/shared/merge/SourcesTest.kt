package com.agentworkspace.shared.merge

import com.agentworkspace.shared.FakeClock
import com.agentworkspace.shared.Fixtures
import com.agentworkspace.shared.files.FileEntry
import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.files.ReadableFile
import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.jsonDiff
import com.agentworkspace.shared.model.AwJson
import kotlinx.coroutines.test.runTest
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The merge sources are regular files only, and one source that cannot be read is an issue of the
 * merge, not a failure of each update (fix list fc1-a2).
 */
class SourcesTest {
    private val ws = TestWorkspace()
    private val outside: Path = Files.createTempDirectory("aw-kt-outside-")
    private val task = Fixtures.FIXTURE_TASK

    @AfterTest
    fun cleanup() {
        ws.remove()
        Fixtures.remove(outside)
    }

    private fun viewOf(update: MergeUpdate) = AwJson.encodeToJsonElement(WorkspaceView.serializer(), update.view)

    /** Moves a file of the workspace out of it, and puts a symbolic link to it at its path. */
    private fun replaceWithLink(path: String) {
        val file = ws.root.resolve(path)
        val target = outside.resolve(path.replace('/', '_'))
        Files.move(file, target)
        Files.createSymbolicLink(file, target)
    }

    @Test
    fun listsOnlyRegularFiles() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val folder = "tasks/$task/log/mac-mini-lab.jsonl"
            Files.createDirectories(ws.root.resolve(folder))
            ws.write("$folder/x.jsonl", "")
            val links =
                listOf(
                    "tasks/$task/log/macbook-pro.jsonl",
                    "tasks/log/ubuntu-01.jsonl",
                    "tasks/devices/pixel-9/health.yaml",
                    "tasks/projects/billing-api/project.yaml",
                )
            links.forEach(::replaceWithLink)
            val files = NioWorkspaceFiles(ws.root)
            val found = findSources(files)
            val paths = found.logs.map { it.path } + found.documents.map { it.path }
            assertTrue(paths.none { it == folder || it in links }, "$paths")
            assertTrue("tasks/$task/log/pixel-9.jsonl" in paths, "$paths")
            // The merge works, and equals the merge with no such entries.
            val update = MergeEngine(files, clock).update()
            Files.delete(ws.root.resolve("$folder/x.jsonl"))
            Files.delete(ws.root.resolve(folder))
            links.forEach { Files.delete(ws.root.resolve(it)) }
            assertNull(jsonDiff(viewOf(mergeWorkspace(files, clock)), viewOf(update)))
        }

    /** Files that fail each read of one path with an I/O error while [fail] is true. */
    private class FailingFiles(
        private val inner: WorkspaceFiles,
        private val failPath: String,
    ) : WorkspaceFiles {
        var fail = false

        override fun list(path: String): List<FileEntry> = inner.list(path)

        override fun exists(path: String): Boolean = inner.exists(path)

        override fun readText(path: String): String? {
            if (fail && path == failPath) throw IOException("EACCES")
            return inner.readText(path)
        }

        override fun open(path: String): ReadableFile? {
            if (fail && path == failPath) throw IOException("EACCES")
            return inner.open(path)
        }
    }

    @Test
    fun aLogThatCannotBeReadIsAnIssue() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val path = "tasks/$task/log/ubuntu-01.jsonl"
            val files = FailingFiles(NioWorkspaceFiles(ws.root), path)
            val engine = MergeEngine(files, clock)
            val first = engine.update()
            files.fail = true
            val failed = engine.update()
            // The events of the log stay; the view has one more issue.
            assertEquals(first.view.tasks, failed.view.tasks)
            val issue = failed.view.issues.single { it.code == "read_error" }
            assertEquals(path, issue.path)
            assertEquals(task, issue.task)
            assertTrue(issue.message.contains("EACCES"), issue.message)
            files.fail = false
            val next = engine.update()
            assertTrue(next.view.issues.none { it.code == "read_error" })
            assertNull(jsonDiff(viewOf(mergeWorkspace(NioWorkspaceFiles(ws.root), clock)), viewOf(next)))
        }

    @Test
    fun aDocumentThatCannotBeReadIsAnIssue() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val path = "tasks/projects/billing-api/project.yaml"
            val files = FailingFiles(NioWorkspaceFiles(ws.root), path)
            val engine = MergeEngine(files, clock)
            val first = engine.update()
            files.fail = true
            val failed = engine.update()
            // The document keeps its last value.
            assertEquals(first.view.projects, failed.view.projects)
            val issue = failed.view.issues.single { it.code == "read_error" }
            assertEquals(path, issue.path)
            files.fail = false
            val next = engine.update()
            assertTrue(next.view.issues.none { it.code == "read_error" })
            assertNull(jsonDiff(viewOf(mergeWorkspace(NioWorkspaceFiles(ws.root), clock)), viewOf(next)))
        }
}
