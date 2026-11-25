package com.agentworkspace.control

import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.merge.EventRow
import com.agentworkspace.shared.merge.TaskView
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/** Where an artifact of a task is for this phone (openspec gate-full-context, M24). */
enum class ArtifactState { REMOTE, REQUESTED, LOCAL }

/** One artifact of a task: its path in the task folder, its name, its size and its state. */
data class ArtifactRow(
    val task: String,
    val path: String,
    val name: String,
    val size: Long?,
    val state: ArtifactState,
) {
    /** The request line of the engine ignore list: `<task id>/artifacts/<device>/<name>`. */
    val request: String get() = "$task/$path"

    /** The path from the workspace root. */
    val file: String get() = "tasks/$task/$path"
}

/** The artifact list of a task from its `artifact.added` events (docs/phase-1.md 10.3, prd SYN-12). */
object ArtifactList {
    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    /**
     * The artifacts of `rows` (the `artifact.added` events of the task, in merge order; the newest
     * event of a path wins). LOCAL when the file is on the phone with the size of the event;
     * REQUESTED when the person asked for it; else REMOTE.
     */
    fun of(
        task: String,
        rows: List<EventRow>,
        requested: Set<String>,
        localSize: (String) -> Long?,
    ): List<ArtifactRow> {
        val sizes = LinkedHashMap<String, Long?>()
        val added =
            rows
                .filter { it.type == "artifact.added" && it.applied }
                .mapNotNull { it.event["data"] as? JsonObject }
        for (data in added) {
            // Only a path of the form artifacts/<device>/<name>: an event with another path never
            // names a file outside the artifacts of the task (gate-full-context check).
            val path = data.text("path")?.takeIf { isArtifactPath(task, it) } ?: continue
            sizes.remove(path)
            sizes[path] = (data["size"] as? JsonPrimitive)?.longOrNull
        }
        return sizes.map { (path, size) ->
            val row = ArtifactRow(task, path, path.substringAfterLast('/'), size, ArtifactState.REMOTE)
            val local = localSize(row.file)
            val state =
                when {
                    local != null && (size == null || local == size) -> ArtifactState.LOCAL
                    row.request in requested -> ArtifactState.REQUESTED
                    else -> ArtifactState.REMOTE
                }
            row.copy(state = state)
        }
    }

    /** True for `artifacts/<device>/<name>` with no pattern character, `.` or `..` name. */
    fun isArtifactPath(
        task: String,
        path: String,
    ): Boolean = ArtifactRequests.REQUEST.matches("$task/$path") && path.substringAfterLast('/').any { it != '.' }

    /**
     * True while the task detail must read the list again: a row is REQUESTED, or the person tapped
     * Download on a row (`asked`, request lines) that is not on the phone yet. The requests file and
     * the arriving file change no event, so only a new read shows "Downloading…" and "On this phone".
     */
    fun waiting(
        rows: List<ArtifactRow>,
        asked: Set<String>,
    ): Boolean =
        rows.any {
            it.state == ArtifactState.REQUESTED ||
                (it.request in asked && it.state != ArtifactState.LOCAL)
        }

    /** The size of a file of the workspace on the phone, or null when it is not there. */
    fun localSize(files: WorkspaceFiles): (String) -> Long? = { path -> files.open(path)?.use { it.size } }
}

/** The rule of Download (docs/phase-1.md 10.3): mobile data only when the person allows it. */
object ArtifactRule {
    const val MOBILE_DATA_REFUSED =
        "You are on mobile data. Connect to Wi-Fi, or turn on Use mobile data for artifacts."

    /**
     * The types that Open gives to another app: images, PDF, text, logs and test reports, as on the
     * desktop. A synced file can be a program (an APK, a web page): AW never hands it to an app.
     */
    private val OPEN_TYPES = Regex(".+\\.(png|jpe?g|gif|webp|pdf|txt|md|log|json|xml|csv)$", RegexOption.IGNORE_CASE)

    /** True when Open may give the file `name` to another app. */
    fun openable(name: String): Boolean = OPEN_TYPES.matches(name)

    /** The text when Open refuses a type. */
    fun notOpenable(name: String): String = "AW does not open $name on the phone: only images, PDF and text files open."

    /** Null when the download may start, else the text for the person. */
    fun check(
        metered: Boolean,
        allowMobileData: Boolean,
    ): String? = if (metered && !allowMobileData) MOBILE_DATA_REFUSED else null
}

/**
 * The artifacts that the person requested on this phone: `<files>/artifact-requests/<workspace>.txt`,
 * one `<task id>/artifacts/<device>/<name>` per line. The engine reads them for its ignore list.
 */
class ArtifactRequests(
    private val dir: Path,
) {
    private fun file(workspace: String): Path = dir.resolve("$workspace.txt")

    @Synchronized
    fun read(workspace: String): List<String> {
        val file = file(workspace)
        if (!Files.isRegularFile(file)) return emptyList()
        return Files
            .readAllLines(file)
            .map { it.trim() }
            .filter { REQUEST.matches(it) }
            .distinct()
    }

    /** Adds a request; false for a path of another form (it is not written). */
    @Synchronized
    fun add(
        workspace: String,
        request: String,
    ): Boolean {
        require(WORKSPACE.matches(workspace)) { "The workspace id $workspace is not valid" }
        if (!REQUEST.matches(request)) return false
        val lines = read(workspace)
        if (request in lines) return true
        Files.createDirectories(dir)
        val tmp = dir.resolve("$workspace.txt.aw-tmp")
        Files.write(tmp, (lines + request).joinToString("\n", postfix = "\n").encodeToByteArray())
        Files.move(tmp, file(workspace), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        return true
    }

    companion object {
        /** The same form as the engine check: no pattern character and no `..`. */
        val REQUEST = Regex("^[0-9a-f-]{36}/artifacts/[a-z0-9-]+/[A-Za-z0-9._-]+$")
        private val WORKSPACE = Regex("^[A-Za-z0-9-]+$")
    }
}

/** The switch "Use mobile data for artifacts": a phone-local file, off by default. */
class MobileDataSetting(
    private val file: Path,
) {
    // Byte reads and writes: Android has no Files.readString or Files.writeString.
    fun allowed(): Boolean = Files.isRegularFile(file) && Files.readAllBytes(file).decodeToString().trim() == "on"

    fun set(on: Boolean) {
        Files.createDirectories(file.parent)
        Files.write(file, (if (on) "on\n" else "off\n").encodeToByteArray())
    }
}

/** One proposal version of a task and its state (openspec proposal-and-discussion). */
data class ProposalVersion(
    val version: Long,
    /** "Approved", "Waits for you" or "Replaced". */
    val state: String,
)

/**
 * The proposal versions of a task and their full text (the synced files `proposal/v<n>.md`, or
 * `approach/v<n>.md` from before openspec proposal-and-discussion).
 */
object ProposalVersions {
    fun of(task: TaskView): List<ProposalVersion> {
        val latest = task.proposal.latest
        val approved = task.proposal.approved
        return (1..latest).map { v ->
            val state =
                when {
                    approved == v -> "Approved"
                    v == latest && (approved == null || latest > approved) -> "Waits for you"
                    else -> "Replaced"
                }
            ProposalVersion(v, state)
        }
    }

    /** The file of a version in the task folder: the layout of awd before and after the rename. */
    val FILE = Regex("^(?:proposal|approach)/v([1-9][0-9]*)\\.md\\z")

    /**
     * The full text of a version, or null when the file is not on the phone yet. [file] is the path of
     * its `proposal.proposed` event in the task folder (only a path of the proposal layout); with no
     * event, the new folder comes first.
     */
    fun text(
        files: WorkspaceFiles,
        task: String,
        version: Long,
        file: String? = null,
    ): String? {
        val paths =
            listOfNotNull(file?.takeIf { FILE.matches(it) }) +
                listOf("proposal/v$version.md", "approach/v$version.md")
        return paths.distinct().firstNotNullOfOrNull { files.readText("tasks/$task/$it") }
    }
}

/** A gate of the task that this phone answered too late: its answer became a comment. */
data class LateAnswer(
    val gate: String,
    val answer: String,
    val device: String?,
    /** The close answer of AW ("Session ended", "Denied after 120 s"), or null. */
    val closedBy: String? = null,
) {
    val text: String
        get() =
            closedBy?.let { "Your answer “$answer” came after AW closed the gate: $it. It is a comment now." }
                ?: device?.let { "Your answer “$answer” came after the answer of $it. It is a comment now." }
                ?: "Your answer “$answer” came after another answer. It is a comment now."
}

/**
 * The late answers of this phone (design decision 9): its newest answer of a resolved gate is a
 * comment, and an answer of another device resolved the gate, or AW closed the gate because no
 * session can use it (openspec stale-gates).
 */
object LateAnswers {
    /**
     * The close answers of AW for a gate with no session: the same texts as `SESSION_ENDED` and
     * `timeoutAnswer()` of `daemon/src/loop/stale-gates.ts`.
     */
    private val closeAnswer = Regex("^(Session ended|Denied after [0-9]+ s)$")

    fun isCloseAnswer(answer: String?): Boolean = answer != null && closeAnswer.matches(answer)

    fun of(
        task: TaskView,
        phone: String,
    ): List<LateAnswer> =
        task.gates.filter { it.state != "open" }.mapNotNull { gate ->
            val mine = gate.answers.lastOrNull { it.dev == phone } ?: return@mapNotNull null
            if (mine.use != "comment") return@mapNotNull null
            // AW closed the gate with no answer of a person: the phone answer came too late.
            if (gate.answerEvent == null && isCloseAnswer(gate.answer)) {
                return@mapNotNull LateAnswer(gate.gate, mine.answer, null, gate.answer)
            }
            // Only an answer of another device resolved the gate: a gate that a newer version
            // replaced has no used answer, and the phone answer did not come too late.
            val used = gate.answers.firstOrNull { it.use == "used" } ?: return@mapNotNull null
            if (used.dev == phone) return@mapNotNull null
            LateAnswer(gate.gate, mine.answer, used.dev)
        }
}
