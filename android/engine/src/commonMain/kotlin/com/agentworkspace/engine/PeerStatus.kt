package com.agentworkspace.engine

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The folder kinds of the phone: never `secure` (docs/phase-1.md 6.2, no secrets on the phone). */
enum class FolderKind(
    val folder: String,
) {
    TASKS("tasks"),
    KNOWLEDGE("knowledge"),
}

/** The engine folder id of a workspace folder (docs/phase-1.md 3.1): `aw-<workspace id>-<kind>`. */
fun folderId(
    workspace: String,
    kind: FolderKind,
): String = "aw-$workspace-${kind.folder}"

/** A peer of the phone, the record of `sync-peers.json` (the same fields as awd). */
@Serializable
data class PeerRecord(
    /** The AW device slug, for example `ubuntu-01`. */
    val device: String,
    /** The Syncthing device id. */
    @SerialName("sync_id") val syncId: String,
    /** `local`, `remote` or `mobile`. */
    val role: String,
    /** Addresses to dial, for example `tcp://192.0.2.10:22300`, or `dynamic`. */
    val addresses: List<String>,
)

/** The route of a connection (docs/phase-1.md 6.5.2). */
enum class PeerRoute { LAN, TAILSCALE, RELAY, INTERNET }

/** One connection of `/rest/system/connections`. */
data class ConnectionInfo(
    val connected: Boolean,
    val address: String,
    val type: String,
    val isLocal: Boolean,
)

/** The completion of one folder for one peer (`/rest/db/completion`). */
data class CompletionInfo(
    val needItems: Long,
    val needDeletes: Long,
    val needBytes: Long,
    val remoteState: String,
)

data class FolderPeerStatus(
    val folder: String,
    val needItems: Long,
    val needBytes: Long,
    val remoteState: String,
    val inSync: Boolean,
)

data class PeerStatus(
    val device: String,
    val connected: Boolean,
    val route: PeerRoute?,
    val needItems: Long,
    val needBytes: Long,
    val inSync: Boolean,
    /** Epoch ms of the last connection, or null. */
    val lastSeen: Long?,
    /** Epoch ms of the last FolderCompletion with 0 items, or null. */
    val lastSynced: Long?,
    val folders: List<FolderPeerStatus>,
)

/** Why a peer is not synced at the end of Sync now. */
enum class PendingReason { OFFLINE, TIMEOUT }

data class SyncPending(
    val device: String,
    val items: Long,
    val reason: PendingReason,
)

data class SyncResult(
    /** True when each peer is synced. */
    val ok: Boolean,
    val peers: List<PeerStatus>,
    val pending: List<SyncPending>,
    /** The cause when the engine of the phone does not run, for the person; else null. */
    val stopped: String? = null,
)

/**
 * The sync state rules of the phone: a port of plugins/sync-syncthing/src/status.ts. A peer is synced
 * only when it is connected and each shared folder has 0 items to get and the remote state `valid`.
 * The total completion is never used: it showed 100 % while the peer did not have the file (ST8).
 */
object SyncRules {
    private const val SECONDS_PER_MINUTE = 60
    private const val MINUTES_PER_HOUR = 60
    private const val HOURS_SHOWN = 48
    private const val HOURS_PER_DAY = 24
    private const val MS_PER_SECOND = 1000.0
    private const val HALF = 0.5
    private const val IPV4_PARTS = 4
    private const val TAILSCALE_FIRST = 100
    private const val TAILSCALE_LOW = 64
    private const val TAILSCALE_HIGH = 127
    private val ipv4 = Regex("""^\[?([0-9.]+)]?(?::\d+)?$""")

    /** True when an IPv4 address is in the Tailscale range 100.64.0.0/10. */
    fun isTailscale(address: String): Boolean {
        val host = ipv4.find(address)?.groupValues?.get(1) ?: return false
        val parts = host.split(".").map { it.toIntOrNull() ?: return false }
        return parts.size == IPV4_PARTS && parts[0] == TAILSCALE_FIRST && parts[1] in TAILSCALE_LOW..TAILSCALE_HIGH
    }

    fun routeOf(connection: ConnectionInfo?): PeerRoute? =
        when {
            connection == null || !connection.connected -> null
            connection.type.contains("relay") -> PeerRoute.RELAY
            isTailscale(connection.address) -> PeerRoute.TAILSCALE
            connection.isLocal -> PeerRoute.LAN
            else -> PeerRoute.INTERNET
        }

    fun folderStatus(
        folder: String,
        completion: CompletionInfo?,
        connected: Boolean,
    ): FolderPeerStatus {
        val needItems = completion?.let { it.needItems + it.needDeletes } ?: 0
        val remoteState = completion?.remoteState ?: "unknown"
        return FolderPeerStatus(
            folder = folder,
            needItems = needItems,
            needBytes = completion?.needBytes ?: 0,
            remoteState = remoteState,
            inSync = connected && completion != null && needItems == 0L && remoteState == "valid",
        )
    }

    fun peerStatus(
        device: String,
        connection: ConnectionInfo?,
        folders: List<FolderPeerStatus>,
        lastSeen: Long?,
        lastSynced: Long?,
    ): PeerStatus {
        val connected = connection?.connected ?: false
        return PeerStatus(
            device = device,
            connected = connected,
            route = routeOf(connection),
            needItems = folders.sumOf { it.needItems },
            needBytes = folders.sumOf { it.needBytes },
            inSync = connected && folders.all { it.inSync },
            lastSeen = lastSeen,
            lastSynced = lastSynced,
            folders = folders,
        )
    }

    /** The pending entry of a peer that is not synced, or null. */
    fun pendingOf(
        peer: PeerStatus,
        timedOut: Boolean,
    ): SyncPending? =
        when {
            peer.inSync -> null
            !peer.connected -> SyncPending(peer.device, peer.needItems, PendingReason.OFFLINE)
            timedOut -> SyncPending(peer.device, peer.needItems, PendingReason.TIMEOUT)
            else -> null
        }

    /** "12 s ago", "5 min ago", "3 h ago", "2 d ago". */
    fun ago(
        fromMs: Long,
        nowMs: Long,
    ): String {
        // Half up, like Math.round of JavaScript (kotlin.math.round rounds half to even).
        val seconds = maxOf(0L, kotlin.math.floor((nowMs - fromMs) / MS_PER_SECOND + HALF).toLong())
        if (seconds < SECONDS_PER_MINUTE) return "$seconds s ago"
        val minutes = seconds / SECONDS_PER_MINUTE
        if (minutes < MINUTES_PER_HOUR) return "$minutes min ago"
        val hours = minutes / MINUTES_PER_HOUR
        if (hours < HOURS_SHOWN) return "$hours h ago"
        return "${hours / HOURS_PER_DAY} d ago"
    }

    private fun changes(count: Long): String = if (count == 1L) "1 change" else "$count changes"

    /** "Synced 12 s ago", "3 changes not synced to ubuntu-01 (offline)" or "(syncing)". */
    fun describe(
        peer: PeerStatus,
        nowMs: Long,
    ): String {
        if (peer.inSync) return peer.lastSynced?.let { "Synced ${ago(it, nowMs)}" } ?: "Synced"
        val why = if (peer.connected) "syncing" else "offline"
        if (peer.needItems == 0L) {
            return if (peer.connected) {
                "Checking ${peer.device} (syncing)"
            } else {
                "No changes waiting for ${peer.device} (offline)"
            }
        }
        return "${changes(peer.needItems)} not synced to ${peer.device} ($why)"
    }
}
