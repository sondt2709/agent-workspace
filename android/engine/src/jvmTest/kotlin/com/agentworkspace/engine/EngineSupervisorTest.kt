// The tests run the engine logic in real time on Dispatchers.Default.
@file:Suppress("InjectDispatcher")

package com.agentworkspace.engine

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.nio.file.Files
import java.nio.file.Path
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Short times, so each test runs in real time in well under a second. */
val FAST =
    SupervisorTiming(
        healthMs = 40,
        startTimeoutMs = 200,
        pingPollMs = 10,
        stopGraceMs = 100,
        backoffMinMs = 10,
        backoffMaxMs = 40,
    )

class SupervisorFixture(
    dir: Path,
    val api: FakeEngineApi = FakeEngineApi(),
    timing: SupervisorTiming = FAST,
    val onStart: suspend (EngineSession) -> Unit = {},
) : AutoCloseable {
    val paths = EnginePaths(dir)
    val launcher = FakeLauncher(paths)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val killed: MutableList<Long> = Collections.synchronizedList(mutableListOf())
    val identities: MutableList<EngineIdentity> = Collections.synchronizedList(mutableListOf())
    val starts = AtomicInteger()
    val supervisor =
        EngineSupervisor(
            paths = paths,
            launcher = launcher,
            home = EngineHome(paths, launcher, freePort = { 45678 }),
            stale = StaleEngines(paths.pidFile, paths.home, dir.resolve("proc"), kill = { killed.add(it) }),
            restFactory = { identity ->
                identities.add(identity)
                api.client()
            },
            settings = { EngineSettings("pixel-9") },
            onStart = { session ->
                starts.incrementAndGet()
                onStart(session)
            },
            scope = scope,
            timing = timing,
        )

    suspend fun waitFor(state: EngineState) = withTimeout(WAIT_MS) { supervisor.state.first { it == state } }

    suspend fun waitUntil(check: () -> Boolean) =
        withTimeout(WAIT_MS) {
            while (!check()) delay(5)
        }

    override fun close() {
        runBlocking { supervisor.stop() }
        scope.cancel()
    }

    companion object {
        const val WAIT_MS = 5_000L
    }
}

class EngineSupervisorTest {
    @Test
    fun startsTheEngineAndRunsTheConfigStep() =
        runBlocking<Unit> {
            withTempDir { dir ->
                SupervisorFixture(dir).use { f ->
                    f.supervisor.start()
                    f.waitFor(EngineState.RUNNING)
                    f.waitUntil { f.starts.get() == 1 }
                    val serve = f.launcher.commands.first { it.first() == "serve" }
                    assertEquals(
                        listOf("serve", "--home=${f.paths.home}", "--no-browser", "--no-upgrade", "--no-restart"),
                        serve,
                    )
                    val env = f.launcher.envs.single()
                    assertEquals("1", env["STMONITORED"])
                    assertEquals("1", env["STNOUPGRADE"])
                    assertEquals(f.paths.home.toString(), env["STHOMEDIR"])
                    assertEquals(
                        f.launcher.processes
                            .single()
                            .pid
                            .toString(),
                        Files.readString(f.paths.pidFile).trim(),
                    )
                    assertEquals(
                        Ids.PHONE,
                        f.supervisor.session.value
                            ?.identity
                            ?.deviceId,
                    )
                    f.supervisor.stop()
                    assertEquals(EngineState.STOPPED, f.supervisor.state.value)
                    assertTrue(
                        f.launcher.processes
                            .single()
                            .destroyed,
                    )
                    assertFalse(Files.exists(f.paths.pidFile))
                }
            }
        }

    @Test
    fun restartsTheEngineAfterAnExit() =
        runBlocking<Unit> {
            withTempDir { dir ->
                SupervisorFixture(dir).use { f ->
                    f.supervisor.start()
                    f.waitFor(EngineState.RUNNING)
                    val seen = Collections.synchronizedList(mutableListOf<EngineState>())
                    val watcher = f.scope.launchCollect(f.supervisor) { seen.add(it) }
                    f.launcher.processes
                        .single()
                        .exit
                        .complete(2)
                    f.waitUntil { f.launcher.serves() == 2 && f.supervisor.state.value == EngineState.RUNNING }
                    f.waitUntil { f.starts.get() == 2 }
                    watcher.cancel()
                    assertTrue(EngineState.RESTARTING in seen, "states: $seen")
                    assertEquals(
                        2,
                        f.supervisor.session.value
                            ?.generation,
                    )
                }
            }
        }

    @Test
    fun aCrashLoopBacksOffAndShowsFailed() =
        runBlocking<Unit> {
            withTempDir { dir ->
                SupervisorFixture(dir).use { f ->
                    // Each engine answers the first ping, then exits at once (review android-engine M2).
                    val seen = Collections.synchronizedList(mutableListOf<EngineState>())
                    val watcher =
                        f.scope.launchCollect(f.supervisor) { state ->
                            seen.add(state)
                            if (state == EngineState.RUNNING) {
                                f.launcher.processes
                                    .last()
                                    .exit
                                    .complete(1)
                            }
                        }
                    f.supervisor.start()
                    f.waitFor(EngineState.FAILED)
                    watcher.cancel()
                    // awd: failed after 10 restarts with no healthy minute; the restarts go on with the backoff.
                    assertTrue(f.launcher.serves() >= 10, "serves: ${f.launcher.serves()}")
                }
            }
        }

    @Test
    fun aHealthyMinuteResetsTheBackoff() =
        runBlocking<Unit> {
            withTempDir { dir ->
                // A healthy "minute" of 3 health checks; the engine exits after it, each time.
                SupervisorFixture(dir, timing = FAST.copy(healthyResetMs = 120, failedAfter = 2)).use { f ->
                    val seen = Collections.synchronizedList(mutableListOf<EngineState>())
                    val watcher = f.scope.launchCollect(f.supervisor) { seen.add(it) }
                    f.supervisor.start()
                    repeat(4) { round ->
                        f.waitUntil {
                            f.launcher.serves() == round + 1 &&
                                f.supervisor.state.value == EngineState.RUNNING
                        }
                        delay(250)
                        f.launcher.processes
                            .last()
                            .exit
                            .complete(1)
                    }
                    watcher.cancel()
                    assertFalse(EngineState.FAILED in seen, "states: $seen")
                }
            }
        }

    @Test
    fun restartsAfterThreeFailedPings() =
        runBlocking<Unit> {
            withTempDir { dir ->
                SupervisorFixture(dir).use { f ->
                    f.supervisor.start()
                    f.waitFor(EngineState.RUNNING)
                    f.api.pingOk = false
                    f.waitUntil {
                        f.launcher.processes
                            .first()
                            .destroyed
                    }
                    f.api.pingOk = true
                    f.waitUntil { f.launcher.serves() >= 2 && f.supervisor.state.value == EngineState.RUNNING }
                }
            }
        }

    @Test
    fun keepsTheEngineWhenTheConfigStepFails() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val calls = AtomicInteger()
                val onStart: suspend (EngineSession) -> Unit = {
                    if (calls.incrementAndGet() ==
                        1
                    ) {
                        throw EngineRestException("Engine PUT rest/config/folders failed: 500", 500)
                    }
                }
                SupervisorFixture(dir, onStart = onStart).use { f ->
                    f.supervisor.start()
                    f.waitUntil { calls.get() >= 2 }
                    assertEquals(1, f.launcher.serves())
                    assertFalse(
                        f.launcher.processes
                            .single()
                            .destroyed,
                    )
                    assertEquals(EngineState.RUNNING, f.supervisor.state.value)
                    // No third call: the step passed at the second try.
                    delay(FAST.healthMs * 3)
                    assertEquals(2, calls.get())
                }
            }
        }

    @Test
    fun startsNoProcessWithNoBinary() =
        runBlocking<Unit> {
            withTempDir { dir ->
                SupervisorFixture(dir).use { f ->
                    f.launcher.installed = false
                    f.supervisor.start()
                    assertEquals(EngineState.NOT_INSTALLED, f.supervisor.state.value)
                    assertEquals(0, f.launcher.serves())
                }
            }
        }

    @Test
    fun failsAndTriesAgainWhenTheHomeCannotBePrepared() =
        runBlocking<Unit> {
            withTempDir { dir ->
                SupervisorFixture(dir).use { f ->
                    f.launcher.generateExit = 1
                    f.supervisor.start()
                    f.waitFor(EngineState.FAILED)
                    f.waitUntil { f.launcher.commands.count { it.first() == "generate" } >= 2 }
                    f.launcher.generateExit = 0
                    f.waitFor(EngineState.RUNNING)
                }
            }
        }

    @Test
    fun usesTheHttpsFallbackWhenTheSocketGivesNoPing() =
        runBlocking<Unit> {
            withTempDir { dir ->
                SupervisorFixture(dir).use { f ->
                    f.api.pingOk = false
                    f.supervisor.start()
                    f.waitUntil { f.supervisor.usesLoopback }
                    f.api.pingOk = true
                    f.waitFor(EngineState.RUNNING)
                    assertEquals(
                        RestEndpoint.Loopback(45678),
                        f.supervisor.session.value
                            ?.identity
                            ?.endpoint,
                    )
                    assertTrue(f.identities.take(2).all { it.endpoint is RestEndpoint.UnixSocket })
                }
            }
        }

    @Test
    fun theStartTimeoutCountsTheTimeOfEachPing() =
        runBlocking<Unit> {
            withTempDir { dir ->
                // Each ping hangs 150 ms (as the 2 s of a socket that does not answer); the start limit is 200 ms.
                SupervisorFixture(dir, timing = FAST.copy(socketFailuresForFallback = 1)).use { f ->
                    f.api.pingDelayMs = 150
                    f.api.pingOk = false
                    val started = System.nanoTime()
                    f.supervisor.start()
                    f.waitUntil { f.supervisor.usesLoopback }
                    val ms = (System.nanoTime() - started) / 1_000_000
                    // 1 start of about 200 ms, not 20 polls of 10 ms plus 150 ms each (about 3.2 s).
                    assertTrue(ms < 1_500, "the first start took $ms ms")
                }
            }
        }

    @Test
    fun aNewAppProcessKeepsTheHttpsFallback() =
        runBlocking<Unit> {
            withTempDir { dir ->
                // The first app process moved to the HTTPS fallback.
                SupervisorFixture(dir).use { f ->
                    f.api.pingOk = false
                    f.supervisor.start()
                    f.waitUntil { f.supervisor.usesLoopback }
                    f.api.pingOk = true
                    f.waitFor(EngineState.RUNNING)
                }
                // A new app process (review android-engine M3): no new config, no socket try first.
                SupervisorFixture(dir).use { f ->
                    f.supervisor.start()
                    f.waitFor(EngineState.RUNNING)
                    assertTrue(f.supervisor.usesLoopback)
                    assertEquals(listOf<RestEndpoint>(RestEndpoint.Loopback(45678)), f.identities.map { it.endpoint })
                    assertTrue(f.identities.none { it.created }, "the config was written again")
                }
            }
        }

    @Test
    fun stopsOnlyAStaleEngineOfThisHome() =
        runBlocking<Unit> {
            withTempDir { dir ->
                SupervisorFixture(dir).use { f ->
                    val proc = dir.resolve("proc")

                    fun cmdline(
                        pid: Long,
                        vararg args: String,
                    ) {
                        Files.createDirectories(proc.resolve("$pid"))
                        Files.write(
                            proc.resolve("$pid").resolve("cmdline"),
                            args.joinToString("\u0000", postfix = "\u0000").toByteArray(),
                        )
                    }
                    cmdline(77, "/data/app/x/lib/arm64/libawsync.so", "serve", "--home=${f.paths.home}")
                    cmdline(78, "/usr/bin/syncthing", "serve", "--home=${f.paths.home}")
                    val stale = StaleEngines(f.paths.pidFile, f.paths.home, proc) { f.killed.add(it) }
                    Files.createDirectories(f.paths.home)
                    stale.record(78)
                    assertFalse(stale.stop())
                    stale.record(77)
                    assertTrue(stale.stop())
                    assertEquals(listOf(77L), f.killed.toList())
                    stale.record(79)
                    assertFalse(stale.stop())
                }
            }
        }
}

private fun CoroutineScope.launchCollect(
    supervisor: EngineSupervisor,
    block: (EngineState) -> Unit,
) = launch { supervisor.state.collect { block(it) } }
