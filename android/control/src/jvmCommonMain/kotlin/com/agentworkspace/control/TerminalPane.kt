package com.agentworkspace.control

import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.merge.TaskView
import com.agentworkspace.shared.model.IsoTime
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// The terminal pane of the phone (openspec task-terminal-view): the newest synced snapshot file of a
// task, `tasks/<task>/terminal/<device>.txt`, with its device and capture time. The format is the
// one of awd (daemon/src/sessions/terminal-snapshot.ts): one JSON header line, then the screen. Both
// run contracts/fixtures/terminal/cases.json.

/** The header line of a snapshot file. */
data class TerminalHeader(
    val device: String,
    val session: String,
    val host: String,
    val socket: String?,
    val window: String?,
    val capturedAt: String,
)

/** One parsed snapshot file. [header] is null for a file with no valid header line. */
data class TerminalSnapshot(
    val device: String,
    val header: TerminalHeader?,
    val text: String,
)

/** What the Terminal section of the task detail shows. */
data class TerminalPaneState(
    /** The screen, or null with no snapshot. */
    val text: String?,
    /** "Captured 14:20 on ubuntu-01 · 3 min ago", or null with no snapshot. */
    val caption: String?,
    /** The Orca note or the empty text, or null. */
    val note: String?,
)

object TerminalPane {
    private val ISO_TIME = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")

    /** The form of a tmux socket name: the same rule as awd, which puts it in an ssh command. */
    private val SOCKET = Regex("^[A-Za-z0-9_-]{1,64}$")

    /** The file name of a snapshot: `<device slug>.txt`. A conflict copy or a temp file is not one. */
    private val NAME = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*\\.txt$")
    private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

    /** The file name suffix of a snapshot. */
    private const val SUFFIX = ".txt"

    const val EMPTY = "No terminal snapshot yet."

    fun folder(task: String): String = "tasks/$task/terminal"

    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    /** A string or null; a missing key or any other value is not valid (as in awd). */
    private fun JsonObject.optional(key: String): Pair<Boolean, String?> {
        val value = this[key] ?: return Pair(false, null)
        if (value is JsonNull) return Pair(true, null)
        val primitive = value as? JsonPrimitive
        return if (primitive != null && primitive.isString) Pair(true, primitive.content) else Pair(false, null)
    }

    /** The socket: null or a tmux socket name (awd puts it in an ssh command), else not valid. */
    private fun JsonObject.socket(): Pair<Boolean, String?> {
        val (ok, socket) = optional("socket")
        return Pair(ok && (socket == null || SOCKET.matches(socket)), socket)
    }

    private fun header(line: String): TerminalHeader? {
        val value =
            try {
                Json.parseToJsonElement(line) as? JsonObject
            } catch (_: IllegalArgumentException) {
                null
            } ?: return null
        if (value.text("kind") != "aw-terminal") return null
        // JSON has one number type: awd reads `1.0` as 1 too.
        if ((value["v"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull != 1.0) return null
        val device = value.text("device") ?: return null
        val session = value.text("session") ?: return null
        val host = value.text("host") ?: return null
        val captured = value.text("captured_at") ?: return null
        if (!ISO_TIME.matches(captured) || IsoTime.parseMillis(captured) == null) return null
        val (socketOk, socket) = value.socket()
        val (windowOk, window) = value.optional("window")
        if (!socketOk || !windowOk) return null
        return TerminalHeader(device, session, host, socket, window, captured)
    }

    /** Parses a snapshot file: the header line and the screen, or all text with no valid header. */
    fun parse(
        device: String,
        content: String,
    ): TerminalSnapshot {
        val end = content.indexOf('\n')
        val first = if (end < 0) content else content.substring(0, end)
        val header = header(first) ?: return TerminalSnapshot(device, null, content)
        val text = if (end < 0) "" else content.substring(end + 1).removeSuffix("\n")
        return TerminalSnapshot(device, header, text)
    }

    /**
     * The newest snapshot of `<device>.txt` files: the latest capture of a file with a header (a tie
     * goes to the device name order), else the first file by name.
     */
    fun newest(files: Map<String, String>): TerminalSnapshot? {
        val parsed =
            files.keys
                .filter { NAME.matches(it) }
                .sorted()
                .map { parse(it.removeSuffix(SUFFIX), files.getValue(it)) }
        var best: TerminalSnapshot? = null
        var bestMs = Long.MIN_VALUE
        for (file in parsed) {
            val ms = file.header?.let { IsoTime.parseMillis(it.capturedAt) } ?: continue
            if (best == null || ms > bestMs) {
                best = file
                bestMs = ms
            }
        }
        return best ?: parsed.firstOrNull()
    }

    /** "Captured 14:20 on ubuntu-01 · 3 min ago" in the time zone of the phone. */
    fun caption(
        snapshot: TerminalSnapshot,
        nowMs: Long,
        zone: ZoneId,
    ): String {
        val ms = snapshot.header?.let { IsoTime.parseMillis(it.capturedAt) }
        if (ms == null) return "Captured on ${snapshot.device} · time not known"
        val time = HHMM.format(Instant.ofEpochMilli(ms).atZone(zone))
        return "Captured $time on ${snapshot.device} · ${Texts.ago(ms, nowMs)}"
    }

    /** Reads the snapshot files of a task from the synced folder. */
    fun read(
        files: WorkspaceFiles,
        task: TaskView,
        nowMs: Long,
        zone: ZoneId = ZoneId.systemDefault(),
    ): TerminalPaneState {
        val folder = folder(task.id)
        val contents =
            files
                .list(folder)
                .filter { !it.isDirectory && NAME.matches(it.name) }
                .mapNotNull { entry ->
                    // A file that the sync engine replaces during the read is skipped: no crash of the screen.
                    runCatching { files.readText("$folder/${entry.name}") }.getOrNull()?.let { entry.name to it }
                }.toMap()
        val newest = newest(contents)
        val session = task.session
        val note =
            when {
                session?.host == "orca" -> {
                    "AW does not read the screen of an Orca session. Open the Orca worktree aw-${task.id} on ${session.device}."
                }

                newest == null -> {
                    EMPTY
                }

                else -> {
                    null
                }
            }
        return TerminalPaneState(newest?.text, newest?.let { caption(it, nowMs, zone) }, note)
    }
}
