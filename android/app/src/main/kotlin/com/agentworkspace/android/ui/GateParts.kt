package com.agentworkspace.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.agentworkspace.android.R
import com.agentworkspace.control.ActivityRule
import com.agentworkspace.control.CardStatus
import com.agentworkspace.control.CommentRule
import com.agentworkspace.control.GateCard
import com.agentworkspace.control.GateQuestion
import com.agentworkspace.control.GateRules
import com.agentworkspace.control.GateTexts
import com.agentworkspace.control.QuestionMode

// The parts of a gate card for question details, context and questions (openspec gate-context).

/** A text of a gate card as Markdown: 6 lines and "Show more" (the Activity rule). */
@Composable
internal fun ClampedText(
    text: String,
    key: String,
) {
    var all by rememberSaveable(key) { mutableStateOf(false) }
    val cut = ActivityRule.clamp(text)
    MarkdownText(if (cut.cut && !all) cut.head else text)
    if (cut.cut) {
        TextButton(onClick = { all = !all }) { Text(if (all) "Show less" else "Show more") }
    }
}

/**
 * The text of a gate card as Markdown (openspec task-review-layout, design decision 6): its first
 * 260 dp with a fade, then "Show more" shows the full text in the list, with no scroll box of its own.
 * The proposal card shows its first 240 dp with the text size of the phone (proposal-and-discussion).
 */
@Composable
internal fun GateText(
    text: String,
    key: String,
    height: Dp = GateTextHeight,
    textSize: Dp? = null,
) {
    var all by rememberSaveable(key) { mutableStateOf(false) }
    var full by remember(text, textSize) { mutableIntStateOf(0) }
    val limit = with(LocalDensity.current) { height.roundToPx() }
    val over = full > limit
    val fade = MaterialTheme.colorScheme.surfaceContainer
    Box(if (all) Modifier.fillMaxWidth() else Modifier.fillMaxWidth().heightIn(max = height).clipToBounds()) {
        Box(Modifier.wrapContentHeight(Alignment.Top, unbounded = true).onSizeChanged { full = it.height }) {
            MarkdownText(text, textSize = textSize)
        }
        if (over && !all) {
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(FadeHeight)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, fade))),
            )
        }
    }
    if (over) {
        TextButton(onClick = { all = !all }) { Text(if (all) "Show less" else "Show more") }
    }
}

/** The label of an option button, with its description under it (gate-context). */
@Composable
internal fun OptionText(
    label: String,
    description: String,
) {
    Column(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        if (description.isNotEmpty()) {
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = LocalContentColor.current.copy(alpha = DESCRIPTION_ALPHA),
            )
        }
    }
}

/**
 * One option of a question gate (openspec polish-prototype-style): a full-width button with the
 * label and its description under it. [filled]: the recommended option, filled with the accent;
 * else outlined. [checked] not null: a toggle of a question list, with a check mark and the accent
 * border when picked.
 */
@Composable
internal fun OptionButton(
    label: String,
    description: String,
    onClick: () -> Unit,
    filled: Boolean = false,
    checked: Boolean? = null,
    radio: Boolean = false,
) {
    val modifier =
        Modifier.fillMaxWidth().semantics {
            if (checked != null) {
                role = if (radio) Role.RadioButton else Role.Checkbox
                toggleableState = ToggleableState(checked)
            }
        }
    val padding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
    if (filled) {
        Button(onClick = onClick, modifier = modifier, contentPadding = padding) { OptionText(label, description) }
    } else {
        val on = checked == true
        androidx.compose.material3.OutlinedButton(
            onClick = onClick,
            modifier = modifier.heightIn(min = ControlHeight),
            shape = CompactShape,
            contentPadding = padding,
            border =
                BorderStroke(
                    1.dp,
                    if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                ),
            colors =
                ButtonDefaults.outlinedButtonColors(
                    containerColor = if (on) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                ),
        ) {
            Box(Modifier.weight(1f)) { OptionText(label, description) }
            if (on) AwIcon(R.drawable.ic_check, null)
        }
    }
}

/**
 * The questions of a gate with several questions or a multi-select one (gate-context): each
 * question with its header and its options as chips, and "Send answers" with the answer text of
 * [GateTexts.answer] (the format of the AskUserQuestion result of Claude Code).
 */
@Composable
internal fun QuestionListView(
    gate: String,
    questions: List<GateQuestion>,
    onSend: (String) -> Unit,
) {
    var picks by rememberSaveable(gate) { mutableStateOf(questions.map { emptyList<String>() }) }
    for ((i, q) in questions.withIndex()) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val head = listOfNotNull(q.header, q.question).joinToString(" · ")
            Text(head, style = MaterialTheme.typography.titleSmall)
            if (q.multiSelect) Text("Select one or more.", style = MaterialTheme.typography.labelSmall)
            for (option in q.options) {
                val on = option.label in picks[i]
                OptionButton(
                    label = option.label,
                    description = option.description,
                    checked = on,
                    radio = !q.multiSelect,
                    onClick = {
                        picks =
                            picks.mapIndexed { j, p ->
                                when {
                                    j != i -> p
                                    !q.multiSelect -> listOf(option.label)
                                    on -> p - option.label
                                    else -> p + option.label
                                }
                            }
                    },
                )
            }
        }
    }
    Button(
        enabled = picks.any { it.isNotEmpty() },
        onClick = { onSend(GateTexts.answer(questions, picks)) },
    ) { Text("Send answers") }
}

/**
 * The details of a gate as Markdown, or the agent messages before a gate with no details (openspec
 * gate-context, polish-prototype-style).
 */
@Composable
internal fun GateBody(card: GateCard) {
    if (card.text.isNotBlank()) GateText(card.text, "${card.gate.gate}:text")
    if (card.context.isNotEmpty()) {
        Text("Context", style = MaterialTheme.typography.labelMedium)
        for (message in card.context) {
            Text(message.by.orEmpty(), style = MaterialTheme.typography.labelSmall)
            ClampedText(message.text.orEmpty(), message.id)
        }
    }
}

/**
 * The state and the answer controls of a gate: "Answer sent", the answer of another device, or the
 * option buttons of 48 dp, the comment of an option that needs one, and the free-text field.
 */
@Composable
internal fun GateAnswerControls(
    card: GateCard,
    onAnswer: (answer: String, comment: String?, sent: () -> Unit) -> Unit,
    freeTextLabel: String = card.freeTextLabel,
    /** The free-text field of a question or a reply: off where the message box answers. */
    freeText: Boolean = card.freeText,
) {
    var text by rememberSaveable(card.gate.gate) { mutableStateOf("") }
    var comment by rememberSaveable(card.gate.gate) { mutableStateOf("") }
    var chosen by rememberSaveable(card.gate.gate) { mutableStateOf<String?>(null) }
    when (val status = card.status) {
        is CardStatus.Sent -> {
            Text(status.text, color = MaterialTheme.colorScheme.primary)
        }

        is CardStatus.AnsweredElsewhere -> {
            Text("${status.device} answered: ${status.answer}")
        }

        is CardStatus.Resolved -> {
            Text("Resolved: ${status.answer.orEmpty()}")
        }

        CardStatus.Open -> {
            val mode = GateTexts.mode(card.questions)
            if (mode == QuestionMode.LIST) {
                QuestionListView(card.gate.gate, card.questions) { answer -> onAnswer(answer, null) {} }
            }
            val options = card.options.takeIf { mode != QuestionMode.LIST }.orEmpty()
            val recommended = GateTexts.recommended(options)
            if (card.freeText) {
                // A question or a reply: one full-width button of 48 dp per option, stacked; the
                // recommended option is filled (openspec polish-prototype-style).
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    options.forEachIndexed { i, option ->
                        val description =
                            card.questions
                                .takeIf { mode == QuestionMode.BUTTONS }
                                ?.first()
                                ?.options
                                ?.firstOrNull { it.label == option }
                                ?.description
                                .orEmpty()
                        val rule = GateRules.commentRule(option)
                        OptionButton(
                            label = option,
                            description = description,
                            filled = i == recommended && rule == CommentRule.NONE,
                            onClick = {
                                if (rule == CommentRule.NONE) onAnswer(option, null) {} else chosen = option
                            },
                        )
                    }
                }
            } else {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    options.forEachIndexed { i, option ->
                        val rule = GateRules.commentRule(option)
                        if (rule == CommentRule.NONE && i == recommended) {
                            Button(onClick = { onAnswer(option, null) {} }) { Text(option) }
                        } else if (rule == CommentRule.NONE) {
                            OutlinedButton(onClick = { onAnswer(option, null) {} }) { Text(option) }
                        } else {
                            OutlinedButton(onClick = { chosen = option }) { Text(option) }
                        }
                    }
                }
            }
            chosen?.let { option ->
                val required = GateRules.commentRule(option) == CommentRule.REQUIRED
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    label = { Text(if (required) "Comment (required)" else "Comment (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = !required || comment.isNotBlank(),
                        onClick = { onAnswer(option, comment.ifBlank { null }) {} },
                    ) { Text("Send \"$option\"") }
                    TextButton(onClick = { chosen = null }) { Text("Cancel") }
                }
            }
            if (freeText) {
                MessageField(
                    value = text,
                    onValueChange = { text = it },
                    label = freeTextLabel,
                    onSend = {
                        onAnswer(text, null) { text = "" }
                    },
                )
            }
        }
    }
}

/** The start of a long gate text that a card shows before "Show more" (the desktop shows 240 px). */
private val GateTextHeight = 260.dp

/** The height of the fade at the end of a cut gate text. */
private val FadeHeight = 48.dp

/** The alpha of an option description under its label. */
private const val DESCRIPTION_ALPHA = 0.8f
