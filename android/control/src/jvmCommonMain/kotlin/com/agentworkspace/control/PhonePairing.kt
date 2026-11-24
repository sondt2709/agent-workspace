package com.agentworkspace.control

import co.touchlab.kermit.Logger
import com.agentworkspace.engine.EngineConfig
import com.agentworkspace.engine.PeerRecord
import com.agentworkspace.engine.SyncEngineController
import com.agentworkspace.identity.DeviceKeyStore
import com.agentworkspace.identity.Pairing
import com.agentworkspace.identity.PairingCodeException
import com.agentworkspace.identity.PairingOffer
import com.agentworkspace.identity.PairingRequestFields
import com.agentworkspace.identity.Records
import com.agentworkspace.shared.model.DocumentException
import com.agentworkspace.shared.model.DocumentReader
import com.agentworkspace.shared.model.TimeSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.Inet4Address
import java.net.NetworkInterface
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively

/** The states of a pairing on the phone (the join side of daemon/src/service/pairing.ts). */
enum class PairingState(
    val terminal: Boolean,
) {
    /** The request is in the pairing folder; the phone shows the check code and waits for the approval. */
    WAITING(false),

    /** The response is accepted: the workspace folders sync, the phone waits for `tasks/workspace.yaml`. */
    JOINING(false),
    DONE(true),
    FAILED(true),
    EXPIRED(true),
    CANCELLED(true),
}

/** What the pairing screen shows. */
data class PairingStatus(
    val state: PairingState,
    val nonce: String,
    val workspaceName: String,
    /** The id of the workspace of the code: the app shows it after `DONE`. */
    val workspaceId: String,
    /** The slug of the showing computer. */
    val showing: String,
    /** The 6-digit check code, `123 456`. */
    val checkCode: String,
    val slug: String,
    val error: String? = null,
)

/** A join that the phone refuses before it starts; the message is for the person. */
class PairingRefused(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

/** The engine calls of a pairing (a port, so the JVM tests run the flow with a fake engine). */
@Suppress("TooManyFunctions")
interface EnginePairing {
    /** Starts the engine (also with no workspace) and gives the sync device id of the phone, or null. */
    suspend fun start(): String?

    suspend fun addPairingDevice(
        syncId: String,
        name: String,
        addresses: List<String>,
    )

    suspend fun addPairingFolder(
        id: String,
        path: String,
        device: String,
    )

    suspend fun scanFolder(id: String)

    suspend fun removePairingFolder(id: String)

    suspend fun removePairingDevice(syncId: String)

    suspend fun setPeers(peers: List<PeerRecord>)

    /** The current peer list. */
    fun peers(): List<PeerRecord>

    suspend fun addWorkspace(id: String)

    suspend fun removeWorkspace(id: String)

    /** The pairing ended: the engine runs on only with a workspace. */
    suspend fun endPairing()

    fun workspaces(): List<String>

    fun workspaceRoot(id: String): Path
}

/** The engine port on the sync engine controller of the app. */
class ControllerPairing(
    private val engine: SyncEngineController,
) : EnginePairing {
    override suspend fun start() = engine.startForPairing()

    override suspend fun addPairingDevice(
        syncId: String,
        name: String,
        addresses: List<String>,
    ) = engine.addPairingDevice(syncId, name, addresses)

    override suspend fun addPairingFolder(
        id: String,
        path: String,
        device: String,
    ) = engine.addPairingFolder(id, path, device)

    override suspend fun scanFolder(id: String) = engine.scanFolder(id)

    override suspend fun removePairingFolder(id: String) = engine.removePairingFolder(id)

    override suspend fun removePairingDevice(syncId: String) = engine.removePairingDevice(syncId)

    override suspend fun setPeers(peers: List<PeerRecord>) = engine.setPeers(peers)

    override fun peers(): List<PeerRecord> = engine.peers.read()

    override suspend fun addWorkspace(id: String) = engine.addWorkspace(id)

    override suspend fun removeWorkspace(id: String) = engine.removeWorkspace(id)

    override suspend fun endPairing() = engine.endPairing()

    override fun workspaces() = engine.workspaces()

    override fun workspaceRoot(id: String): Path = engine.workspaceRoot(id)
}

/** The times of a pairing (the constants of daemon/src/service/pairing.ts); tests make them short. */
data class PairingTiming(
    val pollMs: Long = 1_000,
    /** After the expiry of the code, the wait for `tasks/workspace.yaml`. */
    val joinWaitMs: Long = 300_000,
    /** After `done.json`, the time for the computer to read it. */
    val doneWaitMs: Long = 3_000,
)

/**
 * The phone joins a workspace with a pairing code (docs/phase-1.md 7, the join side of
 * daemon/src/service/pairing.ts with `role: "mobile"`). One pairing at a time. The texts are those
 * of awd.
 */
@Suppress("TooManyFunctions", "LongParameterList")
class PhonePairing(
    private val store: PhoneIdentityStore,
    private val keys: DeviceKeyStore,
    private val engine: EnginePairing,
    private val clock: TimeSource,
    private val scope: CoroutineScope,
    private val addresses: () -> List<String> = { LocalAddresses.of(EngineConfig.DEFAULT_LISTEN) },
    private val timing: PairingTiming = PairingTiming(),
    private val log: Logger = Logger.withTag("aw-pairing"),
) {
    private val mutex = Mutex()
    private val state = MutableStateFlow<PairingStatus?>(null)
    private var job: Job? = null
    private var open: Open? = null

    /** The open or the last pairing. */
    val status: StateFlow<PairingStatus?> = state.asStateFlow()

    private class Open(
        val offer: PairingOffer,
        val dir: Path,
        val folder: String,
        val slug: String,
        val syncId: String,
        val ed25519: String,
        val x25519: String,
        /** True when the slug is the stored slug of a phone that joined another workspace before. */
        val kept: Boolean = false,
    )

    /**
     * Joins with a code: the request goes to the showing computer through the pairing folder. Throws
     * [PairingRefused] for a code or a state that the phone refuses before it starts.
     */
    @Suppress("ThrowsCount")
    suspend fun join(
        code: String,
        name: String,
    ): PairingStatus =
        mutex.withLock {
            if (state.value?.state?.terminal ==
                false
            ) {
                throw PairingRefused("A pairing runs already: wait for it, or cancel it")
            }
            val offer =
                try {
                    Pairing.decode(code)
                } catch (e: PairingCodeException) {
                    throw PairingRefused(e.message.orEmpty(), e)
                }
            if (offer.isExpired(
                    clock.now(),
                )
            ) {
                throw PairingRefused("The pairing code expired at ${offer.expires}: show a new code")
            }
            checkIdentity(offer)
            if (offer.workspaceId in engine.workspaces()) {
                throw PairingRefused("The workspace ${offer.workspaceName} is on this phone already")
            }
            // A phone that paired before keeps its slug in each workspace (openspec phone-workspaces).
            val stored = storedSlug()
            val slug = stored ?: slugOf(name)
            if (slug == offer.device.slug) {
                // A kept slug has no name field on the screen: the text says what the person can do.
                throw PairingRefused(
                    if (stored != null) {
                        "${keptText(slug)}, and the showing device has the same name. " +
                            "Pair from another computer of ${offer.workspaceName}."
                    } else {
                        "The name $slug is the name of the showing device: give another name"
                    },
                )
            }
            start(
                offer,
                slug,
                (if (stored != null) storedName(stored) else null) ?: name.trim().ifEmpty { slug },
                kept = stored != null,
            )
        }

    /**
     * The user id comes from the master key, as awd does (identity.adopt): a code with the user id of
     * this phone and another master key cannot replace the trust root.
     */
    @Suppress("ThrowsCount")
    private fun checkIdentity(offer: PairingOffer) {
        if (!Pairing.ownsMaster(offer)) {
            throw PairingRefused("The pairing code is not valid: its user id is not the user id of its master key")
        }
        val identity = store.identity() ?: return
        if (identity.user != offer.user) {
            throw PairingRefused("This phone belongs to the identity ${identity.user}")
        }
        if (identity.masterPublic != offer.master) {
            throw PairingRefused("This phone belongs to the identity ${identity.user} with another master key")
        }
    }

    private fun keptText(slug: String) = "This phone is $slug in your other workspaces and keeps that name"

    /** The slug of a phone that paired before (it has an identity and a slug), else null. */
    fun storedSlug(): String? = store.identity()?.let { store.slug() }

    /** The name of the own record in a joined workspace, so each workspace gets the same name. */
    private fun storedName(slug: String): String? =
        engine
            .workspaces()
            .asSequence()
            .flatMap { store.records(it) }
            .firstOrNull { (it["slug"] as? JsonPrimitive)?.contentOrNull == slug }
            ?.let { (it["name"] as? JsonPrimitive)?.contentOrNull }

    @Suppress("ThrowsCount")
    private suspend fun start(
        offer: PairingOffer,
        slug: String,
        name: String,
        kept: Boolean,
    ): PairingStatus {
        // A Keystore or disk error is a refusal with a text, never a stop of the app (android-pairing finding 3).
        val key =
            try {
                keys.load()
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                throw PairingRefused("The phone could not make or read its device key (${e.message}): try again", e)
            }
        val syncId =
            engine.start() ?: run {
                // The engine started for the pairing must not stay in the pairing mode.
                runCatching { engine.endPairing() }
                throw PairingRefused("The sync engine did not start: try again")
            }
        val fields =
            PairingRequestFields(
                nonce = offer.nonce,
                slug = slug,
                name = name.take(MAX_NAME),
                role = "mobile",
                ed25519 = key.ed25519,
                x25519 = key.x25519,
                syncId = syncId,
                addresses = addresses().take(MAX_ADDRESSES),
            )
        val request = Pairing.signRequest(fields, offer.secret, key.ed25519Secret)
        val dir = store.pairingDir(offer.nonce)
        val p = Open(offer, dir, "aw-pair-${offer.nonce}", slug, syncId, key.ed25519, key.x25519, kept)
        writeRequest(dir, request)
        open = p
        state.value =
            PairingStatus(
                state = PairingState.WAITING,
                nonce = offer.nonce,
                workspaceName = offer.workspaceName,
                workspaceId = offer.workspaceId,
                showing = offer.device.slug,
                checkCode = Pairing.formatCheckCode(Pairing.checkCode(offer.device, request)),
                slug = slug,
            )
        try {
            engine.addPairingDevice(offer.device.syncId, offer.device.slug, offer.addresses)
            engine.addPairingFolder(p.folder, dir.toString(), offer.device.syncId)
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            end(PairingState.FAILED, "The sync engine did not add the pairing: ${e.message}")
            throw PairingRefused("The sync engine did not add the pairing folder (${e.message}): try again", e)
        }
        log.i { "Pairing request sent to ${offer.device.slug}" }
        job = scope.launch { loop() }
        return checkNotNull(state.value)
    }

    /** Cancels an open pairing. */
    suspend fun cancel() {
        job?.cancel()
        mutex.withLock { if (state.value?.state?.terminal == false) end(PairingState.CANCELLED, null) }
    }

    private suspend fun loop() {
        while (state.value?.state?.terminal == false) {
            try {
                mutex.withLock { if (state.value?.state?.terminal == false) step() }
            } catch (e: PairingRefused) {
                mutex.withLock { end(PairingState.FAILED, e.message) }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                log.d(e) { "A pairing step failed; it runs again" }
            }
            if (state.value?.state?.terminal != false) break
            delay(timing.pollMs)
        }
    }

    private suspend fun step() {
        val p = checkNotNull(open)
        when (state.value?.state) {
            PairingState.WAITING -> waitForResponse(p)
            PairingState.JOINING -> waitForWorkspace(p)
            else -> Unit
        }
    }

    @Suppress("ThrowsCount")
    private suspend fun waitForResponse(p: Open) {
        val raw = readJson(p.dir.resolve("response.json"))
        if (raw == null) {
            if (p.offer.isExpired(clock.now())) end(PairingState.EXPIRED, "No approval before the expiry")
            return
        }
        val response = raw as? JsonObject ?: throw PairingRefused("The pairing response is not valid")
        val nonce = (response["nonce"] as? JsonPrimitive)?.contentOrNull
        val approved = (response["approved"] as? JsonPrimitive)?.content
        val records = response["records"] as? JsonArray ?: JsonArray(emptyList())
        if ((response["v"] as? JsonPrimitive)?.content != "1" || nonce != p.offer.nonce ||
            approved !in setOf("true", "false")
        ) {
            throw PairingRefused("The pairing response is not valid")
        }
        if (approved != "true") {
            val reason = (response["reason"] as? JsonPrimitive)?.contentOrNull ?: "no reason"
            // awd refuses a slug in use or revoked with "--slug <other name>"; a kept slug cannot change.
            if (p.kept && reason.contains("device name ${p.slug} is in use")) {
                throw PairingRefused(
                    "${keptText(p.slug)}, and ${p.offer.workspaceName} has another device ${p.slug}. " +
                        "Remove that device from ${p.offer.workspaceName} on the computer, then pair again.",
                )
            }
            if (p.kept && reason.contains("device ${p.slug} is revoked")) {
                throw PairingRefused(
                    "${keptText(p.slug)}, and ${p.slug} is a revoked device in ${p.offer.workspaceName}: " +
                        "this phone cannot join it.",
                )
            }
            throw PairingRefused("The pairing was refused: $reason")
        }
        accept(p, records)
    }

    /** Checks the signed records of the response and joins the workspace folders. */
    @Suppress("ThrowsCount")
    private suspend fun accept(
        p: Open,
        records: JsonArray,
    ) {
        val master = p.offer.masterPublic()
        val valid =
            records.map { raw ->
                val record = raw as? JsonObject ?: throw PairingRefused(BAD_SIGNATURE)
                try {
                    DocumentReader.validate(record, "device")
                } catch (_: DocumentException) {
                    throw PairingRefused(BAD_SIGNATURE)
                }
                if (!Records.verify(record, master)) throw PairingRefused(BAD_SIGNATURE)
                record
            }

        fun text(
            r: JsonObject?,
            key: String,
        ) = (r?.get(key) as? JsonPrimitive)?.contentOrNull

        fun key(
            r: JsonObject?,
            name: String,
        ) = ((r?.get("keys") as? JsonObject)?.get(name) as? JsonPrimitive)?.contentOrNull
        val mine = valid.firstOrNull { text(it, "slug") == p.slug }
        val theirs = valid.firstOrNull { text(it, "slug") == p.offer.device.slug }
        val myKeys = listOf(key(mine, "ed25519"), key(mine, "x25519"), text(mine, "sync_device_id"), text(mine, "role"))
        if (myKeys != listOf(p.ed25519, p.x25519, p.syncId, "mobile")) {
            throw PairingRefused("The record of this phone in the response has other keys")
        }
        if (key(theirs, "ed25519") != p.offer.device.ed25519) {
            throw PairingRefused("The record of the showing device has other keys than the code")
        }
        val ws = p.offer.workspaceId
        store.saveIdentity(PhoneIdentity(p.offer.user, p.offer.master))
        store.saveSlug(p.slug)
        store.saveRecords(ws, valid)
        // The peers of the other joined workspaces stay, as awd does (refreshPeers): the next index
        // refresh sets the full list.
        engine.setPeers(RecordPeers.withWorkspace(engine.peers(), valid, p.slug))
        engine.addWorkspace(ws)
        state.value = state.value?.copy(state = PairingState.JOINING)
        log.i { "Pairing approved: the folders of ${p.offer.workspaceName} sync" }
    }

    private suspend fun waitForWorkspace(p: Open) {
        val ws = p.offer.workspaceId
        val file = engine.workspaceRoot(ws).resolve("tasks").resolve("workspace.yaml")
        val text =
            if (Files.isRegularFile(
                    file,
                    LinkOption.NOFOLLOW_LINKS,
                )
            ) {
                Files.readAllBytes(file).decodeToString()
            } else {
                null
            }
        if (text == null) {
            if (p.offer.expiresAtMs + timing.joinWaitMs <
                clock.now()
            ) {
                end(PairingState.FAILED, "tasks/workspace.yaml did not arrive")
            }
            return
        }
        // The workspace id comes from the file, not from the code: keep only the offered workspace.
        val id =
            runCatching {
                (DocumentReader.parseYaml(text) as? JsonObject)?.get("id") as? JsonPrimitive
            }.getOrNull()?.contentOrNull
        if (id != ws) {
            runCatching {
                engine.removeWorkspace(
                    ws,
                )
            }.onFailure { log.w(it) { "The workspace folders were not removed" } }
            end(
                PairingState.FAILED,
                "tasks/workspace.yaml is the file of another workspace (${id ?: "no id"}), not $ws",
            )
            return
        }
        writeJson(
            p.dir.resolve("done.json"),
            buildJsonObject {
                put("v", 1)
                put("nonce", p.offer.nonce)
                put("ok", true)
            },
        )
        runCatching { engine.scanFolder(p.folder) }
        // The showing device reads done.json, or the first heartbeat of this phone.
        delay(timing.doneWaitMs)
        end(PairingState.DONE, null)
    }

    /** Ends the pairing: removes the pairing folder, the pairing device (unless it is a peer) and the folder. */
    private suspend fun end(
        to: PairingState,
        error: String?,
    ) {
        val p = open ?: return
        open = null
        if (error != null) log.w { "Pairing ended $to: $error" }
        runCatching { engine.removePairingFolder(p.folder) }
        runCatching { engine.removePairingDevice(p.offer.device.syncId) }
        runCatching { removeDir(p.dir) }
        runCatching { engine.endPairing() }
        // The screen sees the end after the cleanup.
        state.value = state.value?.copy(state = to, error = error)
    }

    @OptIn(ExperimentalPathApi::class)
    private fun removeDir(dir: Path) = dir.deleteRecursively()

    /** Writes `request.json` into a new pairing folder; a disk error ends the pairing mode of the engine. */
    private suspend fun writeRequest(
        dir: Path,
        request: JsonObject,
    ) {
        try {
            removeDir(dir)
            Files.createDirectories(dir)
            writeJson(dir.resolve("request.json"), request)
        } catch (e: IOException) {
            runCatching { engine.endPairing() }
            throw PairingRefused("The phone could not write the pairing request (${e.message}): try again", e)
        }
    }

    /** Reads a JSON file of the pairing folder: a regular file of at most 1 MiB, or null. */
    private fun readJson(file: Path): JsonElement? {
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) return null
        if (Files.size(file) > MAX_PAIRING_FILE) throw PairingRefused("A pairing file is too large")
        val text =
            try {
                Files.readAllBytes(file).decodeToString()
            } catch (_: IOException) {
                return null
            }
        // A file that the engine writes now can be partial: the next poll reads it again.
        return runCatching { Json.parseToJsonElement(text) }.getOrNull()
    }

    private fun writeJson(
        file: Path,
        value: JsonObject,
    ) {
        val temp = file.resolveSibling("${file.fileName}.aw-tmp")
        Files.write(temp, (value.toString() + "\n").encodeToByteArray())
        Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    companion object {
        private const val MAX_PAIRING_FILE = 1024L * 1024
        private const val MAX_NAME = 200
        private const val MAX_ADDRESSES = 8
        private const val MAX_SLUG = 63
        private const val BAD_SIGNATURE = "A record of the response has no valid signature of the master key"

        /** The slug of a device name: `Pixel 9` gives `pixel-9`; an empty result gives `phone`. */
        fun slugOf(name: String): String =
            name
                .lowercase()
                .replace(Regex("[^a-z0-9]+"), "-")
                .trim('-')
                .take(MAX_SLUG)
                .trimEnd('-')
                .ifEmpty { "phone" }
    }
}

/** The LAN addresses of the phone for the pairing request (`localAddresses()` of awd). */
object LocalAddresses {
    private val LISTEN = Regex("^tcp[46]?://(.+):(\\d+)$")
    private const val MAX = 8

    fun of(listen: String): List<String> {
        val match = LISTEN.matchEntire(listen) ?: return emptyList()
        val (host, port) = match.destructured
        if (host != "0.0.0.0" && host != "[::]" && host != "::") return listOf("tcp://$host:$port")
        val out = sortedSetOf<String>()
        runCatching {
            for (nic in NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()) {
                if (!nic.isUp || nic.isLoopback) continue
                nic.inetAddresses.toList().filterIsInstance<Inet4Address>().forEach {
                    out.add(
                        "tcp://${it.hostAddress}:$port",
                    )
                }
            }
        }
        return out.take(MAX)
    }
}
