package com.agentworkspace.engine

import co.touchlab.kermit.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.serializer
import java.nio.file.Files

/** The values of the config step that the app can change while it runs. */
data class SetupSettings(
    /** The switch "Use community discovery and relay servers" (on by default, decision D18). */
    val community: Boolean = true,
)

/**
 * The config step after each engine start (a port of `#onEngineStart` of
 * plugins/sync-syncthing/src/transport.ts with the phone values of docs/phase-1.md 6.2 and 6.7):
 * options, the device name, the peers, the folders `tasks` and `knowledge` of each workspace (never
 * `secure`), and the ignores. A value is sent only when it differs: a folder-config change restarts
 * the folder (ST2).
 */
@Suppress("LongParameterList")
class EngineSetup(
    private val paths: EnginePaths,
    private val peers: PeerStore,
    private val workspaces: () -> List<String>,
    private val engineSettings: () -> EngineSettings,
    private val setupSettings: () -> SetupSettings,
    private val log: Logger = Logger.withTag("aw-engine"),
    /** The engine devices of an open pairing: the config step keeps them (as awd does). */
    private val pairingDevices: () -> Set<String> = { emptySet() },
    /**
     * The artifacts that the person requested on the phone, per workspace: `<task>/artifacts/<device>/<name>`
     * (openspec gate-full-context, docs/phase-1.md 10.3).
     */
    private val artifactRequests: (String) -> List<String> = { emptyList() },
) {
    /** True while the app is open: the reconnect interval is then 5 s (docs/phase-1.md 6.7.5). */
    @Volatile var appOpen: Boolean = false

    fun reconnectS(): Int = if (appOpen) EngineConfig.OPEN_RECONNECT_S else EngineConfig.PHONE_RECONNECT_S

    fun wantedOptions(): JsonObject {
        val community = setupSettings().community
        return buildJsonObject {
            put("localAnnounceEnabled", true)
            put("globalAnnounceEnabled", community)
            put("relaysEnabled", community)
            put("natEnabled", false)
            put("announceLANAddresses", community)
            put("reconnectionIntervalS", reconnectS())
            putJsonArray("listenAddresses") { add(JsonPrimitive(engineSettings().listen)) }
        }
    }

    /** Sends the options that differ from [current]; true when it sent a change. */
    suspend fun applyOptions(rest: EngineRest): Boolean {
        val current = rest.options()
        val patch = JsonObject(wantedOptions().filter { (key, value) -> current[key] != value })
        if (patch.isEmpty()) return false
        rest.patchOptions(patch)
        return true
    }

    /** The full config step. */
    suspend fun apply(
        rest: EngineRest,
        myId: String,
    ) {
        applyOptions(rest)
        val list = peers.read()
        val devices = rest.devices()
        val name = engineSettings().name
        val self = devices.firstOrNull { it.deviceID == myId }
        if (self != null && self.name != name) {
            rest.patchDevice(myId, buildJsonObject { put("name", name) })
        }
        for (peer in list) putDevice(rest, peer, devices)
        // A device that is not in the peer list any more (removed while the engine was stopped).
        val pairing = pairingDevices()
        for (device in devices) {
            if (device.deviceID != myId && device.deviceID !in pairing && list.none { it.syncId == device.deviceID }) {
                rest.deleteDevice(device.deviceID)
                log.i { "Removed the engine device ${device.name}: it is not a peer" }
            }
        }
        for (workspace in workspaces()) {
            for (kind in FolderKind.entries) ensureFolder(rest, workspace, kind, myId, list)
        }
    }

    suspend fun putDevice(
        rest: EngineRest,
        peer: PeerRecord,
        known: List<EngineDevice>,
    ) {
        val current = known.firstOrNull { it.deviceID == peer.syncId }
        if (current != null && current.name == peer.device && current.addresses == peer.addresses) return
        rest.putDevice(
            EngineDevice(
                deviceID = peer.syncId,
                name = peer.device,
                addresses = peer.addresses,
                compression = "metadata",
                introducer = false,
                autoAcceptFolders = false,
                paused = false,
            ),
        )
    }

    /**
     * The ignore list of a folder. In `tasks`, one `!` line per requested artifact comes before the line
     * [ARTIFACTS_IGNORE]: the first matching line wins, so the engine syncs only these artifact files.
     * A path with any other form (a pattern character, `..`) gets no line.
     */
    fun ignoresOf(
        workspace: String,
        kind: FolderKind,
    ): List<String> =
        when (kind) {
            FolderKind.TASKS -> {
                val requested =
                    artifactRequests(workspace)
                        .filter { ARTIFACT_PATH.matches(it) }
                        .distinct()
                        .sorted()
                        .map { "!/$it" }
                listOf(TMP_IGNORE) + requested + ARTIFACTS_IGNORE
            }

            FolderKind.KNOWLEDGE -> {
                listOf(TMP_IGNORE)
            }
        }

    /** Sends the ignore list of the tasks folder of a workspace when it differs (a new artifact request). */
    suspend fun applyIgnores(
        rest: EngineRest,
        workspace: String,
    ) {
        val id = folderId(workspace, FolderKind.TASKS)
        if (rest.folderJson(id) == null) return
        val ignores = ignoresOf(workspace, FolderKind.TASKS)
        if (rest.ignores(id) != ignores) rest.setIgnores(id, ignores)
    }

    /** The wanted folder config: each peer, send and receive, no versioning on the phone. */
    fun wantedFolder(
        workspace: String,
        kind: FolderKind,
        myId: String,
        list: List<PeerRecord>,
    ): JsonObject {
        val devices = (listOf(myId) + list.map { it.syncId }).sorted()
        return buildJsonObject {
            put("id", folderId(workspace, kind))
            put("label", kind.folder)
            put("path", paths.folder(workspace, kind).toString())
            put("type", "sendreceive")
            put("devices", buildJsonArray { devices.forEach { add(buildJsonObject { put("deviceID", it) }) } })
            put("fsWatcherEnabled", true)
            put("fsWatcherDelayS", 1)
            put("rescanIntervalS", RESCAN_S)
            put("maxConflicts", MAX_CONFLICTS)
            put("paused", false)
            putJsonObject("versioning") {
                put("type", "")
                putJsonObject("params") {}
                put("cleanupIntervalS", RESCAN_S)
                put("fsPath", "")
                put("fsType", "basic")
            }
        }
    }

    /** True when the engine config has each wanted value. */
    fun folderMatches(
        current: EngineFolder,
        wanted: JsonObject,
    ): Boolean {
        val w = EngineRest.json.decodeFromJsonElement(serializer<EngineFolder>(), wanted)
        return current.path == w.path &&
            current.label == w.label &&
            current.type == w.type &&
            current.devices.map { it.deviceID }.sorted() == w.devices.map { it.deviceID }.sorted() &&
            current.fsWatcherEnabled == w.fsWatcherEnabled &&
            current.fsWatcherDelayS == w.fsWatcherDelayS &&
            current.rescanIntervalS == w.rescanIntervalS &&
            current.maxConflicts == w.maxConflicts &&
            current.paused == w.paused &&
            current.versioning.type == w.versioning.type
    }

    suspend fun ensureFolder(
        rest: EngineRest,
        workspace: String,
        kind: FolderKind,
        myId: String,
        list: List<PeerRecord>,
    ) {
        Files.createDirectories(paths.folder(workspace, kind))
        val id = folderId(workspace, kind)
        val wanted = wantedFolder(workspace, kind, myId, list)
        val current = rest.folderJson(id)
        val matches =
            current != null &&
                folderMatches(EngineRest.json.decodeFromJsonElement(serializer<EngineFolder>(), current), wanted)
        if (!matches) {
            rest.putFolder(id, if (current == null) wanted else JsonObject(current + wanted))
            log.i { "Sync folder config written: $id" }
        }
        val ignores = ignoresOf(workspace, kind)
        if (rest.ignores(id) != ignores) rest.setIgnores(id, ignores)
    }

    companion object {
        const val TMP_IGNORE = "*.aw-tmp"

        /** Artifacts on request only (docs/phase-1.md 6.2): `tasks/<task id>/artifacts`. */
        const val ARTIFACTS_IGNORE = "/*/artifacts"

        /** A requested artifact: `<task id>/artifacts/<device>/<file name>`, with no pattern character. */
        val ARTIFACT_PATH = Regex("^[0-9a-f-]{36}/artifacts/[a-z0-9-]+/[A-Za-z0-9._-]+$")
        const val RESCAN_S = 3600
        const val MAX_CONFLICTS = 10
    }
}
