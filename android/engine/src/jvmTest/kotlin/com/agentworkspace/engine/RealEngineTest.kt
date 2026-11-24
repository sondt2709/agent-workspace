// The test runs the engine logic in real time on Dispatchers.Default.
@file:Suppress("InjectDispatcher")

package com.agentworkspace.engine

import com.agentworkspace.shared.index.openWorkspaceIndex
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.net.ServerSocket
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * A contract run with the real Syncthing binary of the pinned tag (the desktop binary of the computer
 * that runs the test): the config before the first start, the Unix socket client, the folder setup and
 * the stop. Opt-in: `./gradlew :engine:jvmTest -Paw.engineBinary=<path of syncthing v2.1.7>`. Without
 * the property the test does nothing, so `task check` needs no engine download.
 */
class RealEngineTest {
    private val binary: String? = System.getProperty("aw.engine.binary")?.takeIf { it.isNotEmpty() }

    @Test
    fun runsTheRealEngineWithTheAwConfig() =
        runBlocking<Unit> {
            val engine = binary ?: return@runBlocking
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                val index = openWorkspaceIndex(null)
                val port = ServerSocket(0).use { it.localPort }
                val launcher = ProcessEngineLauncher(Path.of(engine))
                val controller =
                    SyncEngineController(
                        platform =
                            EnginePlatform(paths, launcher, JdkUnixConnector, { index }, kill = { pid ->
                                ProcessHandle.of(pid).ifPresent { it.destroyForcibly() }
                            }),
                        scope = scope,
                        engineSettings = { EngineSettings("pixel-9", "tcp://127.0.0.1:$port") },
                        // No community servers in a test.
                        setupSettings = { SetupSettings(community = false) },
                    )
                try {
                    controller.addWorkspace("ws1")
                    withTimeout(START_MS) { controller.state.first { it == EngineState.RUNNING } }
                    val session = controller.supervisor.session.value!!
                    val text = paths.config.readText()
                    assertTrue(EngineConfig.isAwConfig(text, paths.socket.toString()), text)
                    assertEquals(session.identity.deviceId, session.rest.myId())
                    // The config step ran: 2 folders, the ignores and the options.
                    withTimeout(START_MS) {
                        while (session.rest.ignores("aw-ws1-tasks") !=
                            listOf("*.aw-tmp", "/*/artifacts")
                        ) {
                            kotlinx.coroutines.delay(POLL_MS)
                        }
                    }
                    val tasks = session.rest.folderJson("aw-ws1-tasks")!!
                    assertEquals(paths.folder("ws1", FolderKind.TASKS).toString(), tasks["path"].toString().trim('"'))
                    assertEquals(null, session.rest.folderJson("aw-ws1-secure"))
                    val options = session.rest.options()
                    assertEquals("false", options["relaysEnabled"].toString())
                    assertEquals("false", options["natEnabled"].toString())
                    assertEquals("true", options["localAnnounceEnabled"].toString())
                    assertTrue(controller.syncNow(SYNC_MS).ok)
                    val pid = Files.readString(paths.pidFile).trim().toLong()
                    controller.stop()
                    assertFalse(ProcessHandle.of(pid).map { it.isAlive }.orElse(false), "the engine process ended")
                    val log = paths.log.readText()
                    for (word in listOf("global discovery", "relay", "UPnP", "NAT-PMP", "STUN")) {
                        assertFalse(
                            log.lines().any {
                                it.contains(word, ignoreCase = true) &&
                                    !it.contains("disabled", true)
                            },
                            word,
                        )
                    }
                } finally {
                    controller.stop()
                    controller.refresher.close()
                    index.close()
                    scope.cancel()
                }
            }
        }

    private companion object {
        const val START_MS = 60_000L
        const val SYNC_MS = 10_000L
        const val POLL_MS = 100L
    }
}
