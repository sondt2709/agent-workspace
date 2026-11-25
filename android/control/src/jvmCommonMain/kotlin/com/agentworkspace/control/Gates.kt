package com.agentworkspace.control

import com.agentworkspace.shared.merge.GateView

/** What an option of a gate needs: a comment that is required, optional, or none. */
enum class CommentRule { REQUIRED, OPTIONAL, NONE }

/** The rules of the gate cards: the same as `commentRule` and the free-text rule of the desktop app. */
object GateRules {
    fun commentRule(option: String): CommentRule =
        when (option.trim().lowercase()) {
            "request changes", "reject" -> CommentRule.REQUIRED
            "deny" -> CommentRule.OPTIONAL
            else -> CommentRule.NONE
        }

    /** A question, a reply and a gate with no options take a typed answer. */
    fun takesFreeText(gate: GateView): Boolean =
        gate.kind == "question" || gate.kind == "reply" || gate.options.isEmpty()

    fun freeTextLabel(gate: GateView): String = if (gate.kind == "reply") "Your reply" else "Or type your answer"

    /**
     * Checks an answer before the write. Null when it may be sent, else the text for the person.
     * A typed answer must not be empty; an option that needs a comment must have one.
     */
    fun problem(
        gate: GateView,
        answer: String,
        comment: String?,
    ): String? {
        if (gate.state != "open") return "This gate is closed."
        if (answer.isBlank()) return "Write an answer."
        if (gate.options.isNotEmpty() && answer in gate.options) {
            if (commentRule(answer) == CommentRule.REQUIRED && comment.isNullOrBlank()) {
                return "\"$answer\" needs a comment."
            }
            return null
        }
        return if (takesFreeText(gate)) null else "Select one of the options."
    }
}

/** The state of a gate card. */
sealed interface CardStatus {
    /** The gate waits for an answer. */
    data object Open : CardStatus

    /** This phone sent an answer; the owner device has not resolved the gate yet. */
    data class Sent(
        val answer: String,
        val owner: String?,
        val ownerOffline: Boolean,
    ) : CardStatus {
        val text: String
            get() =
                when {
                    owner == null -> "Answer sent"
                    ownerOffline -> "Answer sent. $owner is offline: it gets the answer when it is back."
                    else -> "Answer sent, waiting for $owner"
                }
    }

    /** Another device answered first. */
    data class AnsweredElsewhere(
        val answer: String,
        val device: String,
    ) : CardStatus

    data class Resolved(
        val answer: String?,
    ) : CardStatus
}

/** A gate card: the gate, its texts and its state. */
data class GateCard(
    val task: String,
    val taskLabel: String,
    val gate: GateView,
    val label: String,
    val title: String,
    /**
     * The body of `gate.opened` (the details, the plan, the command) as written; "" when the text says
     * no more than the title (gate-context).
     */
    val text: String,
    /** The questions of `gate.opened` with headers, multi-select and descriptions (gate-context). */
    val questions: List<GateQuestion> = emptyList(),
    /** The agent messages before a question or reply gate with no body (gate-context). */
    val context: List<ContextEvent> = emptyList(),
    val options: List<String>,
    val freeText: Boolean,
    val freeTextLabel: String,
    val status: CardStatus,
)
