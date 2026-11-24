package com.agentworkspace.identity

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.math.BigDecimal
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/**
 * Canonical JSON (`canonicalJson()` of shared/identity/src/encoding.ts): object keys sorted by UTF-16
 * code unit, no spaces, arrays in order, and the string and number forms of `JSON.stringify`. The
 * signatures of the device records and of the pairing request cover these bytes, so each device must
 * make the same text.
 */
object CanonicalJson {
    fun of(value: JsonElement): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(
        out: StringBuilder,
        value: JsonElement,
    ) {
        when (value) {
            is JsonNull -> {
                out.append("null")
            }

            is JsonPrimitive -> {
                if (value.isString) quote(out, value.content) else out.append(number(value.content))
            }

            is JsonArray -> {
                out.append('[')
                value.forEachIndexed { i, item ->
                    if (i > 0) out.append(',')
                    write(out, item)
                }
                out.append(']')
            }

            is JsonObject -> {
                out.append('{')
                // String.compareTo compares UTF-16 code units, like the sort of the TypeScript code.
                value.keys.sorted().forEachIndexed { i, key ->
                    if (i > 0) out.append(',')
                    quote(out, key)
                    out.append(':')
                    write(out, value.getValue(key))
                }
                out.append('}')
            }
        }
    }

    /** A string as `JSON.stringify` writes it (well-formed: a lone surrogate is escaped). */
    @Suppress("CyclomaticComplexMethod")
    fun quote(
        out: StringBuilder,
        text: String,
    ) {
        out.append('"')
        var i = 0
        while (i < text.length) {
            val c = text[i]
            when {
                c == '"' -> {
                    out.append("\\\"")
                }

                c == '\\' -> {
                    out.append("\\\\")
                }

                c == '\b' -> {
                    out.append("\\b")
                }

                c == '\u000C' -> {
                    out.append("\\f")
                }

                c == '\n' -> {
                    out.append("\\n")
                }

                c == '\r' -> {
                    out.append("\\r")
                }

                c == '\t' -> {
                    out.append("\\t")
                }

                c.code < SPACE -> {
                    escape(out, c)
                }

                c.isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate() -> {
                    out.append(c).append(text[i + 1])
                    i += 1
                }

                c.isSurrogate() -> {
                    escape(out, c)
                }

                else -> {
                    out.append(c)
                }
            }
            i += 1
        }
        out.append('"')
    }

    private fun escape(
        out: StringBuilder,
        c: Char,
    ) {
        out.append("\\u").append(String.format(Locale.ROOT, "%04x", c.code))
    }

    private val INTEGER = Regex("^-?(?:0|[1-9][0-9]*)$")

    /** A number as `JSON.stringify` writes it: an integral value has no fraction. */
    private fun number(text: String): String {
        if (text == "true" || text == "false") return text
        if (INTEGER.matches(text)) return text
        val value = text.toDouble()
        require(value.isFinite()) { "A canonical JSON number must be finite" }
        if (value == 0.0) return "0"
        val magnitude = abs(value)
        if (value == floor(value) && magnitude < MAX_PLAIN) return BigDecimal(value).toPlainString()
        val decimal = BigDecimal(value.toString()).stripTrailingZeros()
        if (magnitude >= MIN_PLAIN && magnitude < MAX_PLAIN) return decimal.toPlainString()
        // The exponent form of JavaScript: 1.5e-7, 1e+21.
        val digits = decimal.unscaledValue().abs().toString()
        val exponent = digits.length - 1 - decimal.scale()
        val mantissa = if (digits.length == 1) digits else digits[0] + "." + digits.substring(1)
        val sign = if (value < 0) "-" else ""
        return sign + mantissa + "e" + (if (exponent >= 0) "+" else "-") + abs(exponent)
    }

    private const val SPACE = 0x20
    private const val MAX_PLAIN = 1e21
    private const val MIN_PLAIN = 1e-6
}
