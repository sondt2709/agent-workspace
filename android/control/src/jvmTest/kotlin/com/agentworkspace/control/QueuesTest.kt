package com.agentworkspace.control

import com.agentworkspace.shared.model.IsoTime
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The queue rule of the phone: the shared contract fixture, and the rows from the real index. */
class QueuesTest {
    @Serializable
    private data class Case(
        val name: String,
        val now: String,
        val tasks: List<QueueTask>,
        val orders: List<QueueOrder>,
        val devices: List<QueueDevice>,
        val expected: List<AgentQueue>,
    )

    @Serializable
    private data class Fixture(
        val ordinals: List<JsonArray>,
        val cases: List<Case>,
    )

    private val fixture: Fixture by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        LENIENT.decodeFromString(
            Fixture.serializer(),
            Files.readString(dir.resolve("fixtures/queue/cases.json")),
        )
    }

    @Test
    fun eachCaseOfTheContractFixture() {
        for (case in fixture.cases) {
            val actual =
                QueueRules.agentQueues(case.tasks, case.orders, case.devices, IsoTime.parseMillis(case.now)!!)
            assertEquals(case.expected, actual, case.name)
        }
        assertEquals(17, fixture.cases.size)
    }

    @Test
    fun englishOrdinals() {
        for (pair in fixture.ordinals) {
            assertEquals(pair[1].jsonPrimitive.content, QueueTexts.ordinal(pair[0].jsonPrimitive.int))
        }
    }

    @Test
    fun queuedRowsFromTheIndexWithTheNewestOrder() =
        runTest {
            TestWorkspace().use { ws ->
                newLog(ws, TASK_A, created(TASK_A, "AW-8", "14:22:00", "a001"))
                newLog(ws, TASK_B, created(TASK_B, "AW-9", "14:22:10", "a002"))
                ws.appendRaw(
                    "tasks/log/macbook-pro.jsonl",
                    "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000a003\"," +
                        "\"hlc\":\"2026-11-22T14:22:20.000Z#0000\"," +
                        "\"dev\":\"macbook-pro\",\"type\":\"queue.reordered\",\"by\":\"human@macbook-pro\"," +
                        "\"data\":{\"agent\":\"claude@ubuntu-01\",\"tasks\":[\"$TASK_B\",\"$TASK_A\"]}}",
                )
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val rows = snapshot.tasks.map { ScreenStates.row(it, snapshot) }.associateBy { it.label }
                // AW-7 works on ubuntu-01 (1 of 2): the first queued task starts next.
                assertEquals("Queued · 1st for claude@ubuntu-01", rows.getValue("AW-9").queue)
                assertEquals("starts soon", rows.getValue("AW-9").queueCause)
                assertEquals("Queued · 2nd for claude@ubuntu-01", rows.getValue("AW-8").queue)
                assertEquals("2 sessions working", rows.getValue("AW-8").queueCause)
                assertNull(rows.getValue("AW-7").queue)
                val task = snapshot.task(TASK_A)!!
                val fields = QueueTexts.withQueue(ScreenStates.fields(task), snapshot.queueEntries[TASK_A]).toMap()
                assertEquals("Queued · 2nd for claude@ubuntu-01 · 2 sessions working", fields["Queue"])
            }
        }

    /** A new task log of macbook-pro with one line. */
    private fun newLog(
        ws: TestWorkspace,
        task: String,
        line: String,
    ) {
        val file = ws.root.resolve("tasks/$task/log/macbook-pro.jsonl")
        Files.createDirectories(file.parent)
        Files.writeString(file, "$line\n")
    }

    private companion object {
        val LENIENT = Json { ignoreUnknownKeys = true }
        const val TASK_A = "01a203a2-0000-7000-8000-0000000000a8"
        const val TASK_B = "01a203a2-0000-7000-8000-0000000000a9"

        fun created(
            task: String,
            key: String,
            time: String,
            id: String,
        ) = "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000$id\",\"hlc\":\"2026-11-22T$time.000Z#0000\"," +
            "\"dev\":\"macbook-pro\",\"type\":\"task.created\",\"task\":\"$task\",\"by\":\"human@macbook-pro\"," +
            "\"data\":{\"key\":\"$key\",\"project\":\"billing-api\",\"title\":\"Queued $key\"," +
            "\"first_message\":\"x\",\"assignee\":\"claude@ubuntu-01\",\"parent\":null,\"depends_on\":[]}}"
    }
}
