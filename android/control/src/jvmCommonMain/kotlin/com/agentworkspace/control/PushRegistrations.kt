package com.agentworkspace.control

import co.touchlab.kermit.Logger
import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.files.WorkspaceWriter
import com.agentworkspace.shared.model.IsoTime
import com.agentworkspace.shared.model.TimeSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.IOException

/** What Devices shows about push. */
enum class PushState {
    WAITING_FOR_COMPUTERS,
    REGISTERING,
    ON,
    FAILED,
    NO_DISTRIBUTOR,
    ;

    companion object {
        /** One state for the phone: the worst state of its workspaces (design decision 11). */
        fun combine(states: Collection<PushState>): PushState =
            when {
                NO_DISTRIBUTOR in states -> NO_DISTRIBUTOR
                FAILED in states -> FAILED
                REGISTERING in states -> REGISTERING
                ON in states -> ON
                else -> WAITING_FOR_COMPUTERS
            }
    }
}

/** The UnifiedPush calls of the app (the port of [PushRegistrations]; the app adapter calls the connector). */
interface PushConnector {
    fun register(
        instance: String,
        vapidKey: String,
    )

    fun unregister(instance: String)

    /** Selects a distributor with no picker. False when the phone has none. */
    fun useDistributor(): Boolean

    /** The package of the distributor that answered, or null. */
    fun distributor(): String?
}

/** A new endpoint of an instance, with the RFC 8291 keys of the phone (base64url). */
data class PushEndpoint(
    val url: String,
    val p256dh: String,
    val auth: String,
)

/**
 * The push registrations of the phone for every joined workspace (docs/phase-1.md 8.2): one
 * UnifiedPush instance `<workspace>/<computer>` per computer with a VAPID key, and the endpoints in
 * `push.yaml` of that workspace. One lock serializes each read and write of `push.yaml`.
 */
@Suppress("LongParameterList")
class PushRegistrations(
    private val connector: PushConnector,
    private val files: (String) -> WorkspaceFiles,
    private val writer: (String) -> WorkspaceWriter,
    /** The snapshot of a workspace, read again from the index (a cold process has none loaded). */
    private val snapshot: suspend (String) -> WorkspaceSnapshot,
    /** A targeted scan after a write of the phone. */
    private val wrote: suspend (String, String) -> Unit,
    private val phone: () -> String,
    private val time: TimeSource,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val log: Logger = Logger.withTag("aw-push"),
) {
    private val lock = Mutex()

    /** The VAPID key of each instance that this process asked the distributor for. */
    private val requested = HashMap<String, String>()

    /** The VAPID key of each instance whose registration failed in this process (review android-ui M2). */
    private val failed = HashMap<String, String>()
    private val states = HashMap<String, PushState>()
    private val mutableState = MutableStateFlow(PushState.WAITING_FOR_COMPUTERS)

    val state: StateFlow<PushState> = mutableState.asStateFlow()

    /**
     * Follows the snapshot of every joined workspace, not only the shown one, and registers each
     * (design decision 7). The app starts it in its own scope, so it runs also with no screen open.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun follow(
        workspaces: Flow<List<String>>,
        snapshots: (String) -> Flow<WorkspaceSnapshot>,
        scope: CoroutineScope,
    ): Job =
        scope.launch {
            workspaces
                .onEach { ids -> lock.withLock { keepStates(ids) } }
                .flatMapLatest { ids -> ids.map(snapshots).merge() }
                .collect { update(it) }
        }

    /**
     * Forgets the failed registrations, so the next snapshot registers them again. The app calls it at
     * each app open: a failure (no network, Play services in an update) must not stop push for the life
     * of the process (review phone-workspaces M1).
     */
    suspend fun retryFailed() = lock.withLock { failed.clear() }

    /** Registers the computers of one workspace with a new or changed key and removes the ones with no key. */
    @Suppress("TooGenericExceptionCaught")
    suspend fun update(snapshot: WorkspaceSnapshot) {
        if (!snapshot.loaded) return
        try {
            lock.withLock { withContext(io) { plan(snapshot) } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.e(e) { "The push registration of ${snapshot.workspace} failed" }
        }
    }

    private suspend fun plan(snapshot: WorkspaceSnapshot) {
        val ws = snapshot.workspace
        val keys = PushRegistry.vapidKeys(snapshot)
        var file = PushFile.read(files(ws), snapshot.phone)
        val (register, remove) = PushRegistry.plan(keys, file)
        for (computer in remove) {
            val instance = PushRegistry.instance(ws, computer)
            connector.unregister(instance)
            requested.remove(instance)
            failed.remove(instance)
            file = file.without(computer)
            write(ws, file)
        }
        if (keys.isEmpty()) return setState(ws, PushState.WAITING_FOR_COMPUTERS)
        val todo =
            register.filter { (computer, key) ->
                val instance = PushRegistry.instance(ws, computer)
                requested[instance] != key && failed[instance] != key
            }
        if (todo.isEmpty()) {
            val anyFailed = register.any { (computer, key) -> failed[PushRegistry.instance(ws, computer)] == key }
            when {
                anyFailed -> setState(ws, PushState.FAILED)
                register.isEmpty() -> setState(ws, PushState.ON)
                else -> Unit // The distributor has not answered yet.
            }
            return
        }
        if (!connector.useDistributor()) return setState(ws, PushState.NO_DISTRIBUTOR)
        setState(ws, PushState.REGISTERING)
        for ((computer, key) in todo) {
            val instance = PushRegistry.instance(ws, computer)
            requested[instance] = key
            connector.register(instance, key)
        }
    }

    /**
     * A new endpoint of an instance goes to `push.yaml` of its workspace. The VAPID key comes from this
     * process, else from the existing entry of `push.yaml`, else from the index read again: a cold
     * process has neither the requests nor a loaded snapshot (review android-ui H2).
     */
    suspend fun onEndpoint(
        instance: String,
        endpoint: PushEndpoint,
    ) = guarded(instance) {
        val (ws, computer) = PushRegistry.parseInstance(instance) ?: return@guarded
        val file = PushFile.read(files(ws), phone())
        val vapid =
            requested[instance]
                ?: file.subscriptions.firstOrNull { it.computer == computer }?.vapidPublicKey
                ?: PushRegistry.vapidKeys(snapshot(ws))[computer]
        if (vapid == null) {
            log.w { "The endpoint of $computer in $ws has no VAPID key: dropped" }
            return@guarded
        }
        failed.remove(instance)
        val subscription =
            PushSubscription(
                computer = computer,
                endpoint = endpoint.url,
                p256dh = endpoint.p256dh,
                auth = endpoint.auth,
                vapidPublicKey = vapid,
                distributor = connector.distributor(),
                updated = IsoTime.format(time.now()),
            )
        val next = file.with(subscription)
        write(ws, next)
        setState(ws, stateOf(ws, next))
    }

    /**
     * The push state of a workspace after an endpoint: failed when one of its computers failed,
     * registering while one has no endpoint yet, else on (review phone-workspaces L5).
     */
    private fun stateOf(
        ws: String,
        file: PushFile,
    ): PushState {
        val prefix = "$ws/"
        if (failed.keys.any { it.startsWith(prefix) }) return PushState.FAILED
        val waiting =
            requested.any { (instance, key) ->
                instance.startsWith(prefix) &&
                    file.subscriptions.none {
                        PushRegistry.instance(ws, it.computer) == instance &&
                            it.vapidPublicKey == key
                    }
            }
        return if (waiting) PushState.REGISTERING else PushState.ON
    }

    suspend fun onUnregistered(instance: String) =
        guarded(instance) {
            val (ws, computer) = PushRegistry.parseInstance(instance) ?: return@guarded
            requested.remove(instance)
            write(ws, PushFile.read(files(ws), phone()).without(computer))
        }

    /** A failed registration: Devices shows it, and the same key does not register again in this process (M2). */
    suspend fun onFailed(instance: String) =
        guarded(instance) {
            val (ws, computer) = PushRegistry.parseInstance(instance) ?: return@guarded
            val key = requested.remove(instance) ?: PushRegistry.vapidKeys(snapshot(ws))[computer]
            if (key != null) failed[instance] = key
            log.w { "The push registration of $instance failed" }
            setState(ws, PushState.FAILED)
        }

    @Suppress("TooGenericExceptionCaught")
    private suspend fun guarded(
        instance: String,
        block: suspend () -> Unit,
    ) {
        try {
            lock.withLock { withContext(io) { block() } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.e(e) { "The push change of $instance failed" }
        }
    }

    private suspend fun write(
        workspace: String,
        file: PushFile,
    ) {
        try {
            PushRegistry.write(writer(workspace), file)
        } catch (e: IOException) {
            log.e(e) { "push.yaml of $workspace could not be written" }
            return
        }
        wrote(workspace, PushFile.path(file.device))
    }

    private fun keepStates(ids: List<String>) {
        states.keys.retainAll(ids.toSet())
        mutableState.value = PushState.combine(states.values)
    }

    private fun setState(
        workspace: String,
        state: PushState,
    ) {
        states[workspace] = state
        mutableState.value = PushState.combine(states.values)
    }
}
