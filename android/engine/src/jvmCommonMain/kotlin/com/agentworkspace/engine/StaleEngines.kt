package com.agentworkspace.engine

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import kotlin.io.path.exists
import kotlin.io.path.readBytes
import kotlin.io.path.readText

/**
 * Stops an engine that an earlier app process left (docs/phase-1.md 6.1, the rule of awd): only a
 * process whose command line (`/proc/<pid>/cmdline`) has the engine binary name and the
 * `--home=<engine home>` argument. So an old pid that now belongs to another process stays.
 */
class StaleEngines(
    private val pidFile: Path,
    private val home: Path,
    private val procDir: Path = Paths.get("/proc"),
    /** Ends a process (SIGKILL). The app gives `android.os.Process.killProcess`. */
    private val kill: (Long) -> Unit,
) {
    /** The command line arguments of a process, or null when it does not exist. */
    fun commandLine(pid: Long): List<String>? {
        val file = procDir.resolve(pid.toString()).resolve("cmdline")
        if (!file.exists()) return null
        return runCatching {
            file
                .readBytes()
                .toString(Charsets.UTF_8)
                .split('\u0000')
                .filter { it.isNotEmpty() }
        }.getOrNull()
    }

    fun isEngine(args: List<String>): Boolean =
        args.firstOrNull()?.substringAfterLast('/') == BINARY_NAME && args.any { it == "--home=$home" }

    /** Stops the engine of the pid file when it is one. True when it stopped a process. */
    fun stop(): Boolean {
        if (!pidFile.exists()) return false
        val pid = runCatching { pidFile.readText().trim().toLong() }.getOrNull()
        Files.deleteIfExists(pidFile)
        if (pid == null || pid <= 0) return false
        val args = commandLine(pid) ?: return false
        if (!isEngine(args)) return false
        kill(pid)
        return true
    }

    fun record(pid: Long) {
        if (pid > 0) EngineHome.writePrivate(pidFile, "$pid\n")
    }

    fun forget() {
        Files.deleteIfExists(pidFile)
    }

    companion object {
        /** The file name of the engine in the native library folder of the app. */
        const val BINARY_NAME = "libawsync.so"
    }
}
