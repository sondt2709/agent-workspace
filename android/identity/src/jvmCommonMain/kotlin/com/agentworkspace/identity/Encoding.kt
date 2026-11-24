// The bit widths and masks of base64, hex and Bech32 are the numbers of their specifications.
@file:Suppress("MagicNumber")

package com.agentworkspace.identity

import java.util.Base64
import java.util.Locale

/** The byte encodings of `shared/identity/src/encoding.ts`. */
object Encoding {
    private val base64Pattern = Regex("^(?:[0-9a-zA-Z+/]{4})*(?:[0-9a-zA-Z+/]{2}==|[0-9a-zA-Z+/]{3}=)?$")
    private val base64UrlPattern = Regex("^[A-Za-z0-9_-]*$")

    fun utf8(text: String): ByteArray = text.encodeToByteArray()

    fun toBase64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    /** Decodes padded standard base64 (the `z.base64()` form); null for any other text. */
    fun fromBase64OrNull(text: String): ByteArray? =
        if (base64Pattern.matches(text)) runCatching { Base64.getDecoder().decode(text) }.getOrNull() else null

    fun fromBase64(text: String): ByteArray =
        requireNotNull(fromBase64OrNull(text)) { "The text is not standard base64 with padding" }

    fun toBase64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    /** Decodes base64url with no padding; null for any other text. */
    fun fromBase64UrlOrNull(text: String): ByteArray? =
        if (base64UrlPattern.matches(text) && text.length % 4 != 1) {
            runCatching { Base64.getUrlDecoder().decode(text) }.getOrNull()
        } else {
            null
        }

    /** RFC 4648 base32 with no padding, in lower case (`toBase32Lower`). */
    fun toBase32Lower(bytes: ByteArray): String {
        val out = StringBuilder()
        var buffer = 0
        var bits = 0
        for (b in bytes) {
            buffer = (buffer shl 8) or (b.toInt() and 0xff)
            bits += 8
            while (bits >= 5) {
                out.append(BASE32[(buffer shr (bits - 5)) and 0x1f])
                bits -= 5
            }
        }
        if (bits > 0) out.append(BASE32[(buffer shl (5 - bits)) and 0x1f])
        return out.toString()
    }

    fun toHex(bytes: ByteArray): String =
        bytes.joinToString("") { String.format(Locale.ROOT, "%02x", it.toInt() and 0xff) }

    fun fromHex(text: String): ByteArray {
        require(
            text.length % 2 == 0 && text.all { it in '0'..'9' || it in 'a'..'f' },
        ) { "The text is not lower-case hex" }
        return ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(HEX_RADIX).toByte() }
    }

    /** True when 2 byte arrays are equal, in a time that does not depend on the first difference. */
    fun equalBytes(
        a: ByteArray,
        b: ByteArray,
    ): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }

    private const val HEX_RADIX = 16
    private const val BASE32 = "abcdefghijklmnopqrstuvwxyz234567"
}

/** A Bech32 text that is not valid (BIP-173, the encoding of the age keys). */
class Bech32Exception(
    message: String,
) : IllegalArgumentException(message)

/**
 * Bech32 (BIP-173, not Bech32m) for the age recipient `age1…` and the age identity
 * `AGE-SECRET-KEY-1…`. The age keys are shorter than the 90-character limit of BIP-173.
 */
object Bech32 {
    private const val CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    private val GENERATOR = intArrayOf(0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)
    private const val CHECKSUM_LENGTH = 6
    private const val MAX_LENGTH = 90
    private const val FIVE_BITS = 5
    private const val BYTE_BITS = 8

    data class Decoded(
        val hrp: String,
        val bytes: ByteArray,
    )

    private fun polymod(values: IntArray): Int {
        var chk = 1
        for (v in values) {
            val top = chk ushr 25
            chk = ((chk and 0x1ffffff) shl FIVE_BITS) xor v
            for (i in GENERATOR.indices) if ((top ushr i) and 1 == 1) chk = chk xor GENERATOR[i]
        }
        return chk
    }

    private fun hrpExpand(hrp: String): IntArray =
        IntArray(hrp.length * 2 + 1).also { out ->
            hrp.forEachIndexed { i, c ->
                out[i] = c.code ushr FIVE_BITS
                out[i + hrp.length + 1] = c.code and 31
            }
        }

    private fun convertBits(
        data: ByteArray,
        from: Int,
        to: Int,
        pad: Boolean,
    ): ByteArray {
        var acc = 0
        var bits = 0
        val out = ArrayList<Byte>()
        val max = (1 shl to) - 1
        for (b in data) {
            val value = b.toInt() and 0xff
            if (value ushr from != 0) throw Bech32Exception("A value is out of range")
            acc = (acc shl from) or value
            bits += from
            while (bits >= to) {
                bits -= to
                out.add(((acc ushr bits) and max).toByte())
            }
        }
        if (pad) {
            if (bits > 0) out.add(((acc shl (to - bits)) and max).toByte())
        } else if (bits >= from || ((acc shl (to - bits)) and max) != 0) {
            throw Bech32Exception("The padding is not valid")
        }
        return out.toByteArray()
    }

    /** Encodes bytes with a human-readable part, in lower case. */
    fun encode(
        hrp: String,
        bytes: ByteArray,
    ): String {
        val data = convertBits(bytes, BYTE_BITS, FIVE_BITS, true).map { it.toInt() }.toIntArray()
        val values = hrpExpand(hrp) + data + IntArray(CHECKSUM_LENGTH)
        val mod = polymod(values) xor 1
        val checksum = IntArray(CHECKSUM_LENGTH) { (mod ushr (FIVE_BITS * (CHECKSUM_LENGTH - 1 - it))) and 31 }
        return hrp + "1" + (data + checksum).joinToString("") { CHARSET[it].toString() }
    }

    /** Decodes a Bech32 text in one case (all lower or all upper); the result part is in lower case. */
    @Suppress("ThrowsCount")
    fun decode(text: String): Decoded {
        if (text.length > MAX_LENGTH) throw Bech32Exception("The text is too long")
        if (text != text.lowercase() && text != text.uppercase()) throw Bech32Exception("The text has mixed case")
        val lower = text.lowercase()
        val sep = lower.lastIndexOf('1')
        if (sep < 1 || sep + CHECKSUM_LENGTH + 1 > lower.length) throw Bech32Exception("No separator")
        val hrp = lower.substring(0, sep)
        if (hrp.any { it.code !in 33..126 }) throw Bech32Exception("The prefix is not valid")
        val data =
            lower.substring(sep + 1).map { c ->
                CHARSET.indexOf(c).also { if (it < 0) throw Bech32Exception("The character $c is not valid") }
            }
        if (polymod(hrpExpand(hrp) + data.toIntArray()) != 1) throw Bech32Exception("The checksum is not valid")
        val words = data.dropLast(CHECKSUM_LENGTH).map { it.toByte() }.toByteArray()
        return Decoded(hrp, convertBits(words, FIVE_BITS, BYTE_BITS, false))
    }
}
