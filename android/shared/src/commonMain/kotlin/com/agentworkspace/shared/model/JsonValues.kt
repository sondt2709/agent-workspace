package com.agentworkspace.shared.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** The largest integer that a JavaScript number holds exactly (`Number.MAX_SAFE_INTEGER`). */
const val MAX_SAFE_INTEGER: Long = 9007199254740991L

/**
 * True when the text has only the white space of JavaScript `String.prototype.trim`: the log readers
 * skip such a line (`text.trim() === ""` in TypeScript). Kotlin `isBlank` differs: it does not skip
 * U+FEFF, and it skips U+001C to U+001F.
 */
fun isJsBlank(text: String): Boolean = text.all { it.isJsSpace() }

private const val JS_SPACES = "\t\n\u000b\u000c\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff"

/** ECMAScript WhiteSpace and LineTerminator: the characters above, and U+2000 to U+200A. */
private fun Char.isJsSpace(): Boolean = this in JS_SPACES || this in '\u2000'..'\u200a'

/** The JSON settings of the files: unknown keys are kept by the reader, defaults are written. */
val AwJson: Json =
    Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

/**
 * The value of a loose object (a zod `looseObject`): the encoded typed value with its defaults, plus
 * each key of the raw value that the typed class does not know, at each object level.
 */
fun withUnknownKeys(
    typed: JsonElement,
    raw: JsonElement,
): JsonElement =
    when {
        typed is JsonObject && raw is JsonObject -> {
            val out = LinkedHashMap<String, JsonElement>()
            for ((key, value) in typed) out[key] = raw[key]?.let { withUnknownKeys(value, it) } ?: value
            for ((key, value) in raw) if (key !in typed) out[key] = value
            JsonObject(out)
        }

        typed is JsonArray && raw is JsonArray && typed.size == raw.size -> {
            JsonArray(typed.mapIndexed { index, value -> withUnknownKeys(value, raw[index]) })
        }

        else -> {
            typed
        }
    }
