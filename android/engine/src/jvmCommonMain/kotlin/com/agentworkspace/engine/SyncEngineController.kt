package com.agentworkspace.engine

import co.touchlab.kermit.Logger
import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.index.WorkspaceIndex
import com.agentworkspace.shared.merge.MergeEngine
import com.agentworkspace.shared.model.TimeSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively
import kotlin.io.path.isDirectory
import kotlin.io.path.name

/** The parts of the controller that the platform gives. */
@Suppress("LongParameterList")
class EnginePlatform(
    val paths: EnginePaths,
    val launcher: EngineLauncher,
    /** The Unix socket of the REST API: `LocalSocket` on Android. */
    val connector: UnixConnector,
    /** Opens the Room index of a workspace. */
    val openIndex: (String) -> WorkspaceIndex,
    /** Ends a stale engine process (SIGKILL). */
    val kill: (Long) -> Unit,
    val clock: TimeSource = TimeSource { System.currentTimeMillis() },
    /**
     * The device record check of the merge of a workspace (`Records.verifier` of the master public key),
     * or null while the phone has no identity: the records are then not checked.
     */
    val recordVerifier: (String) -> ((JsonElement) -> Boolean)? = { null },
)

/**
 * The one entry point of the app to the sync engine (docs/phase-1.md 6.7): start, restart when the
 * app opens, stop, Sync now, the status of each peer, the peers and the workspaces. The foreground
 * service and the screens call only this class. The parameters [timing], [restFactory] and
 * [refreshDebounceMs] are for tests (short times, a fake REST API).
 */
@Suppress("TooManyFunctions", "LongParameterList")
class SyncEngineController(
    private val platform: EnginePlatform,
    scope: CoroutineScope,
    engineSettings: () -> EngineSettings,
    setupSettings: () -> SetupSettings = { SetupSettings() },
    timing: SupervisorTiming = SupervisorTiming(),
    restFactory: ((EngineIdentity) -> EngineRest)? = null,
    refreshDebounceMs: Long = IndexRefresher.DEBOUNCE_MS,
    private val log: Logger = Logger.withTag("aw-engine"),
    /** The artifacts that the person requested, per workspace (openspec gate-full-context). */
    artifactRequests: (String) -> List<String> = { emptyList() },
    presenceTickMs: Long = PRESENCE_TICK_MS,
) {
    private val paths = platform.paths
    val peers = PeerStore(paths.peers)
    val refresher = IndexRefresher(scope, refreshDebounceMs)
    val monitor = SyncMonitor(peers, ::workspaces, platform.clock)

    /** The engine devices of an open pairing (docs/phase-1.md 7): no workspace folder, kept by the config step. */
    private val pairingDevices: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** True while a pairing is open: the engine runs with no workspace. */
    @Volatile private var pairing = false

    private val setup =
        EngineSetup(
            paths,
            peers,
            ::workspaces,
            engineSettings,
            setupSettings,
            pairingDevices = { pairingDevices.toSet() },
            artifactRequests = artifactRequests,
        )
    private val events = EngineEventLoop(refresher, monitor)
    private val lock = Mutex()
    private var configuredGeneration = 0

    val supervisor =
        EngineSupervisor(
            paths = paths,
            launcher = platform.launcher,
            home = EngineHome(paths, platform.launcher),
            stale = StaleEngines(paths.pidFile, paths.home, kill = platform.kill),
            restFactory =
                restFactory ?: { identity ->
                    EngineRest(
                        EngineHttp.client(identity.endpoint, identity.apiKey, platform.connector, paths.httpsCert),
                    )
                },
            settings = engineSettings,
            onStart = ::onEngineStart,
            scope = scope,
            log = log,
            timing = timing,
        )

    val state: StateFlow<EngineState> get() = supervisor.state

    /** The workspaces of the phone: each folder of `<filesDir>/aw/`. */
    fun workspaces(): List<String> {
        if (!paths.workspaces.isDirectory()) return emptyList()
        // A DirectoryStream, not Files.list(...).toList(): Stream.toList needs Android API 34 (fix list 0-30).
        return Files
            .newDirectoryStream(paths.workspaces)
            .use { entries ->
                entries.filter { it.isDirectory() }.map { it.name }
            }.sorted()
    }

    fun hasWorkspace(): Boolean = workspaces().isNotEmpty()

    /** The folder of a workspace on the phone: `<filesDir>/aw/<workspace id>`. */
    fun workspaceRoot(workspace: String): Path = paths.workspace(workspace)

    /** The count of peers, for the notification text; 0 when `sync-peers.json` cannot be read. */
    fun peerCount(): Int = runCatching { peers.read().size }.getOrDefault(0)

    private suspend fun onEngineStart(session: EngineSession) {
        setup.apply(session.rest, session.identity.deviceId)
        val first =
            lock.withLock {
                (configuredGeneration != session.generation).also { configuredGeneration = session.generation }
            }
        if (first) {
            events.launchIn(session)
            refresher.changedAll()
        }
    }

    // While the app is open, a refresh of each workspace every presenceTickMs with no file change: the
    // merge computes the presence of each device with the time of the refresh, so a computer that stops
    // shows "offline" after 90 s also when nothing else changes (review android-ui workflow 1).
    init {
        scope.launch {
            while (true) {
                delay(presenceTickMs)
                if (setup.appOpen) refresher.changedAll()
            }
        }
    }

    /** One register at a time: app open and the foreground service start at the same time (review L2). */
    private val registerLock = Mutex()

    private suspend fun register(workspace: String) =
        registerLock.withLock {
            registerLocked(workspace)
        }

    private suspend fun registerLocked(workspace: String) {
        if (workspace in refresher.workspaces()) return
        val index = platform.openIndex(workspace)
        val merge =
            MergeEngine(
                NioWorkspaceFiles(paths.workspace(workspace)),
                platform.clock,
                lastValid = index.documents(),
                verifyDeviceRecord = platform.recordVerifier(workspace),
            )
        refresher.register(workspace, merge, index)
    }

    /**
     * Starts the engine when the phone has a workspace or an open pairing; the index of each workspace
     * is opened first.
     */
    suspend fun start() {
        for (workspace in workspaces()) register(workspace)
        if (!hasWorkspace() && !pairing) {
            log.i { "No workspace on this phone: the engine does not start" }
            return
        }
        supervisor.start()
    }

    suspend fun stop() = supervisor.stop()

    /** The app came to the foreground: restart the engine with the short reconnect interval. */
    suspend fun appOpened() {
        // A close that came after the open wins: the work runs later than the mark (review L7).
        if (!setup.appOpen) return
        supervisor.stop()
        start()
    }

    /**
     * Marks the app as open or closed at once, on the thread of the activity callback. [appOpened] and
     * [appClosed] run later on other threads and read the newest mark, so their order does not matter.
     */
    fun markAppOpen(open: Boolean) {
        setup.appOpen = open
    }

    /** The app went to the background: the reconnect interval goes back to 20 s. */
    suspend fun appClosed() {
        // The app opened again before this ran: keep the short interval.
        if (setup.appOpen) return
        val session = supervisor.session.value ?: return
        runCatching {
            setup.applyOptions(
                session.rest,
            )
        }.onFailure { log.w(it) { "The reconnect interval was not changed" } }
    }

    /**
     * Sends the ignore list of the tasks folder again after an artifact request (openspec
     * gate-full-context). With no running engine, the config step of the next start sends it.
     */
    suspend fun applyIgnores(workspace: String) {
        val session = supervisor.session.value ?: return
        setup.applyIgnores(session.rest, workspace)
    }

    /** Adds a workspace folder (pairing gives the id); the engine shares its 2 folders. */
    suspend fun addWorkspace(workspace: String) {
        require(WORKSPACE_ID.matches(workspace)) { "The workspace id $workspace is not valid" }
        for (kind in FolderKind.entries) Files.createDirectories(paths.folder(workspace, kind))
        register(workspace)
        val session = supervisor.session.value
        if (session == null) start() else setup.apply(session.rest, session.identity.deviceId)
    }

    suspend fun addPeer(peer: PeerRecord) {
        val session = supervisor.session.value
        peers.add(peer, session?.identity?.deviceId)
        if (session != null) setup.apply(session.rest, session.identity.deviceId)
    }

    suspend fun removePeer(device: String) {
        val removed = peers.read().filter { it.device == device || it.syncId == device }
        peers.remove(device)
        val session = supervisor.session.value ?: return
        removed.forEach { session.rest.deleteDevice(it.syncId) }
        setup.apply(session.rest, session.identity.deviceId)
    }

    /** Replaces the peer list (the peers of the signed device records) and applies it when it changed. */
    suspend fun setPeers(list: List<PeerRecord>) {
        list.forEach(PeerStore::check)
        val wanted = list.sortedBy { it.device }
        if (peers.read().sortedBy { it.device } == wanted) return
        peers.write(wanted)
        val session = supervisor.session.value ?: return
        setup.apply(session.rest, session.identity.deviceId)
    }

    /**
     * Removes a workspace from the phone: its 2 engine folders, its index refresh and its folder
     * (a pairing whose `tasks/workspace.yaml` names another workspace).
     */
    @OptIn(ExperimentalPathApi::class)
    suspend fun removeWorkspace(workspace: String) {
        require(WORKSPACE_ID.matches(workspace)) { "The workspace id $workspace is not valid" }
        supervisor.session.value?.rest?.let { rest ->
            for (kind in FolderKind.entries) {
                val id = folderId(workspace, kind)
                if (rest.folderJson(id) != null) rest.deleteFolder(id)
            }
        }
        refresher.unregister(workspace)
        paths.workspace(workspace).deleteRecursively()
    }

    // ---- Pairing (docs/phase-1.md 7; the routes and values of plugins/sync-syncthing transport.ts) ----

    /**
     * Starts the engine for a pairing, also with no workspace, and gives the sync device id of this
     * phone. Null when the engine did not start in [timeoutMs].
     */
    suspend fun startForPairing(timeoutMs: Long = PAIRING_START_MS): String? {
        pairing = true
        if (supervisor.session.value == null) supervisor.start()
        return withTimeoutOrNull(timeoutMs) { supervisor.session.first { it != null } }?.identity?.deviceId
    }

    /** Ends the pairing mode: the engine runs on only when the phone has a workspace. */
    suspend fun endPairing() {
        pairing = false
        pairingDevices.clear()
        if (!hasWorkspace()) supervisor.stop()
    }

    private fun session(): EngineSession = checkNotNull(supervisor.session.value) { "The sync engine does not run" }

    /** Adds the device of a pairing with no workspace folder; its addresses, or `dynamic`. */
    suspend fun addPairingDevice(
        syncId: String,
        name: String,
        addresses: List<String>,
    ) {
        val rest = session().rest
        pairingDevices.add(syncId)
        if (rest.devices().none { it.deviceID == syncId }) {
            rest.putDevice(
                EngineDevice(
                    deviceID = syncId,
                    name = name,
                    addresses = addresses.ifEmpty { listOf("dynamic") },
                    compression = "metadata",
                    introducer = false,
                    autoAcceptFolders = false,
                    paused = false,
                ),
            )
        }
    }

    /** Shares the pairing folder `aw-pair-<nonce>` at a path with one device. */
    suspend fun addPairingFolder(
        id: String,
        path: String,
        device: String,
    ) {
        val session = session()
        val devices = listOf(session.identity.deviceId, device).sorted()
        session.rest.putFolder(
            id,
            buildJsonObject {
                put("id", id)
                put("label", "pairing")
                put("path", path)
                put("type", "sendreceive")
                put("devices", buildJsonArray { devices.forEach { add(buildJsonObject { put("deviceID", it) }) } })
                put("fsWatcherEnabled", true)
                put("fsWatcherDelayS", 1)
                put("rescanIntervalS", PAIRING_RESCAN_S)
                put("maxConflicts", EngineSetup.MAX_CONFLICTS)
                put("paused", false)
            },
        )
        session.rest.setIgnores(id, listOf(EngineSetup.TMP_IGNORE))
    }

    /** Scans a folder, so a new file goes to the other device at once. */
    suspend fun scanFolder(id: String) {
        session().rest.scan(id)
    }

    suspend fun removePairingFolder(id: String) {
        val rest = supervisor.session.value?.rest ?: return
        if (rest.folderJson(id) != null) rest.deleteFolder(id)
    }

    /** Removes the device of a pairing from the engine, unless it is a peer now. */
    suspend fun removePairingDevice(syncId: String) {
        pairingDevices.remove(syncId)
        val rest = supervisor.session.value?.rest ?: return
        if (peers.read().none { it.syncId == syncId } && rest.devices().any { it.deviceID == syncId }) {
            rest.deleteDevice(syncId)
        }
    }

    /** The status of each peer; all offline when the engine does not run. */
    suspend fun status(): List<PeerStatus> {
        val session = supervisor.session.value
        if (session != null) return monitor.status(session.rest)
        return peers.read().map { SyncRules.peerStatus(it.device, null, emptyList(), null, null) }
    }

    /** "Sync now" (docs/phase-1.md 6.4): starts the engine when it does not run, then syncs. */
    suspend fun syncNow(timeoutMs: Long = SyncMonitor.PHONE_TIMEOUT_MS): SyncResult {
        val started = platform.clock.now()
        if (supervisor.session.value == null) start()
        // An engine that cannot start gives its cause at once, not after the timeout (review L5).
        val cause =
            when {
                !hasWorkspace() && !pairing -> "This phone has no workspace yet: sync is off"
                supervisor.state.value == EngineState.NOT_INSTALLED -> "The sync engine is not installed: sync is off"
                else -> null
            }
        if (cause != null) return SyncResult(ok = false, peers = status(), pending = emptyList(), stopped = cause)
        val session = withTimeoutOrNull(timeoutMs) { supervisor.session.first { it != null } }
        if (session == null) {
            val list = status()
            return SyncResult(
                ok = list.isEmpty(),
                peers = list,
                pending = list.mapNotNull { SyncRules.pendingOf(it, true) },
            )
        }
        val left = (timeoutMs - (platform.clock.now() - started)).coerceAtLeast(MIN_LEFT_MS)
        return monitor.syncNow(session.rest, left)
    }

    /**
     * A targeted scan after a write of the phone (docs/phase-1.md 6.3.1): [path] is relative to the
     * workspace folder, for example `tasks/<task id>/log/<device>.jsonl`.
     */
    suspend fun wrote(
        workspace: String,
        path: String,
    ) {
        val kind = FolderKind.entries.firstOrNull { path == it.folder || path.startsWith("${it.folder}/") } ?: return
        val sub = path.removePrefix(kind.folder).removePrefix("/")
        val session = supervisor.session.value ?: return
        runCatching { session.rest.scan(folderId(workspace, kind), sub.ifEmpty { null }) }
            .onFailure { log.d(it) { "A targeted scan failed" } }
    }

    companion object {
        /** The presence refresh of an open app (the awd presence check also runs every 30 s). */
        const val PRESENCE_TICK_MS = 30_000L
        private val WORKSPACE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9_-]*$")
        private const val MIN_LEFT_MS = 1_000L
        private const val PAIRING_START_MS = 30_000L
        private const val PAIRING_RESCAN_S = 10
    }
}
