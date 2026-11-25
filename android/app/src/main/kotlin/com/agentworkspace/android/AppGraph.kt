package com.agentworkspace.android

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import co.touchlab.kermit.Logger
import com.agentworkspace.android.push.GateNotifications
import com.agentworkspace.android.push.PushRegistrar
import com.agentworkspace.control.AgeCredentialSealer
import com.agentworkspace.control.ArtifactRequests
import com.agentworkspace.control.ControllerPairing
import com.agentworkspace.control.CredentialOutbox
import com.agentworkspace.control.MobileDataSetting
import com.agentworkspace.control.PairingState
import com.agentworkspace.control.PhoneActions
import com.agentworkspace.control.PhoneIdentityStore
import com.agentworkspace.control.PhonePairing
import com.agentworkspace.control.ProposalTextSetting
import com.agentworkspace.control.RecordPeers
import com.agentworkspace.control.SealedOutboxCleanup
import com.agentworkspace.control.WorkspaceModel
import com.agentworkspace.control.WorkspaceSelectionStore
import com.agentworkspace.control.WorkspaceSwitcher
import com.agentworkspace.engine.EnginePaths
import com.agentworkspace.engine.EnginePlatform
import com.agentworkspace.engine.EngineSettings
import com.agentworkspace.engine.LocalSocketConnector
import com.agentworkspace.engine.ProcessEngineLauncher
import com.agentworkspace.engine.StaleEngines
import com.agentworkspace.engine.SyncEngineController
import com.agentworkspace.identity.DeviceKeyStore
import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.files.NioWorkspaceWriter
import com.agentworkspace.shared.index.WorkspaceIndex
import com.agentworkspace.shared.index.openWorkspaceIndex
import com.agentworkspace.shared.model.HybridLogicalClock
import com.agentworkspace.shared.model.TimeSource
import com.agentworkspace.shared.write.EventWriter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * The one object graph of the app (manual DI, docs/tech-stack.md 2.5): one scope with a logging
 * exception handler, the sync engine controller, and one [WorkspaceGraph] per workspace.
 */
class AppGraph(
    private val app: Application,
) {
    private val log = Logger.withTag("aw-app")

    val scope =
        CoroutineScope(
            SupervisorJob() + Dispatchers.Default +
                CoroutineExceptionHandler { _, e -> log.e(e) { "A background job failed" } },
        )

    val paths = EnginePaths(app.filesDir.toPath())

    val time = TimeSource { System.currentTimeMillis() }

    /** The identity files of the phone: `identity.json`, `device-slug`, `records/`, `pairing/`. */
    val identity = PhoneIdentityStore(app.filesDir.toPath())

    /**
     * The mark of a replaced device key: Devices tells the person until they dismiss it (review
     * android-pairing low 4: "Nothing silent"). The key loads only for a pairing.
     */
    val keyReplaced: File = File(app.filesDir, "device-key-replaced")

    /** The device key of the phone, encrypted with a key of the Android Keystore. */
    val deviceKeys =
        DeviceKeyStore(app.filesDir.toPath().resolve("device-key.bin"), KeystoreSecretBox()) { e ->
            log.w(e) { "The device key could not be opened: the phone makes a new one and pairs again" }
            runCatching { keyReplaced.writeText("${System.currentTimeMillis()}\n") }
        }

    /** One Room index per workspace: the engine refresher writes it and the screens read it. */
    private val indexes = ConcurrentHashMap<String, WorkspaceIndex>()

    // computeIfAbsent, not getOrPut: 2 threads must not open 2 indexes or 2 graphs of one workspace.
    private fun index(workspace: String): WorkspaceIndex =
        indexes.computeIfAbsent(workspace) {
            openWorkspaceIndex(app, workspace)
        }

    /**
     * One graph per workspace. It is declared before the `init` block: the push registration job of
     * `init` reads it on another thread at once (review phone-workspaces H1).
     */
    private val workspaces = ConcurrentHashMap<String, WorkspaceGraph>()

    val engine =
        SyncEngineController(
            platform =
                EnginePlatform(
                    paths = paths,
                    launcher =
                        ProcessEngineLauncher(
                            File(app.applicationInfo.nativeLibraryDir, StaleEngines.BINARY_NAME).toPath(),
                        ),
                    connector = LocalSocketConnector,
                    openIndex = ::index,
                    // SIGKILL; Android allows it only for a process of this app (the same uid).
                    kill = { pid -> android.os.Process.killProcess(pid.toInt()) },
                    clock = time,
                    // The merge checks the signed device records once the phone knows the master key.
                    recordVerifier = { identity.verifier() },
                ),
            scope = scope,
            engineSettings = { EngineSettings(name = deviceSlug()) },
            artifactRequests = { workspace -> artifactRequests.read(workspace) },
        )

    /** The artifacts that the person requested on this phone (openspec gate-full-context). */
    val artifactRequests = ArtifactRequests(app.filesDir.toPath().resolve("artifact-requests"))

    /** The switch "Use mobile data for artifacts" (off by default). */
    val mobileData = MobileDataSetting(app.filesDir.toPath().resolve("artifacts-mobile-data"))

    /** The text size of the proposals on this phone (openspec proposal-and-discussion). */
    val proposalText = ProposalTextSetting(app.filesDir.toPath().resolve("proposal-text-px"))

    val network = NetworkCheck(app)

    val artifactOpener = ArtifactOpener(app)

    val battery = BatteryCheck(app)

    val push = PushRegistrar(app, this)

    /** The pairing of this phone with a computer (docs/phase-1.md 7). */
    val pairing = PhonePairing(identity, deviceKeys, ControllerPairing(engine), time, scope)

    /** The joined workspaces and the one that the screens show (`<files>/selected-workspace`). */
    val switcher =
        WorkspaceSwitcher(
            joined = { engine.workspaces() },
            store = WorkspaceSelectionStore(app.filesDir.toPath().resolve("selected-workspace")),
        )

    init {
        // Push for every joined workspace, also with no screen open (openspec phone-workspaces).
        push.registrations.follow(switcher.workspaces, { workspace(it).model.snapshot }, scope)
        // A finished join shows the new workspace.
        scope.launch {
            pairing.status
                .filterNotNull()
                .filter { it.state == PairingState.DONE }
                .distinctUntilChanged()
                .collect { switcher.joined(it.workspaceId) }
        }
        // The peers come from the signed records after each index refresh (docs/phase-1.md 6.2).
        scope.launch { engine.refresher.updates.collect { updatePeers() } }
        // A finished pairing starts the foreground service of the engine (the app is open).
        scope.launch {
            pairing.status
                .map { it?.state }
                .distinctUntilChanged()
                .filter { it == PairingState.DONE }
                .collect { SyncEngineService.start(app) }
        }
    }

    /**
     * Sets the engine peers from the kept device records of each workspace, or from the cached records
     * of the pairing while the index has none. Only after a pairing: the merge checks the records then.
     */
    suspend fun updatePeers() {
        if (identity.identity() == null) return
        val records =
            engine.workspaces().map { ws ->
                index(ws)
                    .documents()
                    .filter { it.kind == "device" }
                    .map { it.value }
                    .ifEmpty { identity.records(ws) }
            }
        val peers = RecordPeers.plan(records, deviceSlug()) ?: return
        runCatching { engine.setPeers(peers) }.onFailure { log.w(it) { "The peers of the records were not set" } }
    }

    /** The graph of a workspace of this phone (a folder of `<files>/aw/`). */
    fun workspace(id: String): WorkspaceGraph = workspaces.computeIfAbsent(id) { WorkspaceGraph(it) }

    /**
     * The AW device slug of the phone: the engine device name. The pairing writes the file
     * `device-slug` from the name that the person confirms; until then the name is [DEFAULT_SLUG].
     */
    fun deviceSlug(): String =
        File(app.filesDir, "device-slug")
            .takeIf { it.isFile }
            ?.readText()
            ?.trim()
            ?.takeIf { SLUG.matches(it) } ?: DEFAULT_SLUG

    /** The writes, the actions and the screen data of one workspace. */
    inner class WorkspaceGraph(
        val id: String,
    ) {
        val root = paths.workspace(id)
        val files = NioWorkspaceFiles(root)
        val writer = NioWorkspaceWriter(root)
        val model =
            WorkspaceModel(
                workspace = id,
                phone = ::deviceSlug,
                index = index(id),
                scope = scope,
                refreshed =
                    engine.refresher.updates
                        .filter { it.workspace == id }
                        .map { },
                clock = time,
            )
        private val events = EventWriter(writer, deviceSlug(), HybridLogicalClock(time), time)

        val actions =
            PhoneActions(
                writer = events,
                snapshot = { model.snapshot.value },
                afterWrite = { path -> afterWrite(path) },
                time = time,
            )

        init {
            // The phone rekeys its own duplicate task keys after each index refresh (offline-task-keys).
            // An error is logged and the next snapshot tries again: it never ends the collector.
            scope.launch {
                model.snapshot.collect {
                    try {
                        actions.rekeyDuplicates()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (
                        @Suppress("TooGenericExceptionCaught") e: Exception,
                    ) {
                        log.e(e) { "The rekey of the duplicate task keys of $id failed" }
                    }
                }
            }
        }

        /** Credential add: the age sealer seals to the X25519 key of each paired computer (docs/phase-1.md 10.2). */
        val outbox = CredentialOutbox(writer, AgeCredentialSealer, time)

        /** A targeted scan, then the merge and the screens at once (docs/phase-1.md 6.3.1). */
        suspend fun afterWrite(path: String) {
            engine.wrote(id, path)
            engine.refresher.refresh(id)
            model.reload()
        }

        /** Removes the sealed credential files that a computer imported (docs/phase-1.md 10.2). */
        private val sealedCleanup = SealedOutboxCleanup(index(id), files, writer)

        init {
            // Its own collector: an error is logged and never stops the rekey collector (review 0-26).
            scope.launch { sealedCleanup.follow(model.snapshot) { afterWrite(it) } }
            // A gate that another device resolved removes its notification on the phone.
            scope.launch {
                model.snapshot.collect { snapshot ->
                    runCatching { GateNotifications.cancelResolved(app, snapshot) }
                        .onFailure { log.w(it) { "The notifications of resolved gates were not removed" } }
                }
            }
        }
    }

    private companion object {
        const val DEFAULT_SLUG = "android"
        val SLUG = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")
    }
}

/**
 * The battery mode check (docs/phase-1.md 6.7.5): in "Restricted", sync stopped in Doze and came back
 * only after a force-stop and an app start, so the app shows a warning with a link to the setting.
 */
class BatteryCheck(
    private val context: Context,
) {
    fun isRestricted(): Boolean = context.getSystemService(ActivityManager::class.java).isBackgroundRestricted

    /** The app details settings, where the user changes the battery mode. */
    fun settingsIntent(): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
