package com.agentworkspace.shared.model

import com.agentworkspace.schema.EventDataV1
import com.agentworkspace.schema.EventEnvelopeV1
import com.agentworkspace.schema.EventTypesV1
import com.agentworkspace.schema.SchemaViolation
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** One event of a log line: the envelope, the typed data of a known type, and the JSON value. */
data class AwEvent(
    val envelope: EventEnvelopeV1,
    /** The typed data, or null for an event of a type that this AW does not know. */
    val data: EventDataV1?,
    /** The event value with the defaults of its schema and the unknown keys (the zod output). */
    val json: JsonObject,
) {
    val id: String get() = envelope.id
    val hlc: String get() = envelope.hlc
    val dev: String get() = envelope.dev
    val type: String get() = envelope.type
    val by: String? get() = envelope.by
    val known: Boolean get() = data != null
}

/** The result of one log line: an event, or a bad line with the error code and the message. */
sealed interface LineResult {
    data class Event(
        val event: AwEvent,
    ) : LineResult

    data class Bad(
        /** `parse_error`, `schema_error`, `newer_version`, `unsupported_version` or `device_mismatch`. */
        val code: String,
        val message: String,
    ) : LineResult
}

/**
 * The log reader of `shared/core/src/files/logs.ts` (`parseLogText` with a scope), one line at a
 * time. The messages have no path and no line: the merge issue has them in its own fields.
 */
object LogReader {
    /** The current major version of each known event type. */
    private const val CURRENT_MAJOR = 1L

    private val WORKSPACE_PREFIXES = listOf("slot.", "queue.", "credential.", "project.")

    fun isEventType(type: String): Boolean = type in EventTypesV1.serializers

    /** True when an event type belongs in a log of this kind. */
    fun logAccepts(
        kind: LogKind,
        type: String,
    ): Boolean {
        val workspace = WORKSPACE_PREFIXES.any { type.startsWith(it) }
        val knowledge = type.startsWith("knowledge.")
        val heartbeat = type == "device.heartbeat"
        return when (kind) {
            LogKind.HEARTBEAT -> heartbeat
            LogKind.KNOWLEDGE -> knowledge
            LogKind.WORKSPACE -> workspace
            LogKind.TASK -> !workspace && !knowledge && !heartbeat
        }
    }

    /** Why an event does not belong in a log of this scope (the field and a message), or null. */
    fun scopeProblem(
        scope: LogScope,
        type: String,
        task: String?,
    ): Pair<String, String>? {
        if (isEventType(type) && !logAccepts(scope.kind, type)) {
            return "type" to "An event of type $type does not belong in a ${scope.kind.text} log"
        }
        if (scope.task != null && task != null && task != scope.task) {
            return "task" to "The event is of task $task, not of the task ${scope.task} of this folder"
        }
        return null
    }

    /** Reads one line of a log of `device`. The caller skips an empty line. */
    fun parseLine(
        text: String,
        device: String,
        scope: LogScope?,
    ): LineResult {
        val syntax = JsonSyntax.error(text)
        val value =
            if (syntax == null) {
                try {
                    AwJson.parseToJsonElement(text)
                } catch (e: SerializationException) {
                    return LineResult.Bad("parse_error", e.message ?: "Not valid JSON")
                }
            } else {
                null
            }
        val result = value?.let { validate(it) } ?: LineResult.Bad("parse_error", syntax.orEmpty())
        return if (result is LineResult.Event) checkPlace(result.event, device, scope) else result
    }

    /** Checks that the event is of the device of the file and belongs in the scope of the file. */
    private fun checkPlace(
        event: AwEvent,
        device: String,
        scope: LogScope?,
    ): LineResult {
        val problem = scope?.let { scopeProblem(it, event.type, event.envelope.task) }
        return when {
            event.dev != device -> {
                LineResult.Bad("device_mismatch", "sync problem: event of device ${event.dev} in the log of $device")
            }

            problem != null -> {
                LineResult.Bad(
                    "schema_error",
                    "does not match ${event.type}.v${event.envelope.v}: ${problem.first}: ${problem.second}",
                )
            }

            else -> {
                LineResult.Event(event)
            }
        }
    }

    /** Validates one event value against its envelope, then against the schema of its type and version. */
    fun validate(value: JsonElement): LineResult {
        var raw = value
        val envelope =
            when (
                val result =
                    decode(
                        "event",
                        "",
                    ) {
                        raw = JsonTypes.check(EventEnvelopeV1.serializer().descriptor, value)
                        AwJson.decodeFromJsonElement(EventEnvelopeV1.serializer(), raw)
                    }
            ) {
                is Decoded.Bad -> return result.bad
                is Decoded.Ok -> result.value
            }
        return validateData(envelope, raw as JsonObject)
    }

    /** Validates the data of an event with a valid envelope. `raw` is the checked event value. */
    private fun validateData(
        envelope: EventEnvelopeV1,
        raw: JsonObject,
    ): LineResult {
        val serializer =
            EventTypesV1.serializers[envelope.type]
                ?: return LineResult.Event(AwEvent(envelope, null, raw))
        if (envelope.v > CURRENT_MAJOR) {
            return LineResult.Bad(
                "newer_version",
                "${envelope.type} version ${envelope.v} is newer than this AW. Update AW.",
            )
        }
        if (envelope.v < CURRENT_MAJOR) {
            // Only version 1 exists: there is no previous major version to read yet.
            return LineResult.Bad(
                "unsupported_version",
                "${envelope.type} version ${envelope.v} is too old for this AW.",
            )
        }
        var rawData = raw["data"] as JsonObject

        @Suppress("UNCHECKED_CAST")
        val dataSerializer = serializer as KSerializer<EventDataV1>
        val data =
            when (
                val result =
                    decode(
                        "${envelope.type}.v${envelope.v}",
                        "data.",
                    ) {
                        rawData = JsonTypes.check(dataSerializer.descriptor, rawData) as JsonObject
                        AwJson.decodeFromJsonElement(dataSerializer, rawData)
                    }
            ) {
                is Decoded.Bad -> return result.bad
                is Decoded.Ok -> result.value
            }
        val typedData = AwJson.encodeToJsonElement(dataSerializer, data)
        val json = JsonObject(raw + ("data" to withUnknownKeys(typedData, rawData)))
        return LineResult.Event(AwEvent(envelope, data, json))
    }

    private sealed interface Decoded<out T> {
        data class Ok<T>(
            val value: T,
        ) : Decoded<T>

        data class Bad(
            val bad: LineResult.Bad,
        ) : Decoded<Nothing>
    }

    /** Runs a decode and maps its error to a `schema_error` line with the schema name and the field. */
    private inline fun <T> decode(
        schema: String,
        prefix: String,
        block: () -> T,
    ): Decoded<T> =
        try {
            Decoded.Ok(block())
        } catch (e: SchemaViolation) {
            Decoded.Bad(LineResult.Bad("schema_error", "does not match $schema: $prefix${e.message}"))
        } catch (e: IllegalArgumentException) {
            // A SerializationException: a missing field or a wrong type. Its first line names the field.
            val message =
                e.message
                    .orEmpty()
                    .lineSequence()
                    .first()
            Decoded.Bad(LineResult.Bad("schema_error", "does not match $schema: $prefix$message"))
        }
}
