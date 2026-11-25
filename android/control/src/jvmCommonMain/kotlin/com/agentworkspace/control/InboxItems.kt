package com.agentworkspace.control

import com.agentworkspace.engine.PeerStatus
import com.agentworkspace.engine.SyncRules
import com.agentworkspace.shared.merge.MergeIssue
import com.agentworkspace.shared.merge.NeedsYouReason
import com.agentworkspace.shared.merge.TaskView

/** What the Inbox rule reads of a task. */
data class InboxTask(
    val id: String,
    val key: String?,
    val title: String,
    val project: String?,
    val stage: String,
    val archived: Boolean,
    val needsYouLane: Boolean,
    val reasons: List<NeedsYouReason>,
    /** The task has a pause chip: a pause, or a session device with no heartbeat. */
    val paused: Boolean,
    /** The task waits in the queue of an agent. */
    val queued: Boolean,
)

/** One row of the "Needs you" tab: the reason, the title and the key. */
data class InboxRow(
    val task: String,
    val reason: String,
    val title: String,
    val key: String,
    val project: String?,
)

/** One group of the Inbox under the rows: "Working now", "Paused" or "Queued". */
data class InboxGroup(
    /** `running`, `paused` or `queued`, as the desktop. */
    val id: String,
    val label: String,
    val tasks: List<InboxTask>,
)

/** A row of the Inbox that is not a task: a file to fix, or a device with changes not synced. */
data class InboxNote(
    val id: String,
    val reason: String,
    val title: String,
    val sub: String,
)

/** The "Needs you" tab: the rows, then the groups. */
data class InboxState(
    val rows: List<InboxRow>,
    val groups: List<InboxGroup>,
)

/**
 * The Inbox of the phone (openspec proposal-and-discussion, design decision 8): the rule of the
 * desktop `inboxItems` and `listGroups`, tested with `contracts/fixtures/inbox/items.json`. The rows
 * and the groups keep the order of the tasks that the caller gives.
 */
object InboxItems {
    private val ASKS = setOf("question", "reply")

    /** The reason of a task in the lane, as the Inbox row shows it. */
    fun reason(task: InboxTask): String =
        when (val reason = task.reasons.firstOrNull()) {
            null -> "Needs you"
            is NeedsYouReason.Gate -> if (reason.kind in ASKS) "Reply to a question" else Texts.gateLabel(reason.kind)
            NeedsYouReason.Assign -> "Assign task"
            is NeedsYouReason.Paused -> "Paused: ${Texts.pauseText(reason.cause)}"
        }

    fun of(tasks: List<InboxTask>): InboxState {
        val active = tasks.filter { !it.archived }
        val rows =
            active.filter { it.needsYouLane }.map { task ->
                InboxRow(task.id, reason(task), task.title, Texts.taskLabel(task.id, task.key), task.project)
            }
        val rest = active.filter { !it.needsYouLane }
        val paused = rest.filter { it.paused }
        val queued = rest.filter { !it.paused && it.queued }
        val running = rest.filter { !it.paused && !it.queued && it.stage != "done" && it.stage != "backlog" }
        val groups =
            listOf(
                InboxGroup("running", "Working now", running),
                InboxGroup("paused", "Paused", paused),
                InboxGroup("queued", "Queued", queued),
            ).filter { it.tasks.isNotEmpty() }
        return InboxState(rows, groups)
    }

    /** The files to fix of "Needs you": each document that fails its schema, as the desktop `badFiles`. */
    fun files(issues: List<MergeIssue>): List<InboxNote> =
        issues
            .filter { it.code == "bad_document" }
            .map { InboxNote("file:${it.path}", "Fix a file", it.path, it.message) }

    /** "Updates": each device that is offline and has changes of this phone to get. */
    fun updates(
        peers: List<PeerStatus>,
        nowMs: Long,
    ): List<InboxNote> =
        peers
            .filter { !it.connected && it.needItems > 0 }
            .map {
                InboxNote(
                    "sync:${it.device}",
                    "Not synced",
                    "${it.device}: ${SyncRules.describe(it, nowMs)}",
                    "The changes go to the device when both devices are online.",
                )
            }

    /** The Inbox task of a task view, from the snapshot of the phone. */
    fun taskOf(
        task: TaskView,
        snapshot: WorkspaceSnapshot,
    ): InboxTask {
        val row = ScreenStates.row(task, snapshot)
        return InboxTask(
            id = task.id,
            key = task.key,
            title = row.title,
            project = task.project,
            stage = task.stage,
            archived = task.archived,
            needsYouLane = task.needsYouLane,
            reasons = task.needsYouReasons,
            paused = row.pause != null,
            queued = row.queue != null,
        )
    }

    /** The Inbox of a snapshot: the tasks of the lane in the order of [ScreenStates.inbox], then the others. */
    fun of(snapshot: WorkspaceSnapshot): InboxState {
        val order = ScreenStates.inbox(snapshot).map { it.id }
        val lane = order.mapNotNull { snapshot.task(it) }
        val others =
            snapshot.tasks
                .filter { !it.archived && !it.needsYouLane }
                .sortedByDescending { it.lastHlc.orEmpty() }
        return of((lane + others).map { taskOf(it, snapshot) })
    }
}
