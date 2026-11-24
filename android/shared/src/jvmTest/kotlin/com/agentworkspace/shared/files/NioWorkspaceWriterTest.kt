package com.agentworkspace.shared.files

import com.agentworkspace.shared.Fixtures
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The appends of the phone to its own logs: never through a synced symbolic link (fix list fc1-a1). */
class NioWorkspaceWriterTest {
    private val root: Path = Files.createTempDirectory("aw-nio-writer-")
    private val outside: Path = Files.createTempDirectory("aw-nio-outside-")
    private val log = "tasks/01a2038e-7f00-70eb-b429-fa86d481c263/log/pixel-9.jsonl"

    @AfterTest
    fun cleanUp() {
        Fixtures.remove(root)
        Fixtures.remove(outside)
    }

    private fun prepareLogFolder(): Path {
        val file = root.resolve(log)
        Files.createDirectories(file.parent)
        return file
    }

    @Test
    fun createsAMissingLogAsARegularFile() {
        NioWorkspaceWriter(root).appendLine(log, "{}")
        val file = root.resolve(log)
        assertTrue(Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))
        assertEquals("{}\n", file.readText())
    }

    @Test
    fun refusesALogThatIsASymbolicLinkToAnotherFile() {
        val target = outside.resolve("other.txt")
        target.writeText("keep\n")
        Files.createSymbolicLink(prepareLogFolder(), target)
        assertFailsWith<IOException> { NioWorkspaceWriter(root).appendLine(log, "{}") }
        assertEquals("keep\n", target.readText())
    }

    @Test
    fun refusesALogThatIsALinkToAMissingFile() {
        val target = outside.resolve("new.txt")
        Files.createSymbolicLink(prepareLogFolder(), target)
        assertFailsWith<IOException> { NioWorkspaceWriter(root).appendLine(log, "{}") }
        assertFalse(Files.exists(target, LinkOption.NOFOLLOW_LINKS))
    }

    @Test
    fun refusesALogFolderThatIsASymbolicLink() {
        val file = root.resolve(log)
        Files.createDirectories(file.parent.parent)
        Files.createSymbolicLink(file.parent, outside)
        assertFailsWith<IOException> { NioWorkspaceWriter(root).appendLine(log, "{}") }
        assertFalse(Files.exists(outside.resolve("pixel-9.jsonl"), LinkOption.NOFOLLOW_LINKS))
    }

    @Test
    fun atomicWriteDoesNotWriteThroughALinkedTempFile() {
        val target = outside.resolve("other.txt")
        target.writeText("keep\n")
        val file = root.resolve("tasks/devices/pixel-9/push.yaml")
        Files.createDirectories(file.parent)
        Files.createSymbolicLink(file.resolveSibling("push.yaml.aw-tmp"), target)
        NioWorkspaceWriter(root).writeAtomic("tasks/devices/pixel-9/push.yaml", "a".encodeToByteArray())
        assertEquals("keep\n", target.readText())
        assertEquals("a", file.readText())
        assertTrue(Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))
    }

    @Test
    fun atomicWriteAndDeleteRefuseALinkedFolder() {
        Files.createDirectories(root.resolve("tasks/devices"))
        Files.createSymbolicLink(root.resolve("tasks/devices/pixel-9"), outside)
        outside.resolve("push.yaml").writeText("keep\n")
        val writer = NioWorkspaceWriter(root)
        assertFailsWith<IOException> { writer.writeAtomic("tasks/devices/pixel-9/push.yaml", "a".encodeToByteArray()) }
        assertFailsWith<IOException> { writer.delete("tasks/devices/pixel-9/push.yaml") }
        assertEquals("keep\n", outside.resolve("push.yaml").readText())
        // A missing folder is no error for a delete, and the delete creates nothing.
        writer.delete("tasks/other/x.yaml")
        assertFalse(Files.exists(root.resolve("tasks/other")))
    }

    @Test
    fun refusesALogThatIsAFolder() {
        Files.createDirectories(prepareLogFolder())
        assertFailsWith<IOException> { NioWorkspaceWriter(root).appendLine(log, "{}") }
        assertTrue(Files.isDirectory(root.resolve(log), LinkOption.NOFOLLOW_LINKS))
    }

    @Test
    fun keepsEachLineWhen2WritersAppendToOneLog() {
        // Final check review: each write goes to the end of the file (APPEND), never to a position
        // that the writer read before, so 2 writers of one log lose no line.
        val writer = NioWorkspaceWriter(root)
        // A first line: the 2 writers then append to an existing file.
        writer.appendLine(log, "{\"first\":true}")
        val threads =
            (0 until 2).map { t ->
                Thread { repeat(300) { i -> writer.appendLine(log, "{\"t\":$t,\"i\":$i}") } }
            }
        threads.forEach(Thread::start)
        threads.forEach(Thread::join)
        val lines =
            root
                .resolve(log)
                .readText()
                .split("\n")
                .filter(String::isNotEmpty)
        assertEquals(601, lines.size)
        assertEquals(601, lines.toSet().size)
    }
}
