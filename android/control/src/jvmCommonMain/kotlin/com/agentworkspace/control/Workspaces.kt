package com.agentworkspace.control

import co.touchlab.kermit.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * The file `<files>/selected-workspace`: the id of the workspace that the screens show. It keeps the
 * selection over an app restart (openspec phone-workspaces, design decision 2).
 */
class WorkspaceSelectionStore(
    private val file: Path,
    private val log: Logger = Logger.withTag("aw-ui"),
) {
    fun read(): String? =
        try {
            // Files.readString and Files.writeString are not on Android (minSdk 29): use bytes.
            if (Files.isRegularFile(file)) {
                Files
                    .readAllBytes(file)
                    .decodeToString()
                    .trim()
                    .takeIf { ID.matches(it) }
            } else {
                null
            }
        } catch (e: IOException) {
            log.w(e) { "The selected workspace could not be read" }
            null
        }

    /** Saves the selection. False when the disk refused it. */
    fun write(id: String): Boolean =
        try {
            Files.createDirectories(file.parent)
            val temp = file.resolveSibling("${file.fileName}.aw-new")
            Files.write(temp, "$id\n".encodeToByteArray())
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
            true
        } catch (e: IOException) {
            // The selection still works in this process; only the restart loses it.
            log.w(e) { "The selected workspace could not be saved" }
            false
        }

    private companion object {
        val ID = Regex("^[A-Za-z0-9][A-Za-z0-9_-]*$")
    }
}

/** One joined workspace in the switcher menu. */
data class WorkspaceEntry(
    val id: String,
    val name: String,
    /** The count of the "Needs you" lane, as on the Inbox badge. */
    val needsYou: Int,
    val selected: Boolean,
)

/**
 * The joined workspaces of the phone (the folders of `<files>/aw/`) and the one that the screens show
 * (docs/phase-1.md 10.7, prd WS-01/02/05). A stored selection that is not joined falls back to the
 * first workspace by id, and the file stays: the selection comes back with its folder.
 */
class WorkspaceSwitcher(
    private val joined: () -> List<String>,
    private val store: WorkspaceSelectionStore,
) {
    private val ids = MutableStateFlow(read())
    private val chosen = MutableStateFlow(resolve(store.read(), ids.value))

    /** The joined workspace ids, sorted. */
    val workspaces: StateFlow<List<String>> = ids.asStateFlow()

    /** The workspace that the screens show, or null before the first pairing. */
    val selected: StateFlow<String?> = chosen.asStateFlow()

    /** Reads the joined workspaces again (app resume, end of a pairing). The selection stays when it is joined. */
    @Synchronized
    fun refresh() {
        ids.value = read()
        // The stored choice of the person wins when its folder is back; else the shown one stays. After a
        // failed save the file has an older choice, so the shown one wins (review phone-workspaces L6).
        val stored = if (unsaved) null else store.read()
        chosen.value = listOf(stored, chosen.value).firstOrNull { it in ids.value } ?: ids.value.firstOrNull()
    }

    /** True when the last selection could not be saved. */
    private var unsaved = false

    /** Selects a joined workspace and saves the choice. False for an id that is not joined. */
    @Synchronized
    fun select(id: String): Boolean {
        if (id !in ids.value) refresh()
        if (id !in ids.value) return false
        if (chosen.value != id || store.read() != id) unsaved = !store.write(id)
        chosen.value = id
        return true
    }

    /** A join ended `done`: the new workspace is the one that the person asked for (design decision 4). */
    fun joined(id: String): Boolean {
        refresh()
        return select(id)
    }

    private fun read(): List<String> = joined().sorted()

    private fun resolve(
        wanted: String?,
        joined: List<String>,
    ): String? = wanted?.takeIf { it in joined } ?: joined.firstOrNull()

    companion object {
        /** The name of a workspace before its `workspace.yaml` arrives: "Workspace 01a20775". */
        fun fallbackName(id: String): String = "Workspace ${id.take(SHORT_ID)}"

        /** The menu rows: the name and the "Needs you" count of each joined workspace, by name. */
        fun entries(
            ids: List<String>,
            selected: String?,
            snapshots: Map<String, WorkspaceSnapshot>,
        ): List<WorkspaceEntry> =
            ids
                .map { id ->
                    val snapshot = snapshots[id]
                    WorkspaceEntry(
                        id = id,
                        name = snapshot?.name ?: fallbackName(id),
                        needsYou = snapshot?.let { ScreenStates.inbox(it).size } ?: 0,
                        selected = id == selected,
                    )
                }.sortedWith(compareBy({ it.name.lowercase() }, { it.id }))

        private const val SHORT_ID = 8
    }
}

/**
 * A workspace switch on the screens: the selected workspace changes and the back stack goes back to
 * the root of the open tab, because a task of one workspace is not valid in another (design decision 5).
 */
class WorkspaceNavigation(
    private val switcher: WorkspaceSwitcher,
    private val navigator: Navigator,
) {
    /** Shows another workspace. False when the id is not joined. */
    fun switchTo(id: String): Boolean {
        if (switcher.selected.value == id) return true
        if (!switcher.select(id)) return false
        navigator.select(navigator.tab)
        return true
    }

    /**
     * A join ended `done`: the new workspace shows and the back stack goes back to the root of the open
     * tab, so Back never opens a task of the old workspace. False when the id is not joined.
     */
    fun joined(id: String): Boolean {
        if (!switcher.joined(id)) return false
        navigator.select(navigator.tab)
        return true
    }

    /**
     * A notification tap: the workspace of the push, then `[Inbox, Task(id)]` (docs/phase-1.md 8.4), or
     * `[Inbox]` for a push with no task. False when the workspace is not on this phone: then only the
     * Inbox of the shown workspace opens, because the task is not in it.
     */
    fun openFromPush(
        workspace: String?,
        task: String?,
    ): Boolean {
        if (workspace != null && !switcher.select(workspace)) {
            navigator.openFromPush(null)
            return false
        }
        navigator.openFromPush(task)
        return true
    }
}
