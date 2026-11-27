package com.agentworkspace.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.agentworkspace.android.R
import com.agentworkspace.control.ActivityContent
import com.agentworkspace.control.ActivityRow
import com.agentworkspace.control.ActivityRows
import com.agentworkspace.control.CardStatus
import com.agentworkspace.control.GateCard
import com.agentworkspace.control.ProposalState
import com.agentworkspace.control.ProposalTextSize
import com.agentworkspace.control.Texts
import com.agentworkspace.shared.merge.TaskView

// The proposal card and its full screen view (openspec proposal-and-discussion).

/** What the proposal card and its full screen view show and do. */
class ProposalView(
    val row: ActivityRow,
    /** The key and the title of the task: "AW-12 · Rate limits for the public API". */
    val task: String,
    /** The full text of the proposal file, or null when the file is not on this phone yet. */
    val text: String?,
    /** The gate card of the open proposal: its state and its options, or null. */
    val card: GateCard?,
    /** The text size of the phone in dp. */
    val textSize: Dp,
    val onApprove: (() -> Unit)?,
)

/**
 * The proposal card (openspec proposal-and-discussion): "Proposal v<n>", the author and the time, the
 * proposal as Markdown (the first 240 dp and "Show more"), a full screen button, and while its gate
 * is open the chip "Waits for your approval", "Approve proposal" and "To change it, write a message."
 */
@Composable
fun ProposalCard(
    view: ProposalView,
    onFullScreen: () -> Unit,
) {
    val row = view.row
    Surface(
        modifier = Modifier.listCard(),
        shape = ProposalShape,
        color = MaterialTheme.colorScheme.surfaceContainer,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            Modifier.padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Proposal v${row.version}", style = AwType.titleSm)
                if (row.state == ProposalState.OPEN && view.card?.status == CardStatus.Open) {
                    NeedChip("Waits for your approval")
                }
                Spacer(Modifier.weight(1f))
                IconButton(
                    onClick = onFullScreen,
                ) { AwIcon(R.drawable.ic_fullscreen, "Open the proposal in full screen") }
            }
            Column(Modifier.padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    listOfNotNull(row.item.who, shownTime(row.item)).joinToString(" · "),
                    style = AwType.meta,
                    color = muted(),
                )
                val text = view.text
                if (text == null) {
                    Text(notHere(row), style = AwType.body, color = muted())
                } else {
                    GateText(text, "${row.event}:proposal", ProposalCardHeight, view.textSize)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ProposalActions(view, hint = true)
            }
        }
    }
}

/** "Approve proposal" and "To change it, write a message.", the answer state, or "Approved by …". */
@Composable
private fun ProposalActions(
    view: ProposalView,
    /** "To change it, write a message." next to the button: the card has it, the full screen view not. */
    hint: Boolean,
) {
    val row = view.row
    val status = view.card?.status
    when {
        row.state == ProposalState.APPROVED -> {
            Text("Approved by ${row.approvedBy ?: "a person"}", style = MaterialTheme.typography.labelMedium)
        }

        status is CardStatus.Sent -> {
            Text(status.text, color = MaterialTheme.colorScheme.primary)
        }

        status is CardStatus.AnsweredElsewhere -> {
            Text("${status.device} answered: ${status.answer}")
        }

        status == CardStatus.Open && view.onApprove != null -> {
            // The button has the width of its label, with the hint next to it (as on the desktop).
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Button(onClick = view.onApprove) { Text("Approve proposal") }
                if (hint) Text(TO_CHANGE, style = AwType.meta, color = muted())
            }
        }
    }
}

/**
 * The proposal over the whole window (openspec proposal-and-discussion): Close, the title "Proposal
 * v<n>", the task key and title, A− and A+, the proposal as Markdown of at most 760 dp, and at the
 * bottom above the system bar "Approve proposal" (while the gate is open) and "Discuss". Back closes
 * it; "Discuss" closes it and puts the cursor in the message box.
 */
@Composable
fun ProposalFullScreen(
    view: ProposalView,
    onSize: (larger: Boolean) -> Unit,
    onClose: () -> Unit,
    onDiscuss: () -> Unit,
) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Column {
                FullScreenTopBar(view, onSize, onClose)
                HorizontalDivider()
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState()),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    Column(
                        Modifier.widthIn(max = FullScreenWidth).padding(horizontal = 18.dp, vertical = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            listOfNotNull(
                                view.row.item.who,
                                shownTime(view.row.item),
                                "text ${view.textSize.value.toInt()} dp",
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall,
                            color = muted(),
                        )
                        val text = view.text
                        SelectionContainer {
                            if (text == null) {
                                Text(notHere(view.row), style = MaterialTheme.typography.bodyMedium)
                            } else {
                                MarkdownText(text, textSize = view.textSize)
                            }
                        }
                    }
                }
                HorizontalDivider()
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ProposalActions(view, hint = false)
                    OutlinedButton(onClick = onDiscuss) { Text("Discuss") }
                }
            }
        }
    }
}

/** Close, "Proposal v<n>" with the task, and the text size control A− and A+. */
@Composable
private fun FullScreenTopBar(
    view: ProposalView,
    onSize: (larger: Boolean) -> Unit,
    onClose: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        IconButton(onClick = onClose) { AwIcon(R.drawable.ic_close, "Close full screen") }
        Column(Modifier.weight(1f)) {
            Text("Proposal v${view.row.version}", style = MaterialTheme.typography.titleMedium)
            Text(
                view.task,
                style = MaterialTheme.typography.labelSmall,
                color = muted(),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        val size = view.textSize.value.toInt()
        OutlinedButton(
            onClick = { onSize(false) },
            enabled = ProposalTextSize.canSmaller(size),
            modifier = Modifier.semantics { contentDescription = "Smaller text" },
        ) { Text("A−") }
        OutlinedButton(
            onClick = { onSize(true) },
            enabled = ProposalTextSize.canLarger(size),
            modifier = Modifier.semantics { contentDescription = "Larger text" },
        ) { Text("A+") }
    }
}

private fun notHere(row: ActivityRow) = "The file of proposal v${row.version} is not on this phone yet."

/** The proposal view of a card row: the text of its file, read off the main thread, and the text size. */
@Composable
internal fun rememberProposalView(
    row: ActivityRow,
    card: GateCard?,
    task: TaskView,
    parts: TaskDetailParts,
    onAnswer: GateAnswer,
): ProposalView {
    val version = row.version ?: 0L
    // The text of an earlier load first: a row that scrolls back keeps its height (no jump).
    val kept = "${task.id}|$version|${row.file}"
    val text by produceState(KeptTexts.proposal(kept), task.id, version, row.file, task.lastHlc) {
        val loaded = parts.loadProposal(task.id, version, row.file)
        KeptTexts.keepProposal(kept, loaded)
        value = loaded ?: value
    }
    val approve =
        card?.takeIf { row.state == ProposalState.OPEN }?.let { open ->
            { onAnswer(open.gate.gate, ActivityRows.approveAnswer(open.options), null) {} }
        }
    return ProposalView(
        row = row,
        task = "${Texts.taskLabel(task.id, task.key)} · ${task.title.orEmpty()}",
        text = text,
        card = card,
        textSize = parts.textSize.dp,
        onApprove = approve,
    )
}

/** The full screen view of the proposal of [row], with the text size control of the phone. */
@Composable
fun ProposalFullScreenOf(
    task: TaskView,
    row: ActivityRow,
    activity: ActivityContent,
    parts: TaskDetailParts,
    onAnswer: GateAnswer,
    onClose: () -> Unit,
    onDiscuss: () -> Unit,
) {
    val card = row.gate?.let { activity.cards[it] }
    ProposalFullScreen(rememberProposalView(row, card, task, parts, onAnswer), parts.onTextSize, onClose, onDiscuss)
}

/** The start of a proposal in its card before "Show more" (240 dp, as the desktop 240 px). */
private val ProposalCardHeight = 240.dp

/** The widest the proposal text grows in the full screen view. */
private val FullScreenWidth = 760.dp

/** The corner of the proposal card: `r-lg` of docs/design.md (12 dp). */
private val ProposalShape = RoundedCornerShape(12.dp)

private const val TO_CHANGE = "To change it, write a message."
