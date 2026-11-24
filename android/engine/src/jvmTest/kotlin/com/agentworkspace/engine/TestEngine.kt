package com.agentworkspace.engine

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively

/** Valid engine device ids (Luhn mod-32 check characters), from plugins/sync-syncthing/src/units.test.ts. */
object Ids {
    const val PHONE = "5NRSCRM-EBSEQFK-QNF5TAK-VWPOCL5-ZSWAWL3-RGEZFBQ-4Z53HNX-4RPKHQV"
    const val MAC = "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG"
    const val SERVER = "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5"
}

fun peer(
    device: String,
    id: String,
    role: String = "local",
) = PeerRecord(device, id, role, listOf("dynamic"))

/** A temp folder that a test removes. */
@OptIn(ExperimentalPathApi::class)
inline fun <T> withTempDir(block: (Path) -> T): T {
    // A short path: the Unix socket path must stay under 104 bytes.
    val dir = Files.createTempDirectory(Path.of("/tmp"), "awe")
    try {
        return block(dir)
    } finally {
        dir.deleteRecursively()
    }
}

/** A process that the test ends. */
class FakeProcess(
    override val pid: Long,
) : EngineProcess {
    val exit = CompletableDeferred<Int>()
    var destroyed = false

    override fun isAlive(): Boolean = !exit.isCompleted

    override suspend fun awaitExit(): Int = exit.await()

    override fun destroy() {
        destroyed = true
        exit.complete(TERM_EXIT)
    }

    override fun destroyForcibly() {
        exit.complete(KILL_EXIT)
    }

    companion object {
        const val TERM_EXIT = 143
        const val KILL_EXIT = 137
    }
}

/**
 * A launcher with no binary run: `generate` writes the config of a real `generate` (GUI on
 * 127.0.0.1:8384, NAT and reports on), `device-id` gives [deviceId], `serve` gives a [FakeProcess].
 */
class FakeLauncher(
    private val paths: EnginePaths,
    var deviceId: String = Ids.PHONE,
    var installed: Boolean = true,
) : EngineLauncher {
    val commands: MutableList<List<String>> = Collections.synchronizedList(mutableListOf())
    val processes: MutableList<FakeProcess> = Collections.synchronizedList(mutableListOf())
    val envs: MutableList<Map<String, String>> = Collections.synchronizedList(mutableListOf())
    var generateExit = 0
    private val pids = AtomicInteger(PID_START)

    override val binary: Path? get() = if (installed) paths.home.resolveSibling(StaleEngines.BINARY_NAME) else null

    override suspend fun run(
        args: List<String>,
        env: Map<String, String>,
    ): CommandResult {
        commands.add(args)
        return when (args.first()) {
            "generate" -> {
                if (generateExit == 0) Files.writeString(paths.config, GENERATED_CONFIG)
                CommandResult(generateExit, if (generateExit == 0) "" else "generate failed")
            }

            "device-id" -> {
                CommandResult(0, "$deviceId\n")
            }

            else -> {
                CommandResult(1, "unknown command")
            }
        }
    }

    override fun start(
        args: List<String>,
        env: Map<String, String>,
        log: Path,
    ): EngineProcess {
        commands.add(args)
        envs.add(env)
        return FakeProcess(pids.incrementAndGet().toLong()).also { processes.add(it) }
    }

    fun serves(): Int = commands.count { it.first() == "serve" }

    companion object {
        private const val PID_START = 4000

        /** The config of `syncthing generate` v2.1.7 (the parts that AW reads). */
        val GENERATED_CONFIG =
            """
            <configuration version="51">
                <device id="${Ids.PHONE}" name="localhost" compression="metadata" introducer="false">
                    <address>dynamic</address>
                </device>
                <gui enabled="true" tls="false" sendBasicAuthPrompt="false">
                    <address>127.0.0.1:8384</address>
                    <apikey>generated-key</apikey>
                    <theme>default</theme>
                </gui>
                <options>
                    <listenAddress>default</listenAddress>
                    <globalAnnounceEnabled>true</globalAnnounceEnabled>
                    <relaysEnabled>true</relaysEnabled>
                    <natEnabled>true</natEnabled>
                    <urAccepted>0</urAccepted>
                    <crashReportingEnabled>true</crashReportingEnabled>
                    <autoUpgradeIntervalH>12</autoUpgradeIntervalH>
                </options>
            </configuration>
            """.trimIndent()
    }
}

/** One request that the fake engine got. */
data class Seen(
    val method: HttpMethod,
    val path: String,
    val query: Map<String, String>,
    val body: String,
    val apiKey: String?,
)

/**
 * The engine REST API in memory, for Ktor `MockEngine`. The reply shapes follow the engine v2.1.7
 * replies that `plugins/sync-syncthing/src/rest.ts` reads (its tests run them against the real engine).
 */
class FakeEngineApi(
    var myId: String = Ids.PHONE,
) {
    @Volatile var pingOk = true

    /** A ping waits this long before it answers (a socket that accepts but does not answer). */
    @Volatile var pingDelayMs = 0L
    val seen: ConcurrentLinkedQueue<Seen> = ConcurrentLinkedQueue()
    var options: JsonObject =
        buildJsonObject {
            put("localAnnounceEnabled", false)
            put("globalAnnounceEnabled", false)
            put("relaysEnabled", false)
            put("natEnabled", false)
            put("announceLANAddresses", false)
            put("reconnectionIntervalS", EngineConfig.PHONE_RECONNECT_S)
            put("listenAddresses", JsonArray(listOf(JsonPrimitive(EngineConfig.DEFAULT_LISTEN))))
        }
    val devices: MutableMap<String, JsonObject> = ConcurrentHashMap()
    val folders: MutableMap<String, JsonObject> = ConcurrentHashMap()
    val ignores: MutableMap<String, List<String>> = ConcurrentHashMap()
    val connections: MutableMap<String, JsonObject> = ConcurrentHashMap()

    /** Completion by `<folder>|<device>`; a missing entry is synced. */
    val completions: MutableMap<String, JsonObject> = ConcurrentHashMap()
    val events: ConcurrentLinkedQueue<JsonObject> = ConcurrentLinkedQueue()
    val diskEvents: ConcurrentLinkedQueue<JsonObject> = ConcurrentLinkedQueue()
    val scans: MutableList<Pair<String, String?>> = Collections.synchronizedList(mutableListOf())

    init {
        devices[myId] = device(myId, "localhost")
    }

    fun changes(): List<Seen> = seen.filter { it.method != HttpMethod.Get }

    fun device(
        id: String,
        name: String,
    ) = buildJsonObject {
        put("deviceID", id)
        put("name", name)
        put("addresses", JsonArray(listOf(JsonPrimitive("dynamic"))))
        put("paused", false)
    }

    fun connect(
        id: String,
        connected: Boolean = true,
        address: String = "192.0.2.10:22300",
        local: Boolean = true,
    ) {
        connections[id] =
            buildJsonObject {
                put("connected", connected)
                put("paused", false)
                put("address", address)
                put("type", "tcp-client")
                put("isLocal", local)
            }
    }

    fun completion(
        folder: String,
        device: String,
        needItems: Long,
        remoteState: String = "valid",
    ) {
        completions["$folder|$device"] = completionJson(needItems, remoteState)
    }

    private fun completionJson(
        needItems: Long,
        remoteState: String,
    ) = buildJsonObject {
        put("completion", if (needItems == 0L) 100 else 50)
        put("needBytes", needItems * 10)
        put("needItems", needItems)
        put("needDeletes", 0)
        put("globalItems", 10)
        put("remoteState", remoteState)
        put("sequence", 1)
    }

    fun client(): EngineRest =
        EngineRest(
            HttpClient(MockEngine { request -> handle(this, request) }) {
                expectSuccess =
                    false
            },
        )

    private fun bodyOf(request: HttpRequestData): String =
        when (val content = request.body) {
            is TextContent -> content.text
            is OutgoingContent.ByteArrayContent -> content.bytes().decodeToString()
            else -> ""
        }

    @Suppress("CyclomaticComplexMethod", "LongMethod")
    suspend fun handle(
        scope: MockRequestHandleScope,
        request: HttpRequestData,
    ): HttpResponseData {
        val path = request.url.encodedPath.trimStart('/')
        val query =
            request.url.parameters
                .entries()
                .associate { it.key to it.value.first() }
        val body = bodyOf(request)
        seen.add(Seen(request.method, path, query, body, request.headers[EngineRest.API_KEY_HEADER]))
        val method = request.method

        fun ok(json: JsonElement) = scope.respond(json.toString(), HttpStatusCode.OK, jsonHeaders)

        fun empty() = scope.respond("", HttpStatusCode.OK)

        fun notFound() = scope.respond("no such object", HttpStatusCode.NotFound)
        val parsed = if (body.isEmpty()) null else Json.parseToJsonElement(body)
        return when {
            path == "rest/system/ping" -> {
                if (pingDelayMs > 0) kotlinx.coroutines.delay(pingDelayMs)
                if (pingOk) {
                    ok(
                        buildJsonObject { put("ping", "pong") },
                    )
                } else {
                    scope.respond("down", HttpStatusCode.ServiceUnavailable)
                }
            }

            path == "rest/system/status" -> {
                ok(buildJsonObject { put("myID", myId) })
            }

            path == "rest/config/options" && method == HttpMethod.Get -> {
                ok(options)
            }

            path == "rest/config/options" && method == HttpMethod.Patch -> {
                options = JsonObject(options + parsed!!.jsonObject)
                empty()
            }

            path == "rest/config/devices" -> {
                ok(JsonArray(devices.values.toList()))
            }

            path.startsWith("rest/config/devices/") -> {
                val id = path.removePrefix("rest/config/devices/")
                when (method) {
                    HttpMethod.Put -> devices[id] = parsed!!.jsonObject
                    HttpMethod.Patch -> devices[id] = JsonObject(devices.getValue(id) + parsed!!.jsonObject)
                    HttpMethod.Delete -> devices.remove(id)
                }
                empty()
            }

            path.startsWith("rest/config/folders/") -> {
                val id = path.removePrefix("rest/config/folders/")
                when (method) {
                    HttpMethod.Get -> {
                        folders[id]?.let { ok(it) } ?: notFound()
                    }

                    HttpMethod.Delete -> {
                        folders.remove(id)
                        empty()
                    }

                    else -> {
                        folders[id] = parsed!!.jsonObject
                        empty()
                    }
                }
            }

            path == "rest/db/ignores" && method == HttpMethod.Get -> {
                ok(
                    buildJsonObject {
                        put(
                            "ignore",
                            JsonArray(ignores[query["folder"]].orEmpty().map(::JsonPrimitive)),
                        )
                    },
                )
            }

            path == "rest/db/ignores" -> {
                ignores[query.getValue("folder")] =
                    (parsed!!.jsonObject["ignore"] as JsonArray).map { it.jsonPrimitive.content }
                empty()
            }

            path == "rest/db/scan" -> {
                scans.add(query.getValue("folder") to query["sub"])
                empty()
            }

            path == "rest/db/completion" -> {
                ok(completions["${query["folder"]}|${query["device"]}"] ?: completionJson(0, "valid"))
            }

            path == "rest/system/connections" -> {
                ok(buildJsonObject { put("connections", JsonObject(connections)) })
            }

            path == "rest/stats/device" -> {
                ok(JsonObject(emptyMap()))
            }

            path == "rest/events" -> {
                ok(drain(events))
            }

            path == "rest/events/disk" -> {
                ok(drain(diskEvents))
            }

            else -> {
                notFound()
            }
        }
    }

    private suspend fun drain(queue: ConcurrentLinkedQueue<JsonObject>): JsonArray {
        if (queue.isEmpty()) delay(LONG_POLL_MS)
        val out = mutableListOf<JsonObject>()
        while (true) out.add(queue.poll() ?: break)
        return JsonArray(out)
    }

    companion object {
        private const val LONG_POLL_MS = 50L
        val jsonHeaders = headersOf("Content-Type", "application/json")
    }
}
