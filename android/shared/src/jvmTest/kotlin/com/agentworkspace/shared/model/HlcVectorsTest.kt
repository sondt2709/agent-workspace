package com.agentworkspace.shared.model

import com.agentworkspace.schema.EventEnvelopeV1
import com.agentworkspace.schema.SchemaViolation
import com.agentworkspace.shared.Fixtures
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull

/** Test plan 1: the HLC vectors of contracts/test-vectors/hlc.json. */
class HlcVectorsTest {
    private val vectors = Fixtures.json(Fixtures.hlcVectors).jsonObject

    @Test
    fun formatsAndParses() {
        val format = vectors.getValue("format").jsonArray
        assertEquals(3, format.size)
        for (item in format) {
            val v = item.jsonObject
            val text = v.getValue("text").jsonPrimitive.content
            val value = HlcValue(v.getValue("time_ms").jsonPrimitive.long, v.getValue("counter").jsonPrimitive.int)
            assertEquals(text, Hlc.format(value))
            assertEquals(value, Hlc.parse(text))
        }
    }

    @Test
    fun rejectsEachInvalidText() {
        val invalid = vectors.getValue("invalid").jsonArray.map { it.jsonPrimitive.content }
        assertEquals(10, invalid.size)
        for (text in invalid) {
            assertFalse(Hlc.isHlc(text), text)
            assertFailsWith<HlcFormatException>(text) { Hlc.parse(text) }
            // The generated class refuses it too, also a date that does not exist.
            assertFailsWith<SchemaViolation>(text) {
                EventEnvelopeV1(
                    1,
                    "01a2038e-7f00-7000-8000-000000000001",
                    text,
                    "pixel-9",
                    "task.done",
                    data = emptyMap(),
                )
            }
        }
    }

    @Test
    fun sortsByTheHlcThenTheDevice() {
        val order = vectors.getValue("order").jsonArray.map { it.jsonObject }
        val keys =
            order.map {
                OrderPair(
                    it.getValue("hlc").jsonPrimitive.content,
                    it.getValue("dev").jsonPrimitive.content,
                )
            }
        val shuffled = keys.reversed().toMutableList().also { it.add(it.removeAt(0)) }
        assertEquals(keys, shuffled.sorted())
    }

    @Test
    fun runsEachSequence() {
        val sequences = vectors.getValue("sequences").jsonArray.map { it.jsonObject }
        assertEquals(7, sequences.size)
        for (sequence in sequences) {
            val name = sequence.getValue("name").jsonPrimitive.content
            var physical = 0L
            val start = sequence["start"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
            val clock = HybridLogicalClock({ physical }, start)
            for ((index, item) in sequence.getValue("steps").jsonArray.withIndex()) {
                val step = item.jsonObject
                step["physical_ms"]?.let { physical = it.jsonPrimitive.long }
                val expected = step["expect"]?.jsonPrimitive?.content
                val result =
                    when (val op = step.getValue("op").jsonPrimitive.content) {
                        "now" -> clock.now()
                        "observe" -> clock.observe(step.getValue("remote").jsonPrimitive.content).let { clock.peek() }
                        "receive" -> clock.receive(step.getValue("remote").jsonPrimitive.content)
                        else -> error("unknown op $op")
                    }
                if (expected != null) assertEquals(expected, result, "$name, step $index")
            }
        }
    }

    @Test
    fun formatsTimesLikeJavaScript() {
        assertEquals("1970-01-01T00:00:00.000Z", IsoTime.format(0))
        assertEquals("1969-12-31T23:59:59.999Z", IsoTime.format(-1))
        assertEquals("2024-02-29T12:00:00.000Z", IsoTime.format(IsoTime.parseMillis("2024-02-29T12:00:00.000Z")!!))
        assertNull(IsoTime.parseMillis("2026-02-29T12:00:00.000Z"))
        assertNull(IsoTime.parseMillis("2026-11-22T14:20:60.000Z"))
        assertFailsWith<IllegalArgumentException> { Hlc.format(HlcValue(253402300800000, 0)) }
    }

    private data class OrderPair(
        val hlc: String,
        val dev: String,
    ) : Comparable<OrderPair> {
        override fun compareTo(other: OrderPair): Int = compareValuesBy(this, other, { it.hlc }, { it.dev })
    }
}
