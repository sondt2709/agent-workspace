package com.agentworkspace.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.dp
import com.agentworkspace.android.R
import com.agentworkspace.control.ActivityRule
import com.agentworkspace.control.GateQuestion
import com.agentworkspace.control.GateTexts

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
            modifier = modifier.heightIn(min = CompactButtonHeight),
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

/** The alpha of an option description under its label. */
private const val DESCRIPTION_ALPHA = 0.8f
