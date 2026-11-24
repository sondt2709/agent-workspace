package com.agentworkspace.engine

import io.ktor.client.HttpClient
import io.ktor.client.plugins.timeout
import io.ktor.client.request.parameter
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.serializer

/** An error of the engine REST API with the HTTP status (0: no reply). */
class EngineRestException(
    message: String,
    val status: Int,
    cause: Throwable? = null,
) : Exception(message, cause)

// The reply types hold only the fields that AW reads (the same fields as rest.ts of awd). Unknown
// fields are ignored; a missing field is an error that names the route and the field.

@Serializable
data class EngineStatus(
    val myID: String,
)

@Serializable
data class EngineConnection(
    val connected: Boolean,
    val paused: Boolean,
    val address: String,
    val type: String,
    val isLocal: Boolean = false,
) {
    fun info() = ConnectionInfo(connected, address, type, isLocal)
}

@Serializable
data class EngineConnections(
    val connections: Map<String, EngineConnection>,
)

@Serializable
data class EngineCompletion(
    val completion: Double,
    val needBytes: Long,
    val needItems: Long,
    val needDeletes: Long,
    val globalItems: Long,
    val remoteState: String,
    val sequence: Long,
) {
    fun info() = CompletionInfo(needItems, needDeletes, needBytes, remoteState)
}

@Serializable
data class EngineEvent(
    val id: Long,
    val type: String,
    val time: String,
    val data: JsonElement? = null,
)

@Serializable
data class EngineDevice(
    val deviceID: String,
    val name: String,
    val addresses: List<String>,
    val compression: String? = null,
    val introducer: Boolean? = null,
    val autoAcceptFolders: Boolean? = null,
    val paused: Boolean? = null,
)

@Serializable
data class EngineFolderDevice(
    val deviceID: String,
)

@Serializable
data class EngineVersioning(
    val type: String = "",
    val params: Map<String, String> = emptyMap(),
    val fsPath: String = "",
)

@Serializable
data class EngineFolder(
    val id: String,
    val label: String,
    val path: String,
    val type: String,
    val devices: List<EngineFolderDevice>,
    val fsWatcherEnabled: Boolean,
    val fsWatcherDelayS: Double,
    val rescanIntervalS: Long,
    val maxConflicts: Long,
    val paused: Boolean = false,
    val versioning: EngineVersioning = EngineVersioning(),
)

@Serializable
data class EngineIgnores(
    val ignore: List<String>? = null,
)

@Serializable
data class EngineDeviceStats(
    val lastSeen: String? = null,
)

@Serializable
private data class IgnoresBody(
    @SerialName("ignore") val ignore: List<String>,
)

/**
 * The engine REST client of the phone (docs/phase-1.md 6.7.2): AW code, no code of the fork. The same
 * routes as `plugins/sync-syncthing/src/rest.ts`: one function per route.
 */
@Suppress("TooManyFunctions")
class EngineRest(
    private val http: HttpClient,
) : AutoCloseable {
    /** One request; a failure with no reply is an error with the status 0. */
    private suspend fun exchange(
        method: HttpMethod,
        route: String,
        params: Map<String, Any>,
        body: String?,
        timeoutMs: Long?,
    ): HttpResponse =
        try {
            http.request(route) {
                this.method = method
                params.forEach { (key, value) -> parameter(key, value) }
                if (body != null) {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
                if (timeoutMs != null) {
                    timeout {
                        requestTimeoutMillis = timeoutMs
                        socketTimeoutMillis = timeoutMs
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            throw EngineRestException("Engine ${method.value} $route failed: ${e.message ?: e::class.simpleName}", 0, e)
        }

    private suspend fun call(
        method: HttpMethod,
        route: String,
        params: Map<String, Any> = emptyMap(),
        body: String? = null,
        timeoutMs: Long? = null,
    ): Pair<Int, String> {
        val response = exchange(method, route, params, body, timeoutMs)
        val text = response.bodyAsText()
        val status = response.status.value
        if (!response.status.isSuccess()) {
            throw EngineRestException(
                "Engine ${method.value} $route failed: $status ${text.trim().take(MAX_BODY_TEXT)}",
                status,
            )
        }
        return status to text
    }

    private suspend fun <T> get(
        serializer: KSerializer<T>,
        route: String,
        params: Map<String, Any> = emptyMap(),
        timeoutMs: Long? = null,
    ): T {
        val (status, text) = call(HttpMethod.Get, route, params, timeoutMs = timeoutMs)
        return try {
            json.decodeFromString(serializer, text)
        } catch (e: SerializationException) {
            throw EngineRestException("Engine GET $route gave a reply that is not valid: ${e.message}", status, e)
        } catch (e: IllegalArgumentException) {
            throw EngineRestException("Engine GET $route gave a reply that is not valid: ${e.message}", status, e)
        }
    }

    private suspend fun send(
        method: HttpMethod,
        route: String,
        params: Map<String, Any> = emptyMap(),
        body: String? = null,
        timeoutMs: Long? = null,
    ) {
        call(method, route, params, body, timeoutMs)
    }

    private fun path(id: String) = id.encodeURLPathPart()

    suspend fun ping(timeoutMs: Long = PING_TIMEOUT_MS) =
        send(HttpMethod.Get, "rest/system/ping", timeoutMs = timeoutMs)

    suspend fun myId(): String = get(serializer<EngineStatus>(), "rest/system/status").myID

    suspend fun options(): JsonObject = get(JsonObject.serializer(), "rest/config/options")

    suspend fun patchOptions(patch: JsonObject) = send(HttpMethod.Patch, "rest/config/options", body = patch.toString())

    suspend fun devices(): List<EngineDevice> = get(ListSerializer(serializer<EngineDevice>()), "rest/config/devices")

    suspend fun putDevice(device: EngineDevice) =
        send(
            HttpMethod.Put,
            "rest/config/devices/${path(device.deviceID)}",
            body = json.encodeToString(serializer<EngineDevice>(), device),
        )

    suspend fun patchDevice(
        id: String,
        patch: JsonObject,
    ) = send(HttpMethod.Patch, "rest/config/devices/${path(id)}", body = patch.toString())

    suspend fun deleteDevice(id: String) = send(HttpMethod.Delete, "rest/config/devices/${path(id)}")

    /** The raw config of a folder (each field, for a PUT that keeps them), or null when it does not exist. */
    suspend fun folderJson(id: String): JsonObject? =
        try {
            get(JsonObject.serializer(), "rest/config/folders/${path(id)}")
        } catch (e: EngineRestException) {
            if (e.status == HTTP_NOT_FOUND) null else throw e
        }

    suspend fun putFolder(
        id: String,
        folder: JsonObject,
    ) = send(HttpMethod.Put, "rest/config/folders/${path(id)}", body = folder.toString())

    suspend fun deleteFolder(id: String) = send(HttpMethod.Delete, "rest/config/folders/${path(id)}")

    suspend fun ignores(folder: String): List<String> =
        get(
            serializer<EngineIgnores>(),
            "rest/db/ignores",
            mapOf("folder" to folder),
        ).ignore.orEmpty()

    suspend fun setIgnores(
        folder: String,
        ignore: List<String>,
    ) = send(
        HttpMethod.Post,
        "rest/db/ignores",
        mapOf("folder" to folder),
        json.encodeToString(serializer<IgnoresBody>(), IgnoresBody(ignore)),
    )

    /** Scans a folder, or one path in it. The call returns after the scan. */
    suspend fun scan(
        folder: String,
        sub: String? = null,
        timeoutMs: Long = SCAN_TIMEOUT_MS,
    ) = send(
        HttpMethod.Post,
        "rest/db/scan",
        buildMap {
            put("folder", folder)
            if (sub != null) put("sub", sub)
        },
        timeoutMs = timeoutMs,
    )

    suspend fun completion(
        folder: String,
        device: String,
    ): EngineCompletion =
        get(
            serializer<EngineCompletion>(),
            "rest/db/completion",
            mapOf(
                "folder" to folder,
                "device" to device,
            ),
        )

    suspend fun connections(): Map<String, EngineConnection> =
        get(serializer<EngineConnections>(), "rest/system/connections").connections

    suspend fun deviceStats(): Map<String, EngineDeviceStats> =
        get(MapSerializer(String.serializer(), serializer<EngineDeviceStats>()), "rest/stats/device")

    /** A long poll of the engine events after [since]. */
    suspend fun events(
        since: Long,
        timeoutS: Int,
        types: List<String> = EVENT_TYPES,
    ): List<EngineEvent> =
        get(
            ListSerializer(serializer<EngineEvent>()),
            "rest/events",
            mapOf("since" to since, "timeout" to timeoutS, "events" to types.joinToString(",")),
            (timeoutS + LONG_POLL_MARGIN_S) * MS_PER_SECOND,
        )

    /** A long poll of the disk events (LocalChangeDetected, RemoteChangeDetected) after [since]. */
    suspend fun diskEvents(
        since: Long,
        timeoutS: Int,
    ): List<EngineEvent> =
        get(
            ListSerializer(serializer<EngineEvent>()),
            "rest/events/disk",
            mapOf("since" to since, "timeout" to timeoutS),
            (timeoutS + LONG_POLL_MARGIN_S) * MS_PER_SECOND,
        )

    override fun close() = http.close()

    companion object {
        const val API_KEY_HEADER = "X-API-Key"
        const val PING_TIMEOUT_MS = 2_000L
        const val SCAN_TIMEOUT_MS = 120_000L
        private const val HTTP_NOT_FOUND = 404
        private const val MAX_BODY_TEXT = 200
        private const val LONG_POLL_MARGIN_S = 10
        private const val MS_PER_SECOND = 1000L

        /** The events that AW reads (docs/phase-1.md 6.5.1). The Item events are skipped (ST9). */
        val EVENT_TYPES =
            listOf(
                "StateChanged",
                "FolderSummary",
                "FolderCompletion",
                "DeviceConnected",
                "DeviceDisconnected",
                "DevicePaused",
                "DeviceResumed",
                "FolderErrors",
                "PendingDevicesChanged",
            )

        val json =
            Json {
                ignoreUnknownKeys = true
                explicitNulls = false
            }
    }
}
