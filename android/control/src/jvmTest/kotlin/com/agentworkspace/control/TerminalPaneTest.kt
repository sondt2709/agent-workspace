package com.agentworkspace.control

import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.model.IsoTime
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The terminal pane of the phone: the shared contract fixture, and the read from a synced folder. */
class TerminalPaneTest {
    @Serializable
    private data class ParseCase(
        val name: String,
        val content: String,
        val header: JsonElement,
        val text: String,
    )

    @Serializable
    private data class NewestCase(
        val name: String,
        val files: Map<String, String>,
        val device: String?,
        val text: String?,
    )

    @Serializable
    private data class Fixture(
        val parse: List<ParseCase>,
        val newest: List<NewestCase>,
    )

    private val fixture: Fixture by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        LENIENT.decodeFromString(Fixture.serializer(), Files.readString(dir.resolve("fixtures/terminal/cases.json")))
    }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    @Test
    fun eachParseCaseOfTheContractFixture() {
        for (case in fixture.parse) {
            val parsed = TerminalPane.parse("ubuntu-01", case.content)
            val expected =
                (case.header as? JsonObject)?.let {
                    TerminalHeader(
                        device = it.text("device")!!,
                        session = it.text("session")!!,
                        host = it.text("host")!!,
                        socket = it.text("socket"),
                        window = it.text("window"),
                        capturedAt = it.text("captured_at")!!,
                    )
                }
            assertEquals(expected, parsed.header, case.name)
            assertEquals(case.text, parsed.text, case.name)
        }
        assertEquals(14, fixture.parse.size)
    }

    @Test
    fun eachNewestCaseOfTheContractFixture() {
        for (case in fixture.newest) {
            val newest = TerminalPane.newest(case.files)
            assertEquals(case.device, newest?.device, case.name)
            assertEquals(case.text, newest?.text, case.name)
        }
    }

    @Test
    fun theNewestSyncedSnapshotWithItsDeviceAndTime() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val task = ws.model(backgroundScope).reload().task(TASK)!!
                val files = NioWorkspaceFiles(ws.root)
                val now = IsoTime.parseMillis("2026-11-23T14:23:05.000Z")!!
                val empty = TerminalPane.read(files, task, now, ZoneOffset.UTC)
                assertEquals(TerminalPaneState(null, null, TerminalPane.EMPTY), empty)

                val file = ws.root.resolve("tasks/$TASK/terminal/ubuntu-01.txt")
                Files.createDirectories(file.parent)
                Files.writeString(
                    file,
                    "{\"kind\":\"aw-terminal\",\"v\":1,\"device\":\"ubuntu-01\",\"session\":\"s1\",\"host\":\"tmux\"," +
                        "\"socket\":\"aw\",\"window\":\"aw-$TASK\",\"captured_at\":\"2026-11-23T14:20:05.000Z\"}\n" +
                        "● I used the key [redacted:stripe-test] for the call.\n❯\n",
                )
                val state = TerminalPane.read(files, task, now, ZoneOffset.UTC)
                assertEquals("● I used the key [redacted:stripe-test] for the call.\n❯", state.text)
                assertEquals("Captured 14:20 on ubuntu-01 · 3 min ago", state.caption)
                assertNull(state.note)

                // AW does not read the screen of an Orca session: the pane says so.
                val orca = task.copy(session = task.session!!.copy(host = "orca"))
                assertEquals(
                    "AW does not read the screen of an Orca session. Open the Orca worktree aw-$TASK on ubuntu-01.",
                    TerminalPane.read(files, orca, now, ZoneOffset.UTC).note,
                )
            }
        }

    private companion object {
        val LENIENT = Json { ignoreUnknownKeys = true }
        const val TASK = "01a2038e-7f00-70eb-b429-fa86d481c263"
    }
}
