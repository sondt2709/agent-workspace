package com.agentworkspace.control

import com.agentworkspace.engine.PeerStatus
import com.agentworkspace.engine.SyncRules
import com.agentworkspace.shared.merge.DevicePresence
import com.agentworkspace.shared.merge.DeviceView
import com.agentworkspace.shared.merge.MergeIssue
import com.agentworkspace.shared.merge.NeedsYouReason
import com.agentworkspace.shared.merge.ProjectView
import com.agentworkspace.shared.merge.TaskView
import com.agentworkspace.shared.model.Hlc
import com.agentworkspace.shared.model.IsoTime
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** What the screens read from the index of one workspace, at one time. */
data class WorkspaceSnapshot(
    val workspace: String,
    /** The slug of this phone. */
    val phone: String,
    /** The `key_prefix` of `workspace.yaml`, or null before the phone has the file: no create, no rekey. */
    val keyPrefix: String?,
    val tasks: List<TaskView>,
    val projects: List<ProjectView>,
    val devices: List<DeviceView>,
    val presence: List<DevicePresence>,
    val issues: List<MergeIssue>,
    /** The text of the `gate.opened` event of each open gate, by gate id. */
    val gateTexts: Map<String, String>,
    /** The `bindings.yaml` value of each device, by slug. */
    val bindings: Map<String, JsonObject>,
    /** The `device.yaml` record of each device, by slug (the keys for a sealed credential). */
    val records: Map<String, JsonObject> = emptyMap(),
    val loaded: Boolean = true,
    /** The `name` of `tasks/workspace.yaml`, or null before the file arrives. */
    val name: String? = null,
    /** The newest `queue.reordered` of each agent (openspec queue-and-assign). */
    val queueOrders: List<QueueOrder> = emptyList(),
    /** The last valid `health.yaml` of each device, by slug. */
    val health: Map<String, JsonObject> = emptyMap(),
    /** The time of the load in ms, from the clock of the model. */
    val loadedAtMs: Long = 0L,
    /** Each key of a `task.created` or `task.rekeyed`, also of a removed task (openspec project-remove). */
    val knownKeys: List<String> = emptyList(),
    /** The questions of the `gate.opened` event of each shown gate, by gate id (gate-context). */
    val gateQuestions: Map<String, List<GateQuestion>> = emptyMap(),
    /** The context of each shown question or reply gate with no body, by gate id (gate-context). */
    val gateContexts: Map<String, List<ContextEvent>> = emptyMap(),
    /** The Inbox cards, the newest message first (openspec inbox-mattermost). */
    val cards: List<InboxCard> = emptyList(),
    /** The sources of the Inbox as their view JSON. */
    val sources: List<JsonObject> = emptyList(),
) {
    fun task(id: String): TaskView? = tasks.firstOrNull { it.id == id }

    /** The projects that get new tasks: not archived (gap-setup). */
    val openProjects: List<ProjectView> get() = projects.filter { !it.archived }

    /** The queue entry of each queued task, by task id: the queue rule of awd on the files of the phone. */
    val queueEntries: Map<String, QueueEntry> by lazy {
        QueueRules
            .agentQueues(
                tasks = tasks.map(QueueRules::queueTask),
                orders = queueOrders,
                devices =
                    devices.map { device ->
                        QueueDevice(device.slug, device.revoked, presenceOf(device.slug)?.online, health[device.slug])
                    },
                nowMs = loadedAtMs,
            ).flatMap { it.tasks }
            .associateBy { it.task }
    }

    fun presenceOf(device: String): DevicePresence? = presence.firstOrNull { it.device == device }

    /** The highest HLC of the tasks: the phone clock reads it before a write. */
    val lastHlc: String? get() = tasks.mapNotNull { it.lastHlc }.maxOrNull()

    companion object {
        fun empty(
            workspace: String,
            phone: String,
        ) = WorkspaceSnapshot(
            workspace = workspace,
            phone = phone,
            keyPrefix = null,
            tasks = emptyList(),
            projects = emptyList(),
            devices = emptyList(),
            presence = emptyList(),
            issues = emptyList(),
            gateTexts = emptyMap(),
            bindings = emptyMap(),
            loaded = false,
        )

        /** The `name` of `workspace.yaml`, or null. */
        fun nameOf(workspace: JsonObject?): String? =
            (workspace?.get("name") as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }

        /**
         * The `key_prefix` of `workspace.yaml`, or null when the phone does not have a valid file. Like
         * awd (`not_ready`), the phone then guesses no prefix.
         */
        fun keyPrefixOf(workspace: JsonObject?): String? =
            (workspace?.get("key_prefix") as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }
    }
}

/** The "Paused" chip of a task: the cause and whether "Assign to another device…" fits. */
data class PauseChip(
    val text: String,
    val canAssign: Boolean,
)

/** One row of a task list. */
data class TaskRowState(
    val id: String,
    val label: String,
    val title: String,
    val stage: String,
    val stageLabel: String,
    val assignee: String?,
    val pause: PauseChip?,
    val needsYou: Boolean,
    /** The first reason of the "Needs you" lane, for example "Needs you: Answer question". */
    val reason: String?,
    val lastHlc: String?,
    /** "Queued · 2nd for claude@ubuntu-01" for a task that waits for a session, else null. */
    val queue: String? = null,
    /** The cause that blocks a queued task, for example "2 sessions working". */
    val queueCause: String? = null,
    /** The agent works: the session runs, and the task neither waits for the person nor is paused. */
    val running: Boolean = false,
) {
    /** The queue text of a row as one text that wraps at word boundaries: "Queued · 1st for … · starts soon". */
    val queueLine: String? get() = queue?.let { q -> listOfNotNull(q, queueCause).joinToString(" · ") }
}

/** One device row of Home and Devices. */
data class DeviceRowState(
    val slug: String,
    val name: String,
    val role: String,
    val isThisPhone: Boolean,
    val online: Boolean,
    val revoked: Boolean,
    /** "Last heartbeat 8 s ago", or "No heartbeat yet". */
    val heartbeat: String,
    /** The sync state of the engine peer: "Synced 12 s ago", or null for this phone. */
    val sync: String?,
)

data class HomeState(
    val needsYou: List<TaskRowState>,
    val working: List<TaskRowState>,
    val paused: List<TaskRowState>,
    val devices: List<DeviceRowState>,
    val issueCount: Int,
)

data class StageGroup(
    val stage: String,
    val label: String,
    val tasks: List<TaskRowState>,
)

/** The pure functions that build each screen state from a snapshot and the time. */
object ScreenStates {
    private const val NEWEST_FIRST_EMPTY = ""

    private const val SESSION_RUNNING = "running"
    private const val PENDING = "pending"

    /** The pause chip: the pause state of the view, else a session device with no heartbeat for 90 s. */
    fun pauseChip(
        task: TaskView,
        snapshot: WorkspaceSnapshot,
    ): PauseChip? {
        if (task.archived || task.stage == "done") return null
        val device = task.claim?.device
        task.paused?.let { paused ->
            val text =
                if (paused.cause == "device_offline" && device != null) {
                    "Paused: $device offline"
                } else {
                    "Paused: ${Texts.pauseText(paused.cause)}"
                }
            return PauseChip(text, paused.cause == "device_offline" || paused.cause == "device_revoked")
        }
        if (device == null || task.owner != device) return null
        val presence = snapshot.presenceOf(device) ?: return null
        return if (presence.offlineSince != null) PauseChip("Paused: $device offline", true) else null
    }

    fun reasonOf(task: TaskView): String? =
        task.needsYouReasons.firstOrNull()?.let { reason ->
            when (reason) {
                is NeedsYouReason.Gate -> "Needs you: ${Texts.gateLabel(reason.kind)}"
                NeedsYouReason.Assign -> "Needs you: Assign task"
                is NeedsYouReason.Paused -> "Needs you: ${Texts.pauseText(reason.cause)}"
            }
        }

    fun row(
        task: TaskView,
        snapshot: WorkspaceSnapshot,
    ) = TaskRowState(
        id = task.id,
        label = Texts.taskLabel(task.id, task.key),
        title = task.title ?: task.firstMessage?.let(Texts::titleFromFirstMessage) ?: "(no title yet)",
        stage = task.stage,
        stageLabel = Texts.stageLabel(task.stage),
        assignee = task.assignee,
        pause = pauseChip(task, snapshot),
        needsYou = task.needsYouLane,
        reason = reasonOf(task),
        lastHlc = task.lastHlc,
        queue = snapshot.queueEntries[task.id]?.text,
        queueCause = snapshot.queueEntries[task.id]?.cause?.text,
        // As the desktop "working" rule: a task that waits for the person or is paused is not running,
        // even while its session waits in the terminal.
        running = task.session?.state == SESSION_RUNNING && !task.needsYouLane && pauseChip(task, snapshot) == null,
    )

    private fun active(snapshot: WorkspaceSnapshot) = snapshot.tasks.filter { !it.archived }

    private fun newestFirst(rows: List<TaskRowState>) = rows.sortedByDescending { it.lastHlc ?: NEWEST_FIRST_EMPTY }

    /** The Inbox: each task in the "Needs you" lane, the newest change first. */
    fun inbox(snapshot: WorkspaceSnapshot): List<TaskRowState> =
        newestFirst(active(snapshot).filter { it.needsYouLane }.map { row(it, snapshot) })

    /** The stage value of the group of the archived tasks (openspec task-actions). */
    const val ARCHIVED_GROUP = "archived"

    /**
     * Tasks: one group per stage in the stage order, with no empty group (openspec phone-desktop-parity).
     * The archived tasks are the last group "Archived" (openspec task-actions), only when there is one.
     */
    fun tasksByStage(
        snapshot: WorkspaceSnapshot,
        project: String? = null,
        /** The project filter of Tasks (openspec nav-tasks-needs-you): none selected keeps all. */
        projects: List<String> = emptyList(),
    ): List<StageGroup> {
        val own =
            snapshot.tasks.filter {
                (project == null || it.project == project) && (projects.isEmpty() || it.project in projects)
            }
        val rows = own.filter { !it.archived }.map { row(it, snapshot) }
        val stages =
            Texts.STAGES
                .map { stage ->
                    StageGroup(stage, Texts.stageLabel(stage), newestFirst(rows.filter { it.stage == stage }))
                }.filter { it.tasks.isNotEmpty() }
        val archived = own.filter { it.archived }.map { row(it, snapshot) }
        if (archived.isEmpty()) return stages
        return stages + StageGroup(ARCHIVED_GROUP, "Archived", newestFirst(archived))
    }

    fun home(
        snapshot: WorkspaceSnapshot,
        peers: List<PeerStatus>,
        nowMs: Long,
    ): HomeState {
        val rows = active(snapshot).map { row(it, snapshot) to it }
        val needsYou = rows.filter { it.first.needsYou }.map { it.first }
        val paused = rows.filter { !it.first.needsYou && it.first.pause != null }.map { it.first }
        val working =
            rows
                .filter { (row, task) ->
                    !row.needsYou && row.pause == null && task.session?.state == SESSION_RUNNING
                }.map { it.first }
        return HomeState(
            needsYou = newestFirst(needsYou),
            working = newestFirst(working),
            paused = newestFirst(paused),
            devices = devices(snapshot, peers, nowMs).filter { !it.isThisPhone && !it.revoked },
            issueCount = snapshot.issues.size,
        )
    }

    /**
     * The devices by priority, with presence and the sync state of the engine peer. [engineDown] is the
     * state text of the phone engine when it does not run: then no peer is blamed as offline (review
     * android-engine workflow 3).
     */
    fun devices(
        snapshot: WorkspaceSnapshot,
        peers: List<PeerStatus>,
        nowMs: Long,
        engineDown: String? = null,
    ): List<DeviceRowState> =
        snapshot.devices.map { device ->
            val presence = snapshot.presenceOf(device.slug)
            val heard = presence?.lastHeartbeatHlc?.let { Hlc.timeOf(it) }
            val received = presence?.receivedAt?.let { IsoTime.parseMillis(it) } ?: heard
            val phone = device.slug == snapshot.phone
            DeviceRowState(
                slug = device.slug,
                name = device.name ?: device.slug,
                role = Texts.roleLabel(device.role),
                isThisPhone = phone,
                online = phone || presence?.online == true,
                revoked = device.revoked,
                heartbeat =
                    when {
                        phone -> "This phone"
                        received == null -> "No heartbeat yet"
                        else -> "Last heartbeat ${Texts.ago(received, nowMs)}"
                    },
                sync =
                    if (phone) {
                        null
                    } else if (engineDown != null) {
                        "No sync state: the sync engine of this phone is $engineDown"
                    } else {
                        peers.firstOrNull { it.device == device.slug }?.let { SyncRules.describe(it, nowMs) }
                            ?: "Not a sync peer of this phone"
                    },
            )
        }

    /**
     * The `agent@device` choices of a task: the default agent of its project on each project device.
     * [except] leaves out the agents of one device: "Assign to another device…" never lists the paused
     * device of the task.
     */
    fun agentChoices(
        snapshot: WorkspaceSnapshot,
        project: String?,
        current: String? = null,
        except: String? = null,
    ): List<String> {
        val choices =
            snapshot.projects
                .filter { project == null || it.slug == project }
                .flatMap { view ->
                    val agent = (view.document["default_agent"] as? JsonPrimitive)?.contentOrNull ?: "claude"
                    val devices =
                        (view.document["devices"] as? JsonArray)
                            ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                            .orEmpty()
                    devices.map { "$agent@$it" }
                }.toMutableList()
        if (current != null) choices.add(current)
        // A mobile device never runs agents.
        val mobile =
            snapshot.devices
                .filter { it.role == "mobile" }
                .map { it.slug }
                .toSet()
        return choices.distinct().filter { it.substringAfter('@') !in mobile && it.substringAfter('@') != except }
    }

    /** The test server names of a project (`project.yaml`; the phone has no `secure` folder). */
    fun testServers(
        snapshot: WorkspaceSnapshot,
        project: String?,
    ): List<String> =
        (
            snapshot.projects
                .firstOrNull { it.slug == project }
                ?.document
                ?.get("test_servers") as? JsonArray
        )?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            .orEmpty()

    /** The cards of the open gates of a task. */
    fun gateCards(
        task: TaskView,
        snapshot: WorkspaceSnapshot,
    ): List<GateCard> =
        task.gates
            .filter { gate ->
                gate.state == "open" || gate.answers.any { it.dev == snapshot.phone && it.use == PENDING }
            }.map { gate ->
                val mine = gate.answers.lastOrNull { it.dev == snapshot.phone && it.use == PENDING }
                val other = gate.answers.lastOrNull { it.dev != snapshot.phone && it.use == PENDING }
                val owner = task.owner
                val status =
                    when {
                        gate.state != "open" -> {
                            CardStatus.Resolved(gate.answer)
                        }

                        mine != null -> {
                            val offline = owner?.let { snapshot.presenceOf(it)?.offlineSince != null } ?: false
                            CardStatus.Sent(mine.answer, owner, offline)
                        }

                        other != null -> {
                            CardStatus.AnsweredElsewhere(other.answer, other.dev)
                        }

                        else -> {
                            CardStatus.Open
                        }
                    }
                val questions = snapshot.gateQuestions[gate.gate].orEmpty()
                val body = snapshot.gateTexts[gate.gate].orEmpty()
                GateCard(
                    task = task.id,
                    taskLabel = Texts.taskLabel(task.id, task.key),
                    gate = gate,
                    label = Texts.gateLabel(gate.kind),
                    title = gate.title,
                    text = if (GateTexts.hasBody(gate.title, body, questions)) body else "",
                    questions = questions,
                    context = snapshot.gateContexts[gate.gate].orEmpty(),
                    options = gate.options,
                    freeText = GateRules.takesFreeText(gate),
                    freeTextLabel = GateRules.freeTextLabel(gate),
                    status = status,
                )
            }

    /** The "Assign task" card shows when the task has no assignee. */
    fun needsAssign(task: TaskView): Boolean = task.needsYouReasons.any { it is NeedsYouReason.Assign }

    /** True when a message can go to the session of the task (a running session). */
    fun canMessage(task: TaskView): Boolean = task.session?.state == SESSION_RUNNING

    /** The properties of the task detail, as label and value; the session rows are in [TaskDetail.sessionSummary]. */
    fun fields(task: TaskView): List<Pair<String, String>> =
        buildList {
            add("Key" to Texts.taskLabel(task.id, task.key))
            add("Stage" to Texts.stageLabel(task.stage))
            task.project?.let { add("Project" to it) }
            add("Assignee" to (task.assignee ?: "None"))
            val latest = task.proposal.latest
            val approved = task.proposal.approved
            val proposal =
                when {
                    latest == 0L -> "None yet"
                    approved != null -> "v$approved approved (latest v$latest)"
                    else -> "v$latest, not approved"
                }
            add("Proposal" to proposal)
            task.testServer?.let { add("Test server" to it) }
            if (task.credentials.isNotEmpty()) add("Credentials" to task.credentials.joinToString(", "))
            task.parent?.let { add("Parent" to it) }
            if (task.subtasks.isNotEmpty()) add("Subtasks" to task.subtasks.size.toString())
            if (task.openDependencies.isNotEmpty()) add("Waiting for" to "${task.openDependencies.size} tasks")
            task.progress?.let { add("Progress" to it) }
        }
}
