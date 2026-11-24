package com.agentworkspace.engine

import co.touchlab.kermit.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.nio.file.Files

/** The engine states of awd (`/readyz` `sync_engine`), the same values on the phone. */
enum class EngineState(
    val wire: String,
) {
    NOT_INSTALLED("not_installed"),
    STARTING("starting"),
    RUNNING("running"),
    RESTARTING("restarting"),
    STOPPED("stopped"),
    FAILED("failed"),
}

/** A running engine: one per start. Its [scope] ends when the engine stops or restarts. */
data class EngineSession(
    val generation: Int,
    val identity: EngineIdentity,
    val rest: EngineRest,
    val scope: CoroutineScope,
)

/** The times of the supervisor (docs/phase-1.md 6.1). Tests make them short. */
data class SupervisorTiming(
    val healthMs: Long = 10_000,
    val startTimeoutMs: Long = 30_000,
    val pingPollMs: Long = 250,
    val stopGraceMs: Long = 10_000,
    val backoffMinMs: Long = 1_000,
    val backoffMaxMs: Long = 60_000,
    val failedPings: Int = 3,
    /** Starts in a row whose socket gave no ping before the app uses the HTTPS fallback. */
    val socketFailuresForFallback: Int = 2,
    /** The healthy run time after which the restart count goes back to 0 (awd `HEALTHY_RESET_MS`). */
    val healthyResetMs: Long = 60_000,
    /** Restarts with no healthy minute before the state is `failed` (awd `FAILED_AFTER`). */
    val failedAfter: Int = 10,
)

/** The values of the engine config that the app gives. */
data class EngineSettings(
    /** The AW device slug of the phone. */
    val name: String,
    val listen: String = EngineConfig.DEFAULT_LISTEN,
)

/**
 * Starts, checks and restarts the engine process (docs/phase-1.md 6.1 and 6.7.3). One run loop at a
 * time: prepare the home, start `serve`, wait for the ping, run [onStart] (the config step), then a
 * ping every 10 s. An exit or 3 failed pings restart the engine with a backoff from 1 s to 60 s; the
 * backoff goes back to 1 s only after a healthy minute, and 10 restarts with no healthy minute show
 * `failed` (the awd values). A
 * failed config step does not stop the engine: it runs again at the next health check. The app sets
 * `STMONITORED=1`, so the engine runs as one process with no monitor; this class is the monitor.
 */
@Suppress("LongParameterList")
class EngineSupervisor(
    private val paths: EnginePaths,
    private val launcher: EngineLauncher,
    private val home: EngineHome,
    private val stale: StaleEngines,
    private val restFactory: (EngineIdentity) -> EngineRest,
    private val settings: () -> EngineSettings,
    private val onStart: suspend (EngineSession) -> Unit,
    private val scope: CoroutineScope,
    private val log: Logger = Logger.withTag("aw-engine"),
    private val timing: SupervisorTiming = SupervisorTiming(),
) {
    private val stateFlow = MutableStateFlow(EngineState.STOPPED)
    val state: StateFlow<EngineState> = stateFlow.asStateFlow()

    private val sessionFlow = MutableStateFlow<EngineSession?>(null)

    /** The running engine, or null. */
    val session: StateFlow<EngineSession?> = sessionFlow.asStateFlow()

    private val control = Mutex()
    private var job: Job? = null
    private var generation = 0

    /**
     * True after the socket failed and the app uses the HTTPS fallback. The choice is in the config of the
     * home, so it stays after the app process ends.
     */
    @Volatile var usesLoopback: Boolean = false
        private set

    @Volatile private var readHomeChoice = false

    /** Starts the run loop when it does not run. */
    suspend fun start() =
        control.withLock {
            if (job?.isActive == true) return@withLock
            if (launcher.binary == null) {
                stateFlow.value = EngineState.NOT_INSTALLED
                log.w { "The engine binary is not installed: sync is off" }
                return@withLock
            }
            if (!readHomeChoice) {
                readHomeChoice = true
                if (home.usesLoopback()) usesLoopback = true
            }
            job = scope.launch { runLoop() }
        }

    /** Stops the engine and the run loop. */
    suspend fun stop() =
        control.withLock {
            job?.cancelAndJoin()
            job = null
            if (stateFlow.value != EngineState.NOT_INSTALLED) stateFlow.value = EngineState.STOPPED
        }

    /** Stops the engine and starts it again at once (each time the app opens, docs/phase-1.md 6.7.5). */
    suspend fun restart() {
        stop()
        start()
    }

    private fun backoff(attempt: Int): Long {
        val shift = attempt.coerceIn(0, MAX_SHIFT)
        return (timing.backoffMinMs shl shift).coerceAtMost(timing.backoffMaxMs)
    }

    private fun env(): Map<String, String> =
        mapOf(
            "STHOMEDIR" to paths.home.toString(),
            "STNOUPGRADE" to "1",
            "STMONITORED" to "1",
            "STNODEFAULTFOLDER" to "1",
            "HOME" to paths.home.parent.toString(),
            "TMPDIR" to paths.tmp.toString(),
        )

    private fun serveArgs(): List<String> =
        listOf(
            "serve",
            "--home=${paths.home}",
            "--no-browser",
            "--no-upgrade",
            "--no-restart",
        )

    @Suppress("TooGenericExceptionCaught")
    private suspend fun runLoop() {
        var attempt = 0
        var socketFailures = 0
        while (currentCoroutineContext().isActive) {
            stateFlow.value = if (attempt == 0) EngineState.STARTING else EngineState.RESTARTING
            val identity =
                try {
                    if (stale.stop()) log.w { "Stopped an engine that an earlier app process left" }
                    Files.createDirectories(paths.tmp)
                    val wanted = settings()
                    home.prepare(wanted.name, wanted.listen, usesLoopback)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    log.e(e) { "The engine home could not be prepared" }
                    stateFlow.value = EngineState.FAILED
                    delay(backoff(attempt++))
                    continue
                }
            when (runOnce(identity)) {
                Outcome.HEALTHY -> {
                    attempt = 0
                    socketFailures = 0
                }

                Outcome.RAN -> {
                    // A start that ran for less than a healthy minute keeps the count, as on awd.
                    socketFailures = 0
                }

                Outcome.NO_PING -> {
                    if (identity.endpoint is RestEndpoint.UnixSocket &&
                        ++socketFailures >= timing.socketFailuresForFallback
                    ) {
                        log.w {
                            "The engine socket gave no ping in $socketFailures starts: the app uses the HTTPS fallback"
                        }
                        usesLoopback = true
                    }
                }

                Outcome.EXITED -> {
                    log.d { "The engine exited during its start: restart after the backoff" }
                }
            }
            // The restarts go on with the backoff; after [SupervisorTiming.failedAfter] of them the state
            // shows `failed`, so the person sees that the engine does not run.
            stateFlow.value = if (attempt >= timing.failedAfter) EngineState.FAILED else EngineState.RESTARTING
            delay(backoff(attempt++))
        }
    }

    /** HEALTHY: it ran for a healthy minute; RAN: it ran for a shorter time. */
    private enum class Outcome { HEALTHY, RAN, NO_PING, EXITED }

    private suspend fun runOnce(identity: EngineIdentity): Outcome {
        val process = launcher.start(serveArgs(), env(), paths.log)
        stale.record(process.pid)
        val rest = restFactory(identity)
        val sessionJob = SupervisorJob()
        try {
            return coroutineScope {
                val exit = async { process.awaitExit() }
                try {
                    watch(identity, rest, exit, CoroutineScope(coroutineContext + sessionJob))
                } finally {
                    exit.cancel()
                }
            }
        } finally {
            sessionFlow.value = null
            sessionJob.cancel()
            withContext(NonCancellable) {
                stopProcess(process)
                rest.close()
                stale.forget()
            }
        }
    }

    private suspend fun waitPing(
        rest: EngineRest,
        exit: Deferred<Int>,
    ): Outcome? {
        // One limit for the whole wait: a ping that hangs for its own 2 s counts too (review android-engine L4).
        val pinged =
            withTimeoutOrNull(timing.startTimeoutMs) {
                while (!exit.isCompleted) {
                    if (runCatching { rest.ping() }.isSuccess) return@withTimeoutOrNull true
                    delay(timing.pingPollMs)
                }
                false
            }
        return when {
            pinged == true -> null
            exit.isCompleted -> Outcome.EXITED
            else -> Outcome.NO_PING
        }
    }

    private suspend fun watch(
        identity: EngineIdentity,
        rest: EngineRest,
        exit: Deferred<Int>,
        sessionScope: CoroutineScope,
    ): Outcome {
        waitPing(rest, exit)?.let { outcome ->
            if (outcome == Outcome.EXITED) {
                log.w { "The engine exited during its start (exit ${exit.await()})" }
            } else {
                log.w { "The engine gave no ping in ${timing.startTimeoutMs} ms" }
            }
            return outcome
        }
        val engineId = runCatching { rest.myId() }.getOrNull()
        val checked =
            if (engineId != null && engineId != identity.deviceId) {
                log.w { "The engine device id differs from the certificate id: the engine id wins" }
                identity.copy(deviceId = engineId)
            } else {
                identity
            }
        val session = EngineSession(++generation, checked, rest, sessionScope)
        sessionFlow.value = session
        stateFlow.value = EngineState.RUNNING
        var configured = configure(session)
        var failed = 0
        var healthyMs = 0L
        while (true) {
            val ran = if (healthyMs >= timing.healthyResetMs) Outcome.HEALTHY else Outcome.RAN
            val code = withTimeoutOrNull(timing.healthMs) { exit.await() }
            if (code != null) {
                log.w { "The engine exited (exit $code)" }
                return ran
            }
            if (runCatching { rest.ping() }.isSuccess) {
                failed = 0
                healthyMs += timing.healthMs
            } else if (++failed >= timing.failedPings) {
                log.w { "The engine gave no ping $failed times: restart" }
                return ran
            }
            if (!configured) configured = configure(session)
        }
    }

    @Suppress("TooGenericExceptionCaught")
    private suspend fun configure(session: EngineSession): Boolean =
        try {
            onStart(session)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.w(e) { "The engine config step failed: it runs again at the next health check" }
            false
        }

    private suspend fun stopProcess(process: EngineProcess) {
        if (!process.isAlive()) return
        process.destroy()
        val ended = withTimeoutOrNull(timing.stopGraceMs) { process.awaitExit() }
        if (ended == null) process.destroyForcibly()
    }

    private companion object {
        const val MAX_SHIFT = 16
    }
}
