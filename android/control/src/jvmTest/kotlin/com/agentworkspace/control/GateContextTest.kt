package com.agentworkspace.control

import com.agentworkspace.control.TestWorkspace.Companion.AW7
import com.agentworkspace.control.TestWorkspace.Companion.GATE
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Question details, context and questions on the phone (openspec gate-context, fix list ux-4). */
class GateContextTest {
    private fun fixture(name: String): JsonObject {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        return Json.parseToJsonElement(Files.readString(dir.resolve("fixtures/gates/$name"))).jsonObject
    }

    private fun questionsOf(value: kotlinx.serialization.json.JsonElement): List<GateQuestion> =
        GateTexts.questions(buildJsonObject { put("questions", value) })

    @Test
    fun answersOfTheSharedQuestionCases() {
        for (case in fixture("questions.json").getValue("cases").jsonArray.map { it.jsonObject }) {
            val name = case.getValue("name").jsonPrimitive.content
            val questions = questionsOf(case.getValue("questions"))
            assertEquals(case.getValue("questions").jsonArray.size, questions.size, name)
            assertEquals(
                case
                    .getValue("mode")
                    .jsonPrimitive.content
                    .uppercase(),
                GateTexts.mode(questions).name,
                name,
            )
            val picks = case.getValue("picks").jsonArray.map { p -> p.jsonArray.map { it.jsonPrimitive.content } }
            assertEquals(case.getValue("answer").jsonPrimitive.content, GateTexts.answer(questions, picks), name)
        }
    }

    @Test
    fun recommendedOptionOfTheSharedCases() {
        for (case in fixture("recommended.json").getValue("cases").jsonArray.map { it.jsonObject }) {
            val options = case.getValue("options").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(
                case
                    .getValue("recommended")
                    .jsonPrimitive.content
                    .toInt(),
                GateTexts.recommended(options),
                case.getValue("name").jsonPrimitive.content,
            )
        }
    }

    @Test
    fun bodyAndContextOfTheSharedCases() {
        val cases = fixture("context.json")
        for (b in cases.getValue("body").jsonArray.map { it.jsonObject }) {
            val name = b.getValue("name").jsonPrimitive.content
            val has =
                GateTexts.hasBody(
                    b.getValue("title").jsonPrimitive.content,
                    b.getValue("text").jsonPrimitive.content,
                    questionsOf(b.getValue("questions")),
                )
            assertEquals(b.getValue("has_body").jsonPrimitive.boolean, has, name)
        }
        for (c in cases.getValue("context").jsonArray.map { it.jsonObject }) {
            val name = c.getValue("name").jsonPrimitive.content
            val events =
                c.getValue("events").jsonArray.map { e ->
                    val o = e.jsonObject
                    ContextEvent(
                        id = o.getValue("id").jsonPrimitive.content,
                        type = o.getValue("type").jsonPrimitive.content,
                        by = o["by"]?.jsonPrimitive?.contentOrNull,
                        text = o["text"]?.jsonPrimitive?.contentOrNull,
                    )
                }
            assertEquals(
                c.getValue("context").jsonArray.map { it.jsonPrimitive.content },
                GateTexts.context(events, c.getValue("gate_event").jsonPrimitive.content).map { it.text },
                name,
            )
        }
    }

    @Test
    fun questionsWithDefaultsAndOtherFormsLeftOut() {
        val data =
            Json
                .parseToJsonElement(
                    """{"questions":[{"question":"Q","options":[{"label":"a"},{"description":"no label"}]},""" +
                        """{"question":3,"options":[]}]}""",
                ).jsonObject
        assertEquals(
            listOf(GateQuestion("Q", null, false, listOf(GateQuestionOption("a", "")))),
            GateTexts.questions(data),
        )
        assertEquals(emptyList(), GateTexts.questions(null))
    }

    @Test
    fun theCardShowsTheAgentMessagesAsContextInTheOwnerCase() =
        runTest {
            TestWorkspace().use { ws ->
                val title = "Which option? (see the gate message above)"
                ws.appendRaw(
                    "tasks/$AW7/log/ubuntu-01.jsonl",
                    "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000c001\"," +
                        "\"hlc\":\"2026-11-22T14:21:05.000Z#0000\"," +
                        "\"dev\":\"ubuntu-01\",\"type\":\"message.agent\",\"task\":\"$AW7\"," +
                        "\"by\":\"claude@ubuntu-01\"," +
                        "\"data\":{\"text\":\"Gate: queue library A or B\\n1. Solution\",\"session\":null}}",
                )
                ws.appendRaw(
                    "tasks/$AW7/log/ubuntu-01.jsonl",
                    TestWorkspace
                        .questionLine(options = "\"a\",\"b\",\"c\",\"d\"")
                        .replace("Which limit per client?", title)
                        .replace("The API has no limit now.", title),
                )
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val card = ScreenStates.gateCards(snapshot.task(AW7)!!, snapshot).single { it.gate.gate == GATE }
                assertEquals("", card.text)
                assertEquals(
                    listOf("Gate: queue library A or B\n1. Solution"),
                    card.context.map { it.text }.takeLast(1),
                )
                // The earlier agent message of the same span (14:21:00) is context too; no person
                // event is between them.
                assertTrue(card.context.size >= 2)
                assertEquals(listOf("a", "b", "c", "d"), card.options)
            }
        }

    @Test
    fun theCardKeepsTheDetailsAndTheQuestions() =
        runTest {
            TestWorkspace().use { ws ->
                val questions = fixture("questions.json").getValue("cases").jsonArray[1].jsonObject
                ws.appendRaw(
                    "tasks/$AW7/log/ubuntu-01.jsonl",
                    TestWorkspace
                        .questionLine(options = "")
                        .replace("Which limit per client?", "Which queue library do we use?")
                        .replace("The API has no limit now.", "## Options\\n- A\\n- B")
                        .replace("}}", ",\"questions\":${questions.getValue("questions")}}}"),
                )
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val card = ScreenStates.gateCards(snapshot.task(AW7)!!, snapshot).single { it.gate.gate == GATE }
                assertEquals("## Options\n- A\n- B", card.text)
                assertEquals(emptyList(), card.context)
                assertEquals(QuestionMode.LIST, GateTexts.mode(card.questions))
                assertEquals("Checks", card.questions[1].header)
                assertEquals("A separate service. Retries after a restart.", card.questions[0].options[1].description)
            }
        }
}
