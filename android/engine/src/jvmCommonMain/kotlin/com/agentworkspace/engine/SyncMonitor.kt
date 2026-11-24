package com.agentworkspace.engine

import co.touchlab.kermit.Logger
import com.agentworkspace.shared.model.TimeSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.OffsetDateTime
import java.util.concurrent.ConcurrentHashMap

/**
 * Sync now and the status of each peer on the phone (docs/phase-1.md 6.4 and 6.5): a port of
 * `syncNow`, `status` and the FolderCompletion handling of plugins/sync-syncthing/src/transport.ts.
 */
class SyncMonitor(
    private val peers: PeerStore,
    private val workspaces: () -> List<String>,
    private val clock: TimeSource,
    private val log: Logger = Logger.withTag("aw-engine"),
    private val pollMs: Long = POLL_MS,
) {
    /** Epoch ms of the last FolderCompletion with 0 items, by peer slug. In memory only, like awd. */
    private val lastSynced = ConcurrentHashMap<String, Long>()

    private fun folders(): List<String> = workspaces().flatMap { ws -> FolderKind.entries.map { folderId(ws, it) } }

    private fun text(
        data: JsonObject?,
        key: String,
    ): String = (data?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

    private fun number(
        data: JsonObject?,
        key: String,
    ): Long? = (data?.get(key) as? JsonPrimitive)?.longOrNull

    private fun epochMs(iso: String): Long? =
        runCatching {
            OffsetDateTime.parse(iso).toInstant().toEpochMilli()
        }.getOrNull()

    /** Reads one engine event; the time of a peer's last change comes from FolderCompletion. */
    fun onEvent(event: EngineEvent) {
        if (event.type != "FolderCompletion") return
        val data = event.data as? JsonObject
        val peer = peers.read().firstOrNull { it.syncId == text(data, "device") } ?: return
        val need = (number(data, "needItems") ?: 1) + (number(data, "needDeletes") ?: 0)
        val state = (data?.get("remoteState") as? JsonPrimitive)?.content
        if (need == 0L && (state == null || state == "valid")) {
            lastSynced[peer.device] = epochMs(event.time) ?: clock.now()
        }
    }

    @Suppress("TooGenericExceptionCaught")
    private suspend fun completionOrNull(
        rest: EngineRest,
        folder: String,
        device: String,
    ): EngineCompletion? =
        try {
            rest.completion(folder, device)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.d(e) { "No completion of $folder for $device" }
            null
        }

    /** The status of each peer. */
    suspend fun status(rest: EngineRest): List<PeerStatus> {
        val connections = rest.connections()
        val stats = runCatching { rest.deviceStats() }.getOrDefault(emptyMap())
        val list = peers.read()
        val folders = folders()
        return coroutineScope {
            list
                .map { peer ->
                    async {
                        val connection = connections[peer.syncId]?.info()
                        val connected = connection?.connected ?: false
                        val folderStates =
                            folders.map { f ->
                                SyncRules.folderStatus(f, completionOrNull(rest, f, peer.syncId)?.info(), connected)
                            }
                        // A peer never seen has the time 1970-...: no time.
                        val seen = stats[peer.syncId]?.lastSeen?.let(::epochMs)?.takeIf { it > 0 }
                        var synced = lastSynced[peer.device]
                        val status = SyncRules.peerStatus(peer.device, connection, folderStates, seen, synced)
                        if (status.inSync && synced == null) {
                            // No FolderCompletion event since the start: the first time the app sees it in sync.
                            synced = clock.now()
                            lastSynced[peer.device] = synced
                            status.copy(lastSynced = synced)
                        } else {
                            status
                        }
                    }
                }.awaitAll()
        }
    }

    /**
     * Sync now (docs/phase-1.md 6.4): a scan of each folder with the time that is left, then a poll of
     * the completion and the connections until each connected peer is synced or the timeout ends. An
     * offline peer is pending at once.
     */
    @Suppress("TooGenericExceptionCaught")
    suspend fun syncNow(
        rest: EngineRest,
        timeoutMs: Long = PHONE_TIMEOUT_MS,
    ): SyncResult {
        val started = clock.now()
        val left = { maxOf(MIN_SCAN_MS, timeoutMs - (clock.now() - started)) }
        coroutineScope {
            folders()
                .map { folder ->
                    async {
                        try {
                            rest.scan(folder, timeoutMs = left())
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            // A failed scan does not stop Sync now: the completion still says what is not synced.
                            log.w(e) { "A folder scan of Sync now failed: $folder" }
                        }
                    }
                }.awaitAll()
        }
        while (true) {
            val list = status(rest)
            val timedOut = clock.now() - started >= timeoutMs
            val waiting = list.filter { it.connected && !it.inSync }
            if (waiting.isEmpty() || timedOut) {
                val pending = list.mapNotNull { SyncRules.pendingOf(it, true) }
                return SyncResult(ok = pending.isEmpty(), peers = list, pending = pending)
            }
            delay(pollMs)
        }
    }

    companion object {
        const val POLL_MS = 250L

        /** Sync now stops after 60 s on the phone (docs/phase-1.md 6.4.4). */
        const val PHONE_TIMEOUT_MS = 60_000L
        private const val MIN_SCAN_MS = 1_000L
    }
}
