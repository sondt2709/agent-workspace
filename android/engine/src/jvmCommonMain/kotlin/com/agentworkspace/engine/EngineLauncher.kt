package com.agentworkspace.engine

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.io.path.exists
import kotlin.io.path.fileSize

/**
 * The files of the phone engine in app-private storage (docs/phase-1.md 6.7.3 and 6.7.4). The app
 * gives `filesDir`; the paths never leave it, so the app needs no all-files access.
 */
class EnginePaths(
    filesDir: Path,
) {
    /** `STHOMEDIR` of the engine. */
    val home: Path = filesDir.resolve("sync")

    /** The Unix socket of the REST API (mode 0600 from the config). */
    val socket: Path = filesDir.resolve("run").resolve("sync.sock")

    /** One workspace folder per workspace: `aw/<workspace id>/{tasks,knowledge}`. */
    val workspaces: Path = filesDir.resolve("aw")

    /** The peer list until identity-pairing (the same file as awd). */
    val peers: Path = filesDir.resolve("sync-peers.json")

    /** The engine output: the launcher rotates it at 10 MB while the engine runs and keeps 3 old files. */
    val log: Path = filesDir.resolve("logs").resolve("sync-engine.log")

    /** The pid of the running engine, to stop an engine that an earlier app process left. */
    val pidFile: Path = home.resolve("aw-engine.pid")

    val config: Path = home.resolve("config.xml")

    /** `TMPDIR` of the engine: Android has no writable `/tmp`. */
    val tmp: Path = filesDir.resolve("tmp")

    /** The certificate of the HTTPS fallback, written by the engine at its first TLS start. */
    val httpsCert: Path = home.resolve("https-cert.pem")

    fun workspace(id: String): Path = workspaces.resolve(id)

    fun folder(
        workspace: String,
        kind: FolderKind,
    ): Path = workspace(workspace).resolve(kind.folder)
}

/** The result of a short engine command (`generate`, `device-id`). */
data class CommandResult(
    val exitCode: Int,
    val output: String,
)

/** A running engine process. */
interface EngineProcess {
    val pid: Long

    fun isAlive(): Boolean

    /** Waits for the exit; a cancel ends the wait, not the process. */
    suspend fun awaitExit(): Int

    /** Asks the process to stop (SIGTERM). */
    fun destroy()

    /** Ends the process (SIGKILL). */
    fun destroyForcibly()
}

/** Starts the engine binary. The app gives the binary of its native library folder. */
interface EngineLauncher {
    /** The binary, or null when it is not installed. */
    val binary: Path?

    suspend fun run(
        args: List<String>,
        env: Map<String, String>,
    ): CommandResult

    fun start(
        args: List<String>,
        env: Map<String, String>,
        log: Path,
    ): EngineProcess
}

/** Starts the binary with `ProcessBuilder` (Android and the JVM). */
class ProcessEngineLauncher(
    private val path: Path,
    private val logLimitBytes: Long = LOG_LIMIT_BYTES,
    /** The dispatcher of the blocking waits of a process. */
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : EngineLauncher {
    override val binary: Path? get() = path.takeIf { Files.isRegularFile(it) }

    private fun builder(
        args: List<String>,
        env: Map<String, String>,
    ): ProcessBuilder {
        val exe = requireNotNull(binary) { "The engine binary is not installed: $path" }
        val builder = ProcessBuilder(listOf(exe.toString()) + args)
        builder.environment().putAll(env)
        return builder
    }

    override suspend fun run(
        args: List<String>,
        env: Map<String, String>,
    ): CommandResult =
        runInterruptible(io) {
            val process = builder(args, env).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().readText()
            CommandResult(process.waitFor(), output)
        }

    override fun start(
        args: List<String>,
        env: Map<String, String>,
        log: Path,
    ): EngineProcess {
        Files.createDirectories(log.parent)
        rotate(log, logLimitBytes)
        val process = builder(args, env).redirectErrorStream(true).start()
        copyWithRotation(process.inputStream, log, logLimitBytes)
        return JavaEngineProcess(process, io)
    }

    /**
     * Copies the engine output into [log] and rotates the log at [limit] while the engine runs (review
     * android-engine L1). With STMONITORED=1 the engine has no monitor, so it writes no own log file.
     */
    private fun copyWithRotation(
        input: InputStream,
        log: Path,
        limit: Long,
    ) {
        thread(isDaemon = true, name = "aw-engine-log") {
            val buffer = ByteArray(COPY_BUFFER)
            var out = FileOutputStream(log.toFile(), true)
            var size = log.fileSize()
            try {
                input.use {
                    while (true) {
                        val n = it.read(buffer)
                        if (n < 0) break
                        if (size > 0 && size + n > limit) {
                            out.close()
                            rotate(log, 0)
                            out = FileOutputStream(log.toFile(), true)
                            size = 0
                        }
                        out.write(buffer, 0, n)
                        size += n
                    }
                }
            } catch (_: IOException) {
                // The process ended or the disk refused the write: the log stops, the engine runs on.
            } finally {
                out.close()
            }
        }
    }

    companion object {
        const val LOG_LIMIT_BYTES = 10L * 1024 * 1024
        const val LOG_FILES = 3
        private const val COPY_BUFFER = 8192

        /** Moves a full log to `.1` (and `.1` to `.2` ...), keeping [LOG_FILES] old files. */
        fun rotate(
            log: Path,
            limit: Long,
        ) {
            if (!log.exists() || log.fileSize() < limit) return
            for (i in LOG_FILES downTo 1) {
                val from = if (i == 1) log else log.resolveSibling("${log.fileName}.${i - 1}")
                val to = log.resolveSibling("${log.fileName}.$i")
                if (from.exists()) Files.move(from, to, StandardCopyOption.REPLACE_EXISTING)
            }
        }
    }
}

/**
 * The pid of a process: `Process.pid()` on the JVM, the `pid` field of the process class on Android
 * (android.jar has no `Process.pid()` for each API level of the app). -1 when neither exists.
 */
internal fun pidOf(process: Process): Long =
    runCatching { Process::class.java.getMethod("pid").invoke(process) as Long }
        .recoverCatching {
            val field = process.javaClass.getDeclaredField("pid")
            field.isAccessible = true
            (field.get(process) as Number).toLong()
        }.getOrDefault(-1L)

private class JavaEngineProcess(
    private val process: Process,
    private val io: CoroutineDispatcher,
) : EngineProcess {
    override val pid: Long = pidOf(process)

    override fun isAlive(): Boolean = process.isAlive

    override suspend fun awaitExit(): Int = runInterruptible(io) { process.waitFor() }

    override fun destroy() = process.destroy()

    override fun destroyForcibly() {
        process.destroyForcibly()
        process.waitFor(1, TimeUnit.SECONDS)
    }
}
