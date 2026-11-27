package com.agentworkspace.shared.merge

import com.agentworkspace.schema.ArtifactAddedV1
import com.agentworkspace.schema.CommentAddedV1
import com.agentworkspace.schema.GateAnsweredV1
import com.agentworkspace.schema.GateOpenedV1
import com.agentworkspace.schema.GateResolvedV1
import com.agentworkspace.schema.HandoffWrittenV1
import com.agentworkspace.schema.MessageAgentV1
import com.agentworkspace.schema.MessageHumanV1
import com.agentworkspace.schema.MessageSentV1
import com.agentworkspace.schema.ProjectV1
import com.agentworkspace.schema.ProposalProposedV1
import com.agentworkspace.schema.ResultPostedV1
import com.agentworkspace.schema.SessionEndedV1
import com.agentworkspace.schema.SessionResumedV1
import com.agentworkspace.schema.SessionStartedV1
import com.agentworkspace.schema.SessionStopRequestedV1
import com.agentworkspace.schema.TaskArchivedV1
import com.agentworkspace.schema.TaskAssignedV1
import com.agentworkspace.schema.TaskClaimedV1
import com.agentworkspace.schema.TaskCreatedV1
import com.agentworkspace.schema.TaskDoneV1
import com.agentworkspace.schema.TaskEditedV1
import com.agentworkspace.schema.TaskLearnedV1
import com.agentworkspace.schema.TaskPausedV1
import com.agentworkspace.schema.TaskProgressV1
import com.agentworkspace.schema.TaskReadyV1
import com.agentworkspace.schema.TaskRekeyedV1
import com.agentworkspace.schema.TaskReleasedV1
import com.agentworkspace.schema.TaskResumedV1
import com.agentworkspace.schema.TaskStageChangedV1
import com.agentworkspace.schema.TaskUnarchivedV1
import com.agentworkspace.shared.model.AwEvent
import com.agentworkspace.shared.model.Hlc
import com.agentworkspace.shared.model.MAX_SAFE_INTEGER

/** What the fold needs from outside the task. */
interface TaskContext {
    /** The project document of a slug. */
    fun project(slug: String): ProjectV1?

    /** The owner device of another task at a point of the merge order (for the parent rule). */
    fun ownerAt(
        task: String,
        key: OrderKey,
    ): String?

    /** The `revoked_at` HLC of a revoked device, else null (add-identity-and-pairing). */
    fun revokedAt(device: String): String? = null
}

/**
 * True when an event comes from a revoked device after its revoke: the merge does not apply it
 * (reason `device_revoked`). An event at the revoke HLC or before it still counts.
 */
fun isAfterRevoke(
    e: AwEvent,
    revokedAt: (String) -> String?,
): Boolean {
    val at = revokedAt(e.dev) ?: return false
    return e.hlc > at
}

/** Events that count only from the owner device at that point (merge-index design decision 4). */
private val STATE_EVENTS =
    setOf(
        "task.stage_changed",
        "task.paused",
        "task.resumed",
        "task.ready",
        "task.progress",
        "task.done",
        "task.learned",
        "task.released",
        "gate.opened",
        "gate.resolved",
        "proposal.proposed",
        "result.posted",
        "handoff.written",
        "session.started",
        "session.resumed",
        "session.ended",
        "message.human",
        "message.agent",
    )

/**
 * The answer "Approve" (or "Confirm" of a gate from before openspec proposal-and-discussion) approves
 * the proposal of the gate file (spec workspace-merge "Gate answers").
 */
private val APPROVE = Regex("^(approve|confirm)", RegexOption.IGNORE_CASE)
private val PROPOSAL_FILE = Regex("^(?:proposal|approach)/v([1-9][0-9]*)\\.md\\z")

/** True for an actor `human@…`: a person. */
fun isHuman(by: String?): Boolean = by != null && by.startsWith("human@")

/** The device of an assignee `agent@device`. */
internal fun assigneeDevice(assignee: String?): String? {
    if (assignee == null) return null
    val at = assignee.indexOf('@')
    return if (at < 0) null else assignee.substring(at + 1)
}

private class AnswerState(
    val ref: EventRef,
    val by: String?,
    val version: Long,
    val answer: String,
    val comment: String?,
    var use: String,
) {
    fun view() = AnswerView(ref.event, ref.dev, ref.hlc, by, version, answer, comment, use)
}

private class GateState(
    val opened: GateOpenedV1,
    val openedRef: EventRef,
    val answers: MutableList<AnswerState>,
) {
    val gate: String get() = opened.gate
    val kind: String get() = opened.kind
    val version: Long get() = opened.version
    val file: String? get() = opened.file
    var state = "open"
    var answer: String? = null
    var answerEvent: String? = null
    var resolvedBy: String? = null

    fun view() =
        GateView(
            gate = gate,
            kind = kind,
            version = version,
            title = opened.title,
            options = opened.options,
            file = file,
            opened = openedRef,
            state = state,
            answer = answer,
            answerEvent = answerEvent,
            resolvedBy = resolvedBy,
            answers = answers.map { it.view() },
        )
}

/**
 * The fold of one task over its events in merge order (`task.ts`). It never reads the time or a file:
 * the same events give the same state.
 */
@Suppress("TooManyFunctions")
class TaskFold(
    val id: String,
) {
    /** The last folded event, or null. */
    var last: OrderKey? = null
        private set
    val decisions = HashMap<String, Decision>()

    /** The owner history: the device that owns the task from each point on. */
    private val owners = mutableListOf<Pair<OrderKey, String>>()
    private var eventCount = 0

    var created: EventRef? = null
        private set
    private var createdBy: String? = null
    private var sessionOptions: SessionOptionsView? = null
    private var startFailure: StartFailureView? = null
    private var createdKey: String? = null
    private var key: String? = null
    private var project: String? = null
    private var title: String? = null
    private var firstMessage: String? = null
    private var priority: String? = null
    private var stage = "backlog"
    private var paused: PauseView? = null
    private var assignee: String? = null
    private var claim: ClaimView? = null

    /** The device of the assignee while the accepted claim is on another device (a move). */
    private val movingTo: String?
        get() = assigneeDevice(assignee).takeIf { claim != null && it != claim?.device }
    private var releasedEpoch: Long? = null
    private var proposal = ProposalView(0, null)
    private var ready: ReadyView? = null
    private var testServer: String? = null
    private var credentials: List<String> = emptyList()
    var parent: String? = null
        private set
    private var dependsOn: List<String> = emptyList()
    private var links: List<String> = emptyList()
    private var branch: String? = null
    private var session: SessionView? = null
    private var sessionStarted = false
    private var progress: String? = null
    private var result: String? = null
    private val artifacts = mutableListOf<String>()
    private var learned = false
    private var archived = false
    private val gates = LinkedHashMap<String, GateState>()
    private val comments = mutableListOf<CommentView>()

    /** The owner device now. */
    val owner: String? get() = owners.lastOrNull()?.second

    /** The owner device at a point of the merge order: the last owner entry at or before the key. */
    fun ownerAt(key: OrderKey): String? {
        var found: String? = null
        for ((at, device) in owners) {
            if (compareOrder(at, key) > 0) break
            found = device
        }
        return found
    }

    /** True when the line sorts after the last folded event, so the fold can continue. */
    fun canAppend(line: LogLine): Boolean = last.let { it == null || compareOrder(it, line.key) < 0 }

    /** Folds one event. The caller gives the events in merge order. */
    fun apply(
        line: LogLine,
        context: TaskContext,
    ) {
        val e = line.event
        last = line.key
        eventCount++
        decisions[e.id] =
            when {
                isAfterRevoke(e, context::revokedAt) -> Decision.reject("device_revoked")
                !e.known -> Decision.reject("unknown_type")
                else -> applyKnown(e, context)
            }
    }

    @Suppress("CyclomaticComplexMethod", "LongMethod")
    private fun applyKnown(
        e: AwEvent,
        context: TaskContext,
    ): Decision {
        if (e.type in STATE_EVENTS && !mayWriteState(e)) return Decision.reject("not_owner")
        return when (val data = e.data) {
            is TaskCreatedV1 -> {
                created(e, data, context)
            }

            is TaskClaimedV1 -> {
                when {
                    data.device != e.dev -> {
                        Decision.reject("claim_device_mismatch")
                    }

                    // Only the device of the current assignee claims: AW never moves a task by
                    // itself (docs/decisions/2026-11-23-manual-move.md items 1 and 4).
                    assigneeDevice(assignee) != e.dev -> {
                        Decision.reject("not_assignee_device")
                    }

                    claim.let { it != null && data.epoch <= it.epoch } -> {
                        Decision.reject("stale_claim")
                    }

                    else -> {
                        claim = ClaimView(data.epoch, data.device, data.session, e.id)
                        owners.add(OrderKey(e.hlc, e.dev, e.id) to e.dev)
                        startFailure = null
                        Decision.OK
                    }
                }
            }

            is TaskAssignedV1 -> {
                if (!mayAssign(e, context)) {
                    Decision.reject("assignment_not_allowed")
                } else {
                    assignee = data.assignee
                    // "Restart agent": the device tries the start again (openspec restart-agent).
                    if (isHuman(e.by)) startFailure = startFailure?.copy(retrying = true)
                    if (takeOptions(e, data.sessionOptions?.let(::optionsOf))) {
                        Decision.OK
                    } else {
                        Decision(true, "session_options_ignored")
                    }
                }
            }

            is TaskEditedV1 -> {
                when (data.field) {
                    "title" -> {
                        Decision.OK.also { title = data.value }
                    }

                    "priority" -> {
                        Decision.OK.also { priority = data.value }
                    }

                    else -> {
                        if (sessionStarted) {
                            Decision.reject("first_message_locked")
                        } else {
                            Decision.OK.also { firstMessage = data.value }
                        }
                    }
                }
            }

            is TaskRekeyedV1 -> {
                when {
                    created?.dev != e.dev -> Decision.reject("not_creator")
                    data.from != key -> Decision.reject("stale_rekey")
                    else -> Decision.OK.also { key = data.to }
                }
            }

            is TaskArchivedV1 -> {
                Decision.OK.also { archived = true }
            }

            // A person makes the task active again; the newest of the two events wins (openspec task-actions).
            is TaskUnarchivedV1 -> {
                Decision.OK.also { archived = false }
            }

            is TaskStageChangedV1 -> {
                Decision.OK.also { stage = data.to }
            }

            is TaskPausedV1 -> {
                Decision.OK.also {
                    paused = PauseView(data.cause, Hlc.iso(e.hlc), data.resumesAt, data.nextStep, data.needsHuman)
                }
            }

            is TaskResumedV1 -> {
                Decision.OK.also { paused = null }
            }

            is TaskReadyV1 -> {
                Decision.OK.also {
                    ready = ReadyView(if (data.missing.isEmpty()) e.dev else null, data.missing)
                }
            }

            is TaskProgressV1 -> {
                Decision.OK.also { progress = data.text }
            }

            is TaskDoneV1 -> {
                Decision.OK.also { stage = "done" }
            }

            is TaskLearnedV1 -> {
                Decision.OK.also { learned = true }
            }

            is TaskReleasedV1 -> {
                Decision.OK.also { releasedEpoch = data.epoch }
            }

            is ProposalProposedV1 -> {
                Decision.OK.also { proposal = proposal.copy(latest = maxOf(proposal.latest, data.version)) }
            }

            is ResultPostedV1 -> {
                Decision.OK.also { result = data.file }
            }

            is HandoffWrittenV1, is MessageHumanV1, is MessageAgentV1, is MessageSentV1 -> {
                Decision.OK
            }

            is ArtifactAddedV1 -> {
                Decision.OK.also { artifacts.add(data.path) }
            }

            is SessionStartedV1 -> {
                Decision.OK.also {
                    session =
                        SessionView(
                            session = data.session,
                            device = e.dev,
                            host = data.host,
                            state = "running",
                            reason = null,
                            cwd = data.cwd,
                            branch = data.branch,
                            permissionMode = data.permissionMode,
                            agentTeams = data.agentTeams,
                            workIn = data.workIn,
                            name = data.name,
                            terminal = data.terminal?.let { t -> TerminalView(t.window, t.pane) },
                            pid = data.pids.pane,
                        )
                    if (!sessionStarted && branch == null) branch = data.branch
                    sessionStarted = true
                    startFailure = null
                }
            }

            is SessionResumedV1 -> {
                Decision.OK.also {
                    // The same session keeps its values; another session has none known.
                    val same = session?.takeIf { current -> current.session == data.session }
                    // A resume names its new pane (agent-pushes-updates); "Resume again" names none.
                    val terminal = data.terminal?.let { t -> TerminalView(t.window, t.pane) }
                    session =
                        same?.copy(
                            device = e.dev,
                            state = "running",
                            reason = null,
                            terminal = terminal ?: same.terminal,
                            pid = data.pids?.pane ?: same.pid,
                        ) ?: SessionView(
                            data.session,
                            e.dev,
                            "unknown",
                            "running",
                            null,
                            terminal = terminal,
                            pid = data.pids?.pane,
                        )
                }
            }

            // A request of a person; the session device acts on it (openspec session-options).
            is SessionStopRequestedV1 -> {
                if (isHuman(e.by)) Decision.OK else Decision.reject("not_human")
            }

            is SessionEndedV1 -> {
                val current = session
                if (current?.session != data.session) {
                    Decision.reject("unknown_session")
                } else {
                    session = current.copy(state = "ended", reason = data.reason)
                    Decision.OK
                }
            }

            is CommentAddedV1 -> {
                if (data.kind == "start_failed" && e.by == "aw@${e.dev}") {
                    startFailure = StartFailureView(e.dev, data.text, e.hlc, retrying = false)
                }
                Decision.OK.also { comments.add(CommentView(e.id, e.dev, e.hlc, e.by, data.text, "comment", null)) }
            }

            is GateOpenedV1 -> {
                gateOpened(e, data)
            }

            is GateAnsweredV1 -> {
                gateAnswered(e, data)
            }

            is GateResolvedV1 -> {
                gateResolved(e, data)
            }

            // A known type of another log kind: the reader already refuses it in a task log.
            else -> {
                Decision.reject("wrong_log")
            }
        }
    }

    /** A state event counts only from the owner, also a gate of each kind. */
    private fun mayWriteState(e: AwEvent): Boolean = owner != null && owner == e.dev

    /**
     * An assignee counts from a human, or with the project switch on, from the owner of the parent,
     * and then only as the first assignment of the subtask.
     */
    private fun mayAssign(
        e: AwEvent,
        context: TaskContext,
    ): Boolean {
        if (isHuman(e.by)) return true
        if (assignee != null) return false
        val parent = parent ?: return false
        val project = project ?: return false
        if (context.project(project)?.switches?.assignNewSubtasksToDefaultDevice != true) return false
        return context.ownerAt(parent, OrderKey(e.hlc, e.dev, e.id)) == e.dev
    }

    private fun created(
        e: AwEvent,
        data: TaskCreatedV1,
        context: TaskContext,
    ): Decision {
        if (created != null) return Decision.reject("duplicate_created")
        created = refOf(e)
        createdBy = e.by
        createdKey = data.key
        key = data.key
        project = data.project
        title = data.title
        firstMessage = data.firstMessage
        parent = data.parent
        dependsOn = data.dependsOn
        testServer = data.testServer
        credentials = data.credentials
        links = data.links
        // Before the first claim, the creating device owns the task.
        if (claim == null) owners.add(OrderKey(e.hlc, e.dev, e.id) to e.dev)
        val options = takeOptions(e, data.sessionOptions?.let(::optionsOf))
        if (data.assignee != null) {
            if (!mayAssign(e, context)) return Decision(true, "assignee_ignored")
            assignee = data.assignee
        }
        return if (options) Decision.OK else Decision(true, "session_options_ignored")
    }

    /**
     * Takes the session options of the event when a person wrote it: the newest such event replaces
     * the whole object. Only a person sets them (openspec session-options): an agent never gives a
     * task "skip". Returns false when the event had options that the fold ignored.
     */
    private fun takeOptions(
        e: AwEvent,
        options: SessionOptionsView?,
    ): Boolean {
        if (options == null) return true
        if (!isHuman(e.by)) return false
        sessionOptions = options
        return true
    }

    private fun gateOpened(
        e: AwEvent,
        data: GateOpenedV1,
    ): Decision {
        val old = gates[data.gate]
        if (old != null && data.version <= old.version) return Decision.reject("stale_version")
        // The pending answers of the older version become comments.
        old?.answers?.filter { it.use == "pending" }?.forEach { toComment(it, data.gate) }
        gates[data.gate] = GateState(data, refOf(e), old?.answers ?: mutableListOf())
        return Decision.OK
    }

    private fun gateAnswered(
        e: AwEvent,
        data: GateAnsweredV1,
    ): Decision {
        val answer = AnswerState(refOf(e), e.by, data.version, data.answer, data.comment, "pending")
        val gate = gates[data.gate]
        if (gate == null) {
            toComment(answer, data.gate)
            return Decision(true, "gate_unknown")
        }
        gate.answers.add(answer)
        if (gate.state != "open" || data.version != gate.version) {
            toComment(answer, data.gate)
            return Decision(true, if (gate.state == "open") "old_version" else "late_answer")
        }
        return Decision.OK
    }

    private fun gateResolved(
        e: AwEvent,
        data: GateResolvedV1,
    ): Decision {
        val gate = gates[data.gate] ?: return Decision.reject("gate_unknown")
        if (gate.state != "open") return Decision.reject("already_resolved")
        if (data.version != gate.version) return Decision.reject("stale_version")
        resolve(gate, data.answer, data.answerEvent, e.dev)
        if (gate.kind == "approve_proposal" && APPROVE.containsMatchIn(data.answer)) {
            // A version number above the safe integers of JavaScript counts as no version (as in TypeScript).
            val version =
                PROPOSAL_FILE
                    .find(gate.file.orEmpty())
                    ?.groupValues
                    ?.get(1)
                    ?.toLongOrNull()
                    ?.takeIf { it <= MAX_SAFE_INTEGER }
            proposal = proposal.copy(approved = version ?: proposal.latest)
        }
        return Decision.OK
    }

    private fun resolve(
        gate: GateState,
        answer: String,
        answerEvent: String?,
        by: String,
    ) {
        gate.state = "resolved"
        gate.answer = answer
        gate.answerEvent = answerEvent
        gate.resolvedBy = by
        for (item in gate.answers) {
            if (item.use != "pending") continue
            if (item.ref.event == answerEvent) item.use = "used" else toComment(item, gate.gate)
        }
    }

    private fun toComment(
        answer: AnswerState,
        gate: String,
    ) {
        answer.use = "comment"
        val text = if (answer.comment.isNullOrEmpty()) answer.answer else "${answer.answer}\n\n${answer.comment}"
        comments.add(
            CommentView(answer.ref.event, answer.ref.dev, answer.ref.hlc, answer.by, text, "late_answer", gate),
        )
    }

    /**
     * Why the task is in the "Needs you" lane. Only an active task is in the lane: an open gate of a
     * done or archived task stays in `needs_you` and `gates`, but it is no reason.
     */
    private fun needsYouReasons(open: List<GateView>): List<NeedsYouReason> {
        val active = created != null && stage != "done" && !archived
        if (!active) return emptyList()
        val reasons = mutableListOf<NeedsYouReason>()
        open.forEach { g -> reasons.add(NeedsYouReason.Gate(g.gate, g.kind, g.answers.any { it.use == "pending" })) }
        if (assignee == null) reasons.add(NeedsYouReason.Assign)
        paused?.takeIf { it.needsHuman }?.let { reasons.add(NeedsYouReason.Paused(it.cause)) }
        return reasons
    }

    /**
     * The view of the task. The fields that need other tasks (key state, subtasks, open dependencies,
     * includes) get their values in the view assembly.
     */
    fun toView(): TaskView {
        val gateViews = gates.values.map { it.view() }
        val open = gateViews.filter { it.state == "open" }
        val reasons = needsYouReasons(open)
        return TaskView(
            id = id,
            key = key,
            createdKey = createdKey,
            keyState = "ok",
            rekeyBy = null,
            project = project,
            title = title,
            firstMessage = firstMessage,
            priority = priority,
            stage = stage,
            needsYou = open.map { it.gate },
            needsYouReasons = reasons,
            needsYouLane = reasons.isNotEmpty(),
            paused = paused,
            assignee = assignee,
            owner = owner,
            created = created,
            createdBy = createdBy,
            sessionOptions = sessionOptions,
            startFailure = startFailure,
            claim = claim,
            movingTo = movingTo,
            releasedEpoch = releasedEpoch,
            proposal = proposal,
            ready = ready,
            testServer = testServer,
            credentials = credentials,
            parent = parent,
            subtasks = emptyList(),
            dependsOn = dependsOn,
            openDependencies = emptyList(),
            links = links,
            branch = branch,
            session = session,
            progress = progress,
            result = result,
            artifacts = artifacts.toList(),
            learned = learned,
            archived = archived,
            gates = gateViews,
            comments =
                comments.sortedWith {
                    a,
                    b,
                    ->
                    compareOrder(OrderKey(a.hlc, a.dev, a.event), OrderKey(b.hlc, b.dev, b.event))
                },
            includes = emptyMap(),
            lastHlc = last?.hlc,
            eventCount = eventCount,
        )
    }
}

private fun optionsOf(o: TaskCreatedV1.SessionOptions) =
    optionsView(o.permissionMode, o.agentTeams, o.workIn, o.folder, o.switchBranch)

private fun optionsOf(o: TaskAssignedV1.SessionOptions) =
    optionsView(o.permissionMode, o.agentTeams, o.workIn, o.folder, o.switchBranch)

/** The folder counts only for `work_in: folder`. */
private fun optionsView(
    permissionMode: String?,
    agentTeams: Boolean,
    workIn: String,
    folder: String?,
    switchBranch: Boolean,
) = SessionOptionsView(permissionMode, agentTeams, workIn, if (workIn == "folder") folder else null, switchBranch)
