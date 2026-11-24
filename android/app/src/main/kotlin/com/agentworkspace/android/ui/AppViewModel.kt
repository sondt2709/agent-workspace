package com.agentworkspace.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentworkspace.android.AppGraph
import com.agentworkspace.control.ActionResult
import com.agentworkspace.control.ApproachVersions
import com.agentworkspace.control.ArtifactList
import com.agentworkspace.control.ArtifactRequests
import com.agentworkspace.control.ArtifactRow
import com.agentworkspace.control.ArtifactRule
import com.agentworkspace.control.Navigator
import com.agentworkspace.control.NewTaskDraft
import com.agentworkspace.control.PairingRefused
import com.agentworkspace.control.PairingState
import com.agentworkspace.control.PairingStatus
import com.agentworkspace.control.Route
import com.agentworkspace.control.SessionOptionsDraft
import com.agentworkspace.control.Shortcut
import com.agentworkspace.control.Tab
import com.agentworkspace.control.TerminalPane
import com.agentworkspace.control.TerminalPaneState
import com.agentworkspace.control.ThreadWindow
import com.agentworkspace.control.WidthClass
import com.agentworkspace.control.WorkspaceEntry
import com.agentworkspace.control.WorkspaceNavigation
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.control.WorkspaceSwitcher
import com.agentworkspace.engine.PeerStatus
import com.agentworkspace.engine.PendingReason
import com.agentworkspace.engine.SyncResult
import com.agentworkspace.shared.merge.TaskView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The state of the app window: the one back stack (it survives a fold, an unfold and a resize), the
 * snapshot of the open workspace, the sync state and the actions. The screens are functions of it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooManyFunctions") // One action per screen button; gate-full-context added the artifacts.
class AppViewModel(
    private val graph: AppGraph,
) : ViewModel() {
    val backStack = mutableStateListOf<Route>(Route.Home)
    val navigator = Navigator(backStack)

    /** The width class of the window; the root sets it at each size change. */
    var widthClass by mutableStateOf(WidthClass.COMPACT)

    /** The workspace that the screens show: the selection of the switcher (it survives a restart). */
    private val workspaceId = graph.switcher.selected

    private val workspaceNavigation = WorkspaceNavigation(graph.switcher, navigator)

    /** The rows of the workspace menu: each joined workspace with its name and "Needs you" count. */
    val workspaces: StateFlow<List<WorkspaceEntry>> =
        graph.switcher.workspaces
            .flatMapLatest { ids ->
                if (ids.isEmpty()) {
                    flowOf(emptyMap())
                } else {
                    combine(ids.map { id -> graph.workspace(id).model.snapshot }) { list ->
                        list.associateBy { it.workspace }
                    }
                }
            }.combine(workspaceId) { snapshots, selected ->
                WorkspaceSwitcher.entries(snapshots.keys.toList(), selected, snapshots)
            }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_MS), emptyList())

    val snapshot: StateFlow<WorkspaceSnapshot?> =
        workspaceId
            .flatMapLatest { id -> id?.let { graph.workspace(it).model.snapshot } ?: flowOf(null) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_MS), null)

    /** The time of the "ago" texts, once per second. */
    val now: StateFlow<Long> =
        flow {
            while (true) {
                emit(graph.time.now())
                delay(TICK_MS)
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_MS), graph.time.now())

    /** The sync state of each engine peer, every 5 s while a screen shows. */
    val peers: StateFlow<List<PeerStatus>> =
        flow {
            while (true) {
                emit(runCatching { graph.engine.status() }.getOrDefault(emptyList()))
                delay(PEERS_MS)
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_MS), emptyList())

    val engineState = graph.engine.state
    val pushState = graph.push.state

    /**
     * True when the phone replaced a device key that it could not read. Declared before the init block:
     * init calls resumed(), which writes it.
     */
    var keyReplaced by mutableStateOf(graph.keyReplaced.exists())
        private set

    var batteryRestricted by mutableStateOf(graph.battery.isRestricted())
        private set

    var syncing by mutableStateOf(false)
        private set

    /** The result line of the last "Sync now". */
    var syncText by mutableStateOf<String?>(null)
        private set

    private val messageFlow = MutableSharedFlow<String>(extraBufferCapacity = 8)

    /** The short texts for the snackbar: a refused action, a sent answer. */
    val messages: SharedFlow<String> = messageFlow.asSharedFlow()

    /** The open or the last pairing of this phone. */
    val pairing: StateFlow<PairingStatus?> = graph.pairing.status

    /** The slug of a phone that paired before: a later join keeps it (null before the first pairing). */
    val storedSlug: String?
        get() = graph.pairing.storedSlug()

    /** True while a join call runs (the engine starts). */
    var joining by mutableStateOf(false)
        private set

    val credentialAddAvailable: Boolean
        get() = workspaceId.value?.let { graph.workspace(it).outbox.available } ?: false

    init {
        // A finished pairing: the switcher selects the new workspace (AppGraph); read the list again.
        viewModelScope.launch { pairing.collect { if (it?.state == PairingState.DONE) resumed() } }
        // A join that ends while the screens show: the new workspace and the root of the open tab. The
        // first value is skipped: a join that ended before this window must not change the selection.
        viewModelScope.launch {
            pairing
                .drop(1)
                .filter { it?.state == PairingState.DONE }
                .collect { status -> status?.let { workspaceNavigation.joined(it.workspaceId) } }
        }
    }

    /** Shows another joined workspace; the back stack goes back to the root of the open tab. */
    fun switchWorkspace(id: String) {
        if (!workspaceNavigation.switchTo(id)) messageFlow.tryEmit("This workspace is not on this phone")
    }

    /** Joins a workspace with a pairing code (docs/phase-1.md 7). */
    fun join(
        code: String,
        name: String,
    ) {
        if (joining) return
        joining = true
        viewModelScope.launch {
            try {
                graph.pairing.join(code, name)
            } catch (e: PairingRefused) {
                messageFlow.tryEmit(e.message.orEmpty())
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                // Any other error is a message on the screen, never a stop of the app.
                messageFlow.tryEmit("The pairing did not start (${e.message}): try again")
            } finally {
                joining = false
            }
        }
    }

    fun cancelPairing() {
        viewModelScope.launch { graph.pairing.cancel() }
    }

    fun message(text: String) {
        messageFlow.tryEmit(text)
    }

    /** The person read the warning of the replaced device key. */
    fun dismissKeyReplaced() {
        graph.keyReplaced.delete()
        keyReplaced = false
    }

    /** The app came to the front: read the workspaces, the battery mode and the key mark again. */
    fun resumed() {
        graph.switcher.refresh()
        batteryRestricted = graph.battery.isRestricted()
        keyReplaced = graph.keyReplaced.exists()
        // A failed push registration registers again at the next snapshot (review phone-workspaces M1).
        viewModelScope.launch { graph.push.registrations.retryFailed() }
    }

    fun batterySettings() = graph.battery.settingsIntent()

    fun select(tab: Tab) = navigator.select(tab)

    /** Opens a task; on a large window also its thread in the third pane. */
    fun openTask(id: String) {
        navigator.open(Route.Task(id))
        if (widthClass.threadPane) navigator.open(Route.Thread(id))
    }

    /** A notification tap: the workspace of the push, then `[Inbox, Task(id)]`, or `[Inbox]` with no task. */
    fun openFromPush(
        workspace: String?,
        task: String?,
    ) {
        if (!workspaceNavigation.openFromPush(workspace, task)) message("This workspace is not on this phone")
    }

    fun back(): Boolean = navigator.back()

    /** Runs a keyboard shortcut. False when the key is not a shortcut here. */
    fun shortcut(shortcut: Shortcut): Boolean =
        when (shortcut) {
            Shortcut.NEW_TASK -> true.also { navigator.open(Route.NewTask) }
            Shortcut.SYNC_NOW -> true.also { syncNow() }
            Shortcut.CLOSE -> back()
        }

    fun syncNow() {
        if (syncing) return
        syncing = true
        viewModelScope.launch {
            try {
                syncText = describe(graph.engine.syncNow())
            } finally {
                syncing = false
            }
        }
    }

    private fun describe(result: SyncResult): String {
        result.stopped?.let { return it }
        if (result.ok) {
            val count = result.peers.size
            return if (count == 0) "No device to sync with yet" else "Synced with $count devices"
        }
        return result.pending.joinToString("; ") { p ->
            val why = if (p.reason == PendingReason.OFFLINE) "offline" else "timed out"
            "${p.device}: ${p.items} changes not synced ($why)"
        }
    }

    private fun act(
        done: String?,
        block: suspend (AppGraph.WorkspaceGraph) -> ActionResult,
        onEnd: () -> Unit = {},
        then: (ActionResult.Done) -> Unit = {},
    ) {
        val id = workspaceId.value
        if (id == null) {
            messageFlow.tryEmit("This phone has no workspace yet")
            onEnd()
            return
        }
        viewModelScope.launch {
            try {
                when (val result = block(graph.workspace(id))) {
                    is ActionResult.Done -> {
                        done?.let(messageFlow::tryEmit)
                        then(result)
                    }

                    is ActionResult.Refused -> {
                        messageFlow.tryEmit(result.message)
                    }
                }
            } finally {
                onEnd()
            }
        }
    }

    fun answer(
        task: String,
        gate: String,
        answer: String,
        comment: String?,
        sent: () -> Unit = {},
    ) = act(null, { it.actions.answerGate(task, gate, answer, comment) }) { sent() }

    fun sendMessage(
        task: String,
        text: String,
        sent: () -> Unit,
    ) = act("Message sent", { it.actions.sendMessage(task, text) }) { sent() }

    fun assign(
        task: String,
        assignee: String,
    ) = act("Assigned to $assignee", { it.actions.assign(task, assignee) })

    /** New session: an assign with the session options that the person changed (openspec session-options). */
    fun newSession(
        task: String,
        assignee: String,
        options: SessionOptionsDraft?,
    ) = act("New session requested on $assignee", { it.actions.assign(task, assignee, options) })

    /** Stop session: the session device stops the running session (openspec session-options). */
    fun stopSession(task: String) = act("Stop requested", { it.actions.stopSession(task) })

    /** Archive task: a running session gets a stop request first (openspec task-actions). */
    fun archiveTask(task: String) = act("Archived", { it.actions.archiveTask(task) })

    fun unarchiveTask(task: String) = act("Unarchived", { it.actions.unarchiveTask(task) })

    /** True while a create runs: the button is off, so a double tap makes one task (android-ui M3). */
    var creating by mutableStateOf(false)
        private set

    fun createTask(draft: NewTaskDraft) {
        if (creating) return
        creating = true
        act("Task created", { it.actions.createTask(draft) }, onEnd = { creating = false }) { done ->
            // The person can have left the form: then the open screen stays (android-ui L3).
            if (navigator.close(Route.NewTask)) openTask(done.task)
        }
    }

    /** Seals the value into the outbox; the array is cleared in every case. */
    fun addCredential(
        name: String,
        value: CharArray,
    ) = act("Credential sealed for the computers", { ws ->
        val snapshot = ws.model.snapshot.value
        ws.outbox.add(snapshot.phone, name, value, ws.outbox.recipients(snapshot.records))
    }) { navigator.close(Route.AddCredential) }

    /** The thread window of a task, read from the index: the newest `limit` events (fix list 0-20). */
    suspend fun thread(
        task: String,
        limit: Int,
    ): ThreadWindow = workspaceId.value?.let { graph.workspace(it).model.thread(task, limit) } ?: ThreadWindow.EMPTY

    /** The full text of an approach version: its synced file, or null (openspec gate-full-context). */
    suspend fun approachText(
        task: String,
        version: Long,
    ): String? =
        withContext(Dispatchers.IO) {
            workspaceId.value?.let { ApproachVersions.text(graph.workspace(it).files, task, version) }
        }

    /** The artifacts of a task with their state on this phone (docs/phase-1.md 10.3). */
    suspend fun artifacts(task: String): List<ArtifactRow> {
        val ws = workspaceId.value ?: return emptyList()
        val rows = graph.workspace(ws).model.artifactEvents(task)
        return withContext(Dispatchers.IO) {
            ArtifactList.of(
                task,
                rows,
                graph.artifactRequests.read(ws).toSet(),
                ArtifactList.localSize(graph.workspace(ws).files),
            )
        }
    }

    /** The switch "Use mobile data for artifacts" (off by default). */
    var mobileData by mutableStateOf(graph.mobileData.allowed())
        private set

    fun setMobileDataAllowed(on: Boolean) {
        viewModelScope.launch(Dispatchers.IO) { graph.mobileData.set(on) }
        mobileData = on
    }

    /** Download: the network rule, then the request and the new ignore list of the engine. */
    fun download(row: ArtifactRow): Boolean {
        val ws = workspaceId.value ?: return false
        val refused = ArtifactRule.check(graph.network.metered(), graph.mobileData.allowed())
        if (refused != null) {
            messageFlow.tryEmit(refused)
            return false
        }
        if (!ArtifactRequests.REQUEST.matches(row.request)) {
            messageFlow.tryEmit("AW cannot download ${row.name}: the path is not an artifact path.")
            return false
        }
        viewModelScope.launch {
            val added = withContext(Dispatchers.IO) { graph.artifactRequests.add(ws, row.request) }
            if (!added) return@launch
            runCatching { graph.engine.applyIgnores(ws) }
            messageFlow.tryEmit("Downloading ${row.name}")
        }
        return true
    }

    /** Open: a downloaded artifact in an app of the phone. */
    fun openArtifact(row: ArtifactRow) {
        val ws = workspaceId.value ?: return
        graph.artifactOpener.open(graph.workspace(ws).root, row)?.let { messageFlow.tryEmit(it) }
    }

    /** The newest synced terminal snapshot of a task (openspec task-terminal-view), read off the main thread. */
    suspend fun terminal(task: TaskView): TerminalPaneState =
        withContext(Dispatchers.IO) {
            workspaceId.value?.let { TerminalPane.read(graph.workspace(it).files, task, graph.time.now()) }
                ?: TerminalPaneState(null, null, TerminalPane.EMPTY)
        }

    private companion object {
        const val STOP_MS = 5_000L
        const val TICK_MS = 1_000L
        const val PEERS_MS = 5_000L
    }
}
