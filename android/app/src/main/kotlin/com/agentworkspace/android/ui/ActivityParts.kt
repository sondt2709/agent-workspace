package com.agentworkspace.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.ActivityContent
import com.agentworkspace.control.ActivityRow
import com.agentworkspace.control.Author
import com.agentworkspace.control.CardStatus
import com.agentworkspace.control.GateCard
import com.agentworkspace.control.GateTexts
import com.agentworkspace.control.MessageKind
import com.agentworkspace.control.RowStyle
import com.agentworkspace.control.ThreadItem
import com.agentworkspace.shared.merge.TaskView

// The 3 row styles of Activity (openspec proposal-and-discussion, spec app-style): a message with a
// 2 dp edge in the color of its author, the proposal card, and a task line. A gate card of another
// kind keeps the card style of the gate cards (GateCardView).

/** The answer of a gate row: the gate, the answer, the comment, and the call when it was written. */
typealias GateAnswer = (gate: String, answer: String, comment: String?, sent: () -> Unit) -> Unit

/**
 * One message of Activity: an agent message, a question with its option buttons of 48 dp while the
 * gate is open, an answer, or a person message. Each shows as Markdown, 6 lines and "Show more".
 * [card] is the gate card of an open question: its state ("Answer sent") and its controls.
 */
@Composable
fun MessageRowView(
    row: ActivityRow,
    card: GateCard?,
    onAnswer: GateAnswer,
    /** A reply field under the buttons (the Inbox item); else the message box answers. */
    replyField: Boolean = false,
) {
    val edge = if (row.author == Author.AGENT) infoColor() else MaterialTheme.colorScheme.outline
    // The edge is drawn behind the row: a Markdown table cannot give an intrinsic height.
    Row(
        Modifier
            .fillMaxWidth()
            .widthIn(max = MaxContentWidth)
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .drawBehind { drawRect(edge, size = Size(EDGE.toPx(), size.height)) },
    ) {
        Column(
            Modifier.padding(start = 14.dp, top = 2.dp, bottom = 2.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // The card of an open question: its state and its controls.
            val open = card?.takeIf { row.kind == MessageKind.QUESTION && row.needsYou }
            MessageMeta(row, waits = open?.status == CardStatus.Open)
            when (row.kind) {
                MessageKind.QUESTION -> QuestionBody(row, open, onAnswer, replyField)
                MessageKind.ANSWER -> AnswerBody(row)
                MessageKind.MESSAGE -> ClampedText(row.text, row.event)
            }
        }
    }
}

/** "claude@ubuntu-01 · question · 2026-11-26 10:02:00" and the chip "Waits for your reply". */
@Composable
private fun MessageMeta(
    row: ActivityRow,
    waits: Boolean,
) {
    val item = row.item
    val part =
        when (row.kind) {
            MessageKind.QUESTION -> "question"
            MessageKind.ANSWER -> "answer"
            MessageKind.MESSAGE -> item.note
        }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)) {
                    append(item.who)
                }
                for (text in listOfNotNull(part, shownTime(item))) append(" · $text")
            },
            style = MaterialTheme.typography.labelSmall,
            color = muted(),
        )
        if (waits) NeedChip("Waits for your reply")
    }
}

/**
 * A question: the gate title in bold, the details as Markdown (or the Context of a gate with no
 * details), and while the gate is open its options as buttons and a reply field. A question that AW
 * closed shows the close answer, for example "Replaced by a newer question".
 */
@Composable
private fun QuestionBody(
    row: ActivityRow,
    card: GateCard?,
    onAnswer: GateAnswer,
    replyField: Boolean,
) {
    val title = row.title.orEmpty()
    if (title.isNotBlank()) {
        SelectionContainer {
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
    if (card != null) {
        GateBody(card)
        GateAnswerControls(
            card,
            { answer, comment, sent -> onAnswer(card.gate.gate, answer, comment, sent) },
            OR_WRITE,
            freeText = card.freeText && replyField,
        )
        // In Activity, the message box of the task page answers the question (as the desktop).
        if (card.freeText && !replyField && card.status == CardStatus.Open) {
            Text(IN_THE_BOX, style = MaterialTheme.typography.labelSmall, color = muted())
        }
    } else {
        if (GateTexts.hasBody(title, row.text)) ClampedText(row.text, "${row.event}:text")
        row.gateNote?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = muted()) }
    }
}

/** An answer: the label of a gate of another kind ("Approve result: Request changes"), then the text. */
@Composable
private fun AnswerBody(row: ActivityRow) {
    row.label?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = muted()) }
    ClampedText(row.text, row.event)
}

/** A task line: one muted line with a dot, for example "Proposal v1 · replaced by v2 · 10:05". */
@Composable
fun TaskLineView(row: ActivityRow) {
    Row(
        Modifier
            .fillMaxWidth()
            .widthIn(max = MaxContentWidth)
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(6.dp).background(MaterialTheme.colorScheme.outlineVariant, CircleShape))
        val note = row.item.note?.takeIf { !row.item.applied }
        Text(
            listOfNotNull(row.text, note, shownTime(row.item)).joinToString(" · "),
            style = MaterialTheme.typography.labelMedium,
            color = muted(),
        )
    }
}

/** The chip of a row that waits for the person, in the accent: "Waits for your reply". */
@Composable
internal fun NeedChip(text: String) =
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier =
            Modifier
                .background(MaterialTheme.colorScheme.primary.copy(alpha = CHIP_ALPHA), CircleShape)
                .padding(horizontal = 10.dp, vertical = 3.dp),
    )

/** "2026-11-22 14:21:00": the time part of an HLC, to the second. */
internal fun shownTime(item: ThreadItem): String =
    item.hlc
        .substringBefore('#')
        .replace('T', ' ')
        .take(SHOWN_TIME)

/** The width of the colored edge of a message (2 dp, as on the desktop). */
private val EDGE = 2.dp

private const val OR_WRITE = "Or write your answer"
private const val IN_THE_BOX = "Or write your answer in the message box."
private const val SHOWN_TIME = 19
private const val CHIP_ALPHA = 0.14f

/** What a row of Activity needs from the task page: the task, the loaders, the answer and the full screen view. */
class ActivityRowParts(
    val task: TaskView,
    val parts: TaskDetailParts,
    val onAnswer: GateAnswer,
    /** The Inbox item has no message box: its question keeps a reply field. */
    val replyField: Boolean = false,
    val onFullScreen: (event: String) -> Unit,
)

/** One row of Activity in its style. */
@Composable
fun ActivityRowView(
    row: ActivityRow,
    activity: ActivityContent,
    parts: ActivityRowParts,
) {
    val card = row.gate?.let { activity.cards[it] }
    when (row.style) {
        RowStyle.MESSAGE -> {
            MessageRowView(row, card, parts.onAnswer, parts.replyField)
        }

        RowStyle.LINE -> {
            TaskLineView(row)
        }

        RowStyle.CARD -> {
            card?.let {
                GateCardView(
                    it,
                ) { answer, comment, sent -> parts.onAnswer(it.gate.gate, answer, comment, sent) }
            }
        }

        RowStyle.PROPOSAL -> {
            ProposalCard(rememberProposalView(row, card, parts.task, parts.parts, parts.onAnswer)) {
                parts.onFullScreen(row.event)
            }
        }
    }
}
