package com.agentworkspace.engine

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.fileSize
import kotlin.test.Test
import kotlin.test.assertTrue

/** The launcher rotates the engine output while the engine runs (review android-engine L1). */
class EngineLogTest {
    @Test
    fun theOutputOfARunningEngineIsRotatedAtTheLimit() =
        runBlocking<Unit> {
            withTempDir { dir ->
                // A process that writes 100 lines of 50 bytes, one at a time; the limit is 1,000 bytes.
                val launcher = ProcessEngineLauncher(Path.of("/bin/sh"), logLimitBytes = 1_000)
                val log = dir.resolve("logs").resolve("sync-engine.log")
                val line = "0123456789".repeat(5).dropLast(1)
                val script = "i=0; while [ \$i -lt 100 ]; do echo $line; sleep 0.01; i=\$((i+1)); done"
                val process = launcher.start(listOf("-c", script), emptyMap(), log)
                withTimeout(20_000) { process.awaitExit() }
                val old = (1..ProcessEngineLauncher.LOG_FILES).map { log.resolveSibling("sync-engine.log.$it") }
                withTimeout(5_000) { while (!old.last().exists()) delay(10) }
                delay(100)
                assertTrue(log.fileSize() <= 1_000, "log has ${log.fileSize()} bytes")
                assertTrue(old.all { Files.exists(it) && it.fileSize() <= 1_000 })
                assertTrue(!log.resolveSibling("sync-engine.log.4").exists())
            }
        }
}
