package com.agentworkspace.shared.index

import androidx.room3.ColumnInfo
import androidx.room3.ConstructedBy
import androidx.room3.Dao
import androidx.room3.Database
import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.PrimaryKey
import androidx.room3.Query
import androidx.room3.RoomDatabase
import androidx.room3.RoomDatabaseConstructor
import androidx.room3.Upsert

// The local index of the phone (docs/phase-1.md 3.5): a Room 3 database, never synced, rebuilt from
// the files at any time. Each table keeps the JSON of the merged view row and the query columns.

/** The version of the table layout. A new version rebuilds the index. */
const val INDEX_VERSION = 1

@Entity(
    tableName = "tasks",
    indices = [Index("project", "stage"), Index("needs_you_lane")],
)
data class TaskRow(
    @PrimaryKey val id: String,
    val json: String,
    val key: String?,
    val project: String?,
    val stage: String,
    val assignee: String?,
    val owner: String?,
    val parent: String?,
    val archived: Boolean,
    @ColumnInfo(name = "key_state") val keyState: String,
    @ColumnInfo(name = "needs_you_lane") val needsYouLane: Boolean,
    @ColumnInfo(name = "last_hlc") val lastHlc: String?,
)

@Entity(tableName = "events", indices = [Index("task", "hlc", "dev", "id")])
data class EventRowEntity(
    @PrimaryKey val id: String,
    val task: String?,
    val hlc: String,
    val dev: String,
    val type: String,
    val path: String,
    val line: Int,
    val applied: Boolean,
    val reason: String?,
    val json: String,
)

@Entity(tableName = "issues")
data class IssueRow(
    @PrimaryKey val pk: String,
    val code: String,
    val path: String,
    val task: String?,
    val reason: String?,
    val json: String,
)

@Entity(tableName = "documents")
data class DocumentRow(
    @PrimaryKey val path: String,
    val kind: String,
    val json: String,
)

@Entity(tableName = "projects")
data class ProjectRow(
    @PrimaryKey val slug: String,
    val json: String,
)

@Entity(tableName = "devices")
data class DeviceRow(
    @PrimaryKey val slug: String,
    val role: String?,
    val priority: Int,
    val json: String,
)

@Entity(tableName = "presence")
data class PresenceRow(
    @PrimaryKey val device: String,
    val online: Boolean,
    val json: String,
)

@Dao
@Suppress("TooManyFunctions")
interface IndexDao {
    /** The tasks in the "Needs you" lane, by id. */
    @Query("SELECT * FROM tasks WHERE needs_you_lane = 1 ORDER BY id")
    suspend fun needsYou(): List<TaskRow>

    /** The tasks of a project in a stage, by key then id. */
    @Query("SELECT * FROM tasks WHERE project = :project AND stage = :stage ORDER BY key, id")
    suspend fun tasksByProjectAndStage(
        project: String,
        stage: String,
    ): List<TaskRow>

    @Query("SELECT * FROM tasks WHERE id = :id")
    suspend fun task(id: String): TaskRow?

    /** The events of a task in merge order (HLC, device, id) after a place, at most `limit`. */
    @Query(
        "SELECT * FROM events WHERE task = :task AND " +
            "(hlc > :hlc OR (hlc = :hlc AND (dev > :dev OR (dev = :dev AND id > :id)))) " +
            "ORDER BY hlc, dev, id LIMIT :limit",
    )
    suspend fun thread(
        task: String,
        hlc: String,
        dev: String,
        id: String,
        limit: Int,
    ): List<EventRowEntity>

    /** The newest events of a task, newest first (gate-full-context, fix list 0-20). */
    @Query("SELECT * FROM events WHERE task = :task ORDER BY hlc DESC, dev DESC, id DESC LIMIT :limit")
    suspend fun threadNewest(
        task: String,
        limit: Int,
    ): List<EventRowEntity>

    /** The events of one type of a task, in merge order (gate-full-context: the artifacts). */
    @Query("SELECT * FROM events WHERE task = :task AND type = :type ORDER BY hlc, dev, id")
    suspend fun taskEvents(
        task: String,
        type: String,
    ): List<EventRowEntity>

    @Query("SELECT * FROM events WHERE id = :id")
    suspend fun event(id: String): EventRowEntity?

    /** The applied events of one type of the workspace logs, in merge order. */
    @Query("SELECT * FROM events WHERE task IS NULL AND type = :type AND applied = 1 ORDER BY hlc, dev, id")
    suspend fun workspaceEvents(type: String): List<EventRowEntity>

    /** The applied key events of each task, also of a removed task (openspec project-remove). */
    @Query(
        "SELECT * FROM events WHERE task IS NOT NULL AND type IN ('task.created', 'task.rekeyed') " +
            "AND applied = 1 ORDER BY id",
    )
    suspend fun keyEvents(): List<EventRowEntity>

    @Query("SELECT * FROM tasks ORDER BY id")
    suspend fun allTasks(): List<TaskRow>

    @Query("SELECT * FROM events ORDER BY id")
    suspend fun allEvents(): List<EventRowEntity>

    @Query("SELECT * FROM issues ORDER BY pk")
    suspend fun allIssues(): List<IssueRow>

    @Query("SELECT * FROM documents ORDER BY path")
    suspend fun allDocuments(): List<DocumentRow>

    @Query("SELECT * FROM documents WHERE path = :path")
    suspend fun document(path: String): DocumentRow?

    @Query("SELECT * FROM projects ORDER BY slug")
    suspend fun allProjects(): List<ProjectRow>

    @Query("SELECT * FROM devices ORDER BY priority")
    suspend fun allDevices(): List<DeviceRow>

    @Query("SELECT * FROM presence ORDER BY device")
    suspend fun allPresence(): List<PresenceRow>

    @Upsert
    suspend fun upsertTasks(rows: List<TaskRow>)

    @Query("DELETE FROM tasks WHERE id IN (:ids)")
    suspend fun deleteTasks(ids: List<String>)

    @Upsert
    suspend fun upsertEvents(rows: List<EventRowEntity>)

    @Query("DELETE FROM events WHERE task = :task")
    suspend fun deleteEventsOf(task: String)

    @Query("DELETE FROM events WHERE task IS NULL")
    suspend fun deleteWorkspaceEvents()

    @Upsert
    suspend fun upsertIssues(rows: List<IssueRow>)

    @Upsert
    suspend fun upsertDocuments(rows: List<DocumentRow>)

    @Upsert
    suspend fun upsertProjects(rows: List<ProjectRow>)

    @Upsert
    suspend fun upsertDevices(rows: List<DeviceRow>)

    @Upsert
    suspend fun upsertPresence(rows: List<PresenceRow>)

    @Query("DELETE FROM tasks")
    suspend fun clearTasks()

    @Query("DELETE FROM events")
    suspend fun clearEvents()

    @Query("DELETE FROM issues")
    suspend fun clearIssues()

    @Query("DELETE FROM documents")
    suspend fun clearDocuments()

    @Query("DELETE FROM projects")
    suspend fun clearProjects()

    @Query("DELETE FROM devices")
    suspend fun clearDevices()

    @Query("DELETE FROM presence")
    suspend fun clearPresence()
}

@Database(
    entities = [
        TaskRow::class,
        EventRowEntity::class,
        IssueRow::class,
        DocumentRow::class,
        ProjectRow::class,
        DeviceRow::class,
        PresenceRow::class,
    ],
    version = INDEX_VERSION,
    exportSchema = false,
)
@ConstructedBy(WorkspaceIndexDatabaseConstructor::class)
abstract class WorkspaceIndexDatabase : RoomDatabase() {
    abstract fun dao(): IndexDao
}

/** Room generates the actual object of each target (KSP). */
@Suppress("KotlinNoActualForExpect")
expect object WorkspaceIndexDatabaseConstructor : RoomDatabaseConstructor<WorkspaceIndexDatabase> {
    override fun initialize(): WorkspaceIndexDatabase
}
