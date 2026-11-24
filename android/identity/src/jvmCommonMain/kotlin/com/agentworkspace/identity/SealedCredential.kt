package com.agentworkspace.identity

import java.nio.CharBuffer
import java.util.Locale

/**
 * The content of a phone outbox file (`sealCredential()` of shared/identity/src/seal.ts,
 * docs/phase-1.md 10.2): the UTF-8 bytes of `{"kind":"sealed-credential","v":1,"name":…,"value":…}`,
 * the text of `JSON.stringify` with this key order.
 */
object SealedCredential {
    private const val SPACE = 0x20

    /**
     * Builds the content from the value characters. The value never becomes a `String`, and each
     * buffer of the value is cleared; the caller clears [value] and the result.
     */
    @Suppress("CyclomaticComplexMethod")
    fun content(
        name: String,
        value: CharArray,
    ): ByteArray {
        val head = StringBuilder("{\"kind\":\"sealed-credential\",\"v\":1,\"name\":")
        CanonicalJson.quote(head, name)
        head.append(",\"value\":\"")
        val chars = CharBuffers(head.length + value.size * 2 + 2)
        head.forEach(chars::add)
        var i = 0
        while (i < value.size) {
            val c = value[i]
            when {
                c == '"' -> {
                    chars.add('\\', '"')
                }

                c == '\\' -> {
                    chars.add('\\', '\\')
                }

                c == '\b' -> {
                    chars.add('\\', 'b')
                }

                c == '\u000C' -> {
                    chars.add('\\', 'f')
                }

                c == '\n' -> {
                    chars.add('\\', 'n')
                }

                c == '\r' -> {
                    chars.add('\\', 'r')
                }

                c == '\t' -> {
                    chars.add('\\', 't')
                }

                c.code < SPACE || (c.isSurrogate() && !pairAt(value, i)) -> {
                    String.format(Locale.ROOT, "\\u%04x", c.code).forEach(chars::add)
                }

                c.isHighSurrogate() -> {
                    chars.add(c, value[i + 1])
                    i += 1
                }

                else -> {
                    chars.add(c)
                }
            }
            i += 1
        }
        chars.add('"', '}')
        return chars.toUtf8AndClear()
    }

    private fun pairAt(
        value: CharArray,
        i: Int,
    ): Boolean = value[i].isHighSurrogate() && i + 1 < value.size && value[i + 1].isLowSurrogate()

    /** A growable char buffer that clears each old array. */
    private class CharBuffers(
        size: Int,
    ) {
        private var data = CharArray(size)
        private var length = 0

        fun add(vararg cs: Char) {
            for (c in cs) {
                if (length == data.size) {
                    val bigger = data.copyOf(data.size * 2)
                    data.fill('\u0000')
                    data = bigger
                }
                data[length++] = c
            }
        }

        fun toUtf8AndClear(): ByteArray {
            val buffer = Charsets.UTF_8.newEncoder().encode(CharBuffer.wrap(data, 0, length))
            val out = ByteArray(buffer.remaining()).also(buffer::get)
            if (buffer.hasArray()) buffer.array().fill(0)
            data.fill('\u0000')
            return out
        }
    }
}
