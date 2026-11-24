package com.agentworkspace.control

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** One decision of a gate, with its recommended option (`gate.opened` `data.decisions`). */
data class GateDecision(
    val question: String,
    val options: List<String>,
    val recommended: String,
)

/** The answer of the decision picks: "Request changes" with one line for each changed decision. */
data class DecisionsAnswer(
    val answer: String,
    val comment: String,
)

/** One option of a gate question (`gate.opened` `data.questions[].options[]`, gate-context). */
data class GateQuestionOption(
    val label: String,
    val description: String,
)

/** One question of a gate with its header, its multi-select value and its options (gate-context). */
data class GateQuestion(
    val question: String,
    val header: String?,
    val multiSelect: Boolean,
    val options: List<GateQuestionOption>,
)

/** How a card shows the questions: none, one-click buttons, or a list with "Send answers". */
enum class QuestionMode { NONE, BUTTONS, LIST }

/** One event of a thread, as the context rule reads it (gate-context). */
data class ContextEvent(
    val id: String,
    val type: String,
    /** The actor, for example `human@pixel-9` or `claude@ubuntu-01`. */
    val by: String?,
    val text: String?,
)

/**
 * The text of a gate with decisions (openspec gate-full-context, design decision 4). awd appends the
 * decisions to the gate text as a Markdown block; the card shows the decisions as a list and cuts
 * that block. TypeScript: `@aw/client/gates`. Both run `contracts/fixtures/gates/cases.json`.
 */
object GateTexts {
    /** The start of the decision block of awd (`gateText` in daemon/src/loop/agent.ts). */
    const val DECISIONS_HEADING = "\n\n## Decisions\n"

    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    /** The decisions of `gate.opened` data; a decision of another form is left out. */
    fun decisions(data: JsonObject?): List<GateDecision> =
        (data?.get("decisions") as? JsonArray).orEmpty().mapNotNull { item ->
            val d = item as? JsonObject ?: return@mapNotNull null
            val question = d.text("question") ?: return@mapNotNull null
            val recommended = d.text("recommended") ?: return@mapNotNull null
            val options =
                (d["options"] as? JsonArray)?.map {
                    (it as? JsonPrimitive)
                        ?.takeIf { p ->
                            p.isString
                        }?.contentOrNull
                }
            if (options == null || options.any { it == null }) return@mapNotNull null
            GateDecision(question, options.filterNotNull(), recommended)
        }

    // ---- Decision picks (openspec task-review-layout, design decision 4). TS: @aw/client/gates. ----

    /** The option that makes the agent write a new approach, and the answer of the decision picks. */
    const val REQUEST_CHANGES = "Request changes"

    /** True when the person can pick the decisions of a gate: the gate has the option "Request changes". */
    fun canPickDecisions(options: List<String>): Boolean =
        options.any { it.trim().equals(REQUEST_CHANGES, ignoreCase = true) }

    /**
     * The answer for the decision picks of a gate, or null when each pick is the recommended option
     * (the gate then gets its recommended option, for example "Confirm"). `picks[i]` is the option
     * label picked for decision i; a missing pick or a label that is not an option counts as the
     * recommended option. `contracts/fixtures/gates/decisions-answer.json`.
     */
    fun decisionsAnswer(
        decisions: List<GateDecision>,
        picks: List<String>,
    ): DecisionsAnswer? {
        val changed =
            decisions.mapIndexedNotNull { i, d ->
                val pick = picks.getOrNull(i)
                if (pick != null && pick != d.recommended && pick in d.options) "- ${d.question}: $pick" else null
            }
        if (changed.isEmpty()) return null
        val lines = mutableListOf("My choices for the decisions:")
        lines += changed
        if (changed.size < decisions.size) lines += "Keep the recommended option of the other decisions."
        return DecisionsAnswer(REQUEST_CHANGES, lines.joinToString("\n"))
    }

    /**
     * The status line under the decision picks, as the desktop `DecisionList`: how many picks differ
     * from the recommendation and what "Send my choices" does.
     */
    fun picksLine(
        decisions: List<GateDecision>,
        picks: List<String>,
    ): String {
        val differ = decisions.indices.count { i -> picks.getOrNull(i) != decisions[i].recommended }
        if (differ == 0) return "All picks are the recommended options."
        val verb = if (differ == 1) "pick differs" else "picks differ"
        return "$differ $verb from the recommendation. “Send my choices” asks the agent for a new " +
            "approach with your picks."
    }

    /** The text with no decision block when the gate has decisions to show; else the text. */
    fun body(
        text: String,
        decisions: List<GateDecision>,
    ): String {
        if (decisions.isEmpty()) return text
        val at = text.lastIndexOf(DECISIONS_HEADING)
        return if (at < 0) text else text.substring(0, at)
    }

    // ---- Question details, context and questions (openspec gate-context). TS: @aw/client/gates. ----

    /** The text of a question with no pick (the Claude Code AskUserQuestion result, 2.1.331). */
    const val NO_PICK = "(no option selected)"

    /** The most messages that the context of a gate shows. */
    const val MAX_CONTEXT_MESSAGES = 5

    private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    /** The questions of `gate.opened` data; a question of another form is left out. */
    fun questions(data: JsonObject?): List<GateQuestion> =
        (data?.get("questions") as? JsonArray).orEmpty().mapNotNull { item ->
            val q = item as? JsonObject ?: return@mapNotNull null
            val question = q["question"].string() ?: return@mapNotNull null
            val options = q["options"] as? JsonArray ?: return@mapNotNull null
            GateQuestion(
                question = question,
                header = q["header"].string(),
                multiSelect = (q["multi_select"] as? JsonPrimitive)?.contentOrNull == "true",
                options =
                    options.mapNotNull { o ->
                        val option = o as? JsonObject ?: return@mapNotNull null
                        val label = option["label"].string() ?: return@mapNotNull null
                        GateQuestionOption(label, option["description"].string().orEmpty())
                    },
            )
        }

    /**
     * The index of the recommended option of a question gate: the first label that contains
     * "(Recommended)" in any case (the AskUserQuestion rule of Claude Code), else 0; -1 with no
     * options. The card shows it as the filled button. TypeScript: `recommendedOption`. Cases:
     * `contracts/fixtures/gates/recommended.json`.
     */
    fun recommended(options: List<String>): Int {
        if (options.isEmpty()) return -1
        val at = options.indexOfFirst { it.contains("(recommended)", ignoreCase = true) }
        return if (at < 0) 0 else at
    }

    /** One single-choice question: buttons; several questions or a multi-select one: a list. */
    fun mode(questions: List<GateQuestion>): QuestionMode =
        when {
            questions.isEmpty() -> QuestionMode.NONE
            questions.size == 1 && !questions[0].multiSelect -> QuestionMode.BUTTONS
            else -> QuestionMode.LIST
        }

    /**
     * The answer of a question list: `"<question>"="<labels>"` for each question, joined by ", ";
     * the labels in the order of the options. The format of the AskUserQuestion tool result of
     * Claude Code 2.1.331. `picks[i]` are the labels picked for question i.
     */
    fun answer(
        questions: List<GateQuestion>,
        picks: List<List<String>>,
    ): String =
        questions
            .mapIndexed { i, q ->
                val chosen = q.options.map { it.label }.filter { it in picks.getOrElse(i) { emptyList() } }
                if (chosen.isEmpty()) {
                    "\"${q.question}\"=$NO_PICK"
                } else {
                    "\"${q.question}\"=\"${chosen.joinToString(
                        ", ",
                    )}\""
                }
            }.joinToString(", ")

    /** The text that the Claude plugin writes for the questions of AskUserQuestion. */
    fun listing(questions: List<GateQuestion>): String =
        questions.joinToString("\n\n") { q ->
            if (q.options.isEmpty()) {
                q.question
            } else {
                "${q.question}\nOptions: ${q.options.joinToString(" | ") { it.label }}"
            }
        }

    /** True when the gate text says more than its title and the listing of its questions. */
    fun hasBody(
        title: String,
        text: String,
        questions: List<GateQuestion> = emptyList(),
    ): Boolean {
        val body = text.trim()
        if (body.isEmpty() || body == title.trim()) return false
        return questions.isEmpty() || body != listing(questions).trim()
    }

    /**
     * The context of a gate with no body: the `message.agent` events after the last event of a
     * person (`by` = `human@…`) before the `gate.opened` event [gateEvent], oldest first, at most
     * [MAX_CONTEXT_MESSAGES] (the newest). [events] are in merge order.
     */
    fun context(
        events: List<ContextEvent>,
        gateEvent: String,
    ): List<ContextEvent> {
        val at = events.indexOfFirst { it.id == gateEvent }
        if (at < 0) return emptyList()
        return events
            .subList(0, at)
            .asReversed()
            .takeWhile { it.by?.startsWith("human@") != true }
            .filter { it.type == "message.agent" && !it.text.isNullOrEmpty() }
            .take(MAX_CONTEXT_MESSAGES)
            .asReversed()
    }
}
