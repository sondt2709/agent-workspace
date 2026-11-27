package com.agentworkspace.schema

import com.agentworkspace.shared.model.Hlc
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialInfo

/**
 * A field that may be absent but not null: a zod `.optional()` with no default. The generated classes
 * put it on such a field; `JsonTypes.check` refuses a JSON null for it, as zod does.
 */
@OptIn(ExperimentalSerializationApi::class)
@SerialInfo
@Target(AnnotationTarget.PROPERTY)
annotation class AwOptional

/** A value that breaks its schema. The message names the field and the check. */
class SchemaViolation(
    val field: String,
    message: String,
) : IllegalArgumentException(message)

/**
 * The checks that the generated classes of `android/shared/generated/kotlin` run in their `init`
 * blocks (shared/schema/scripts/kotlin.ts). A decode with kotlinx.serialization runs `init`, so a
 * decode is also the validation.
 */
object AwChecks {
    private fun fail(
        field: String,
        message: String,
    ): Nothing = throw SchemaViolation(field, "$field: $message")

    fun equal(
        value: Any,
        expected: Any,
        field: String,
    ) {
        if (value != expected) fail(field, "expected $expected, found $value")
    }

    fun oneOf(
        value: String,
        values: Set<String>,
        field: String,
    ) {
        if (value !in values) fail(field, "expected one of ${values.joinToString(", ")}, found \"$value\"")
    }

    fun pattern(
        value: String,
        regex: Regex,
        field: String,
    ) {
        if (!regex.containsMatchIn(value)) fail(field, "\"$value\" does not match the pattern ${regex.pattern}")
    }

    fun minLength(
        value: String,
        min: Int,
        field: String,
    ) {
        if (value.length < min) fail(field, "use at least $min characters")
    }

    fun maxLength(
        value: String,
        max: Int,
        field: String,
    ) {
        if (value.length > max) fail(field, "use at most $max characters")
    }

    fun minItems(
        value: Collection<*>,
        min: Int,
        field: String,
    ) {
        if (value.size < min) fail(field, "use at least $min items")
    }

    fun maxItems(
        value: Collection<*>,
        max: Int,
        field: String,
    ) {
        if (value.size > max) fail(field, "use at most $max items")
    }

    fun atLeast(
        value: Long,
        min: Long,
        field: String,
    ) {
        if (value < min) fail(field, "expected $min or more, found $value")
    }

    fun atMost(
        value: Long,
        max: Long,
        field: String,
    ) {
        if (value > max) fail(field, "expected $max or less, found $value")
    }

    fun atLeast(
        value: Double,
        min: Double,
        field: String,
    ) {
        if (value < min) fail(field, "expected $min or more, found $value")
    }

    fun atMost(
        value: Double,
        max: Double,
        field: String,
    ) {
        if (value > max) fail(field, "expected $max or less, found $value")
    }

    /** `x-aw-check: hlc`: a real UTC date and time (the zod refine of `hlcText`). */
    fun hlc(
        value: String,
        field: String,
    ) {
        if (Hlc.timeOf(value) == null) fail(field, "use a real UTC date and time")
    }

    /** `x-aw-check: relative-path`: a relative path with no `..`, `.` or empty part. */
    fun relativePath(
        value: String,
        field: String,
    ) {
        val ok =
            !value.startsWith("/") &&
                !value.contains('\\') &&
                value.split("/").all { it != ".." && it != "" && it != "." }
        if (!ok) fail(field, "use a relative path with no '..', '.' or empty part")
    }
}
