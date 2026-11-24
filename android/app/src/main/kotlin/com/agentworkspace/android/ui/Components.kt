package com.agentworkspace.android.ui

import android.content.ClipData
import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentworkspace.android.R
import com.agentworkspace.control.CardStatus
import com.agentworkspace.control.CommentRule
import com.agentworkspace.control.GateCard
import com.agentworkspace.control.GateRules
import com.agentworkspace.control.GateTexts
import com.agentworkspace.control.PauseChip
import com.agentworkspace.control.QuestionMode
import com.agentworkspace.control.TaskRowState
import kotlinx.coroutines.launch

/** The widest a form, a card or a sheet grows on a wide window (docs/phase-1.md 10.8). */
val MaxContentWidth = 720.dp

/** The color of the secondary texts. */
@Composable
fun muted() = MaterialTheme.colorScheme.onSurfaceVariant

/** A card with the maximum width and the list padding. */
fun Modifier.listCard(): Modifier =
    fillMaxWidth().widthIn(max = MaxContentWidth).padding(horizontal = 16.dp, vertical = 6.dp)

@Composable
fun AwIcon(
    @DrawableRes id: Int,
    description: String?,
) = Icon(painterResource(id), contentDescription = description)

@Composable
fun SectionHeader(text: String) =
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
    )

@Composable
fun EmptyText(text: String) =
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(16.dp),
    )

@Composable
fun PauseChipView(chip: PauseChip) =
    AssistChip(
        onClick = {},
        label = { Text(chip.text) },
    )

/**
 * One task row. A click opens the task. A long press and a secondary (right) click open the same
 * menu: Open, Copy task key, Sync now (docs/phase-1.md 10.10). The row is focusable, so the arrow
 * keys move between rows and Enter opens one.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TaskRow(
    row: TaskRowState,
    selected: Boolean,
    onOpen: () -> Unit,
    onSyncNow: () -> Unit,
) {
    var menu by rememberSaveable { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    Box {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .pointerInput(row.id) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent()
                                if (event.type == PointerEventType.Press && event.buttons.isSecondaryPressed) {
                                    event.changes.forEach { it.consume() }
                                    menu = true
                                }
                            }
                        }
                    }.combinedClickable(
                        role = Role.Button,
                        onClickLabel = "Open",
                        onLongClickLabel = "Menu",
                        onClick = onOpen,
                        onLongClick = { menu = true },
                    ).padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    row.label,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (selected) MaterialTheme.colorScheme.primary else muted(),
                )
                Text(row.stageLabel, style = MaterialTheme.typography.labelSmall, color = muted())
                row.assignee?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = muted())
                }
            }
            Text(
                row.title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            row.reason?.let {
                Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.tertiary)
            }
            row.pause?.let { PauseChipView(it) }
            row.queue?.let { QueueChipView(it, row.queueCause) }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text("Open") }, onClick = {
                menu = false
                onOpen()
            })
            DropdownMenuItem(text = { Text("Copy task key") }, onClick = {
                menu = false
                scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Task key", row.label))) }
            })
            DropdownMenuItem(text = { Text("Sync now") }, onClick = {
                menu = false
                onSyncNow()
            })
        }
    }
}

/**
 * A gate card, acted on in place: one button per option, a comment when the option needs one, and a
 * free-text answer for a question or a reply. After an answer it shows "Answer sent, waiting for
 * <owner>" until the owner device resolves the gate.
 */
@Composable
fun GateCardView(
    card: GateCard,
    /** [sent] runs only when the answer was written: a refused answer keeps the typed text (review L2). */
    onAnswer: (answer: String, comment: String?, sent: () -> Unit) -> Unit,
) {
    var text by rememberSaveable(card.gate.gate) { mutableStateOf("") }
    var comment by rememberSaveable(card.gate.gate) { mutableStateOf("") }
    var chosen by rememberSaveable(card.gate.gate) { mutableStateOf<String?>(null) }
    // The gate card of the prototype: the raised surface with a line in the accent (docs/design.md 8).
    Card(
        modifier = Modifier.listCard(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = GATE_LINE_ALPHA)),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "${card.taskLabel} · ${card.label}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            if (card.title.isNotBlank()) Text(card.title, style = MaterialTheme.typography.titleMedium)
            // The details as Markdown, or the agent messages before a gate with no details
            // (openspec gate-context, polish-prototype-style).
            if (card.text.isNotBlank()) ClampedText(card.text, "${card.gate.gate}:text")
            if (card.context.isNotEmpty()) {
                Text("Context", style = MaterialTheme.typography.labelMedium)
                for (message in card.context) {
                    Text(message.by.orEmpty(), style = MaterialTheme.typography.labelSmall)
                    ClampedText(message.text.orEmpty(), message.id)
                }
            }
            DecisionsView(card.decisions)
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
                        // A question or a reply: one full-width button per option, stacked; the
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
                    if (card.freeText) {
                        MessageField(
                            value = text,
                            onValueChange = { text = it },
                            label = card.freeTextLabel,
                            onSend = {
                                onAnswer(text, null) { text = "" }
                            },
                        )
                    }
                }
            }
        }
    }
}

/** The assign card and "Assign to another device…": one button per `agent@device` choice. */
@Composable
fun AssignCard(
    title: String,
    choices: List<String>,
    onAssign: (String) -> Unit,
) {
    Card(modifier = Modifier.listCard()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.labelLarge)
            if (choices.isEmpty()) Text("No device of this project can run an agent.")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (choice in choices) OutlinedButton(onClick = { onAssign(choice) }) { Text(choice) }
            }
        }
    }
}

/** A text field that sends on Enter (Shift+Enter is a new line) and with its send button. */
@Composable
fun MessageField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            enabled = enabled,
            modifier = Modifier.weight(1f).sendOnEnter { if (value.isNotBlank()) onSend() },
        )
        androidx.compose.material3.IconButton(enabled = enabled && value.isNotBlank(), onClick = onSend) {
            AwIcon(R.drawable.ic_send, "Send")
        }
    }
}

/** A warning card with an action button, for example the battery mode "Restricted". */
@Composable
fun WarningCard(
    text: String,
    action: String,
    onAction: () -> Unit,
) {
    Card(
        modifier = Modifier.listCard(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(text, color = MaterialTheme.colorScheme.onErrorContainer)
            Button(onClick = onAction) { Text(action) }
        }
    }
}

/** The alpha of the accent line of a gate card (40 %, as on the desktop). */
private const val GATE_LINE_ALPHA = 0.4f
