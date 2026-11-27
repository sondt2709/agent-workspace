package com.agentworkspace.engine

import com.agentworkspace.shared.model.TimeSource
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SyncRulesTest {
    private fun peer(
        connected: Boolean,
        need: Long,
        lastSynced: Long? = null,
    ): PeerStatus {
        val connection = ConnectionInfo(connected, "192.0.2.10:22300", "tcp-client", true).takeIf { connected }
        val folder = SyncRules.folderStatus("aw-ws1-tasks", CompletionInfo(need, 0, need * 10, "valid"), connected)
        return SyncRules.peerStatus("ubuntu-01", connection, listOf(folder), null, lastSynced)
    }

    @Test
    fun countsAPeerAsSyncedOnlyWhenConnectedWithNothingToGet() {
        assertTrue(peer(true, 0).inSync)
        assertFalse(peer(false, 0).inSync)
        assertFalse(peer(true, 1).inSync)
        val stale = SyncRules.folderStatus("f", CompletionInfo(0, 0, 0, "unknown"), true)
        assertFalse(stale.inSync)
        assertFalse(SyncRules.folderStatus("f", null, true).inSync)
    }

    @Test
    fun writesTheTextsOfAwd() {
        assertEquals("Synced 12 s ago", SyncRules.describe(peer(true, 0, lastSynced = 1_000), 13_000))
        assertEquals("3 changes not synced to ubuntu-01 (offline)", SyncRules.describe(peer(false, 3), 0))
        assertEquals("1 change not synced to ubuntu-01 (syncing)", SyncRules.describe(peer(true, 1), 0))
        assertEquals("No changes waiting for ubuntu-01 (offline)", SyncRules.describe(peer(false, 0), 0))
        assertEquals("5 min ago", SyncRules.ago(0, 300_000))
        assertEquals("3 h ago", SyncRules.ago(0, 3 * 3_600_000))
        assertEquals("2 days ago", SyncRules.ago(0, 49 * 3_600_000L))
        assertEquals("1 s ago", SyncRules.ago(0, 500))
    }

    @Test
    fun findsTheRouteOfAConnection() {
        assertEquals(
            PeerRoute.TAILSCALE,
            SyncRules.routeOf(ConnectionInfo(true, "100.101.1.2:22300", "tcp-client", false)),
        )
        assertEquals(
            PeerRoute.RELAY,
            SyncRules.routeOf(ConnectionInfo(true, "198.51.100.1:22067", "relay-client", false)),
        )
        assertEquals(PeerRoute.LAN, SyncRules.routeOf(ConnectionInfo(true, "192.0.2.10:22300", "tcp-server", true)))
        assertEquals(
            PeerRoute.INTERNET,
            SyncRules.routeOf(ConnectionInfo(true, "203.0.113.5:22300", "tcp-client", false)),
        )
        assertNull(SyncRules.routeOf(ConnectionInfo(false, "", "", false)))
        assertFalse(SyncRules.isTailscale("100.128.0.1:1"))
    }
}

class SyncMonitorTest {
    private val time = AtomicLong(1_000_000)
    private val clock = TimeSource { time.get() }

    @Test
    fun listsAnOfflinePeerAsPendingAtOnce() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val peers = PeerStore(dir.resolve("p.json")).apply { write(listOf(peer("ubuntu-01", Ids.SERVER))) }
                val api = FakeEngineApi()
                api.completion("aw-ws1-tasks", Ids.SERVER, needItems = 3)
                val result = SyncMonitor(peers, { listOf("ws1") }, clock, pollMs = 5).syncNow(api.client(), 60_000)
                assertFalse(result.ok)
                assertEquals(listOf(SyncPending("ubuntu-01", 3, PendingReason.OFFLINE)), result.pending)
                assertEquals(setOf("aw-ws1-tasks" to null, "aw-ws1-knowledge" to null), api.scans.toSet())
            }
        }

    @Test
    fun returnsWhenEachPeerIsSyncedAndTimesOutElse() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val peers = PeerStore(dir.resolve("p.json")).apply { write(listOf(peer("macbook-pro", Ids.MAC))) }
                val api = FakeEngineApi()
                api.connect(Ids.MAC)
                val monitor = SyncMonitor(peers, { listOf("ws1") }, clock, pollMs = 5)
                val ok = monitor.syncNow(api.client(), 60_000)
                assertTrue(ok.ok)
                assertEquals(time.get(), ok.peers.single().lastSynced)

                api.completion("aw-ws1-knowledge", Ids.MAC, needItems = 2)
                val slow = SyncMonitor(peers, { listOf("ws1") }, TimeSource { time.addAndGet(1_000) }, pollMs = 1)
                val result = slow.syncNow(api.client(), 5_000)
                assertEquals(listOf(SyncPending("macbook-pro", 2, PendingReason.TIMEOUT)), result.pending)
            }
        }

    @Test
    fun takesTheLastSyncTimeFromFolderCompletion() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val peers = PeerStore(dir.resolve("p.json")).apply { write(listOf(peer("macbook-pro", Ids.MAC))) }
                val monitor = SyncMonitor(peers, { listOf("ws1") }, clock)
                val data =
                    buildJsonObject {
                        put("device", Ids.MAC)
                        put("folder", "aw-ws1-tasks")
                        put("needItems", 0)
                        put("needDeletes", 0)
                        put("remoteState", JsonPrimitive("valid"))
                    }
                monitor.onEvent(EngineEvent(7, "FolderCompletion", "2026-11-23T10:00:00.5+07:00", data))
                val api = FakeEngineApi().apply { connect(Ids.MAC) }
                val status = monitor.status(api.client()).single()
                assertEquals(
                    java.time.OffsetDateTime
                        .parse("2026-11-23T10:00:00.5+07:00")
                        .toInstant()
                        .toEpochMilli(),
                    status.lastSynced,
                )
            }
        }
}
