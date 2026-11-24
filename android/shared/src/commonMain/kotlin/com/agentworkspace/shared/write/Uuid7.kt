package com.agentworkspace.shared.write

import kotlin.random.Random

/** UUIDv7 ids (RFC 9562): 48 bits of Unix time in ms, the version 7, the variant, 74 random bits. */
object Uuid7 {
    private const val HEX = "0123456789abcdef"
    private const val BYTES = 16
    private const val TIME_BYTES = 6
    private const val BYTE_MASK = 0xff
    private const val LOW_NIBBLE = 0x0f
    private const val VERSION = 0x70
    private const val VARIANT_MASK = 0x3f
    private const val VARIANT = 0x80
    private const val BITS_PER_BYTE = 8
    private const val NIBBLE_BITS = 4
    private val DASHES = setOf(4, 6, 8, 10)

    fun next(
        millis: Long,
        random: Random = Random.Default,
    ): String {
        val bytes = random.nextBytes(BYTES)
        for (i in 0 until TIME_BYTES) {
            bytes[i] = (millis shr (BITS_PER_BYTE * (TIME_BYTES - 1 - i))).toByte()
        }
        bytes[TIME_BYTES] = ((bytes[TIME_BYTES].toInt() and LOW_NIBBLE) or VERSION).toByte()
        bytes[TIME_BYTES + 2] = ((bytes[TIME_BYTES + 2].toInt() and VARIANT_MASK) or VARIANT).toByte()
        val out = StringBuilder()
        bytes.forEachIndexed { index, byte ->
            if (index in DASHES) out.append('-')
            val value = byte.toInt() and BYTE_MASK
            out.append(HEX[value shr NIBBLE_BITS]).append(HEX[value and LOW_NIBBLE])
        }
        return out.toString()
    }
}
