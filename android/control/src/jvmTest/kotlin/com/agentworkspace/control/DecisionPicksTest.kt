package com.agentworkspace.control

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The decision picks of a gate card (openspec task-review-layout, design decision 4): the same answer
 * and comment as the desktop, from the shared fixture `contracts/fixtures/gates/decisions-answer.json`.
 */
class DecisionPicksTest {
    private val fixture: JsonObject by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        Json.parseToJsonElement(Files.readString(dir.resolve("fixtures/gates/decisions-answer.json"))).jsonObject
    }

    @Test
    fun decisionsAnswerOfTheSharedCases() {
        val cases = fixture.getValue("cases").jsonArray.map { it.jsonObject }
        assertEquals(5, cases.size)
        for (case in cases) {
            val name = case.getValue("name").jsonPrimitive.content
            val decisions = GateTexts.decisions(buildJsonObject { put("decisions", case.getValue("decisions")) })
            val picks = case.getValue("picks").jsonArray.map { it.jsonPrimitive.content }
            val expected =
                when (val e = case.getValue("expected")) {
                    is JsonNull -> {
                        null
                    }

                    else -> {
                        DecisionsAnswer(
                            e.jsonObject
                                .getValue("answer")
                                .jsonPrimitive.content,
                            e.jsonObject
                                .getValue("comment")
                                .jsonPrimitive.content,
                        )
                    }
                }
            assertEquals(expected, GateTexts.decisionsAnswer(decisions, picks), name)
        }
    }

    @Test
    fun canPickDecisionsOfTheSharedGates() {
        for (gate in fixture.getValue("gates").jsonArray.map { it.jsonObject }) {
            val options = gate.getValue("options").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(
                gate.getValue("can_pick").jsonPrimitive.boolean,
                GateTexts.canPickDecisions(options),
                gate.getValue("name").jsonPrimitive.content,
            )
        }
    }

    @Test
    fun theStatusLineCountsThePicksThatDiffer() {
        val d1 = GateDecision("D1 Limit per API key", listOf("100", "1,000"), "100")
        val d2 = GateDecision("D2 Counter store", listOf("Redis", "In memory"), "Redis")
        val all = GateTexts.picksLine(listOf(d1, d2), listOf("100", "Redis"))
        assertEquals("All picks are the recommended options.", all)
        assertEquals(
            "1 pick differs from the recommendation. “Send my choices” asks the agent for a new approach " +
                "with your picks.",
            GateTexts.picksLine(listOf(d1, d2), listOf("100", "In memory")),
        )
        assertEquals(
            "2 picks differ from the recommendation. “Send my choices” asks the agent for a new approach " +
                "with your picks.",
            GateTexts.picksLine(listOf(d1, d2), listOf("1,000", "In memory")),
        )
        // Back to the recommendation: the main button is "Confirm" again (no answer of the picks).
        assertEquals(null, GateTexts.decisionsAnswer(listOf(d1, d2), listOf("100", "Redis")))
    }
}
