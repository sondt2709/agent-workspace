@file:OptIn(ExperimentalSerializationApi::class)

package com.agentworkspace.shared.model

import com.agentworkspace.schema.AwOptional
import com.agentworkspace.schema.SchemaViolation
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs
import kotlin.math.floor

/**
 * The JSON type check before a decode. kotlinx.serialization reads the text "2" as the number 2 and
 * a number as a text; zod refuses both, so the reader checks each value against the descriptor of
 * the generated class first. zod reads `2.0` and `1e3` as the integers 2 and 1000 (a JavaScript
 * number), so the check gives the value with such a number of an integer field written as an integer.
 */
object JsonTypes {
    /**
     * Checks a value and gives it with each integer field as an integer. Throws SchemaViolation when
     * a value has another JSON type than its field.
     */
    fun check(
        descriptor: SerialDescriptor,
        value: JsonElement,
        path: String = "",
    ): JsonElement {
        if (value is JsonNull) return value
        expectedType(descriptor, value)?.let { fail(path, it) }
        return when (descriptor.kind) {
            StructureKind.CLASS -> {
                checkObject(descriptor, value as JsonObject, path)
            }

            StructureKind.LIST -> {
                JsonArray(
                    (value as JsonArray).mapIndexed { index, item ->
                        check(descriptor.getElementDescriptor(0), item, "$path.$index")
                    },
                )
            }

            StructureKind.MAP -> {
                JsonObject(
                    (value as JsonObject).mapValues { (key, item) ->
                        check(descriptor.getElementDescriptor(1), item, "$path.$key")
                    },
                )
            }

            PrimitiveKind.INT, PrimitiveKind.LONG -> {
                integerOf(value as JsonPrimitive)
            }

            else -> {
                value
            }
        }
    }

    /**
     * A number with an integer value as an integer (`Number.isInteger` of the JavaScript number), for
     * example `2.0` or `1e3`. Each other value stays: the decode or the range check refuses it.
     */
    private fun integerOf(value: JsonPrimitive): JsonElement {
        val text = value.content
        if (value.isString || text.all { it == '-' || it in '0'..'9' }) return value
        val number = text.toDoubleOrNull() ?: return value
        val integer = number.isFinite() && number == floor(number) && abs(number) <= MAX_SAFE_INTEGER.toDouble()
        return if (integer) JsonPrimitive(number.toLong()) else value
    }

    /** The JSON type that the field needs when the value has another type, else null. */
    private fun expectedType(
        descriptor: SerialDescriptor,
        value: JsonElement,
    ): String? {
        val text = value is JsonPrimitive && value.isString
        val scalar = value is JsonPrimitive && !value.isString
        return when (descriptor.kind) {
            StructureKind.CLASS, StructureKind.MAP -> {
                "an object".takeIf { value !is JsonObject }
            }

            StructureKind.LIST -> {
                "an array".takeIf { value !is JsonArray }
            }

            PrimitiveKind.STRING -> {
                "a text".takeIf { !text }
            }

            PrimitiveKind.BOOLEAN, PrimitiveKind.INT, PrimitiveKind.LONG, PrimitiveKind.DOUBLE -> {
                "a ${descriptor.kind.toString().lowercase()}".takeIf { !scalar }
            }

            else -> {
                null
            }
        }
    }

    private fun checkObject(
        descriptor: SerialDescriptor,
        value: JsonObject,
        path: String,
    ): JsonObject {
        val out = LinkedHashMap(value)
        for (index in 0 until descriptor.elementsCount) {
            val name = descriptor.getElementName(index)
            val item = value[name] ?: continue
            val itemPath = if (path.isEmpty()) name else "$path.$name"
            // A zod `.optional()` field: the key may be absent, but null breaks its type.
            if (item is JsonNull && descriptor.getElementAnnotations(index).any { it is AwOptional }) {
                fail(itemPath, "a value or no key, found null")
            }
            out[name] = check(descriptor.getElementDescriptor(index), item, itemPath)
        }
        return JsonObject(out)
    }

    private fun fail(
        path: String,
        expected: String,
    ): Nothing = throw SchemaViolation(path, "${path.ifEmpty { "(root)" }}: expected $expected")
}
