// The tests run the engine logic in real time on Dispatchers.Default.
@file:Suppress("InjectDispatcher")

package com.agentworkspace.engine

import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.index.openWorkspaceIndex
import com.agentworkspace.shared.merge.MergeEngine
import com.agentworkspace.shared.model.TimeSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.copyToRecursively
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val FIXTURE_TASK = "01a2038e-7f00-70eb-b429-fa86d481c263"

/** The workspace fixture of contracts/ (the same files as the merge tests of awd and android-shared). */
private val fixture: Path = Path.of(requireNotNull(System.getProperty("aw.schema.dir"))).resolve("fixtures/workspace")

/** Copies the fixture into a workspace folder, as the engine writes the files of the computers. */
@OptIn(ExperimentalPathApi::class)
private fun receiveFixture(workspace: Path) {
    for (kind in listOf("tasks", "knowledge")) {
        Files.createDirectories(workspace.resolve(kind).parent)
        fixture.resolve(kind).copyToRecursively(workspace.resolve(kind), followLinks = false, overwrite = true)
    }
}

class IndexRefresherTest {
    @Test
    fun aBadPeerFileDoesNotEndTheEventLoop() =
        runBlocking<Unit> {
            withTempDir { dir ->
                // sync-peers.json is cut short (review android-engine L3).
                val peersFile = dir.resolve("p.json")
                Files.writeString(peersFile, "{\"peers\": [")
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val refresher = IndexRefresher(scope, debounceMs = 20)
                val monitor = SyncMonitor(PeerStore(peersFile), { listOf("ws1") }, TimeSource { 0 })
                val loop = EngineEventLoop(refresher, monitor)
                val completion =
                    EngineEvent(
                        3,
                        "FolderCompletion",
                        "2026-11-23T10:00:00Z",
                        buildJsonObject {
                            put("folder", "aw-ws1-tasks")
                            put("device", Ids.PHONE)
                            put("completion", 100)
                        },
                    )
                // The event is logged and dropped; the loop goes on.
                loop.handle(completion)
                refresher.close()
                scope.cancel()
            }
        }

    @Test
    fun updatesTheIndexAfterADiskEventOfTheEngine() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val workspace = dir.resolve("aw/ws1")
                Files.createDirectories(workspace.resolve("tasks"))
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val index = openWorkspaceIndex(null)
                try {
                    val refresher = IndexRefresher(scope, debounceMs = 20)
                    val merge = MergeEngine(NioWorkspaceFiles(workspace), TimeSource { System.currentTimeMillis() })
                    refresher.register("ws1", merge, index)
                    refresher.refresh("ws1")
                    assertNull(index.task(FIXTURE_TASK))

                    receiveFixture(workspace)
                    val loop =
                        EngineEventLoop(
                            refresher,
                            SyncMonitor(PeerStore(dir.resolve("p.json")), { listOf("ws1") }, TimeSource { 0 }),
                        )
                    // A folder of another workspace changes nothing.
                    loop.handle(
                        EngineEvent(
                            1,
                            "RemoteChangeDetected",
                            "2026-11-23T10:00:00Z",
                            buildJsonObject {
                                put("folder", "aw-ws2-tasks")
                            },
                        ),
                    )
                    loop.handle(
                        EngineEvent(
                            2,
                            "RemoteChangeDetected",
                            "2026-11-23T10:00:00Z",
                            buildJsonObject {
                                put("folder", "aw-ws1-tasks")
                            },
                        ),
                    )
                    val result = withTimeout(5_000) { refresher.updates.first() }
                    assertEquals("ws1", result.workspace)
                    assertNotNull(index.task(FIXTURE_TASK))
                    refresher.close()
                } finally {
                    index.close()
                    scope.cancel()
                }
            }
        }
}

class SyncEngineControllerTest {
    @Test
    fun anOpenAppRefreshesThePresenceWithNoFileChange() =
        runBlocking<Unit> {
            withTempDir { dir ->
                // One computer stops: no file changes, but the presence must go offline (review android-ui W1).
                val paths = EnginePaths(dir)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val index = openWorkspaceIndex(null)
                val platform =
                    EnginePlatform(
                        paths,
                        FakeLauncher(paths, installed = false),
                        JdkUnixConnector,
                        { index },
                        kill = {},
                    )
                val controller =
                    SyncEngineController(
                        platform,
                        scope,
                        { EngineSettings("pixel-9") },
                        timing = FAST,
                        refreshDebounceMs = 5,
                        presenceTickMs = 30,
                    )
                try {
                    Files.createDirectories(paths.workspace("ws1"))
                    controller.start()
                    val seen =
                        java.util.concurrent.atomic
                            .AtomicInteger()
                    val watch = scope.launch { controller.refresher.updates.collect { seen.incrementAndGet() } }
                    delay(200)
                    assertEquals(0, seen.get(), "a closed app does not refresh by time")
                    controller.markAppOpen(true)
                    withTimeout(2_000) { while (seen.get() < 2) delay(10) }
                    watch.cancel()
                } finally {
                    index.close()
                    scope.cancel()
                }
            }
        }

    @Test
    fun parallelStartsRegisterAWorkspaceOnce() =
        runBlocking<Unit> {
            withTempDir { dir ->
                // App open and the foreground service both call start() (review android-engine L2).
                val paths = EnginePaths(dir)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val opened =
                    java.util.concurrent.atomic
                        .AtomicInteger()
                val index = openWorkspaceIndex(null)
                val platform =
                    EnginePlatform(paths, FakeLauncher(paths, installed = false), JdkUnixConnector, {
                        opened.incrementAndGet()
                        java.util.concurrent.locks.LockSupport
                            .parkNanos(20_000_000)
                        index
                    }, kill = {})
                val controller = SyncEngineController(platform, scope, { EngineSettings("pixel-9") }, timing = FAST)
                try {
                    Files.createDirectories(paths.workspace("ws1"))
                    (1..8).map { scope.async { controller.start() } }.awaitAll()
                    assertEquals(1, opened.get())
                } finally {
                    index.close()
                    scope.cancel()
                }
            }
        }

    @Test
    fun syncNowSaysAtOnceWhyTheEngineDoesNotRun() =
        runBlocking<Unit> {
            withTempDir { dir ->
                // Review android-engine L5 and workflow 2: no 60 s wait, and the cause in the result.
                val paths = EnginePaths(dir)
                val launcher = FakeLauncher(paths, installed = false)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val index = openWorkspaceIndex(null)
                val platform = EnginePlatform(paths, launcher, JdkUnixConnector, { index }, kill = {})
                val controller =
                    SyncEngineController(platform, scope, { EngineSettings("pixel-9") }, timing = FAST)
                try {
                    val none = withTimeout(2_000) { controller.syncNow(60_000) }
                    assertEquals("This phone has no workspace yet: sync is off", none.stopped)
                    Files.createDirectories(paths.workspace("ws1"))
                    val missing = withTimeout(2_000) { controller.syncNow(60_000) }
                    assertEquals("The sync engine is not installed: sync is off", missing.stopped)
                    assertTrue(!missing.ok)
                } finally {
                    index.close()
                    scope.cancel()
                }
            }
        }

    @Test
    fun startsWithAWorkspaceRefreshesTheIndexAndSyncs() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val api = FakeEngineApi()
                val launcher = FakeLauncher(paths)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val index = openWorkspaceIndex(null)
                val platform = EnginePlatform(paths, launcher, JdkUnixConnector, { index }, kill = {})
                val controller =
                    SyncEngineController(
                        platform = platform,
                        scope = scope,
                        engineSettings = { EngineSettings("pixel-9") },
                        timing = FAST,
                        restFactory = { api.client() },
                        refreshDebounceMs = 20,
                    )
                try {
                    controller.start()
                    assertEquals(0, launcher.serves(), "no workspace: no engine")

                    receiveFixture(paths.workspace("ws1"))
                    controller.addWorkspace("ws1")
                    withTimeout(5_000) { controller.state.first { it == EngineState.RUNNING } }
                    withTimeout(5_000) { while (index.task(FIXTURE_TASK) == null) delay(10) }
                    withTimeout(5_000) { while (api.folders.size < 2) delay(10) }
                    assertEquals(setOf("aw-ws1-tasks", "aw-ws1-knowledge"), api.folders.keys)

                    controller.addPeer(peer("macbook-pro", Ids.MAC))
                    api.connect(Ids.MAC)
                    assertEquals(
                        listOf("Synced"),
                        controller.status().map { SyncRules.describe(it, 0).substringBefore(" ") },
                    )
                    assertTrue(api.devices.containsKey(Ids.MAC))
                    val result = controller.syncNow(10_000)
                    assertTrue(result.ok, "result: $result")

                    controller.wrote("ws1", "tasks/$FIXTURE_TASK/log/pixel-9.jsonl")
                    assertEquals("aw-ws1-tasks" to "$FIXTURE_TASK/log/pixel-9.jsonl", api.scans.last())

                    controller.markAppOpen(true)
                    controller.appOpened()
                    withTimeout(5_000) {
                        while (launcher.serves() < 2 ||
                            controller.state.value != EngineState.RUNNING
                        ) {
                            delay(10)
                        }
                    }
                    withTimeout(5_000) { while (api.options["reconnectionIntervalS"].toString() != "5") delay(10) }
                    // Home, then the app at once: the close work runs after the new open (review L7).
                    controller.markAppOpen(false)
                    controller.markAppOpen(true)
                    controller.appClosed()
                    assertEquals("5", api.options["reconnectionIntervalS"].toString())
                    controller.markAppOpen(false)
                    controller.appClosed()
                    assertEquals("20", api.options["reconnectionIntervalS"].toString())

                    controller.removePeer("macbook-pro")
                    assertTrue(!api.devices.containsKey(Ids.MAC))
                    controller.stop()
                    assertEquals(EngineState.STOPPED, controller.state.value)
                    // The peer list is empty again, and a stopped engine gives no peer status.
                    assertEquals(emptyList(), controller.status())
                } finally {
                    controller.stop()
                    controller.refresher.close()
                    index.close()
                    scope.cancel()
                }
            }
        }

    @Test
    fun pairsWithNoWorkspaceAndKeepsThePairingDevice() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val api = FakeEngineApi()
                val launcher = FakeLauncher(paths)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val index = openWorkspaceIndex(null)
                val platform = EnginePlatform(paths, launcher, JdkUnixConnector, { index }, kill = {})
                val controller =
                    SyncEngineController(
                        platform = platform,
                        scope = scope,
                        engineSettings = { EngineSettings("pixel-9") },
                        timing = FAST,
                        restFactory = { api.client() },
                        refreshDebounceMs = 20,
                    )
                try {
                    assertEquals(Ids.PHONE, controller.startForPairing(5_000))
                    controller.addPairingDevice(Ids.MAC, "macbook-pro", emptyList())
                    assertEquals("[\"dynamic\"]", api.devices.getValue(Ids.MAC)["addresses"].toString())
                    val folder = dir.resolve("pairing/n1").toString()
                    controller.addPairingFolder("aw-pair-n1", folder, Ids.MAC)
                    val shared = api.folders.getValue("aw-pair-n1")
                    assertEquals(folder, shared["path"]!!.jsonPrimitive.content)
                    assertEquals(listOf("*.aw-tmp"), api.ignores["aw-pair-n1"])
                    controller.scanFolder("aw-pair-n1")
                    assertEquals("aw-pair-n1" to null, api.scans.last())

                    // The config step keeps the pairing device, which is not a peer.
                    controller.addPeer(peer("ubuntu-01", Ids.SERVER, "remote"))
                    assertTrue(api.devices.containsKey(Ids.MAC))
                    assertTrue(api.devices.containsKey(Ids.SERVER))

                    // The records make it a peer: the end of the pairing keeps it.
                    controller.setPeers(listOf(peer("macbook-pro", Ids.MAC)))
                    assertTrue(!api.devices.containsKey(Ids.SERVER))
                    controller.removePairingDevice(Ids.MAC)
                    controller.removePairingFolder("aw-pair-n1")
                    assertTrue(api.devices.containsKey(Ids.MAC))
                    assertTrue("aw-pair-n1" !in api.folders)
                    assertEquals(listOf("macbook-pro"), controller.peers.read().map { it.device })

                    // A workspace that the pairing must not keep is removed with its engine folders.
                    controller.addWorkspace("ws1")
                    withTimeout(5_000) { while (api.folders.size < 2) delay(10) }
                    controller.removeWorkspace("ws1")
                    assertEquals(emptySet(), api.folders.keys)
                    assertTrue(!Files.exists(paths.workspace("ws1")))
                    assertEquals(emptyList(), controller.workspaces())

                    controller.endPairing()
                    assertEquals(EngineState.STOPPED, controller.state.value)
                } finally {
                    controller.stop()
                    controller.refresher.close()
                    index.close()
                    scope.cancel()
                }
            }
        }
}
