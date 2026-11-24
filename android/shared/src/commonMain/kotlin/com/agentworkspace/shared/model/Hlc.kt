package com.agentworkspace.shared.model

/**
 * The hybrid logical clock (docs/phase-1.md 3.6, docs/architecture.md 4.2.4), the same as
 * `shared/schema/src/hlc.ts`. Text form: `<UTC time, ISO 8601 with ms>#<4-digit counter>`. It
 * sorts as text. The tests run `contracts/test-vectors/hlc.json`.
 */
data class HlcValue(
    /** The time part, ms since the epoch. */
    val time: Long,
    /** The logical counter, 0 to 9999. */
    val counter: Int,
)

class HlcFormatException(
    val text: String,
) : IllegalArgumentException("Not an HLC: \"$text\". Use <UTC time with ms>#<4-digit counter>.")

/** A source of the physical time in ms since the epoch. */
fun interface TimeSource {
    fun now(): Long
}

object Hlc {
    const val MAX_COUNTER = 9999

    /** The pattern of an HLC text (`HLC_PATTERN` of shared/schema/src/common.ts). */
    val PATTERN = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z#\\d{4}\\z")

    /** The time in ms of an HLC text, or null when the text is not an HLC or its date is not real. */
    fun timeOf(text: String): Long? {
        if (!PATTERN.matches(text)) return null
        return IsoTime.parseMillis(text.substring(0, text.indexOf('#')))
    }

    fun format(value: HlcValue): String {
        require(value.counter in 0..MAX_COUNTER) { "HLC counter out of range: ${value.counter}" }
        val iso = IsoTime.format(value.time)
        require(iso.length == ISO_LENGTH) { "HLC time out of range: ${value.time}" }
        return "$iso#${value.counter.toString().padStart(COUNTER_DIGITS, '0')}"
    }

    fun parse(text: String): HlcValue {
        val time = timeOf(text) ?: throw HlcFormatException(text)
        return HlcValue(time, text.substring(text.indexOf('#') + 1).toInt())
    }

    fun isHlc(text: String): Boolean = timeOf(text) != null

    /** The time of an HLC text in ms. The merge reads only valid events, so the HLC is valid. */
    fun millis(text: String): Long = timeOf(text) ?: throw HlcFormatException(text)

    /** The time of an HLC text as an ISO 8601 text, for example the `since` of a pause. */
    fun iso(text: String): String = IsoTime.format(millis(text))

    private const val ISO_LENGTH = 24
    private const val COUNTER_DIGITS = 4
}

/** The HLC of one device. It keeps its value above each HLC that it made or read. */
class HybridLogicalClock(
    private val source: TimeSource,
    last: String? = null,
) {
    private var last: HlcValue? = last?.let { Hlc.parse(it) }

    /** The last HLC that this clock made or read, or null. */
    fun peek(): String? = last?.let { Hlc.format(it) }

    /** Makes the HLC of a new local event. */
    fun now(): String {
        val physical = source.now()
        val old = last
        val next =
            when {
                old == null || physical > old.time -> HlcValue(physical, 0)

                old.counter < Hlc.MAX_COUNTER -> HlcValue(old.time, old.counter + 1)

                // The counter is full: move the time part 1 ms forward, so the text stays sortable.
                else -> HlcValue(old.time + 1, 0)
            }
        last = next
        return Hlc.format(next)
    }

    /** Reads the HLC of an event of another device. The next `now()` is greater than it. */
    fun observe(remote: String) {
        val value = Hlc.parse(remote)
        val old = last
        last =
            when {
                old == null -> value
                old.time != value.time -> if (old.time > value.time) old else value
                else -> if (old.counter >= value.counter) old else value
            }
    }

    /** Reads a remote HLC and makes the HLC of the local event that answers it. */
    fun receive(remote: String): String {
        observe(remote)
        return now()
    }
}
