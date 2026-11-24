package com.agentworkspace.control

import co.touchlab.kermit.Logger
import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.files.WorkspaceWriter
import com.agentworkspace.shared.index.WorkspaceIndex
import com.agentworkspace.shared.merge.EventRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Removes the sealed credential files of the phone that a computer imported (docs/phase-1.md 10.2,
 * openspec credential-redaction): after an applied `credential.imported {from: <this phone>, sealed:
 * <id>}` of a computer, `tasks/devices/<phone>/sealed/<id>.age` goes. One import is enough: the
 * computer writes `secure/credentials/<name>.age` for all computers. The delete syncs to each
 * computer, so the sealed value is not kept on any device.
 */
class SealedOutboxCleanup(
    private val index: WorkspaceIndex,
    private val files: WorkspaceFiles,
    private val writer: WorkspaceWriter,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val log: Logger = Logger.withTag("aw-credentials"),
) {
    private val lock = Mutex()

    /**
     * Runs [run] after each snapshot, then [afterWrite] (the targeted scan) for each removed path. An
     * error is logged, and the next snapshot tries again: it never stops the collector.
     */
    @Suppress("TooGenericExceptionCaught")
    suspend fun follow(
        snapshots: Flow<WorkspaceSnapshot>,
        afterWrite: suspend (String) -> Unit,
    ) {
        snapshots.collect { snapshot ->
            try {
                run(snapshot).forEach { afterWrite(it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.w(
                    e,
                ) {
                    "The imported sealed files of ${snapshot.workspace} were not removed; the next refresh tries again"
                }
            }
        }
    }

    /** Removes each imported sealed file of [snapshot]'s phone that is on disk. Returns the removed paths. */
    suspend fun run(snapshot: WorkspaceSnapshot): List<String> =
        lock.withLock {
            val computers = computers(snapshot.records)
            val paths =
                index
                    .workspaceEvents(IMPORTED)
                    .mapNotNull { pathOf(it, snapshot.phone, computers) }
                    .distinct()
            withContext(io) {
                paths.filter { files.exists(it) }.onEach { writer.delete(it) }
            }
        }

    companion object {
        const val IMPORTED = "credential.imported"

        /** A sealed id: one name with no `/` (the `sealed` pattern of the event schema). */
        private val ID = Regex("^[a-z0-9]+(?:[-_.][a-z0-9]+)*$")

        /** The path of the outbox file of [phone] with the sealed id [id]. */
        fun sealedPath(
            phone: String,
            id: String,
        ): String = "tasks/devices/$phone/sealed/$id.age"

        /** The slugs of the device records of a computer that is not revoked. */
        fun computers(records: Map<String, JsonObject>): Set<String> =
            records
                .filter { (_, record) ->
                    val role = (record["role"] as? JsonPrimitive)?.contentOrNull
                    val revoked = (record["revoked"] as? JsonPrimitive)?.booleanOrNull ?: false
                    role != null && role != "mobile" && !revoked
                }.keys

        /** The outbox path that an import names, or null when the import does not count for [phone]. */
        fun pathOf(
            row: EventRow,
            phone: String,
            computers: Set<String>,
        ): String? {
            if (row.type != IMPORTED || !row.applied || row.dev !in computers) return null
            val data = row.event["data"] as? JsonObject ?: return null
            val from = (data["from"] as? JsonPrimitive)?.contentOrNull
            val sealed = (data["sealed"] as? JsonPrimitive)?.contentOrNull
            if (from != phone || sealed == null || !ID.matches(sealed)) return null
            return sealedPath(phone, sealed)
        }
    }
}
