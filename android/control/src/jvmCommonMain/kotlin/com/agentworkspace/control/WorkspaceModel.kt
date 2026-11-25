package com.agentworkspace.control

import co.touchlab.kermit.Logger
import com.agentworkspace.shared.index.WorkspaceIndex
import com.agentworkspace.shared.merge.TaskView
import com.agentworkspace.shared.model.TimeSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * The data of the screens of one workspace: one [WorkspaceSnapshot] that is read again from the Room
 * index at the start, after each index refresh ([refreshed], from `IndexRefresher.updates`) and after
 * each phone write ([reload]).
 */
@Suppress("LongParameterList") // The 7th parameter is the clock of the queue view (queue-and-assign).
class WorkspaceModel(
    val workspace: String,
    private val phone: () -> String,
    private val index: WorkspaceIndex,
    private val scope: CoroutineScope,
    refreshed: Flow<Unit>,
    private val clock: TimeSource,
    private val log: Logger = Logger.withTag("aw-ui"),
) {
    private val state = MutableStateFlow(WorkspaceSnapshot.empty(workspace, phone()))
    private val lock = Mutex()

    val snapshot: StateFlow<WorkspaceSnapshot> = state.asStateFlow()

    init {
        scope.launch {
            reload()
            refreshed.collect { reload() }
        }
    }

    /** Reads the index again. A failed read keeps the last snapshot (the next refresh tries again). */
    @Suppress("TooGenericExceptionCaught")
    suspend fun reload(): WorkspaceSnapshot =
        lock.withLock {
            try {
                load().also { state.value = it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.e(e) { "The screens of $workspace could not read the index" }
                state.value
            }
        }

    private suspend fun load(): WorkspaceSnapshot {
        val me = phone()
        val tasks = index.tasks()
        val devices = index.devices()
        val gates = gateParts(tasks, me)
        val bindings =
            devices
                .mapNotNull { device ->
                    index.document("tasks/devices/${device.slug}/bindings.yaml")?.let { device.slug to it }
                }.toMap()
        val records =
            devices
                .mapNotNull { device ->
                    index.document("tasks/devices/${device.slug}/device.yaml")?.let { device.slug to it }
                }.toMap()
        val health =
            devices
                .mapNotNull { device ->
                    index.document("tasks/devices/${device.slug}/health.yaml")?.let { device.slug to it }
                }.toMap()
        val workspaceFile = index.document("tasks/workspace.yaml")
        return WorkspaceSnapshot(
            workspace = workspace,
            phone = me,
            keyPrefix = WorkspaceSnapshot.keyPrefixOf(workspaceFile),
            name = WorkspaceSnapshot.nameOf(workspaceFile),
            tasks = tasks,
            projects = index.projects(),
            devices = devices,
            presence = index.presence(),
            issues = index.issues(),
            gateTexts = gates.texts,
            bindings = bindings,
            records = records,
            queueOrders = queueOrders(),
            health = health,
            loadedAtMs = clock.now(),
            gateQuestions = gates.questions,
            gateContexts = gates.contexts,
            knownKeys = index.knownKeys(),
        )
    }

    /** The texts, questions and context of each shown gate, by gate id. */
    private class GateParts(
        val texts: Map<String, String>,
        val questions: Map<String, List<GateQuestion>>,
        val contexts: Map<String, List<ContextEvent>>,
    )

    private suspend fun gateParts(
        tasks: List<TaskView>,
        me: String,
    ): GateParts {
        val texts = HashMap<String, String>()
        val questions = HashMap<String, List<GateQuestion>>()
        val contexts = HashMap<String, List<ContextEvent>>()
        val shown =
            tasks.flatMap { it.gates }.filter { gate ->
                gate.state == "open" || gate.answers.any { it.dev == me && it.use == "pending" }
            }
        for (gate in shown) {
            val data = index.event(gate.opened.event)?.event?.get("data") as? JsonObject
            (data?.get("text") as? JsonPrimitive)?.contentOrNull?.let { texts[gate.gate] = it }
            val asked = GateTexts.questions(data)
            if (asked.isNotEmpty()) questions[gate.gate] = asked
            val text = (data?.get("text") as? JsonPrimitive)?.contentOrNull.orEmpty()
            val asks = gate.kind == "question" || gate.kind == "reply"
            if (asks && !GateTexts.hasBody(gate.title, text, asked)) {
                contextOf(shownTask(tasks, gate.gate), gate.opened.event)
                    .takeIf { it.isNotEmpty() }
                    ?.let { contexts[gate.gate] = it }
            }
        }
        return GateParts(texts, questions, contexts)
    }

    /** The task of a gate id. */
    private fun shownTask(
        tasks: List<TaskView>,
        gate: String,
    ): String? = tasks.firstOrNull { task -> task.gates.any { it.gate == gate } }?.id

    /**
     * The context of a gate with no body (gate-context): the agent messages before its `gate.opened`
     * event in the newest [CONTEXT_EVENTS] events of the task.
     */
    private suspend fun contextOf(
        task: String?,
        gateEvent: String,
    ): List<ContextEvent> {
        if (task == null) return emptyList()
        val events =
            index.threadNewest(task, CONTEXT_EVENTS).map { row ->
                val data = row.event["data"] as? JsonObject
                ContextEvent(
                    id = row.id,
                    type = row.type,
                    by = (row.event["by"] as? JsonPrimitive)?.contentOrNull,
                    text = (data?.get("text") as? JsonPrimitive)?.contentOrNull,
                )
            }
        return GateTexts.context(events, gateEvent)
    }

    /** The newest applied `queue.reordered` of each agent: the events come in merge order. */
    private suspend fun queueOrders(): List<QueueOrder> =
        index
            .workspaceEvents("queue.reordered")
            .mapNotNull { row ->
                val data = row.event["data"] as? JsonObject
                val agent = (data?.get("agent") as? JsonPrimitive)?.contentOrNull
                val tasks = (data?.get("tasks") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                if (agent == null || tasks == null) null else QueueOrder(agent, tasks)
            }.associateBy { it.agent }
            .values
            .toList()

    /**
     * The thread window of a task (fix list 0-20, prd TSK-24): the newest `limit` events as
     * [ThreadItems] in merge order (the Session rows and the Activity rows), and whether older events
     * exist ("Show older").
     */
    suspend fun thread(
        task: String,
        limit: Int = THREAD_PAGE,
    ): ThreadWindow {
        val rows = index.threadNewest(task, limit + 1)
        val older = rows.size > limit
        val shown = if (older) rows.drop(1) else rows
        return ThreadWindow(ThreadItems.of(shown), older, ActivityRows.of(shown))
    }

    /** The `artifact.added` events of a task in merge order (gate-full-context). */
    suspend fun artifactEvents(task: String) = index.taskEvents(task, "artifact.added")

    fun refresh() {
        scope.launch { reload() }
    }

    companion object {
        const val THREAD_PAGE = 500

        /** The newest events of a task that the context of a gate reads (gate-context). */
        const val CONTEXT_EVENTS = 500
    }
}
