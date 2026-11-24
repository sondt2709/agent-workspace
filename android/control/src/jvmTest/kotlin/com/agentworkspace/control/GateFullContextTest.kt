package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.GATE
import com.agentworkspace.control.TestWorkspace.Companion.PHONE
import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.merge.AnswerView
import com.agentworkspace.shared.merge.EventRow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The full context of a gate on the phone (openspec gate-full-context; M19, M24, fix list 0-20). */
class GateFullContextTest {
    private val fixture: JsonObject by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        Json.parseToJsonElement(Files.readString(dir.resolve("fixtures/gates/cases.json"))).jsonObject
    }

    @Test
    fun gateTextsOfTheSharedCases() {
        for (case in fixture.getValue("cases").jsonArray.map { it.jsonObject }) {
            val name = case.getValue("name").jsonPrimitive.content
            val decisions = GateTexts.decisions(buildJsonObject { put("decisions", case.getValue("decisions")) })
            assertEquals(case.getValue("decisions").jsonArray.size, decisions.size, name)
            assertEquals(
                case.getValue("body").jsonPrimitive.content,
                GateTexts.body(case.getValue("text").jsonPrimitive.content, decisions),
                name,
            )
        }
    }

    @Test
    fun decisionsOfOtherFormsAreLeftOut() {
        val data =
            Json
                .parseToJsonElement(
                    """{"decisions":[{"question":"Q","options":["a","b"],"recommended":"a"},""" +
                        """{"question":"Bad","options":[1],"recommended":"a"},"x"]}""",
                ).jsonObject
        assertEquals(listOf(GateDecision("Q", listOf("a", "b"), "a")), GateTexts.decisions(data))
        assertEquals(emptyList(), GateTexts.decisions(null))
    }

    @Test
    fun theCardShowsTheDecisionsAndCutsTheBlock() =
        runTest {
            TestWorkspace().use { ws ->
                val text = fixture.getValue("cases").jsonArray[0].jsonObject
                val line =
                    TestWorkspace
                        .questionLine()
                        .replace("\"text\":\"The API has no limit now.\"", "\"text\":${text.getValue("text")}")
                        .replace("}}", ",\"decisions\":${text.getValue("decisions")}}}")
                ws.appendRaw("tasks/$AW7/log/ubuntu-01.jsonl", line)
                ws.refresh()
                val model = ws.model(backgroundScope)
                val snapshot = model.reload()
                val card = ScreenStates.gateCards(snapshot.task(AW7)!!, snapshot).single { it.gate.gate == GATE }
                assertEquals(2, card.decisions.size)
                assertEquals("100/min", card.decisions[0].recommended)
                assertEquals(text.getValue("body").jsonPrimitive.content, card.text)
                assertFalse(card.text.contains("## Decisions"))
            }
        }

    @Test
    fun theThreadShowsTheNewestEventsAndHasOlder() =
        runTest {
            TestWorkspace("2026-11-22T14:30:00.000Z").use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                val before = model.thread(AW7, 500)
                assertFalse(before.hasOlder)
                for (n in 1..600) {
                    val ms = n.toString().padStart(3, '0').takeLast(3)
                    val sec = 25 + n / 1000
                    val id = "01a203a3-0000-7000-8000-" + n.toString(16).padStart(12, '0')
                    ws.appendRaw(
                        "tasks/$AW7/log/ubuntu-01.jsonl",
                        "{\"v\":1,\"id\":\"$id\",\"hlc\":\"2026-11-22T14:25:$sec.$ms" +
                            "Z#0000\",\"dev\":\"ubuntu-01\",\"type\":\"comment.added\",\"task\":\"$AW7\"," +
                            "\"by\":\"human@ubuntu-01\",\"data\":{\"text\":\"Note $n\"}}",
                    )
                }
                ws.refresh()
                val window = model.thread(AW7, 500)
                assertTrue(window.hasOlder)
                assertEquals(500, window.items.size)
                assertEquals("Note 600", window.items.last().text)
                assertEquals("Note 101", window.items.first().text)
                val more = model.thread(AW7, 1000)
                assertEquals("Note 600", more.items.last().text)
                assertTrue(more.items.any { it.text == "Note 1" })
            }
        }

    @Test
    fun aLateAnswerOfThePhoneShowsAsAComment() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val model = ws.model(backgroundScope)
                val task = model.reload().task(AW7)!!
                val gate =
                    task.gates.first().copy(
                        state = "resolved",
                        answers =
                            listOf(
                                AnswerView("e1", "macbook-pro", "h1", "human@macbook-pro", 1, "Confirm", null, "used"),
                                AnswerView("e2", PHONE, "h2", "human@$PHONE", 1, "Request changes", "x", "comment"),
                            ),
                    )
                val late = LateAnswers.of(task.copy(gates = listOf(gate)), PHONE)
                assertEquals(
                    listOf("Your answer “Request changes” came after the answer of macbook-pro. It is a comment now."),
                    late.map { it.text },
                )
                val used = gate.copy(answers = gate.answers.map { it.copy(use = "used") })
                assertEquals(emptyList(), LateAnswers.of(task.copy(gates = listOf(used)), PHONE))
                // A gate that a newer version replaced has no used answer: no late-answer card (R3).
                val replaced =
                    gate.copy(
                        answer = "Replaced by a newer result",
                        answerEvent = null,
                        answers = listOf(gate.answers[1]),
                    )
                assertEquals(emptyList(), LateAnswers.of(task.copy(gates = listOf(replaced)), PHONE))
                // AW closed the gate because its session ended (openspec stale-gates).
                for (close in listOf("Session ended", "Denied after 120 s")) {
                    val closed = replaced.copy(kind = "approve_command", answer = close)
                    assertEquals(
                        listOf(
                            "Your answer “Request changes” came after AW closed the gate: $close. It is a comment now.",
                        ),
                        LateAnswers.of(task.copy(gates = listOf(closed)), PHONE).map { it.text },
                    )
                }
                assertTrue(LateAnswers.isCloseAnswer("Session ended"))
                assertFalse(LateAnswers.isCloseAnswer("Deny"))
                assertFalse(LateAnswers.isCloseAnswer(null))
            }
        }

    @Test
    fun theApproachVersionsShowWaitsForYouAfterAConfirmedOne() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val task = ws.model(backgroundScope).reload().task(AW7)!!
                val v2 = task.copy(approach = task.approach.copy(latest = 2, confirmed = 1))
                assertEquals(
                    listOf(ApproachVersion(1, "Confirmed"), ApproachVersion(2, "Waits for you")),
                    ApproachVersions.of(v2),
                )
                assertEquals(
                    listOf(ApproachVersion(1, "Replaced"), ApproachVersion(2, "Waits for you")),
                    ApproachVersions.of(task.copy(approach = task.approach.copy(latest = 2, confirmed = null))),
                )
                Files.createDirectories(ws.root.resolve("tasks/$AW7/approach"))
                Files.writeString(ws.root.resolve("tasks/$AW7/approach/v2.md"), "# v2\n\nFULL-TEXT-END-MARKER\n")
                assertEquals(
                    "# v2\n\nFULL-TEXT-END-MARKER\n",
                    ApproachVersions.text(NioWorkspaceFiles(ws.root), AW7, 2),
                )
                assertNull(ApproachVersions.text(NioWorkspaceFiles(ws.root), AW7, 3))
            }
        }

    private fun added(
        path: String,
        size: Long,
        n: Int,
    ) = EventRow(
        id = "e$n",
        task = AW7,
        hlc = "2026-11-22T14:21:0$n.000Z#0000",
        dev = "ubuntu-01",
        type = "artifact.added",
        path = "tasks/$AW7/log/ubuntu-01.jsonl",
        line = n,
        applied = true,
        reason = null,
        event =
            buildJsonObject {
                put("type", "artifact.added")
                put(
                    "data",
                    buildJsonObject {
                        put("path", path)
                        put("size", size)
                        put("sha256", "a")
                    },
                )
            },
    )

    @Test
    fun theArtifactListHasTheStateOfEachFile() {
        val rows =
            listOf(
                added("artifacts/ubuntu-01/shot.png", 135, 1),
                added("artifacts/ubuntu-01/report.xml", 2048, 2),
                added("artifacts/ubuntu-01/old.txt", 10, 3),
            )
        val local =
            mapOf(
                "tasks/$AW7/artifacts/ubuntu-01/shot.png" to 135L,
                "tasks/$AW7/artifacts/ubuntu-01/old.txt" to 4L,
            )
        val list = ArtifactList.of(AW7, rows, setOf("$AW7/artifacts/ubuntu-01/report.xml"), local::get)
        assertEquals(
            listOf(ArtifactState.LOCAL, ArtifactState.REQUESTED, ArtifactState.REMOTE),
            list.map { it.state },
        )
        assertEquals(listOf("shot.png", "report.xml", "old.txt"), list.map { it.name })
        assertEquals(2048L, list[1].size)
        assertEquals("$AW7/artifacts/ubuntu-01/report.xml", list[1].request)
    }

    /** Check of the phone Open: only artifact paths, and only document types open in another app. */
    @Test
    fun theListAndOpenKeepOnlyArtifactPathsAndDocumentTypes() {
        val rows =
            listOf(
                added("artifacts/ubuntu-01/shot.png", 135, 1),
                added("artifacts/../../../../device-key", 32, 2),
                added("log/ubuntu-01.jsonl", 10, 3),
                added("artifacts/ubuntu-01/..", 1, 4),
                added("artifacts/ubuntu-01/build.apk", 5, 5),
            )
        val list = ArtifactList.of(AW7, rows, emptySet()) { null }
        assertEquals(listOf("shot.png", "build.apk"), list.map { it.name })
        assertTrue(ArtifactRule.openable("shot.png"))
        assertTrue(ArtifactRule.openable("report.XML"))
        assertTrue(ArtifactRule.openable("run.log"))
        assertFalse(ArtifactRule.openable("build.apk"))
        assertFalse(ArtifactRule.openable("page.html"))
        assertFalse(ArtifactRule.openable("png"))
    }

    /** The task detail reads the list again after Download until the file is on the phone (finding R2). */
    @Test
    fun theListIsReadAgainUntilTheDownloadedFileIsThere() {
        val shot = { state: ArtifactState -> ArtifactRow(AW7, "artifacts/ubuntu-01/shot.png", "shot.png", 135, state) }
        val asked = setOf("$AW7/artifacts/ubuntu-01/shot.png")
        assertFalse(ArtifactList.waiting(listOf(shot(ArtifactState.REMOTE)), emptySet()))
        assertTrue(ArtifactList.waiting(listOf(shot(ArtifactState.REMOTE)), asked))
        assertTrue(ArtifactList.waiting(listOf(shot(ArtifactState.REQUESTED)), emptySet()))
        assertFalse(ArtifactList.waiting(listOf(shot(ArtifactState.LOCAL)), asked))
    }

    @Test
    fun downloadOnMobileDataNeedsTheSwitch() {
        assertNull(ArtifactRule.check(metered = false, allowMobileData = false))
        assertEquals(ArtifactRule.MOBILE_DATA_REFUSED, ArtifactRule.check(metered = true, allowMobileData = false))
        assertNull(ArtifactRule.check(metered = true, allowMobileData = true))
        val dir = Files.createTempDirectory("aw-artifacts-")
        val setting = MobileDataSetting(dir.resolve("artifacts-mobile-data"))
        assertFalse(setting.allowed())
        setting.set(true)
        assertTrue(setting.allowed())
        setting.set(false)
        assertFalse(setting.allowed())
    }

    @Test
    fun theRequestsKeepOnlyArtifactPaths() {
        val dir = Files.createTempDirectory("aw-requests-")
        val requests = ArtifactRequests(dir)
        val ws = "01a2038e-7f00-721a-b230-e03772a58aff"
        assertTrue(requests.add(ws, "$AW7/artifacts/ubuntu-01/shot.png"))
        assertTrue(requests.add(ws, "$AW7/artifacts/ubuntu-01/shot.png"))
        assertFalse(requests.add(ws, "$AW7/artifacts/ubuntu-01/*.png"))
        assertFalse(requests.add(ws, "$AW7/log/ubuntu-01.jsonl"))
        assertEquals(listOf("$AW7/artifacts/ubuntu-01/shot.png"), requests.read(ws))
        assertEquals(emptyList(), requests.read("other"))
    }
}
