package com.agentworkspace.shared.merge

import com.agentworkspace.schema.BindingsV1
import com.agentworkspace.schema.DeviceHeartbeatV1
import com.agentworkspace.schema.DeviceV1
import com.agentworkspace.schema.HealthV1
import com.agentworkspace.schema.ProjectV1
import com.agentworkspace.schema.TaskCreatedV1
import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.model.AwJson
import com.agentworkspace.shared.model.DocumentException
import com.agentworkspace.shared.model.DocumentReader
import com.agentworkspace.shared.model.Hlc
import com.agentworkspace.shared.model.LogKind
import com.agentworkspace.shared.model.SourcePath
import com.agentworkspace.shared.model.TimeSource
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.roundToLong

/** The default bound for a remote HLC: 24 h ahead of the local clock (docs/phase-1.md 3.6.3). */
const val DEFAULT_MAX_SKEW_MS = 24 * 60 * 60 * 1000L

/** The last valid value of a document, for example from `WorkspaceIndex.documents()`. */
data class LastValidDocument(
    val path: String,
    val kind: String,
    val value: JsonObject,
)

/** A log that changed in a way that an append cannot: the update reads all files again. */
data class MergeNotice(
    /** `truncated`, `replaced` or `removed`. */
    val code: String,
    val path: String,
)

data class MergeUpdate(
    val view: WorkspaceView,
    val presence: PresenceView,
    /** True when the engine read all files again. */
    val full: Boolean,
    val notices: List<MergeNotice>,
    /** The tasks that the update folded. */
    val changedTasks: List<String>,
    val workspaceChanged: Boolean,
    val documentsChanged: Boolean,
)

/** One event row for the index: the event, its place and the merge decision. */
data class EventRow(
    val id: String,
    val task: String?,
    val hlc: String,
    val dev: String,
    val type: String,
    val path: String,
    val line: Int,
    val applied: Boolean,
    val reason: String?,
    val event: JsonObject,
)

private class DocumentEntry(
    val path: String,
    val kind: String,
    /** The text of the last read, or null when the file was not read yet (a kept value only). */
    val text: String?,
    /** The last valid value. */
    val value: JsonObject?,
    val issue: MergeIssue?,
) {
    private var typedValue: Any? = null

    /** The value as its generated class. */
    fun <T> typed(serializer: KSerializer<T>): T {
        @Suppress("UNCHECKED_CAST")
        val cached = typedValue as T?
        return cached ?: AwJson.decodeFromJsonElement(serializer, checkNotNull(value)).also { typedValue = it }
    }
}

private class HeartbeatAggregate(
    val device: String,
    var count: Int,
    var last: LogLine?,
)

private enum class Admit { ADDED, REPLACED, REJECTED }

/**
 * The merge engine (`engine.ts` of shared/core/src/merge): it reads the sources, holds far-future
 * events back, folds each task and the workspace log, and assembles the view. The calls of `update()`
 * and `rebuild()` run one at a time. An update is all or nothing: when a read fails, the engine
 * forgets each read and the next update reads all files again.
 */
@Suppress("TooManyFunctions", "LargeClass")
class MergeEngine(
    private val files: WorkspaceFiles,
    private val clock: TimeSource,
    private val maxSkewMs: Long = DEFAULT_MAX_SKEW_MS,
    /** Changes the read order of the log files. Tests use it to show that the order does not matter. */
    private val readOrder: (List<String>) -> List<String> = { it },
    lastValid: List<LastValidDocument> = emptyList(),
    /**
     * The device record check (`verifyDeviceRecord` of the TypeScript engine): true when a raw record
     * (the parsed YAML value) has a valid signature of the master key. Null when the master public key
     * is not known: the records are then not checked.
     */
    private val verifyDeviceRecord: ((JsonElement) -> Boolean)? = null,
) {
    private val mutex = Mutex()
    private val sources = LinkedHashMap<String, LogSource>()
    private val documents = LinkedHashMap<String, DocumentEntry>()

    /** The line of each merged event id (the winner of a duplicate id). */
    private val byId = HashMap<String, LogLine>()
    private val duplicates = mutableListOf<LogLine>()

    /** Held far-future lines, by `<path>:<line>`. */
    private val held = LinkedHashMap<String, LogLine>()
    private val taskLines = LinkedHashMap<String, MutableList<LogLine>>()
    private val workspaceLines = mutableListOf<LogLine>()
    private val heartbeats = LinkedHashMap<String, HeartbeatAggregate>()
    private val heartbeatIds = HashMap<String, LogLine>()
    private val folds = HashMap<String, TaskFold>()
    private val pendingRefold = HashSet<String>()
    private var workspaceLost = false
    private var workspace = WorkspaceFold.EMPTY
    private val receipts = HashMap<String, Receipt>()
    private var lastHlc: String? = null
    private var mustReadAll = true

    /** The last view, or null before the first update. A failed update keeps the last view. */
    var view: WorkspaceView? = null
        private set
    var presence: PresenceView? = null
        private set

    init {
        for (doc in lastValid) documents[doc.path] = DocumentEntry(doc.path, doc.kind, null, doc.value, null)
    }

    /** The highest merged HLC, for `HybridLogicalClock.observe()`. */
    fun lastHlc(): String? = lastHlc

    /** The owner device of a task. */
    fun taskOwner(task: String): String? = folds[task]?.owner

    /** The ids of the tasks that have events. */
    fun taskIds(): List<String> = taskLines.keys.sorted()

    /** The events of a task (or of the workspace log when `task` is null), in merge order. */
    fun eventRows(task: String?): List<EventRow> {
        val lines = if (task == null) workspaceLines else taskLines[task].orEmpty()
        val decisions = if (task == null) workspace.decisions else folds[task]?.decisions.orEmpty()
        return lines.sortedWith(byOrder).map { line ->
            val decision = decisions[line.event.id]
            EventRow(
                id = line.event.id,
                task = task,
                hlc = line.event.hlc,
                dev = line.event.dev,
                type = line.event.type,
                path = line.path,
                line = line.line,
                applied = decision?.applied ?: false,
                reason = decision?.reason,
                event = line.event.json,
            )
        }
    }

    /** Each document entry with a valid value: the path, the kind and the last valid value. */
    fun documents(): List<LastValidDocument> =
        documents.values.mapNotNull { doc -> doc.value?.let { LastValidDocument(doc.path, doc.kind, it) } }

    private fun clearEvents() {
        sources.clear()
        byId.clear()
        duplicates.clear()
        held.clear()
        taskLines.clear()
        workspaceLines.clear()
        heartbeats.clear()
        heartbeatIds.clear()
        folds.clear()
        pendingRefold.clear()
        workspaceLost = false
        lastHlc = null
    }

    /** Forgets each read event and the text of each document. Each document keeps its last valid value. */
    private fun forgetReads() {
        clearEvents()
        val kept = LinkedHashMap<String, DocumentEntry>()
        for (doc in documents.values) {
            if (doc.value != null) kept[doc.path] = DocumentEntry(doc.path, doc.kind, null, doc.value, null)
        }
        documents.clear()
        documents.putAll(kept)
        mustReadAll = true
    }

    /** Reads all files again from the start. The presence receipts start again too. */
    suspend fun rebuild(): MergeUpdate =
        mutex.withLock {
            forgetReads()
            receipts.clear()
            updateOnce()
        }

    /** Reads the new data of each file and updates the view. */
    suspend fun update(): MergeUpdate = mutex.withLock { updateOnce() }

    @Suppress("TooGenericExceptionCaught")
    private fun updateOnce(): MergeUpdate =
        try {
            read().also { mustReadAll = false }
        } catch (e: Throwable) {
            // Also an Error (for example out of memory): the offsets of the read logs moved, so the
            // next update must read each file again, or it loses the lines of this one.
            forgetReads()
            throw e
        }

    private fun read(): MergeUpdate {
        val now = clock.now()
        var full = mustReadAll
        val notices = mutableListOf<MergeNotice>()
        val found = findSources(files)

        val changedKinds = readDocuments(found.documents)
        val paths = readOrder(found.logs.map { it.path })
        val logs = found.logs.associateBy { it.path }
        for (path in sources.keys) if (path !in logs) notices.add(MergeNotice("removed", path))
        val lines = readLogs(paths, logs, notices)
        if (notices.isNotEmpty() && !full) {
            // A log changed in a way that an append cannot: read each file again from the start.
            full = true
            clearEvents()
            lines.clear()
            lines.addAll(readLogs(paths, logs, mutableListOf()))
        }
        lines.addAll(releaseHeld(now))

        val appended = LinkedHashMap<String, MutableList<LogLine>>()
        val refold = HashSet<String>()
        // Only the bindings change the fold of the workspace log, and only the projects the folds of the tasks.
        val workspaceAdmitted = admitLines(lines, now, appended, refold)
        // A device record (a revoke) changes the folds of the tasks and of the workspace log.
        val devicesChanged = "device" in changedKinds
        val workspaceChanged =
            full || "bindings" in changedKinds || devicesChanged || workspaceAdmitted || workspaceLost
        workspaceLost = false

        val changedTasks = foldTasks(appended, refold, full || "project" in changedKinds || devicesChanged)
        if (workspaceChanged) {
            val bindings = documentsOf("bindings", BindingsV1.serializer())
            workspace =
                foldWorkspace(
                    workspaceLines.sortedWith(byOrder),
                    revokedAt(),
                ) { device -> bindings.find { it.device == device }?.resources }
        }

        lastHlc = highestHlc()
        val view = assemble(now)
        updateReceipts(receipts, lastHeartbeats(), now)
        val presence = presenceOf(view.devices, view.tasks, receipts, now, revokedAt())
        this.view = view
        this.presence = presence
        return MergeUpdate(
            view = view,
            presence = presence,
            full = full,
            notices = notices,
            changedTasks = changedTasks.sorted(),
            workspaceChanged = workspaceChanged,
            documentsChanged = changedKinds.isNotEmpty(),
        )
    }

    /** Takes the held lines that are no longer more than the bound ahead of the local clock. */
    private fun releaseHeld(now: Long): List<LogLine> {
        val released = held.values.filter { !isFuture(it, now) }
        released.forEach { held.remove("${it.path}:${it.line}") }
        return released
    }

    /**
     * Holds the far-future lines and admits the others to their scope. Fills the appended lines and the
     * tasks to fold again; returns true when a line of the workspace log was added or replaced.
     */
    private fun admitLines(
        lines: List<LogLine>,
        now: Long,
        appended: MutableMap<String, MutableList<LogLine>>,
        refold: MutableSet<String>,
    ): Boolean {
        var workspaceChanged = false
        for (line in lines) {
            val source = sources.getValue(line.path)
            val task = if (source.source.scope.kind == LogKind.TASK) source.task else null
            when {
                isFuture(line, now) -> {
                    held["${line.path}:${line.line}"] = line
                }

                source.source.scope.kind == LogKind.HEARTBEAT -> {
                    admitHeartbeat(line, source.device)
                }

                else -> {
                    val result = admit(line, task)
                    when {
                        result == Admit.REJECTED -> Unit
                        task == null -> workspaceChanged = true
                        result == Admit.REPLACED -> refold.add(task)
                        else -> appended.getOrPut(task) { mutableListOf() }.add(line)
                    }
                }
            }
        }
        return workspaceChanged
    }

    /** The HLC of the last heartbeat of each device. */
    private fun lastHeartbeats(): Map<String, String> {
        val last = HashMap<String, String>()
        for (aggregate in heartbeats.values) {
            val hlc = aggregate.last?.event?.hlc
            val old = last[aggregate.device]
            if (hlc != null && (old == null || hlc > old)) last[aggregate.device] = hlc
        }
        return last
    }

    private fun isFuture(
        line: LogLine,
        now: Long,
    ): Boolean = Hlc.millis(line.event.hlc) - now > maxSkewMs

    private fun readLogs(
        paths: List<String>,
        logs: Map<String, SourcePath.Log>,
        notices: MutableList<MergeNotice>,
    ): MutableList<LogLine> {
        sources.keys.retainAll(logs.keys)
        val lines = mutableListOf<LogLine>()
        for (path in paths) {
            val source = sources.getOrPut(path) { LogSource(logs.getValue(path)) }
            val result = source.read(files)
            if (result.reset != null) notices.add(MergeNotice(result.reset, path))
            lines.addAll(result.lines)
        }
        return lines
    }

    /** Reads each document whose text changed. Returns the kinds of the changed documents. */
    @Suppress("TooGenericExceptionCaught")
    private fun readDocuments(found: List<SourcePath.Document>): Set<String> {
        val changed = HashSet<String>()
        val present = found.map { it.path }.toSet()
        val gone = documents.values.filter { it.path !in present }
        for (doc in gone) {
            if (isStickyRevoke(doc)) {
                // A revoke stays when its file is removed (a revoked device must not undo it).
                if (doc.issue?.reason != "revoke_removed") {
                    // No text: the file that comes back is read and checked again.
                    val issue =
                        MergeIssue(
                            "bad_document",
                            doc.path,
                            null,
                            null,
                            null,
                            "revoke_removed",
                            "the revoke record was removed; the revoke stays",
                        )
                    documents[doc.path] = DocumentEntry(doc.path, doc.kind, null, doc.value, issue)
                    changed.add(doc.kind)
                }
                continue
            }
            documents.remove(doc.path)
            changed.add(doc.kind)
        }
        for (doc in found) {
            val old = documents[doc.path]
            val text =
                try {
                    files.readText(doc.path)
                } catch (e: Exception) {
                    // One document that cannot be read does not stop the merge: it keeps its last value.
                    // No text: the next read checks the file again.
                    val issue =
                        MergeIssue(
                            "read_error",
                            doc.path,
                            null,
                            null,
                            null,
                            null,
                            "The document cannot be read: ${e.message}",
                        )
                    documents[doc.path] = DocumentEntry(doc.path, doc.kind, null, old?.value, issue)
                    continue
                }
            if (text != null && old?.text != text) {
                changed.add(doc.kind)
                documents[doc.path] = readDocument(doc, text, old)
            }
        }
        return changed
    }

    /** A document that fails its schema keeps its last valid value. */
    @Suppress("TooGenericExceptionCaught")
    private fun readDocument(
        doc: SourcePath.Document,
        text: String,
        old: DocumentEntry?,
    ): DocumentEntry =
        try {
            val parsed = DocumentReader.parse(text, doc.kind)
            doc.identity?.let { identity ->
                val value = parsed.value[identity.field]
                if ((value as? JsonPrimitive)?.takeIf { it.isString }?.content != identity.value) {
                    throw DocumentException(
                        "schema_error",
                        "${identity.field} is ${value ?: "undefined"}, not ${identity.value} (the name of the folder)",
                    )
                }
            }
            if (doc.kind == "device" && verifyDeviceRecord != null) checkRecord(text, parsed.value, old?.value)
            DocumentEntry(doc.path, doc.kind, text, parsed.value, null)
        } catch (e: DocumentException) {
            val issue = MergeIssue("bad_document", doc.path, e.line, null, null, e.code, e.message.orEmpty())
            DocumentEntry(doc.path, doc.kind, text, old?.value, issue)
        } catch (e: Exception) {
            // Any other error of the YAML library or the decode: a bad document, as in TypeScript. One
            // document that a person edits must not stop the merge.
            val issue = MergeIssue("bad_document", doc.path, null, null, null, "schema_error", e.message.orEmpty())
            DocumentEntry(doc.path, doc.kind, text, old?.value, issue)
        }

    /** True for a kept revoke record when the device records are checked (it never goes away). */
    private fun isStickyRevoke(doc: DocumentEntry): Boolean {
        if (doc.kind != "device" || verifyDeviceRecord == null) return false
        return (doc.value?.get("revoked") as? JsonPrimitive)?.content == "true"
    }

    /** Throws DocumentException for a record that the check refuses or that has an older `seq`. */
    @Suppress("ThrowsCount")
    private fun checkRecord(
        text: String,
        record: JsonObject,
        kept: JsonObject?,
    ) {
        val verify = checkNotNull(verifyDeviceRecord)
        if (!verify(DocumentReader.parseYaml(text))) {
            throw DocumentException(
                "bad_signature",
                "the record has no valid signature of the master key; the last valid record stays",
            )
        }
        if (kept == null) return
        val keptRecord = AwJson.decodeFromJsonElement(DeviceV1.serializer(), kept)
        val next = AwJson.decodeFromJsonElement(DeviceV1.serializer(), record)
        if (keptRecord.revoked && !next.revoked) {
            // A revoke is final: a valid record never makes a revoked device valid again.
            throw DocumentException(
                "old_sequence",
                "the device was revoked at seq ${keptRecord.seq}; a record without the revoke does not count",
            )
        }
        if (keptRecord.seq > next.seq) {
            throw DocumentException(
                "old_sequence",
                "the record has seq ${next.seq}, lower than the kept seq ${keptRecord.seq}",
            )
        }
    }

    private fun entriesOf(kind: String): List<DocumentEntry> =
        documents.values.filter { it.kind == kind && it.value != null }.sortedBy { it.path }

    private fun <T> documentsOf(
        kind: String,
        serializer: KSerializer<T>,
    ): List<T> = entriesOf(kind).map { it.typed(serializer) }

    /** Adds a heartbeat line to its file. A second line with the same id is a duplicate. */
    private fun admitHeartbeat(
        line: LogLine,
        device: String,
    ) {
        val existing = heartbeatIds[line.event.id]
        if (existing != null) {
            if (isSameLine(line, existing)) return
            if (comparePlace(line, existing) > 0) {
                duplicates.add(line)
                return
            }
            duplicates.add(existing)
            removeHeartbeat(existing)
        }
        heartbeatIds[line.event.id] = line
        val aggregate = heartbeats.getOrPut(line.path) { HeartbeatAggregate(device, 0, null) }
        aggregate.count++
        if (aggregate.last.let { it == null || byOrder.compare(it, line) < 0 }) aggregate.last = line
    }

    /** Removes a heartbeat line that lost a duplicate id from the aggregate of its file. */
    private fun removeHeartbeat(line: LogLine) {
        val aggregate = heartbeats[line.path] ?: return
        aggregate.count--
        if (aggregate.last !== line) return
        aggregate.last = null
        for (other in heartbeatIds.values) {
            if (other === line || other.path != line.path) continue
            if (aggregate.last.let { it == null || byOrder.compare(it, other) < 0 }) aggregate.last = other
        }
    }

    /** The highest HLC of the merged lines (the winners of duplicate ids) and of the heartbeats. */
    private fun highestHlc(): String? {
        // Only the winners of duplicate ids and the heartbeats after the read: the order does not matter.
        val all = byId.values.map { it.event.hlc } + heartbeats.values.mapNotNull { it.last?.event?.hlc }
        return all.maxOrNull()
    }

    /** Adds a line to its scope. A second line with the same id is a duplicate: the smaller place wins. */
    private fun admit(
        line: LogLine,
        task: String?,
    ): Admit {
        val existing = byId[line.event.id]
        if (existing == null) {
            byId[line.event.id] = line
            scopeList(task).add(line)
            return Admit.ADDED
        }
        // The same line again is no duplicate. The serial calls prevent it; this is a second guard.
        if (isSameLine(line, existing)) return Admit.REJECTED
        if (comparePlace(line, existing) > 0) {
            duplicates.add(line)
            return Admit.REJECTED
        }
        // The new line wins: remove the old one from its scope.
        val oldTask = scopeTask(existing)
        scopeList(oldTask).remove(existing)
        duplicates.add(existing)
        byId[line.event.id] = line
        scopeList(task).add(line)
        if (oldTask == null) {
            workspaceLost = true
        } else if (oldTask != task) {
            pendingRefold.add(oldTask)
        }
        return Admit.REPLACED
    }

    private fun isSameLine(
        a: LogLine,
        b: LogLine,
    ): Boolean = a.path == b.path && a.line == b.line

    private fun scopeTask(line: LogLine): String? =
        sources[line.path]
            ?.takeIf {
                it.source.scope.kind == LogKind.TASK
            }?.task

    private fun scopeList(task: String?): MutableList<LogLine> =
        if (task ==
            null
        ) {
            workspaceLines
        } else {
            taskLines.getOrPut(task) { mutableListOf() }
        }

    /** The parent of a task from its fold, or from its first `task.created` line. */
    private fun parentOf(task: String): String? {
        val fold = folds[task]
        if (fold?.created != null) return fold.parent
        val created = taskLines[task].orEmpty().filter { it.event.data is TaskCreatedV1 }.minWithOrNull(byOrder)
        return (created?.event?.data as TaskCreatedV1?)?.parent
    }

    /**
     * Folds the tasks that changed. A task continues its saved fold when each new event sorts after its
     * last event; else it folds again. The descendants of a changed task fold again.
     */
    private fun foldTasks(
        appended: Map<String, List<LogLine>>,
        refold: MutableSet<String>,
        everything: Boolean,
    ): Set<String> {
        refold.addAll(pendingRefold)
        pendingRefold.clear()
        val all = taskLines.keys.toList()
        val changed = LinkedHashSet<String>(if (everything) all else appended.keys + refold)
        val full = HashSet<String>(if (everything) all else refold)

        val children = HashMap<String, MutableList<String>>()
        val parents = HashMap<String, String?>()
        for (task in all) {
            val parent = parentOf(task)
            parents[task] = parent
            if (parent != null) children.getOrPut(parent) { mutableListOf() }.add(task)
        }
        val queue = ArrayDeque(changed)
        while (queue.isNotEmpty()) {
            for (child in children[queue.removeFirst()].orEmpty()) {
                if (full.add(child)) {
                    changed.add(child)
                    queue.addLast(child)
                }
            }
        }

        fun depth(task: String): Int {
            var count = 0
            var current = parents[task]
            while (current != null && count < all.size) {
                count++
                current = parents[current]
            }
            return count
        }
        val ordered = changed.sortedWith(compareBy<String> { depth(it) }.thenBy { it })

        foldEach(ordered, appended, full)
        return changed
    }

    /** The `revoked_at` HLC of each revoked device of the kept device records. */
    private fun revokedAt(): (String) -> String? {
        val revoked =
            documentsOf("device", DeviceV1.serializer())
                .filter { it.revoked }
                .mapNotNull { record -> record.revokedAt?.let { record.slug to it } }
                .toMap()
        return { device -> revoked[device] }
    }

    /** Folds each task in order: it continues a saved fold when it can, else it folds the task again. */
    private fun foldEach(
        ordered: List<String>,
        appended: Map<String, List<LogLine>>,
        full: Set<String>,
    ) {
        val revoked = revokedAt()
        val context =
            object : TaskContext {
                override fun project(slug: String): ProjectV1? =
                    documentsOf("project", ProjectV1.serializer()).find {
                        it.slug ==
                            slug
                    }

                override fun ownerAt(
                    task: String,
                    key: OrderKey,
                ): String? = folds[task]?.ownerAt(key)

                override fun revokedAt(device: String): String? = revoked(device)
            }
        for (task in ordered) {
            val fold = folds[task]
            val added = appended[task].orEmpty().sortedWith(byOrder)
            val canContinue = fold != null && task !in full && added.isNotEmpty()
            if (canContinue && fold.canAppend(added.first())) {
                added.forEach { fold.apply(it, context) }
            } else {
                val next = TaskFold(task)
                taskLines[task].orEmpty().sortedWith(byOrder).forEach { next.apply(it, context) }
                folds[task] = next
            }
        }
    }

    private fun assemble(now: Long): WorkspaceView {
        val workspaceDoc = entriesOf("workspace").firstOrNull()?.value
        val records = documentsOf("device", DeviceV1.serializer())
        val bindings = documentsOf("bindings", BindingsV1.serializer())
        val health = documentsOf("health", HealthV1.serializer())

        val slugs = LinkedHashSet<String>()
        records.forEach { slugs.add(it.slug) }
        bindings.forEach { slugs.add(it.device) }
        health.forEach { slugs.add(it.device) }
        sources.values.forEach { slugs.add(it.device) }
        val order =
            (workspaceDoc?.get("device_order") as? JsonArray)?.map { (it as JsonPrimitive).content }.orEmpty()
        val rank = priorityRank(slugs, PriorityInput(records.associate { it.slug to it.role }, order))

        val (live, tasks, removedTasks) = splitRemoved(assembleTasks(rank))
        val projectViews =
            live.map { value ->
                val slug = (value["slug"] as JsonPrimitive).content
                ProjectView(value, tasks.filter { it.project == slug }.map { it.id })
            }
        val devices =
            slugs
                .map { slug ->
                    val record = records.find { it.slug == slug }
                    val binding = bindings.find { it.device == slug }
                    DeviceView(
                        slug = slug,
                        name = record?.name,
                        role = record?.role,
                        revoked = record?.revoked ?: false,
                        priority = rank(slug),
                        mayRun = binding?.mayRun,
                        resources = binding?.resources.orEmpty(),
                        health =
                            health.find { it.device == slug }?.let {
                                DeviceHealthView(
                                    it.updated,
                                    it.bootTime,
                                    it.disk.usedPercentage,
                                )
                            },
                        heartbeat = heartbeatOf(slug),
                    )
                }.sortedBy { it.priority }

        return WorkspaceView(
            workspace = workspaceDoc,
            credentials = workspace.credentials,
            projects = projectViews,
            tasks = tasks,
            removedProjects = workspace.removals,
            removedTasks = removedTasks,
            devices = devices,
            queues = workspace.queues,
            slots = workspace.slots,
            sources = workspace.sources,
            cards = workspace.cards,
            issues = issues(now),
            lastHlc = lastHlc,
        )
    }

    /**
     * The live project documents, the tasks of the view and the removed tasks (openspec project-remove), as
     * `#assemble` of `engine.ts`.
     */
    private fun splitRemoved(all: List<TaskView>): Triple<List<JsonObject>, List<TaskView>, List<TaskView>> {
        val removals = HashMap<String, RemovedProjectView>()
        workspace.removals.forEach { removals[it.slug] = it }
        val live =
            entriesOf("project").mapNotNull { entry ->
                entry.value?.takeIf { value ->
                    val slug = (value["slug"] as JsonPrimitive).content
                    val addedAt = (value["added_at"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                    isLiveProject(addedAt, removals[slug])
                }
            }
        val liveSlugs = live.map { (it["slug"] as JsonPrimitive).content }.toSet()
        val removed: (TaskView) -> Boolean = removed@{ task ->
            val project = task.project ?: return@removed false
            val created = task.created ?: return@removed false
            val removal = removals[project] ?: return@removed false
            if (project !in liveSlugs) return@removed true
            compareOrder(
                OrderKey(created.hlc, created.dev, created.event),
                OrderKey(removal.removed.hlc, removal.removed.dev, removal.removed.event),
            ) < 0
        }
        val removedIds = all.filter(removed).map { it.id }.toSet()
        // A task of a removed project is not an open dependency: no person can finish it.
        val done =
            all.map { task ->
                if (task.openDependencies.none { it in removedIds }) {
                    task
                } else {
                    task.copy(openDependencies = task.openDependencies.filterNot { it in removedIds })
                }
            }
        return Triple(live, done.filterNot(removed), done.filter(removed))
    }

    /** The task views with the fields that need other tasks: key state, includes, subtasks, open dependencies. */
    private fun assembleTasks(rank: (String) -> Int): List<TaskView> {
        val tasks = markDuplicateKeys(folds.values.map { it.toView() }.sortedBy { it.id }, rank)
        val byTask = tasks.associateBy { it.id }
        val includes = includes()
        val subtasks = HashMap<String, MutableList<String>>()
        for (task in tasks) {
            val parent = task.parent
            if (parent != null && parent in byTask) subtasks.getOrPut(parent) { mutableListOf() }.add(task.id)
        }
        val byCreated =
            Comparator<String> { a, b ->
                val x = byTask.getValue(a).created
                val y = byTask.getValue(b).created
                if (x == null ||
                    y == null
                ) {
                    a.compareTo(b)
                } else {
                    compareOrder(OrderKey(x.hlc, x.dev, x.event), OrderKey(y.hlc, y.dev, y.event))
                }
            }
        return tasks.map { task ->
            task.copy(
                includes = includes[task.id].orEmpty(),
                subtasks = subtasks[task.id].orEmpty().sortedWith(byCreated),
                openDependencies = task.dependsOn.filter { byTask[it]?.stage != "done" },
            )
        }
    }

    /** The last heartbeat of a device over its heartbeat files, and the count of its heartbeats. */
    private fun heartbeatOf(slug: String): DeviceHeartbeatView? {
        var best: LogLine? = null
        var count = 0
        for (aggregate in heartbeats.values.filter { it.device == slug }) {
            val last = aggregate.last ?: continue
            if (best == null || byOrder.compare(best, last) < 0) best = last
            count += aggregate.count
        }
        return best?.let { line ->
            DeviceHeartbeatView(line.event.hlc, (line.event.data as? DeviceHeartbeatV1)?.bootTime.orEmpty(), count)
        }
    }

    /** The lines of each device log of each task, up to the first held line of the log. */
    private fun includes(): Map<String, Map<String, Long>> {
        val firstHeld = HashMap<String, Int>()
        for (line in held.values) firstHeld[line.path] = minOf(firstHeld[line.path] ?: line.line, line.line)
        val result = HashMap<String, MutableMap<String, Long>>()
        for (source in sources.values.sortedBy { it.path }) {
            if (source.source.scope.kind != LogKind.TASK) continue
            val entry = result.getOrPut(checkNotNull(source.task)) { LinkedHashMap() }
            val heldLine = firstHeld[source.path]
            entry[source.device] = (if (heldLine == null) source.lines else minOf(source.lines, heldLine - 1)).toLong()
        }
        return result
    }

    @Suppress("CyclomaticComplexMethod")
    private fun issues(now: Long): List<MergeIssue> {
        val issues = mutableListOf<MergeIssue>()
        documents.values.forEach { doc -> doc.issue?.let { issues.add(it) } }
        for (source in sources.values) {
            issues.addAll(source.issues)
            source.readError?.let { issues.add(it) }
            source.partial?.let {
                issues.add(
                    MergeIssue(
                        "partial_tail",
                        source.path,
                        it.line,
                        null,
                        source.task,
                        null,
                        "The last line has no newline (${it.bytes} bytes): a write that did not finish",
                    ),
                )
            }
        }

        fun lineIssue(
            line: LogLine,
            code: String,
            reason: String?,
            message: String,
        ) = MergeIssue(code, line.path, line.line, line.event.id, scopeTask(line), reason, message)
        for (line in held.values) {
            val ahead = jsRound((Hlc.millis(line.event.hlc) - now) / MS_PER_SECOND)
            issues.add(
                lineIssue(
                    line,
                    "future_hlc",
                    null,
                    "The HLC ${line.event.hlc} is $ahead s ahead of the local clock; the event waits",
                ),
            )
        }
        for (line in duplicates) {
            issues.add(lineIssue(line, "duplicate_event", null, "A second event with the id ${line.event.id}"))
        }

        fun decided(
            lines: List<LogLine>,
            decisions: Map<String, Decision>,
        ) {
            for (line in lines) {
                val decision = decisions[line.event.id] ?: continue
                val e = line.event
                when {
                    decision.reason == "unknown_type" -> {
                        issues.add(lineIssue(line, "unknown_type", "unknown_type", "Unknown event type ${e.type}"))
                    }

                    decision.reason == "assignee_ignored" -> {
                        issues.add(
                            lineIssue(
                                line,
                                "ignored",
                                decision.reason,
                                "The assignee of ${e.type} of ${e.dev} is ignored: only a human assigns a task",
                            ),
                        )
                    }

                    !decision.applied -> {
                        issues.add(
                            lineIssue(
                                line,
                                "ignored",
                                decision.reason,
                                "${e.type} of ${e.dev} not applied: ${decision.reason}",
                            ),
                        )
                    }
                }
            }
        }
        for ((task, lines) in taskLines) decided(lines, folds[task]?.decisions.orEmpty())
        decided(workspaceLines, workspace.decisions)
        return issues.sortedWith(
            compareBy<MergeIssue> { it.path }
                .thenBy { it.line ?: 0 }
                .thenBy { it.code }
                .thenBy { it.event.orEmpty() },
        )
    }

    private companion object {
        const val MS_PER_SECOND = 1000.0

        /** `Math.round` of JavaScript: a half rounds up. */
        fun jsRound(value: Double): Long = kotlin.math.floor(value + HALF).roundToLong()

        const val HALF = 0.5
    }
}

/** Merges a workspace folder once: a full read of each file. */
suspend fun mergeWorkspace(
    files: WorkspaceFiles,
    clock: TimeSource,
    maxSkewMs: Long = DEFAULT_MAX_SKEW_MS,
    readOrder: (List<String>) -> List<String> = { it },
): MergeUpdate = MergeEngine(files, clock, maxSkewMs, readOrder).update()
