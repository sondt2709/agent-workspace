package com.agentworkspace.shared.model

/**
 * The syntax check of one JSON text with the error texts of V8 `JSON.parse` (Node 24), so that the
 * `bad_line` issues of awd and of the phone are equal (design decision 6 of the openspec change
 * add-android-shared-model). The reader parses with kotlinx.serialization; this scanner only finds
 * the first syntax error and names it. The texts were captured from Node 24.22.3.
 *
 * The position is the UTF-16 index, like V8. The column is the position plus 1: the reader checks
 * one line at a time (`(line 1 column N)` of V8 is `(column N)` in the issue).
 */
object JsonSyntax {
    /**
     * The deepest nesting of objects and arrays in one line, as `MAX_LINE_DEPTH` of
     * shared/core/src/files/logs.ts: a deeper valid line is a bad line with the same message.
     */
    const val MAX_DEPTH = 64

    /**
     * The V8 error text of the first syntax error of the text, or the message of a line nested deeper
     * than MAX_DEPTH, or null when the text is valid JSON within the limit.
     */
    fun error(text: String): String? =
        try {
            val deepest = Scanner(text).run()
            if (deepest > MAX_DEPTH) "JSON nesting is deeper than $MAX_DEPTH levels" else null
        } catch (e: JsonSyntaxError) {
            e.message
        }

    private class JsonSyntaxError(
        message: String,
    ) : Exception(message)

    private const val CONTEXT = 10
    private const val SHORT_TEXT = CONTEXT * 2 + 1
    private const val HEX_DIGITS = 4
    private const val FIRST_PRINTABLE = 0x20

    @Suppress("TooManyFunctions")
    private class Scanner(
        val text: String,
    ) {
        var pos = 0

        /** The deepest nesting so far: 1 for `{}` or `[1]`. */
        var deepest = 0

        /** Scans the text and gives the deepest nesting. */
        fun run(): Int {
            skipSpace()
            value()
            skipSpace()
            if (pos < text.length) {
                throw JsonSyntaxError(
                    "Unexpected non-whitespace character after JSON at position $pos (column ${pos + 1})",
                )
            }
            return deepest
        }

        fun at(reason: String): Nothing = throw JsonSyntaxError("$reason in JSON at position $pos (column ${pos + 1})")

        fun end(): Nothing = throw JsonSyntaxError("Unexpected end of JSON input")

        fun unexpected(): Nothing {
            if (pos >= text.length) end()
            val token = text[pos]
            val context =
                when {
                    text.length <= SHORT_TEXT -> "\"$text\""
                    pos < CONTEXT -> "\"${text.substring(0, pos + CONTEXT)}\"..."
                    pos >= text.length - CONTEXT -> "...\"${text.substring(pos - CONTEXT)}\""
                    else -> "...\"${text.substring(pos - CONTEXT, pos + CONTEXT)}\"..."
                }
            throw JsonSyntaxError("Unexpected token '$token', $context is not valid JSON")
        }

        fun skipSpace() {
            while (pos < text.length && text[pos] in " \t\n\r") pos++
        }

        fun peek(): Char? = text.getOrNull(pos)

        /**
         * Scans one value. A loop with its own stack of open objects and arrays, not a recursion: V8
         * `JSON.parse` has no depth limit, and a line with very deep nesting must not overflow the
         * thread stack (a broken or hostile device can write one).
         */
        fun value() {
            // true: an open object, false: an open array.
            val open = ArrayList<Boolean>()
            var needValue = startValue(open)
            while (needValue || open.isNotEmpty()) {
                needValue = if (needValue) startValue(open) else afterValue(open)
            }
        }

        /** Reads the start of a value: true when it opens an object or an array with content. */
        fun startValue(open: ArrayList<Boolean>): Boolean =
            when (peek()) {
                null -> {
                    end()
                }

                '{' -> {
                    openObject(open)
                }

                '[' -> {
                    openArray(open)
                }

                else -> {
                    scalar()
                    false
                }
            }

        fun openObject(open: ArrayList<Boolean>): Boolean {
            pos++
            deepest = maxOf(deepest, open.size + 1)
            skipSpace()
            if (peek() == '}') {
                pos++
                return false
            }
            if (peek() != '"') at("Expected property name or '}'")
            propertyName()
            open.add(true)
            return true
        }

        fun openArray(open: ArrayList<Boolean>): Boolean {
            pos++
            deepest = maxOf(deepest, open.size + 1)
            skipSpace()
            if (peek() == ']') {
                pos++
                return false
            }
            open.add(false)
            return true
        }

        /** After a value in an open object or array: true when the next value follows. */
        fun afterValue(open: ArrayList<Boolean>): Boolean {
            skipSpace()
            return if (open[open.lastIndex]) afterProperty(open) else afterElement(open)
        }

        /** Reads a property name, the colon and the space before the value. */
        fun propertyName() {
            string()
            skipSpace()
            if (peek() != ':') at("Expected ':' after property name")
            pos++
            skipSpace()
        }

        /** After a property value: true when the next property value follows. */
        fun afterProperty(open: ArrayList<Boolean>): Boolean =
            when (peek()) {
                ',' -> {
                    pos++
                    skipSpace()
                    if (peek() != '"') at("Expected double-quoted property name")
                    propertyName()
                    true
                }

                '}' -> {
                    pos++
                    open.removeAt(open.lastIndex)
                    false
                }

                else -> {
                    at("Expected ',' or '}' after property value")
                }
            }

        /** After an array element: true when the next element follows. */
        fun afterElement(open: ArrayList<Boolean>): Boolean =
            when (peek()) {
                ',' -> {
                    pos++
                    skipSpace()
                    true
                }

                ']' -> {
                    pos++
                    open.removeAt(open.lastIndex)
                    false
                }

                else -> {
                    at("Expected ',' or ']' after array element")
                }
            }

        fun scalar() {
            when (peek()) {
                '"' -> string()
                't' -> literal("true")
                'f' -> literal("false")
                'n' -> literal("null")
                else -> if (peek() == '-' || peek()?.isAsciiDigit() == true) number() else unexpected()
            }
        }

        fun literal(word: String) {
            for (c in word) {
                if (pos >= text.length) end()
                if (text[pos] != c) unexpected()
                pos++
            }
        }

        fun string() {
            pos++
            while (true) {
                if (pos >= text.length) at("Unterminated string")
                val c = text[pos]
                when {
                    c == '"' -> {
                        pos++
                        return
                    }

                    c == '\\' -> {
                        escape()
                    }

                    c.code < FIRST_PRINTABLE -> {
                        at("Bad control character in string literal")
                    }

                    else -> {
                        pos++
                    }
                }
            }
        }

        fun escape() {
            pos++
            if (pos >= text.length) end()
            when (text[pos]) {
                '"', '\\', '/', 'b', 'f', 'n', 'r', 't' -> {
                    pos++
                }

                'u' -> {
                    pos++
                    repeat(HEX_DIGITS) {
                        if (pos >= text.length || !text[pos].isHex()) at("Bad Unicode escape")
                        pos++
                    }
                }

                else -> {
                    at("Bad escaped character")
                }
            }
        }

        fun number() {
            if (peek() == '-') {
                pos++
                if (peek()?.isAsciiDigit() != true) at("No number after minus sign")
            }
            if (peek() == '0') {
                pos++
                if (peek()?.isAsciiDigit() == true) at("Unexpected number")
            } else {
                digits()
            }
            if (peek() == '.') {
                pos++
                if (peek()?.isAsciiDigit() != true) at("Unterminated fractional number")
                digits()
            }
            if (peek() == 'e' || peek() == 'E') {
                pos++
                if (peek() == '+' || peek() == '-') pos++
                if (peek()?.isAsciiDigit() != true) at("Exponent part is missing a number")
                digits()
            }
        }

        fun digits() {
            while (peek()?.isAsciiDigit() == true) pos++
        }

        fun Char.isAsciiDigit(): Boolean = this in '0'..'9'

        fun Char.isHex(): Boolean = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'
    }
}
