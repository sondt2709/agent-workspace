package com.agentworkspace.control

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The relative time of a row (openspec phone-desktop-parity): the cases of the shared fixture
 * `contracts/fixtures/time/ago.json`, which the desktop runs too.
 */
class AgoTest {
    @Test
    fun eachCaseOfTheSharedFixture() {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        val fixture = Json.parseToJsonElement(Files.readString(dir.resolve("fixtures/time/ago.json"))).jsonObject
        val now = 1_795_000_000_000L
        for (case in fixture.getValue("cases").jsonArray.map { it.jsonObject }) {
            val elapsed = case.getValue("elapsedMs").jsonPrimitive.long
            assertEquals(
                case.getValue("text").jsonPrimitive.content,
                Texts.ago(now - elapsed, now),
                "elapsed $elapsed ms",
            )
        }
    }
}
