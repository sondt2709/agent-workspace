package com.agentworkspace.shared.merge

import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.model.LineResult
import com.agentworkspace.shared.model.LogReader
import com.agentworkspace.shared.model.SourcePath
import com.agentworkspace.shared.model.WorkspacePaths
import com.agentworkspace.shared.model.isJsBlank

/** The merge sources under `tasks/`, sorted by path (`findSources` of `source.ts`). */
data class Sources(
    val logs: List<SourcePath.Log>,
    val documents: List<SourcePath.Document>,
)

/**
 * Finds the workspace log, the task logs, the heartbeat logs and the documents. It reads only the
 * folders of the layout, never the artifacts. A source is a regular file only: a folder or a symbolic
 * link with the name of a source is not a source, as in `findSources` of `source.ts`.
 */
fun findSources(files: WorkspaceFiles): Sources {
    val paths = mutableListOf<String>()

    fun addFiles(folder: String) = files.list(folder).filter { it.isFile }.forEach { paths.add("$folder/${it.name}") }
    for (top in files.list("tasks")) {
        when {
            top.isFile -> {
                paths.add("tasks/${top.name}")
            }

            !top.isDirectory -> {
                // A symbolic link or another special file is not a source.
            }

            top.name == "log" -> {
                addFiles("tasks/log")
            }

            top.name == "projects" -> {
                paths.addAll(projectPaths(files))
            }

            top.name == "devices" -> {
                paths.addAll(devicePaths(files))
            }

            else -> {
                addFiles("tasks/${top.name}/log")
            }
        }
    }
    val logs = mutableListOf<SourcePath.Log>()
    val documents = mutableListOf<SourcePath.Document>()
    for (path in paths.sorted()) {
        val source = WorkspacePaths.classify(path)
        if (source is SourcePath.Log) logs.add(source)
        if (source is SourcePath.Document) documents.add(source)
    }
    return Sources(logs, documents)
}

/** The `project.yaml` of each project folder. A missing project.yaml is not a source. */
private fun projectPaths(files: WorkspaceFiles): List<String> =
    files
        .list("tasks/projects")
        .filter { it.isDirectory }
        .map { "tasks/projects/${it.name}" }
        .filter { base -> files.list(base).any { it.name == "project.yaml" && it.isFile } }
        .map { "$it/project.yaml" }

/** The files of each device folder, and its heartbeat logs. */
private fun devicePaths(files: WorkspaceFiles): List<String> =
    files.list("tasks/devices").filter { it.isDirectory }.flatMap { device ->
        val base = "tasks/devices/${device.name}"
        files.list(base).flatMap { file ->
            when {
                file.isFile -> {
                    listOf("$base/${file.name}")
                }

                file.isDirectory && file.name == "heartbeat" -> {
                    files.list("$base/heartbeat").filter { it.isFile }.map { "$base/heartbeat/${it.name}" }
                }

                else -> {
                    emptyList()
                }
            }
        }
    }

/** The result of one read of a log source. */
class LogSourceRead(
    /** `truncated` or `replaced` when the caller must read all files again, else null. */
    val reset: String?,
    val lines: List<LogLine>,
)

/** A last part of a log with no newline. */
data class PartialTail(
    val line: Int,
    val bytes: Int,
)

/**
 * Reads one log file incrementally (`LogSource` of `source.ts`). It keeps the byte offset after the
 * last complete line, the first and the last read bytes, the line count and the bad lines. Syncthing
 * replaces a file with a rename at each change, so the inode is no check.
 */
class LogSource(
    val source: SourcePath.Log,
) {
    val path: String get() = source.path
    val device: String get() = source.device
    val task: String? get() = source.scope.task

    private var offset = 0L
    private var head = ByteArray(0)
    private var tail = ByteArray(0)

    /** The count of complete lines that this source read. */
    var lines = 0
        private set

    /** The issues of the read lines: bad lines. */
    var issues: List<MergeIssue> = emptyList()
        private set

    /** A last part with no newline, or null. */
    var partial: PartialTail? = null
        private set

    /** The issue `read_error` when the last read of the file failed, or null. */
    var readError: MergeIssue? = null
        private set

    private fun clear() {
        offset = 0
        lines = 0
        head = ByteArray(0)
        tail = ByteArray(0)
        issues = emptyList()
        partial = null
    }

    /**
     * Reads the new complete lines. A missing file reads as an empty file. A file that cannot be read
     * keeps the state of the last read and sets [readError]: one bad source does not stop the merge.
     */
    @Suppress("TooGenericExceptionCaught")
    fun read(files: WorkspaceFiles): LogSourceRead {
        val chunk =
            try {
                load(files)
            } catch (e: Exception) {
                readError =
                    MergeIssue("read_error", path, null, null, task, null, "The log cannot be read: ${e.message}")
                return LogSourceRead(null, emptyList())
            }
        readError = null
        if (chunk.data == null || chunk.reset != null) clear()
        val data = chunk.data ?: return LogSourceRead(chunk.reset, emptyList())
        val end = data.lastIndexOf(NEWLINE)
        val complete = if (end == -1) ByteArray(0) else data.copyOfRange(0, end + 1)
        val rest = data.size - complete.size
        val read = if (complete.isNotEmpty()) parse(complete) else emptyList()
        advance(complete)
        partial = if (rest > 0) PartialTail(lines + 1, rest) else null
        return LogSourceRead(chunk.reset, read)
    }

    /** The new bytes of the file (null: a missing file) and the reset. It changes no state. */
    private class Chunk(
        val reset: String?,
        val data: ByteArray?,
    )

    private fun load(files: WorkspaceFiles): Chunk {
        val file = files.open(path) ?: return Chunk(if (offset > 0) "truncated" else null, null)
        return file.use {
            val size = it.size
            var reset: String? = null
            if (size < offset) {
                reset = "truncated"
            } else if (offset > 0) {
                val nowHead = it.read(0, head.size)
                val nowTail = it.read(offset - tail.size, tail.size)
                if (!nowHead.contentEquals(head) || !nowTail.contentEquals(tail)) reset = "replaced"
            }
            val from = if (reset != null) 0L else offset
            Chunk(reset, it.read(from, (size - from).toInt()))
        }
    }

    private fun advance(complete: ByteArray) {
        if (complete.isEmpty()) return
        if (head.size < CHECK_BYTES) head += complete.copyOfRange(0, minOf(complete.size, CHECK_BYTES - head.size))
        val joined = tail + complete
        tail = joined.copyOfRange(maxOf(0, joined.size - CHECK_BYTES), joined.size)
        offset += complete.size
        lines += complete.count { it == NEWLINE }
    }

    private fun parse(complete: ByteArray): List<LogLine> {
        val texts = complete.decodeToString().split("\n").dropLast(1)
        val out = mutableListOf<LogLine>()
        val bad = issues.toMutableList()
        texts.forEachIndexed { index, text ->
            val line = lines + index + 1
            if (isJsBlank(text)) return@forEachIndexed
            when (val result = LogReader.parseLine(text, device, source.scope)) {
                is LineResult.Bad -> {
                    bad.add(MergeIssue("bad_line", path, line, null, task, result.code, result.message))
                }

                is LineResult.Event -> {
                    out.add(LogLine(result.event, path, line))
                }
            }
        }
        issues = bad
        return out
    }

    private companion object {
        const val CHECK_BYTES = 256
        const val NEWLINE: Byte = 0x0a
    }
}
