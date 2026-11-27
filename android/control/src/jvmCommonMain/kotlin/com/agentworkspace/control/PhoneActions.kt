package com.agentworkspace.control

import com.agentworkspace.schema.GateAnsweredV1
import com.agentworkspace.schema.MessageSentV1
import com.agentworkspace.schema.SchemaViolation
import com.agentworkspace.schema.SessionStopRequestedV1
import com.agentworkspace.schema.TaskArchivedV1
import com.agentworkspace.schema.TaskAssignedV1
import com.agentworkspace.schema.TaskCreatedV1
import com.agentworkspace.schema.TaskRekeyedV1
import com.agentworkspace.schema.TaskUnarchivedV1
import com.agentworkspace.shared.merge.SessionOptions
import com.agentworkspace.shared.merge.nextFreeKey
import com.agentworkspace.shared.merge.rekeyPlan
import com.agentworkspace.shared.model.TimeSource
import com.agentworkspace.shared.write.EventWriter
import com.agentworkspace.shared.write.Uuid7
import com.agentworkspace.shared.write.WriteRefusedException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** The result of a phone action. */
sealed interface ActionResult {
    /** The event is in the log at [path]; [task] is the task of the event. */
    data class Done(
        val task: String,
        val path: String,
    ) : ActionResult

    /** Nothing was written; [message] tells the person why. */
    data class Refused(
        val message: String,
    ) : ActionResult
}

/** The form of a new task (docs/workflow.md 4.1): the first message and the optional fields. */
data class NewTaskDraft(
    val project: String,
    val firstMessage: String,
    val assignee: String? = null,
    val testServer: String? = null,
    val credentials: List<String> = emptyList(),
    val parent: String? = null,
    /** The session options; the event has them only when they differ from the defaults (openspec session-options). */
    val sessionOptions: SessionOptionsDraft? = null,
    /** The title; blank: the first line of the first message, as on the desktop. */
    val title: String? = null,
) {
    companion object {
        /**
         * The session options that New task starts with: "Skip permissions", the product default
         * (openspec polish-skip-default), and "Agent teams" (openspec session-options). Only a person
         * fills New task, so no agent task gets them.
         */
        val START_OPTIONS = SessionOptionsDraft(permissionMode = SessionOptions.SKIP, agentTeams = true)

        /**
         * "Create task" of New task is enabled with a project, a first message that is not blank,
         * and no create in progress (openspec permissions-default: the pinned action bar).
         */
        fun canCreate(
            project: String?,
            firstMessage: String,
            creating: Boolean,
        ): Boolean = !creating && !project.isNullOrEmpty() && firstMessage.isNotBlank()
    }
}

/**
 * The human actions of the phone (docs/workflow.md 6). Each one writes one event to the phone's own
 * log with the event writer of `shared`, then calls [afterWrite] with the path: the app starts a
 * targeted scan of the engine and an index refresh, so the change reaches the other devices in about
 * 1.3 s and the card shows "Answer sent" at once. One action at a time: the clock of the writer is
 * not shared between threads.
 */
class PhoneActions(
    private val writer: EventWriter,
    private val snapshot: () -> WorkspaceSnapshot,
    private val afterWrite: suspend (String) -> Unit,
    private val time: TimeSource,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val newId: (Long) -> String = { Uuid7.next(it) },
) {
    private val lock = Mutex()

    /** The `(task, old key)` pairs that this process rekeyed. Changed only in [lock]. */
    private val rekeyed = mutableSetOf<Pair<String, String>>()

    /**
     * The numbers of the keys that this process wrote (a created key or a new key of a rekey). The index
     * can show them later than the next action: a double tap or the rekey collector must not use them
     * again. Changed only in [lock].
     */
    private val issued = mutableSetOf<Long>()

    /** Answers a gate: `gate.answered` with the gate id and the version that the card shows. */
    suspend fun answerGate(
        task: String,
        gate: String,
        answer: String,
        comment: String? = null,
    ): ActionResult {
        val view = snapshot().task(task) ?: return ActionResult.Refused("The task is not on this phone.")
        val open =
            view.gates.firstOrNull { it.gate == gate } ?: return ActionResult.Refused("The gate is not on this phone.")
        GateRules.problem(open, answer, comment)?.let { return ActionResult.Refused(it) }
        val data = GateAnsweredV1(gate, open.version, answer.trim(), comment?.trim()?.takeIf { it.isNotEmpty() })
        return write(task) { path -> writer.write(path, "gate.answered", GateAnsweredV1.serializer(), data) }
    }

    /** Sends free text to the running session of a task: `message.sent {id, text, to_session}`. */
    suspend fun sendMessage(
        task: String,
        text: String,
    ): ActionResult {
        val view = snapshot().task(task) ?: return ActionResult.Refused("The task is not on this phone.")
        if (text.isBlank()) return ActionResult.Refused("Write a message.")
        val session = view.session?.takeIf { ScreenStates.canMessage(view) }
        if (session == null) return ActionResult.Refused("No session runs for this task. Assign it to start one.")
        val data = MessageSentV1(newId(time.now()), text, session.session)
        return write(task) { path -> writer.write(path, "message.sent", MessageSentV1.serializer(), data) }
    }

    /**
     * Asks the session device to stop the running session of a task: the person event
     * `session.stop_requested {session}` (openspec session-options). AW starts no new session until
     * a person starts one.
     */
    suspend fun stopSession(task: String): ActionResult {
        val view = snapshot().task(task) ?: return ActionResult.Refused("The task is not on this phone.")
        val session =
            view.session?.takeIf { ScreenStates.canMessage(view) }
                ?: return ActionResult.Refused("No session runs for this task.")
        val data = SessionStopRequestedV1(session.session)
        return write(task) { path ->
            writer.write(path, "session.stop_requested", SessionStopRequestedV1.serializer(), data)
        }
    }

    /**
     * Archives a task: `task.archived` (openspec task-actions). With a running session, the stop
     * request `session.stop_requested {session}` goes first, so the session device stops it. The
     * confirm of the screen names that device.
     */
    suspend fun archiveTask(task: String): ActionResult {
        val view = snapshot().task(task) ?: return ActionResult.Refused("The task is not on this phone.")
        if (view.archived) return ActionResult.Refused("The task is already archived.")
        val session = view.session?.takeIf { ScreenStates.canMessage(view) }
        return write(task) { path ->
            if (session != null) {
                writer.write(
                    path,
                    "session.stop_requested",
                    SessionStopRequestedV1.serializer(),
                    SessionStopRequestedV1(session.session),
                )
            }
            writer.write(path, "task.archived", TaskArchivedV1.serializer(), TaskArchivedV1())
        }
    }

    /** Makes an archived task active again: `task.unarchived`. AW starts no session until a person starts one. */
    suspend fun unarchiveTask(task: String): ActionResult {
        val view = snapshot().task(task) ?: return ActionResult.Refused("The task is not on this phone.")
        if (!view.archived) return ActionResult.Refused("The task is not archived.")
        return write(task) { path ->
            writer.write(path, "task.unarchived", TaskUnarchivedV1.serializer(), TaskUnarchivedV1())
        }
    }

    /**
     * Creates a task: `task.created` in a new task folder with the next free key that the phone
     * knows. With no assignee, the task opens "Needs you: Assign task"; AW never assigns it alone. The
     * event has `session_options` only when the person changed them from the defaults.
     */
    suspend fun createTask(draft: NewTaskDraft): ActionResult {
        val now = snapshot()
        val options = draft.sessionOptions?.changedFrom(SessionOptionsDraft())
        val project = now.projects.firstOrNull { it.slug == draft.project }
        val problem =
            when {
                draft.firstMessage.isBlank() -> "Write the first message."
                project == null -> "Select a project."
                project.archived -> "${project.slug} is archived: it gets no new tasks."
                else -> options?.problem()
            }
        if (problem != null) return ActionResult.Refused(problem)
        val prefix = now.keyPrefix ?: return ActionResult.Refused(NO_KEY_PREFIX)
        val title = draft.title?.trim()?.takeIf { it.isNotEmpty() } ?: Texts.titleFromFirstMessage(draft.firstMessage)
        val task = newId(time.now())
        // The field check; the key comes again in the lock from the newest snapshot and the written keys.
        val data =
            try {
                TaskCreatedV1(
                    key = freeKnownKey(now, prefix),
                    project = draft.project,
                    title = title,
                    firstMessage = draft.firstMessage,
                    assignee = draft.assignee?.trim()?.takeIf { it.isNotEmpty() },
                    parent = draft.parent,
                    testServer = draft.testServer?.trim()?.takeIf { it.isNotEmpty() },
                    credentials =
                        draft.credentials
                            .map { it.trim() }
                            .filter { it.isNotEmpty() }
                            .distinct(),
                    sessionOptions = options?.forCreate(),
                )
            } catch (e: SchemaViolation) {
                return ActionResult.Refused("Check the field ${e.field}: ${e.message}")
            }
        val path = EventWriter.taskLog(task, writer.device)
        val result =
            lock.withLock {
                val fresh = snapshot()
                val freshPrefix = fresh.keyPrefix ?: return@withLock ActionResult.Refused(NO_KEY_PREFIX)
                val key = freeKey(fresh, freshPrefix)
                writeLocked(
                    task,
                    path,
                    fresh,
                ) { writer.write(it, "task.created", TaskCreatedV1.serializer(), data.copy(key = key)) }
                    .also { if (it is ActionResult.Done) issue(key, freshPrefix) }
            }
        if (result is ActionResult.Done) afterWrite(path)
        return result
    }

    /**
     * Assigns a task to `agent@device`: a human `task.assigned`. The same action is "Assign task" and
     * "Assign to another device…" on a paused task (docs/decisions/2026-11-23-manual-move.md), and
     * "New session" with [sessionOptions] (openspec session-options): they replace the options of the task.
     */
    suspend fun assign(
        task: String,
        assignee: String,
        sessionOptions: SessionOptionsDraft? = null,
    ): ActionResult {
        snapshot().task(task) ?: return ActionResult.Refused("The task is not on this phone.")
        sessionOptions?.problem()?.let { return ActionResult.Refused(it) }
        val data =
            try {
                TaskAssignedV1(assignee.trim(), sessionOptions = sessionOptions?.forAssign())
            } catch (e: SchemaViolation) {
                if (e.field != "assignee") return ActionResult.Refused("Check the field ${e.field}: ${e.message}")
                return ActionResult.Refused("Write the assignee as agent@device, for example claude@ubuntu-01.")
            }
        return write(task) { path -> writer.write(path, "task.assigned", TaskAssignedV1.serializer(), data) }
    }

    /**
     * "Restart agent" (openspec restart-agent): a person `task.assigned` with the same assignee. It has no
     * `session_options` and no `session_host`, so the task keeps its options and its host choice.
     */
    suspend fun restartAgent(task: String): ActionResult {
        val view = snapshot().task(task) ?: return ActionResult.Refused("The task is not on this phone.")
        val assignee = view.assignee ?: return ActionResult.Refused("Assign the task first.")
        if (!TaskActions.canRestart(view)) return ActionResult.Refused("A session of this task runs.")
        return assign(task, assignee)
    }

    /**
     * Writes `task.rekeyed` for each duplicate task key that the phone must change (docs/architecture.md
     * 4.3.3 item 3): the same plan as awd (`rekeyPlan`). One write per task and old key in this process;
     * after a restart, the index has the merged event, so no duplicate is left.
     */
    suspend fun rekeyDuplicates(): List<ActionResult> {
        val results =
            lock.withLock {
                val now = snapshot()
                if (!now.loaded) return emptyList()
                // Like awd: no rekey before the phone knows the key prefix of workspace.yaml.
                val prefix = now.keyPrefix ?: return emptyList()
                val plan =
                    rekeyPlan(
                        now.tasks,
                        prefix,
                        writer.device,
                    ).filter { (it.task to it.from) !in rekeyed }
                // The plan starts at the next free key of the index; a key that this process wrote moves it up.
                val start = keyNumber(freeKey(now, prefix), prefix)
                val planned = plan.firstOrNull()?.let { keyNumber(it.to, prefix) }
                val shift = if (start != null && planned != null) maxOf(0L, start - planned) else 0L
                plan.map { item ->
                    val to = keyNumber(item.to, prefix)?.let { "$prefix-${it + shift}" } ?: item.to
                    val path = EventWriter.taskLog(item.task, writer.device)
                    val result =
                        writeLocked(item.task, path, now) {
                            writer.write(
                                it,
                                "task.rekeyed",
                                TaskRekeyedV1.serializer(),
                                TaskRekeyedV1(item.from, to),
                                by = "aw@${writer.device}",
                            )
                        }
                    // Only a written rekey counts: a failed write runs again at the next snapshot.
                    if (result is ActionResult.Done) {
                        rekeyed.add(item.task to item.from)
                        issue(to, prefix)
                    }
                    result
                }
            }
        results.filterIsInstance<ActionResult.Done>().forEach { afterWrite(it.path) }
        return results
    }

    /**
     * The next free key that [now] knows with [prefix]: above each key of the tasks and each key of the task
     * events, so a key of a removed task is not used again (openspec project-remove).
     */
    private fun freeKnownKey(
        now: WorkspaceSnapshot,
        prefix: String,
    ): String {
        val fromTasks = keyNumber(nextFreeKey(now.tasks, prefix), prefix) ?: 1L
        val fromEvents =
            now.knownKeys
                .mapNotNull { keyNumber(it, prefix) }
                .maxOrNull()
                ?.plus(1) ?: 1L
        return "$prefix-${maxOf(fromTasks, fromEvents)}"
    }

    /** The next free key of [now] with [prefix], above each key that this process wrote. */
    private fun freeKey(
        now: WorkspaceSnapshot,
        prefix: String,
    ): String {
        val known = freeKnownKey(now, prefix)
        val number = keyNumber(known, prefix) ?: return known
        val next = maxOf(number, (issued.maxOrNull() ?: 0L) + 1)
        return "$prefix-$next"
    }

    private fun issue(
        key: String,
        prefix: String,
    ) {
        keyNumber(key, prefix)?.let(issued::add)
    }

    private fun keyNumber(
        key: String,
        prefix: String,
    ): Long? = key.removePrefix("$prefix-").takeIf { key.startsWith("$prefix-") }?.toLongOrNull()

    private suspend fun write(
        task: String,
        block: (String) -> Unit,
    ): ActionResult {
        val path = EventWriter.taskLog(task, writer.device)
        val result = lock.withLock { writeLocked(task, path, snapshot(), block) }
        if (result is ActionResult.Done) afterWrite(path)
        return result
    }

    /** Writes one event; the caller holds [lock]. */
    private suspend fun writeLocked(
        task: String,
        path: String,
        now: WorkspaceSnapshot,
        block: (String) -> Unit,
    ): ActionResult {
        // The new event sorts after each event that the phone shows.
        now.lastHlc?.let(writer::observe)
        return withContext(io) {
            try {
                block(path)
                ActionResult.Done(task, path)
            } catch (e: WriteRefusedException) {
                ActionResult.Refused("The phone did not write the event: ${e.message}")
            } catch (e: SchemaViolation) {
                ActionResult.Refused("The phone did not write the event: ${e.message}")
            } catch (e: java.io.IOException) {
                ActionResult.Refused("The phone could not write its log: ${e.message}")
            }
        }
    }

    private companion object {
        /** The refusal of a create before the phone has `workspace.yaml` (awd: `not_ready`). */
        const val NO_KEY_PREFIX =
            "The phone does not have workspace.yaml of this workspace yet. Wait for the sync, then try again."
    }
}
