package com.agentworkspace.control

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The text size of a proposal (openspec proposal-and-discussion, design decision 7): the cases of
 * `contracts/fixtures/gates/proposal-text-size.json`, which the desktop runs too, and the file
 * `proposal-text-px` of the phone.
 */
class ProposalTextTest {
    private val fixture: JsonObject by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        Json.parseToJsonElement(Files.readString(dir.resolve("fixtures/gates/proposal-text-size.json"))).jsonObject
    }

    private fun cases(key: String) = fixture.getValue(key).jsonArray.map { it.jsonObject }

    @Test
    fun theLimitsAreTheLimitsOfTheSharedFixture() {
        assertEquals(fixture.getValue("min").jsonPrimitive.int, ProposalTextSize.MIN)
        assertEquals(fixture.getValue("max").jsonPrimitive.int, ProposalTextSize.MAX)
        assertEquals(fixture.getValue("step").jsonPrimitive.int, ProposalTextSize.STEP)
        assertEquals(fixture.getValue("default").jsonPrimitive.int, ProposalTextSize.DEFAULT)
    }

    @Test
    fun loadChangeAndLimitsOfTheSharedCases() {
        val load = cases("load")
        assertEquals(9, load.size)
        for (case in load) {
            val saved = (case.getValue("saved") as? JsonPrimitive)?.contentOrNull
            assertEquals(case.getValue("size").jsonPrimitive.int, ProposalTextSize.load(saved), "load $saved")
        }
        for (case in cases("change")) {
            val size = case.getValue("size").jsonPrimitive.int
            val larger = case.getValue("action").jsonPrimitive.content == "larger"
            assertEquals(case.getValue("size_after").jsonPrimitive.int, ProposalTextSize.change(size, larger), "$case")
        }
        for (case in cases("limits")) {
            val size = case.getValue("size").jsonPrimitive.int
            assertEquals(case.getValue("can_smaller").jsonPrimitive.boolean, ProposalTextSize.canSmaller(size), "$size")
            assertEquals(case.getValue("can_larger").jsonPrimitive.boolean, ProposalTextSize.canLarger(size), "$size")
        }
    }

    @Test
    fun aNumberTooLargeForALongGetsTheNearestLimit() {
        assertEquals(24, ProposalTextSize.load("99999999999999999999"))
        assertEquals(14, ProposalTextSize.load("-99999999999999999999"))
        assertEquals(14, ProposalTextSize.load(" -4 "))
    }

    @Test
    fun thePhoneKeepsTheSizeInItsFile() {
        val file = Files.createTempDirectory("aw-text-").resolve("proposal-text-px")
        val setting = ProposalTextSetting(file)
        assertEquals(16, setting.size())
        setting.set(20)
        assertEquals(20, setting.size())
        assertEquals("20\n", Files.readAllBytes(file).decodeToString())
        // A new setting on the same file (the app starts again) reads the kept size.
        assertEquals(20, ProposalTextSetting(file).size())
        Files.write(file, "abc".encodeToByteArray())
        assertEquals(16, setting.size())
    }
}
