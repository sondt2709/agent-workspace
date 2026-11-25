package com.agentworkspace.shared.model

import com.agentworkspace.schema.BindingsV1
import com.agentworkspace.schema.DeviceV1
import com.agentworkspace.schema.HealthV1
import com.agentworkspace.schema.ProjectV1
import com.agentworkspace.schema.PushV1
import com.agentworkspace.schema.SchemaViolation
import com.agentworkspace.schema.TaskV1
import com.agentworkspace.schema.TestServersV1
import com.agentworkspace.schema.WorkspaceV1
import com.charleskorn.kaml.Yaml
import com.charleskorn.kaml.YamlConfiguration
import com.charleskorn.kaml.YamlException
import com.charleskorn.kaml.YamlList
import com.charleskorn.kaml.YamlMap
import com.charleskorn.kaml.YamlNode
import com.charleskorn.kaml.YamlNull
import com.charleskorn.kaml.YamlScalar
import com.charleskorn.kaml.YamlTaggedNode
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/** A document that fails its syntax or schema check, with the error code of the files layer. */
class DocumentException(
    /** `parse_error`, `schema_error`, `newer_version` or `unsupported_version`. */
    val code: String,
    message: String,
    /** The line of a YAML syntax error, from 1, or null. */
    val line: Int? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

/** A valid document: its kind and its value with defaults and unknown keys (the zod output). */
data class ParsedDocument(
    val kind: String,
    val value: JsonObject,
)

/**
 * The document reader of `shared/core/src/files/documents.ts`: YAML 1.2 into JSON by the core
 * schema, then the decode into the generated class. The messages have no path.
 */
object DocumentReader {
    private const val CURRENT_MAJOR = 1L

    /** The generated class of each document kind, current major version. */
    val serializers: Map<String, KSerializer<*>> =
        mapOf(
            "workspace" to WorkspaceV1.serializer(),
            "project" to ProjectV1.serializer(),
            "task" to TaskV1.serializer(),
            "device" to DeviceV1.serializer(),
            "health" to HealthV1.serializer(),
            "bindings" to BindingsV1.serializer(),
            "test-servers" to TestServersV1.serializer(),
            "push" to PushV1.serializer(),
        )

    private val yaml = Yaml(configuration = YamlConfiguration(strictMode = false))

    /** Parses a YAML text into JSON by the YAML 1.2 core schema. Throws DocumentException on a syntax error. */
    fun parseYaml(text: String): JsonElement {
        val node =
            try {
                yaml.parseToYamlNode(text)
            } catch (e: YamlException) {
                throw DocumentException("parse_error", e.message.lineSequence().first(), e.line, e)
            }
        return toJson(node)
    }

    /** Parses and validates a document text. `expected` is the kind that the path requires. */
    fun parse(
        text: String,
        expected: String?,
    ): ParsedDocument = validate(parseYaml(text), expected)

    /** Validates a document value. `expected` is the kind that the path requires. */
    fun validate(
        document: JsonElement,
        expected: String?,
    ): ParsedDocument {
        // A task snapshot from before openspec proposal-and-discussion gets the field `proposal`.
        val value = Legacy.upgradeTaskDocument(document)
        if (value !is JsonObject) schemaError("document: (root): A document is a YAML map with kind and schema")
        val kind = (value["kind"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (!isKind(kind, expected)) {
            val want = expected ?: "a known document kind"
            schemaError("document: kind: Expected $want, found ${value["kind"] ?: "undefined"}")
        }
        val version = (value["schema"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
        if (version == null ||
            version < 1
        ) {
            schemaError("$kind: schema: Expected the major version, an integer of 1 or more")
        }
        checkVersion(checkNotNull(kind), version)

        @Suppress("UNCHECKED_CAST")
        val serializer = serializers.getValue(kind) as KSerializer<Any>
        var checked: JsonElement = value
        val typed =
            try {
                checked = JsonTypes.check(serializer.descriptor, value)
                AwJson.decodeFromJsonElement(serializer, checked)
            } catch (e: SchemaViolation) {
                throw DocumentException("schema_error", "does not match $kind.v$version: ${e.message}", cause = e)
            } catch (e: IllegalArgumentException) {
                // A SerializationException: a missing field or a wrong type. Its first line names the field.
                val message =
                    e.message
                        .orEmpty()
                        .lineSequence()
                        .first()
                throw DocumentException("schema_error", "does not match $kind.v$version: $message", cause = e)
            }
        val json = withUnknownKeys(AwJson.encodeToJsonElement(serializer, typed), checked) as JsonObject
        return ParsedDocument(kind, json)
    }

    private fun isKind(
        kind: String?,
        expected: String?,
    ): Boolean = kind != null && kind in serializers && (expected == null || kind == expected)

    private fun checkVersion(
        kind: String,
        version: Long,
    ) {
        if (version >
            CURRENT_MAJOR
        ) {
            throw DocumentException("newer_version", "$kind version $version is newer than this AW. Update AW.")
        }
        if (version <
            CURRENT_MAJOR
        ) {
            throw DocumentException("unsupported_version", "$kind version $version is too old for this AW.")
        }
    }

    private fun schemaError(message: String): Nothing =
        throw DocumentException("schema_error", "does not match $message")

    private val NULL = Regex("^(?:~|null|Null|NULL|)\\z")
    private val BOOLEAN = Regex("^(?:true|True|TRUE|false|False|FALSE)\\z")
    private val INT = Regex("^[-+]?[0-9]+\\z")
    private val OCTAL = Regex("^0o[0-7]+\\z")
    private val HEX = Regex("^0x[0-9a-fA-F]+\\z")
    private val FLOAT = Regex("^[-+]?(?:\\.[0-9]+|[0-9]+(?:\\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?\\z")
    private const val OCTAL_RADIX = 8
    private const val HEX_RADIX = 16

    private fun toJson(node: YamlNode): JsonElement =
        when (node) {
            is YamlNull -> {
                JsonNull
            }

            is YamlMap -> {
                JsonObject(node.entries.entries.associate { (key, value) -> key.content to toJson(value) })
            }

            is YamlList -> {
                JsonArray(node.items.map { toJson(it) })
            }

            is YamlScalar -> {
                if (node.plain) plainScalar(node.content) else JsonPrimitive(node.content)
            }

            is YamlTaggedNode -> {
                if (node.tag == "tag:yaml.org,2002:str" || node.tag == "!!str") {
                    JsonPrimitive((node.innerNode as? YamlScalar)?.content.orEmpty())
                } else {
                    toJson(node.innerNode)
                }
            }
        }

    /** A plain scalar by the YAML 1.2 core schema: null, a boolean, an integer, a float, else a string. */
    private fun plainScalar(text: String): JsonElement =
        when {
            NULL.matches(text) -> JsonNull
            BOOLEAN.matches(text) -> JsonPrimitive(text.lowercase() == "true")
            INT.matches(text) -> JsonPrimitive(text.removePrefix("+").toBigNumber())
            OCTAL.matches(text) -> JsonPrimitive(text.drop(2).toRadixNumber(OCTAL_RADIX))
            HEX.matches(text) -> JsonPrimitive(text.drop(2).toRadixNumber(HEX_RADIX))
            FLOAT.matches(text) -> JsonPrimitive(text.toDouble())
            else -> JsonPrimitive(text)
        }

    /** An integer text as a Long, or as a Double when it is too large (like a JavaScript number). */
    private fun String.toBigNumber(): Number = toLongOrNull() ?: toDouble()

    /**
     * Octal or hex digits as a Long, or as a Double when they are too large (like `parseInt` of the
     * YAML library of TypeScript). A large value fails the schema of its field in both languages.
     */
    private fun String.toRadixNumber(radix: Int): Number =
        toLongOrNull(radix) ?: fold(0.0) { sum, digit -> sum * radix + digit.digitToInt(radix) }
}
