package com.agentworkspace.shared.write

import com.agentworkspace.schema.GateAnsweredV1
import com.agentworkspace.schema.TaskAssignedV1
import com.agentworkspace.schema.TaskCreatedV1
import com.agentworkspace.shared.Fixtures
import com.agentworkspace.shared.files.NioWorkspaceWriter
import com.agentworkspace.shared.model.HybridLogicalClock
import com.agentworkspace.shared.model.LineResult
import com.agentworkspace.shared.model.LogKind
import com.agentworkspace.shared.model.LogReader
import com.agentworkspace.shared.model.LogScope
import com.agentworkspace.shared.model.TimeSource
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The event writer of the phone (android-ui): valid lines in the own logs only. */
class EventWriterTest {
    private val root: Path = Files.createTempDirectory("aw-writer-")
    private val time = TimeSource { 1_795_000_000_000L }
    private val task = "01a2038e-7f00-70eb-b429-fa86d481c263"
    private val gate = "01a2038e-7f00-7aaa-8429-fa86d481c264"

    @AfterTest
    fun cleanUp() = Fixtures.remove(root)

    private fun writer(last: String? = null) =
        EventWriter(NioWorkspaceWriter(root), "pixel-9", HybridLogicalClock(time, last), time)

    private fun lines(path: String): List<String> =
        root
            .resolve(path)
            .readText()
            .lines()
            .filter { it.isNotEmpty() }

    @Test
    fun writesAValidGateAnswerOfTheHuman() {
        val path = EventWriter.taskLog(task, "pixel-9")
        val last = "2026-11-20T08:00:00.000Z#0003"
        val w = writer()
        w.observe(last)
        val event = w.write(path, "gate.answered", GateAnsweredV1.serializer(), GateAnsweredV1(gate, 1, "1000/min"))
        assertEquals("human@pixel-9", event.by)
        assertEquals(task, event.envelope.task)
        val line = lines(path).single()
        val read = LogReader.parseLine(line, "pixel-9", LogScope(LogKind.TASK, task))
        assertTrue(read is LineResult.Event, "$read")
        assertTrue(read.event.hlc > last)
        assertTrue(line.contains("\"comment\":null"), line)
        assertTrue(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").matches(event.id))
    }

    @Test
    fun eachEventHasANewerHlcAndANewId() {
        val path = EventWriter.taskLog(task, "pixel-9")
        val w = writer()
        val a = w.write(path, "task.assigned", TaskAssignedV1.serializer(), TaskAssignedV1("claude@ubuntu-01"))
        val b = w.write(path, "task.assigned", TaskAssignedV1.serializer(), TaskAssignedV1("claude@macbook-pro"))
        assertTrue(b.hlc > a.hlc)
        assertTrue(a.id != b.id)
        assertEquals(2, lines(path).size)
    }

    @Test
    fun refusesTheLogOfAnotherDeviceAndOtherKinds() {
        val w = writer()
        val answer = GateAnsweredV1(gate, 1, "yes")
        val other = EventWriter.taskLog(task, "ubuntu-01")
        assertFailsWith<WriteRefusedException> { w.write(other, "gate.answered", GateAnsweredV1.serializer(), answer) }
        // A task event does not belong in the workspace log.
        val workspace = EventWriter.workspaceLog("pixel-9")
        assertFailsWith<WriteRefusedException> {
            w.write(
                workspace,
                "gate.answered",
                GateAnsweredV1.serializer(),
                answer,
            )
        }
        // The data of another type.
        val own = EventWriter.taskLog(task, "pixel-9")
        assertFailsWith<WriteRefusedException> { w.write(own, "task.assigned", GateAnsweredV1.serializer(), answer) }
        assertFailsWith<WriteRefusedException> {
            w.write(
                "tasks/x.yaml",
                "gate.answered",
                GateAnsweredV1.serializer(),
                answer,
            )
        }
        assertFalse(Files.exists(root.resolve(other)))
        assertFalse(Files.exists(root.resolve(own)))
    }

    @Test
    fun refusesALineLongerThan64KiB() {
        val path = EventWriter.taskLog(task, "pixel-9")
        val data = TaskCreatedV1("AW-1", "api", "Long", "x".repeat(EventWriter.MAX_LINE_BYTES))
        assertFailsWith<WriteRefusedException> {
            writer().write(
                path,
                "task.created",
                TaskCreatedV1.serializer(),
                data,
            )
        }
        assertFalse(Files.exists(root.resolve(path)))
    }

    @Test
    fun writesANewlineAfterACutLine() {
        val path = EventWriter.taskLog(task, "pixel-9")
        Files.createDirectories(root.resolve(path).parent)
        root.resolve(path).writeText("{\"v\":1,\"id\":\"cut")
        writer().write(path, "task.assigned", TaskAssignedV1.serializer(), TaskAssignedV1("claude@ubuntu-01"))
        val text = root.resolve(path).readText()
        val parts = text.split("\n")
        assertEquals("{\"v\":1,\"id\":\"cut", parts[0])
        assertTrue(LogReader.parseLine(parts[1], "pixel-9", LogScope(LogKind.TASK, task)) is LineResult.Event)
        assertTrue(text.endsWith("\n"))
    }

    @Test
    fun uuid7HasTheTimeAndTheVersion() {
        val id = Uuid7.next(0x0192_3456_789aL)
        assertTrue(id.startsWith("01923456-789a-7"), id)
        assertTrue(id[19] in "89ab", id)
    }

    @Test
    fun atomicWriteReplacesTheFileAndLeavesNoTempFile() {
        val files = NioWorkspaceWriter(root)
        files.writeAtomic("tasks/devices/pixel-9/push.yaml", "a".encodeToByteArray())
        files.writeAtomic("tasks/devices/pixel-9/push.yaml", "b".encodeToByteArray())
        assertEquals("b", root.resolve("tasks/devices/pixel-9/push.yaml").readText())
        assertFalse(Files.exists(root.resolve("tasks/devices/pixel-9/push.yaml.aw-tmp")))
        files.delete("tasks/devices/pixel-9/push.yaml")
        files.delete("tasks/devices/pixel-9/push.yaml")
        assertFalse(Files.exists(root.resolve("tasks/devices/pixel-9/push.yaml")))
        assertFailsWith<IllegalArgumentException> { files.writeAtomic("../x", ByteArray(0)) }
    }
}
