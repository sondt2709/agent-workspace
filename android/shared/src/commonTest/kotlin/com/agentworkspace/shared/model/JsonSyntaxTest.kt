package com.agentworkspace.shared.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The texts of V8 `JSON.parse` errors. Captured from Node 24.22.3 on 2026-11-23 with
 * `JSON.parse(text)`; V8 writes `(line 1 column N)`, the issue writes `(column N)`.
 */
class JsonSyntaxTest {
    private val cases =
        listOf(
            "{\"a\":\"abc" to "Unterminated string in JSON at position 9 (column 10)",
            "{\"a\":" to "Unexpected end of JSON input",
            "" to "Unexpected end of JSON input",
            "   " to "Unexpected end of JSON input",
            "not json at all" to "Unexpected token 'o', \"not json at all\" is not valid JSON",
            "{\"a\":1,}" to "Expected double-quoted property name in JSON at position 7 (column 8)",
            "{\"a\" 1}" to "Expected ':' after property name in JSON at position 5 (column 6)",
            "{a:1}" to "Expected property name or '}' in JSON at position 1 (column 2)",
            "[1,2" to "Expected ',' or ']' after array element in JSON at position 4 (column 5)",
            "{\"a\":1 \"b\":2}" to "Expected ',' or '}' after property value in JSON at position 7 (column 8)",
            "{\"a\":\"x\ty\"}" to "Bad control character in string literal in JSON at position 7 (column 8)",
            "{\"a\":\"\\q\"}" to "Bad escaped character in JSON at position 7 (column 8)",
            "{\"a\":1} x" to "Unexpected non-whitespace character after JSON at position 8 (column 9)",
            "{\"a\":-}" to "No number after minus sign in JSON at position 6 (column 7)",
            "{\"a\":1.}" to "Unterminated fractional number in JSON at position 7 (column 8)",
            "{\"a\":1e}" to "Exponent part is missing a number in JSON at position 7 (column 8)",
            "{\"a\":tru}" to "Unexpected token '}', \"{\"a\":tru}\" is not valid JSON",
            "{\"a\":01}" to "Unexpected number in JSON at position 6 (column 7)",
            "{\"a\":\"\\u12\"}" to "Bad Unicode escape in JSON at position 10 (column 11)",
            "{\"a\":[1,]}" to "Unexpected token ']', \"{\"a\":[1,]}\" is not valid JSON",
            "{\"a\":1," to "Expected double-quoted property name in JSON at position 7 (column 8)",
            "[1," to "Unexpected end of JSON input",
            "\"a\\" to "Unexpected end of JSON input",
            "1e+" to "Exponent part is missing a number in JSON at position 3 (column 4)",
            "not json at all, really not at all" to "Unexpected token 'o', \"not json at\"... is not valid JSON",
            "{\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\":x}" to
                "Unexpected token 'x', ...\"aaaaaaaa\":x}\" is not valid JSON",
            "{\"${"a".repeat(47)}\":1, \"${"b".repeat(47)}\":x, \"${"c".repeat(34)}\":2}" to
                "Unexpected token 'x', ...\"bbbbbbbb\":x, \"cccccc\"... is not valid JSON",
            "{\"é\":\"x" to "Unterminated string in JSON at position 7 (column 8)",
        )

    @Test
    fun givesTheV8TextOfEachError() {
        for ((text, message) in cases) assertEquals(message, JsonSyntax.error(text), text)
    }

    @Test
    fun scansDeepNestingWithNoRecursion() {
        // V8 has no depth limit: an unclosed deep line is the end of the input, a closed one is valid.
        val depth = 200_000
        val tooDeep = "JSON nesting is deeper than 64 levels"
        assertEquals("Unexpected end of JSON input", JsonSyntax.error("[".repeat(depth)))
        assertEquals(tooDeep, JsonSyntax.error("[".repeat(depth) + "]".repeat(depth)))
        assertEquals(tooDeep, JsonSyntax.error("{\"a\":".repeat(depth) + "1" + "}".repeat(depth)))
        assertEquals(
            "Expected ',' or '}' after property value in JSON at position ${depth * 5 + 1} (column ${depth * 5 + 2})",
            JsonSyntax.error("{\"a\":".repeat(depth) + "1]"),
        )
    }

    @Test
    fun refusesALineNestedDeeperThan64Levels() {
        // The same limit and message as MAX_LINE_DEPTH of the TypeScript log reader. Empty values count.
        assertNull(JsonSyntax.error("[".repeat(64) + "]".repeat(64)))
        assertNull(JsonSyntax.error("{\"a\":".repeat(63) + "{}" + "}".repeat(63)))
        assertEquals("JSON nesting is deeper than 64 levels", JsonSyntax.error("[".repeat(65) + "]".repeat(65)))
        assertEquals(
            "JSON nesting is deeper than 64 levels",
            JsonSyntax.error("{\"a\":".repeat(64) + "{}" + "}".repeat(64)),
        )
    }

    @Test
    fun acceptsValidJson() {
        for (text in listOf("{\"a\":1.5e3}", "{\"a\":\"\\/\\u00e9\"}", "{} ", "[true,false,null,-0.5]", "\"x\"")) {
            assertNull(JsonSyntax.error(text), text)
        }
    }
}
