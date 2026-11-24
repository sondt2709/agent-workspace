package com.agentworkspace.shared.write

import com.agentworkspace.schema.EventDataV1
import com.agentworkspace.schema.EventEnvelopeV1
import com.agentworkspace.schema.EventTypesV1
import com.agentworkspace.shared.files.WorkspaceWriter
import com.agentworkspace.shared.model.AwEvent
import com.agentworkspace.shared.model.AwJson
import com.agentworkspace.shared.model.HybridLogicalClock
import com.agentworkspace.shared.model.LineResult
import com.agentworkspace.shared.model.LogReader
import com.agentworkspace.shared.model.SourcePath
import com.agentworkspace.shared.model.TimeSource
import com.agentworkspace.shared.model.WorkspacePaths
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject

/** The writer refused an event: nothing was written. */
class WriteRefusedException(
    val path: String,
    message: String,
) : IllegalArgumentException("$path: $message")

/**
 * The one event writer of the phone (`appendEvent` of shared/core): it writes only to the logs of
 * [device]. Each event gets a new UUIDv7 id and the next HLC of [clock]. The line is validated again
 * with the log reader of the merge before the write, so a line that the merge would refuse is never
 * written. The phone writes no credential value into an event, so no redaction runs here.
 */
class EventWriter(
    private val files: WorkspaceWriter,
    val device: String,
    private val clock: HybridLogicalClock,
    private val time: TimeSource,
    private val newId: (Long) -> String = { Uuid7.next(it) },
) {
    /** The actor of the phone's own actions. */
    val human: String get() = "human@$device"

    /**
     * Writes one event of [type] with [data] to the log [path], for example
     * `tasks/<task>/log/<device>.jsonl`. The task of a task log is the folder of the path.
     */
    fun <T : EventDataV1> write(
        path: String,
        type: String,
        serializer: KSerializer<T>,
        data: T,
        by: String? = human,
    ): AwEvent {
        val source = WorkspacePaths.classify(path) as? SourcePath.Log
        refusal(source, type, serializer)?.let { throw WriteRefusedException(path, it) }
        checkNotNull(source)
        val encoded = AwJson.encodeToJsonElement(serializer, data) as JsonObject
        val envelope =
            EventEnvelopeV1(
                v = 1,
                id = newId(time.now()),
                hlc = clock.now(),
                dev = device,
                type = type,
                task = source.scope.task,
                by = by,
                data = encoded,
            )
        val line = AwJson.encodeToString(EventEnvelopeV1.serializer(), envelope)
        val bytes = line.encodeToByteArray().size
        val result = LogReader.parseLine(line, device, source.scope)
        val problem =
            when {
                bytes > MAX_LINE_BYTES -> "the line has $bytes bytes, more than $MAX_LINE_BYTES"
                result is LineResult.Bad -> result.message
                else -> null
            }
        if (problem != null || result !is LineResult.Event) throw WriteRefusedException(path, problem.orEmpty())
        files.appendLine(path, line)
        return result.event
    }

    /** Why the writer refuses an event of [type] for the log [source], or null. */
    private fun refusal(
        source: SourcePath.Log?,
        type: String,
        serializer: KSerializer<*>,
    ): String? {
        val known = EventTypesV1.serializers[type]
        return when {
            source == null -> "not a log file"
            source.device != device -> "the log is not the log of $device"
            known == null -> "unknown event type $type"
            known.descriptor.serialName != serializer.descriptor.serialName -> "the data is not the data of $type"
            else -> null
        }
    }

    /** Reads the HLC of an event of another device, so the next own event sorts after it. */
    fun observe(hlc: String) = clock.observe(hlc)

    companion object {
        /** `MAX_LINE_BYTES` of shared/core/src/files/logs.ts. */
        const val MAX_LINE_BYTES = 64 * 1024

        /** The task log of a device. */
        fun taskLog(
            task: String,
            device: String,
        ): String = "tasks/$task/log/$device.jsonl"

        /** The workspace log of a device. */
        fun workspaceLog(device: String): String = "tasks/log/$device.jsonl"
    }
}
