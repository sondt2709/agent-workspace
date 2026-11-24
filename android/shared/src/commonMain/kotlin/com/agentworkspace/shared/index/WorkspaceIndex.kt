package com.agentworkspace.shared.index

import androidx.room3.withWriteTransaction
import com.agentworkspace.shared.merge.DevicePresence
import com.agentworkspace.shared.merge.DeviceView
import com.agentworkspace.shared.merge.EventRow
import com.agentworkspace.shared.merge.LastValidDocument
import com.agentworkspace.shared.merge.MergeEngine
import com.agentworkspace.shared.merge.MergeIssue
import com.agentworkspace.shared.merge.MergeUpdate
import com.agentworkspace.shared.merge.ProjectView
import com.agentworkspace.shared.merge.TaskView
import com.agentworkspace.shared.model.AwJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.serializer

/** One place in the merge order of a thread, for the next page. */
data class ThreadPlace(
    val hlc: String,
    val dev: String,
    val id: String,
) {
    companion object {
        /** Before the first event. */
        val START = ThreadPlace("", "", "")
    }
}

/**
 * Writes the merged view to the Room index and reads the queries of the phone (`sqlite.ts` of
 * shared/core/src/index). An incremental write replaces the task rows that changed and the events
 * of the changed tasks; the small tables are replaced at each write. A failed write makes the next
 * write replace each table, so the index never keeps a half write.
 *
 * The view classes use `serializer<T>()` (a compiler intrinsic), not `T.serializer()`: detekt runs no
 * compiler plugin, so its type resolution does not know the companion function of a class in the
 * same sources.
 */
@Suppress("TooManyFunctions") // One query per phone view; gate-full-context added 2.
class WorkspaceIndex(
    private val database: WorkspaceIndexDatabase,
) {
    private val dao = database.dao()

    /** The JSON of each task row that this process wrote. Empty after open. */
    private val written = HashMap<String, String>()
    private var fresh = true

    /** Writes an update of the engine. A full update or the first write replaces each table. */
    @Suppress("TooGenericExceptionCaught")
    suspend fun write(
        update: MergeUpdate,
        engine: MergeEngine,
    ) {
        try {
            database.withWriteTransaction {
                if (fresh || update.full) replaceAll(update, engine) else replaceChanged(update, engine)
            }
            fresh = false
        } catch (e: Throwable) {
            // Any failure (also an Error or a cancel) makes the next write full, then goes up.
            fresh = true
            written.clear()
            throw e
        }
    }

    /** Writes each table again from the update of `engine.rebuild()`. */
    suspend fun rebuild(
        update: MergeUpdate,
        engine: MergeEngine,
    ) {
        fresh = true
        write(update, engine)
    }

    private suspend fun replaceAll(
        update: MergeUpdate,
        engine: MergeEngine,
    ) {
        dao.clearTasks()
        dao.clearEvents()
        written.clear()
        writeTasks(update.view.tasks)
        dao.upsertEvents(engine.eventRows(null).map { it.row() })
        for (task in engine.taskIds()) dao.upsertEvents(engine.eventRows(task).map { it.row() })
        writeSmallTables(update, engine)
    }

    private suspend fun replaceChanged(
        update: MergeUpdate,
        engine: MergeEngine,
    ) {
        val ids =
            update.view.tasks
                .map { it.id }
                .toSet()
        val gone = written.keys.filter { it !in ids }
        if (gone.isNotEmpty()) {
            dao.deleteTasks(gone)
            gone.forEach { written.remove(it) }
        }
        writeTasks(update.view.tasks)
        for (task in update.changedTasks) {
            dao.deleteEventsOf(task)
            dao.upsertEvents(engine.eventRows(task).map { it.row() })
        }
        if (update.workspaceChanged) {
            dao.deleteWorkspaceEvents()
            dao.upsertEvents(engine.eventRows(null).map { it.row() })
        }
        writeSmallTables(update, engine)
    }

    private suspend fun writeTasks(tasks: List<TaskView>) {
        val rows =
            tasks.mapNotNull { task ->
                val json = AwJson.encodeToString(serializer<TaskView>(), task)
                if (written[task.id] == json) {
                    null
                } else {
                    written[task.id] = json
                    TaskRow(
                        id = task.id,
                        json = json,
                        key = task.key,
                        project = task.project,
                        stage = task.stage,
                        assignee = task.assignee,
                        owner = task.owner,
                        parent = task.parent,
                        archived = task.archived,
                        keyState = task.keyState,
                        needsYouLane = task.needsYouLane,
                        lastHlc = task.lastHlc,
                    )
                }
            }
        if (rows.isNotEmpty()) dao.upsertTasks(rows)
    }

    private suspend fun writeSmallTables(
        update: MergeUpdate,
        engine: MergeEngine,
    ) {
        dao.clearIssues()
        dao.upsertIssues(update.view.issues.map { it.row() })
        dao.clearDocuments()
        dao.upsertDocuments(
            engine.documents().map {
                DocumentRow(
                    it.path,
                    it.kind,
                    AwJson.encodeToString(JsonObject.serializer(), it.value),
                )
            },
        )
        dao.clearProjects()
        dao.upsertProjects(
            update.view.projects.map { ProjectRow(it.slug, AwJson.encodeToString(serializer<ProjectView>(), it)) },
        )
        dao.clearDevices()
        dao.upsertDevices(
            update.view.devices.map {
                DeviceRow(it.slug, it.role, it.priority, AwJson.encodeToString(serializer<DeviceView>(), it))
            },
        )
        dao.clearPresence()
        dao.upsertPresence(
            update.presence.devices.map {
                PresenceRow(it.device, it.online, AwJson.encodeToString(serializer<DevicePresence>(), it))
            },
        )
    }

    /** The tasks in the "Needs you" lane. */
    suspend fun needsYou(): List<TaskView> = dao.needsYou().map { it.view() }

    /** The tasks of a project in a stage. */
    suspend fun tasksByProjectAndStage(
        project: String,
        stage: String,
    ): List<TaskView> = dao.tasksByProjectAndStage(project, stage).map { it.view() }

    suspend fun task(id: String): TaskView? = dao.task(id)?.view()

    /** Each task, also the archived ones, by id (the screens of the phone filter them). */
    suspend fun tasks(): List<TaskView> = dao.allTasks().map { it.view() }

    /** The projects, by slug. */
    suspend fun projects(): List<ProjectView> =
        dao.allProjects().map { AwJson.decodeFromString(serializer<ProjectView>(), it.json) }

    /** The devices, from the highest priority to the lowest. */
    suspend fun devices(): List<DeviceView> =
        dao.allDevices().map { AwJson.decodeFromString(serializer<DeviceView>(), it.json) }

    /** The presence of each device, by slug. */
    suspend fun presence(): List<DevicePresence> =
        dao.allPresence().map { AwJson.decodeFromString(serializer<DevicePresence>(), it.json) }

    /** The issues of the view ("Sync problem"). */
    suspend fun issues(): List<MergeIssue> =
        dao.allIssues().map { AwJson.decodeFromString(serializer<MergeIssue>(), it.json) }

    /** One event by id, for example the `gate.opened` event of a gate (its text), or null. */
    suspend fun event(id: String): EventRow? = dao.event(id)?.eventRow()

    /**
     * The applied events of one type of the workspace logs in merge order, for example each
     * `credential.imported` (the phone removes the sealed file of an import).
     */
    suspend fun workspaceEvents(type: String): List<EventRow> = dao.workspaceEvents(type).map { it.eventRow() }

    /**
     * Each task key that a `task.created` or a `task.rekeyed` gave, also of a removed task: the index has no
     * row of a removed task, and no new task may get its key (openspec project-remove).
     */
    suspend fun knownKeys(): List<String> =
        dao.keyEvents().mapNotNull { row ->
            val data = row.eventRow().event["data"] as? JsonObject
            val field = if (row.type == "task.rekeyed") "to" else "key"
            (data?.get(field) as? JsonPrimitive)?.takeIf { it.isString }?.content
        }

    /** The last valid value of one document, for example `tasks/workspace.yaml`, or null. */
    suspend fun document(path: String): JsonObject? =
        dao.document(path)?.let { AwJson.decodeFromString(JsonObject.serializer(), it.json) }

    /** The thread of a task: its events in merge order after `after`, at most `limit`. */
    suspend fun thread(
        task: String,
        after: ThreadPlace = ThreadPlace.START,
        limit: Int = DEFAULT_PAGE,
    ): List<EventRow> {
        require(limit >= 0) { "limit must be 0 or more: $limit" }
        return dao.thread(task, after.hlc, after.dev, after.id, limit).map { it.eventRow() }
    }

    /**
     * The newest `limit` events of a task, in merge order (oldest first): the thread window of the
     * phone (gate-full-context, fix list 0-20).
     */
    suspend fun threadNewest(
        task: String,
        limit: Int,
    ): List<EventRow> {
        require(limit >= 0) { "limit must be 0 or more: $limit" }
        return dao.threadNewest(task, limit).map { it.eventRow() }.asReversed()
    }

    /** The events of one type of a task in merge order, for example each `artifact.added`. */
    suspend fun taskEvents(
        task: String,
        type: String,
    ): List<EventRow> = dao.taskEvents(task, type).map { it.eventRow() }

    /** The last valid value of each document, for `MergeEngine(lastValid = ...)` at a start. */
    suspend fun documents(): List<LastValidDocument> =
        dao.allDocuments().map {
            LastValidDocument(it.path, it.kind, AwJson.decodeFromString(JsonObject.serializer(), it.json))
        }

    /** Each row of each table, as text, for the tests that compare an incremental index with a rebuild. */
    suspend fun dump(): Map<String, List<String>> =
        mapOf(
            "tasks" to dao.allTasks().map { it.toString() },
            "events" to dao.allEvents().map { it.toString() },
            "issues" to dao.allIssues().map { it.toString() },
            "documents" to dao.allDocuments().map { it.toString() },
            "projects" to dao.allProjects().map { it.toString() },
            "devices" to dao.allDevices().map { it.toString() },
            "presence" to dao.allPresence().map { it.toString() },
        )

    fun close() = database.close()

    private fun TaskRow.view(): TaskView = AwJson.decodeFromString(serializer<TaskView>(), json)

    private fun EventRow.row() =
        EventRowEntity(
            id,
            task,
            hlc,
            dev,
            type,
            path,
            line,
            applied,
            reason,
            AwJson.encodeToString(JsonObject.serializer(), event),
        )

    private fun EventRowEntity.eventRow() =
        EventRow(
            id,
            task,
            hlc,
            dev,
            type,
            path,
            line,
            applied,
            reason,
            AwJson.decodeFromString(JsonObject.serializer(), json),
        )

    private fun MergeIssue.row() =
        IssueRow(
            pk = "$path:$line:$code:$event:$message",
            code = code,
            path = path,
            task = task,
            reason = reason,
            json = AwJson.encodeToString(serializer<MergeIssue>(), this),
        )

    companion object {
        const val DEFAULT_PAGE = 100
    }
}
