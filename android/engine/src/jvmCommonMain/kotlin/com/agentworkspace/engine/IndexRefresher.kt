package com.agentworkspace.engine

import co.touchlab.kermit.Logger
import com.agentworkspace.shared.index.WorkspaceIndex
import com.agentworkspace.shared.merge.MergeEngine
import com.agentworkspace.shared.merge.MergeUpdate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.concurrent.ConcurrentHashMap

/** The result of one index refresh of a workspace. */
data class RefreshResult(
    val workspace: String,
    val update: MergeUpdate,
)

/**
 * Keeps the Room index of each workspace equal to its files (docs/phase-1.md 6.3.3: the index updates
 * from the files, never from the engine completion values). After a change, it waits [debounceMs]
 * for more changes, then runs `MergeEngine.update()` and `WorkspaceIndex.write()` (the order of
 * android-shared). A failed update is logged; the next one reads all files (all or nothing).
 */
class IndexRefresher(
    private val scope: CoroutineScope,
    private val debounceMs: Long = DEBOUNCE_MS,
    private val log: Logger = Logger.withTag("aw-index"),
) {
    private class Entry(
        val merge: MergeEngine,
        val index: WorkspaceIndex,
        val signals: Channel<Unit>,
        val job: Job,
    )

    private val entries = ConcurrentHashMap<String, Entry>()
    private val lock = Mutex()
    private val refreshed = MutableSharedFlow<RefreshResult>(extraBufferCapacity = 16)

    /** Each finished refresh. android-ui reloads its screens from it. */
    val updates: SharedFlow<RefreshResult> = refreshed.asSharedFlow()

    fun workspaces(): Set<String> = entries.keys.toSet()

    @Synchronized
    fun register(
        workspace: String,
        merge: MergeEngine,
        index: WorkspaceIndex,
    ) {
        if (entries.containsKey(workspace)) return
        val signals = Channel<Unit>(Channel.CONFLATED)
        val job =
            scope.launch {
                while (signals.receiveCatching().isSuccess) {
                    delay(debounceMs)
                    // Changes during the wait are in this refresh.
                    do {
                        val more = signals.tryReceive().isSuccess
                    } while (more)
                    refresh(workspace)
                }
            }
        entries[workspace] = Entry(merge, index, signals, job)
    }

    /** Stops the refresh of a workspace (a removed workspace). */
    fun unregister(workspace: String) {
        entries.remove(workspace)?.let {
            it.signals.close()
            it.job.cancel()
        }
    }

    /** Asks for a refresh of one workspace. */
    fun changed(workspace: String) {
        entries[workspace]?.signals?.trySend(Unit)
    }

    fun changedAll() = entries.keys.forEach(::changed)

    /** Asks for a refresh of the workspace of an engine folder id (`aw-<workspace>-<kind>`). */
    fun changedFolder(folder: String) {
        val workspace =
            entries.keys.firstOrNull { ws -> FolderKind.entries.any { folderId(ws, it) == folder } } ?: return
        changed(workspace)
    }

    /** Runs the merge and writes the index now. Null when the update failed. */
    @Suppress("TooGenericExceptionCaught")
    suspend fun refresh(workspace: String): MergeUpdate? {
        val entry = entries[workspace] ?: return null
        return lock.withLock {
            try {
                val update = entry.merge.update()
                entry.index.write(update, entry.merge)
                if (update.notices.isNotEmpty()) log.w { "Sync problem in $workspace: ${update.notices.size} notices" }
                refreshed.tryEmit(RefreshResult(workspace, update))
                update
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.e(e) { "The index refresh of $workspace failed: the next refresh reads all files" }
                null
            }
        }
    }

    fun close() {
        entries.values.forEach {
            it.signals.close()
            it.job.cancel()
        }
        entries.clear()
    }

    companion object {
        const val DEBOUNCE_MS = 500L
    }
}

/**
 * The event loops of one engine start (docs/phase-1.md 6.5.1): the disk events ask for an index
 * refresh, the engine events give the time of each peer's last change. The cursors start at 0 for each
 * engine start, because the event ids start again at 1 after an engine restart.
 */
class EngineEventLoop(
    private val refresher: IndexRefresher,
    private val monitor: SyncMonitor,
    private val log: Logger = Logger.withTag("aw-engine"),
    private val longPollS: Int = LONG_POLL_S,
    private val errorDelayMs: Long = ERROR_DELAY_MS,
) {
    fun launchIn(session: EngineSession) {
        session.scope.launch { poll(session) { since -> session.rest.diskEvents(since, longPollS) } }
        session.scope.launch { poll(session) { since -> session.rest.events(since, longPollS) } }
    }

    @Suppress("TooGenericExceptionCaught")
    private suspend fun poll(
        session: EngineSession,
        read: suspend (Long) -> List<EngineEvent>,
    ) {
        var since = 0L
        while (true) {
            val events =
                try {
                    read(since)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    log.d(e) { "An event poll of engine start ${session.generation} failed" }
                    delay(errorDelayMs)
                    continue
                }
            for (event in events) {
                since = maxOf(since, event.id)
                handle(event)
            }
        }
    }

    fun handle(event: EngineEvent) {
        when (event.type) {
            "RemoteChangeDetected", "LocalChangeDetected" -> {
                val folder = ((event.data as? JsonObject)?.get("folder") as? JsonPrimitive)?.content ?: return
                refresher.changedFolder(folder)
            }

            else -> {
                // A bad sync-peers.json must not end the event loop of this engine start (review L3).
                try {
                    monitor.onEvent(event)
                } catch (e: CancellationException) {
                    throw e
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    log.w(e) { "The engine event ${event.type} ${event.id} was dropped" }
                }
            }
        }
    }

    companion object {
        const val LONG_POLL_S = 60
        const val ERROR_DELAY_MS = 1_000L
    }
}
