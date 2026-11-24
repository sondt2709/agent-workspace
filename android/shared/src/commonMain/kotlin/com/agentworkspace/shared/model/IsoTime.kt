package com.agentworkspace.shared.model

/**
 * UTC times as ISO 8601 texts with ms, the same as JavaScript `Date.toISOString()` and the round
 * trip check of `hlcTimeOf` (shared/schema/src/common.ts). The proleptic Gregorian calendar of
 * JavaScript, for the years 0 to 9999. The calendar arithmetic uses the numbers of the Gregorian
 * calendar (days per era, month lengths), so the object suppresses MagicNumber.
 */
@Suppress("MagicNumber")
object IsoTime {
    private val ISO = Regex("^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})\\.(\\d{3})Z\\z")
    private const val MS_PER_SECOND = 1000L
    private const val SECONDS_PER_MINUTE = 60L
    private const val MINUTES_PER_HOUR = 60L
    private const val HOURS_PER_DAY = 24L
    private const val MS_PER_DAY = MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY
    private const val MONTHS = 12
    private const val LAST_YEAR = 9999

    /** The ms of an ISO text `YYYY-MM-DDTHH:MM:SS.sssZ`, or null when the date or the time is not real. */
    fun parseMillis(text: String): Long? {
        val match = ISO.matchEntire(text) ?: return null
        val parts = match.groupValues.drop(1).map { it.toLong() }
        val (year, month, day) = parts.take(3).map { it.toInt() }
        val (h, mi, s) = parts.subList(3, 6)
        val ms = parts[6]
        val valid =
            month in 1..MONTHS &&
                day in 1..daysInMonth(year, month) &&
                h < HOURS_PER_DAY &&
                mi < MINUTES_PER_HOUR &&
                s < SECONDS_PER_MINUTE
        if (!valid) return null
        val days = daysFromCivil(year, month, day)
        return days * MS_PER_DAY +
            ((h * MINUTES_PER_HOUR + mi) * SECONDS_PER_MINUTE + s) * MS_PER_SECOND +
            ms
    }

    /** `Date.toISOString()` of a time in ms. A year outside 0 to 9999 has another length. */
    fun format(millis: Long): String {
        val days = millis.floorDiv(MS_PER_DAY)
        var rest = millis.mod(MS_PER_DAY)
        val ms = rest % MS_PER_SECOND
        rest /= MS_PER_SECOND
        val second = rest % SECONDS_PER_MINUTE
        rest /= SECONDS_PER_MINUTE
        val minute = rest % MINUTES_PER_HOUR
        val hour = rest / MINUTES_PER_HOUR
        val (year, month, day) = civilFromDays(days)
        val yearText = if (year in 0..LAST_YEAR) year.toString().padStart(4, '0') else year.toString()
        return "$yearText-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}:${two(second)}." +
            "${ms.toString().padStart(3, '0')}Z"
    }

    private fun two(value: Number): String = value.toString().padStart(2, '0')

    private fun isLeap(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0

    private fun daysInMonth(
        year: Int,
        month: Int,
    ): Int =
        when (month) {
            2 -> if (isLeap(year)) 29 else 28
            4, 6, 9, 11 -> 30
            else -> 31
        }

    // The civil date algorithms of H. Hinnant (public domain): days since 1970-01-01.
    private fun daysFromCivil(
        year: Int,
        month: Int,
        day: Int,
    ): Long {
        val y = (if (month <= 2) year - 1 else year).toLong()
        val era = y.floorDiv(400L)
        val yoe = y - era * 400
        val mp = (month + 9) % 12
        val doy = (153 * mp + 2) / 5 + day - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    private fun civilFromDays(days: Long): Triple<Long, Int, Int> {
        val z = days + 719468
        val era = z.floorDiv(146097L)
        val doe = z - era * 146097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val day = (doy - (153 * mp + 2) / 5 + 1).toInt()
        val month = (if (mp < 10) mp + 3 else mp - 9).toInt()
        val year = yoe + era * 400 + (if (month <= 2) 1 else 0)
        return Triple(year, month, day)
    }
}
