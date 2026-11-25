package com.agentworkspace.control

import com.agentworkspace.shared.merge.TaskView

/**
 * What the Activity tab and the Inbox item show (openspec proposal-and-discussion): the late answers,
 * the Assign card and the gate cards with no row in the thread window first, then the rows oldest
 * first. A question, the proposal card and a gate card of another kind take the state of their gate
 * card ("Answer sent") from [cards].
 */
data class ActivityContent(
    val rows: List<ActivityRow>,
    /** The card of each shown gate (open, or with a pending answer of this phone), by gate id. */
    val cards: Map<String, GateCard>,
    /** The shown gates that no row of the thread window has: they show first. */
    val topCards: List<GateCard>,
    val late: List<LateAnswer>,
    /** True when the Assign card shows: the task needs an assignee, or "Assign to another device…". */
    val assign: Boolean,
    val assigning: Boolean,
) {
    /** The index in [rows] of the newest row that needs the person, or null. */
    val needsYouRow: Int? get() = rows.indexOfLast { it.needsYou }.takeIf { it >= 0 }

    /** The rows that need the person, for the Inbox item: an open question, the open proposal, a gate card. */
    val needsYou: List<ActivityRow> get() = rows.filter { it.needsYou && (it.gate == null || it.gate in cards) }

    companion object {
        fun of(
            task: TaskView,
            snapshot: WorkspaceSnapshot,
            thread: ThreadWindow,
            assigning: Boolean = false,
        ): ActivityContent {
            val cards = ScreenStates.gateCards(task, snapshot)
            val inRows = thread.activity.mapNotNull { it.gate }.toSet()
            return ActivityContent(
                rows = thread.activity,
                cards = cards.associateBy { it.gate.gate },
                topCards = cards.filter { it.gate.gate !in inRows },
                late = LateAnswers.of(task, snapshot.phone),
                assign = ScreenStates.needsAssign(task) || assigning,
                assigning = assigning,
            )
        }
    }
}
