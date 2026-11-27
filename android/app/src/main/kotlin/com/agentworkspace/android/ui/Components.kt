package com.agentworkspace.android.ui

import android.content.ClipData
import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.agentworkspace.control.GateCard
import com.agentworkspace.control.PauseChip
import com.agentworkspace.control.TaskPageLayout
import com.agentworkspace.control.TaskRowState
import kotlinx.coroutines.launch

/**
 * The widest a form, a card, the content of a task tab or the message box grows on a wide window
 * (docs/phase-1.md 10.8): 840 dp keeps about 90 characters a line (openspec task-review-layout).
 */
val MaxContentWidth = TaskPageLayout.CONTENT_MAX_DP.dp

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

/** A section label of the desktop (docs/design.md 3 `label`): 12 sp, weight 510, in `text3`. */
@Composable
fun SectionHeader(text: String) =
    Text(
        text,
        style = AwType.label,
        color = muted(),
        modifier =
            Modifier
                .fillMaxWidth()
                .widthIn(max = MaxContentWidth)
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
    )

@Composable
fun EmptyText(text: String) =
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().widthIn(max = MaxContentWidth).padding(16.dp),
    )

@Composable
fun PauseChipView(chip: PauseChip) = StateChip(chip.text, ChipTone.WAIT)

/** The width of the accent mark of a selected row (docs/design.md 8.4). */
private val SELECTED_MARK = 2.dp

/**
 * One task row (docs/design.md 8.4, openspec phone-desktop-parity): the status icon of the stage, the
 * key in the monospace font, the title on one line, then one wrapping line with the chips, the queue
 * text and "<assignee> · <age>". A click opens the task. A long press and a secondary (right) click
 * open the same menu: Open, Copy task key, Sync now (docs/phase-1.md 10.10). The row is focusable, so
 * the arrow keys move between rows and Enter opens one. The selected row has the `selected` fill and
 * a 2 dp accent mark.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TaskRow(
    row: TaskRowState,
    selected: Boolean,
    onOpen: () -> Unit,
    onSyncNow: () -> Unit,
    age: String? = null,
) {
    var menu by rememberSaveable { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val mark = MaterialTheme.colorScheme.primary
    Box {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .then(
                        if (selected) {
                            Modifier.background(selectedColor()).drawBehind {
                                drawRect(mark, size = Size(SELECTED_MARK.toPx(), size.height))
                            }
                        } else {
                            Modifier
                        },
                    ).pointerInput(row.id) {
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
                    ).heightIn(min = TouchHeight)
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StageIcon(row.stage, Modifier.padding(top = 3.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        row.label,
                        style = AwType.meta.copy(fontFamily = MonoFont),
                        color = if (selected) MaterialTheme.colorScheme.primary else muted(),
                    )
                    Text(
                        row.title,
                        style = AwType.bodyStrong,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) {
                    row.reason?.let { StateChip(it.removePrefix("Needs you: "), ChipTone.YOU) }
                    if (row.running) StateChip("Running", ChipTone.RUN)
                    row.pause?.let { PauseChipView(it) }
                    // One text that wraps at word boundaries (the cause never gets the width of one letter).
                    row.queueLine?.let { Text(it, style = AwType.meta, color = waitColor()) }
                    val meta = listOfNotNull(row.assignee, age).joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = AwType.meta, color = muted())
                }
            }
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
 * <owner>" until the owner device resolves the gate. A gate card shows no decisions (openspec
 * proposal-and-discussion).
 */
@Composable
fun GateCardView(
    card: GateCard,
    /** [sent] runs only when the answer was written: a refused answer keeps the typed text (review L2). */
    onAnswer: (answer: String, comment: String?, sent: () -> Unit) -> Unit,
) {
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
            GateBody(card)
            GateAnswerControls(card, onAnswer)
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

/**
 * The message box of the desktop (openspec phone-desktop-parity): the [label], the field of 2 lines,
 * then one line with the [hint] and the Send button at the right. Enter sends; Shift+Enter is a new line.
 */
@Composable
fun MessageField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    placeholder: String? = null,
    /** The focus of the field: "Discuss" of the proposal puts the cursor in it. */
    focusRequester: FocusRequester? = null,
    /** The line under the field, for example "Your message answers the question “…”". */
    hint: String? = null,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = AwType.label, color = muted())
        ControlField(
            value = value,
            onValueChange = onValueChange,
            placeholder = placeholder?.let { { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
            enabled = enabled,
            minLines = MESSAGE_MIN_LINES,
            maxLines = MESSAGE_LINES,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .then(if (focusRequester == null) Modifier else Modifier.focusRequester(focusRequester))
                    .semantics { contentDescription = label }
                    .sendOnEnter { if (value.isNotBlank()) onSend() },
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(hint.orEmpty(), style = AwType.meta, color = muted(), modifier = Modifier.weight(1f))
            val canSend = enabled && value.isNotBlank()
            if (canSend) {
                Button(onClick = onSend) { Text("Send") }
            } else {
                OutlinedButton(enabled = false, onClick = onSend) { Text("Send") }
            }
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

/** The most lines that the message box grows to before it scrolls. */
private const val MESSAGE_LINES = 5

/** The height of the empty message box: 2 lines, as on the desktop. */
private const val MESSAGE_MIN_LINES = 2

/** The alpha of the accent line of a gate card (40 %, as on the desktop). */
private const val GATE_LINE_ALPHA = 0.4f
