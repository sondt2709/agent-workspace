package com.agentworkspace.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// The list parts of the desktop on the phone (openspec phone-desktop-parity, docs/design.md 8.4 and
// 8.6): the state chip, the stage icon, the group header of the Tasks list and the tab row.

/**
 * A state chip of the desktop: 24 dp high, a 6 dp corner, `meta` text in weight 510 on a 14 % tint of
 * its status color. It is a label, not a button. A long text ends with "…".
 */
@Composable
fun StateChip(
    text: String,
    tone: ChipTone,
    modifier: Modifier = Modifier,
) {
    val color =
        when (tone) {
            ChipTone.YOU -> MaterialTheme.colorScheme.primary
            ChipTone.RUN -> infoColor()
            ChipTone.ERR -> MaterialTheme.colorScheme.error
            ChipTone.OK -> okColor()
            ChipTone.WAIT -> waitColor()
            ChipTone.NEUTRAL -> MaterialTheme.colorScheme.secondary
        }
    val fill =
        if (tone == ChipTone.NEUTRAL) MaterialTheme.colorScheme.surfaceContainerHigh else color.copy(alpha = CHIP_TINT)
    Text(
        text,
        style = AwType.meta.copy(fontWeight = FontWeight(CHIP_WEIGHT)),
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier =
            modifier
                .heightIn(min = ChipHeight)
                .background(fill, RoundedCornerShape(AwRadius.sm))
                .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

/** The height of a [StateChip], as on the desktop. */
private val ChipHeight = 24.dp

/** The tint of a chip fill: 14 % of its status color. */
private const val CHIP_TINT = 0.14f

/** The weight of a chip label (`micro` and `label` of docs/design.md 3). */
private const val CHIP_WEIGHT = 510

/**
 * A tab row of the desktop (docs/design.md 8.6): the selected tab in `text` with the accent line, the
 * other tabs in `text3` (openspec phone-desktop-parity). The Material 3 default draws each label in the
 * accent.
 */
@Composable
fun AwTabRow(
    labels: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) = PrimaryScrollableTabRow(
    selectedTabIndex = selected,
    modifier = modifier,
    edgePadding = 8.dp,
    divider = { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) },
) {
    labels.forEachIndexed { index, label ->
        Tab(
            selected = index == selected,
            onClick = { onSelect(index) },
            selectedContentColor = MaterialTheme.colorScheme.onSurface,
            unselectedContentColor = muted(),
            text = { Text(label, style = AwType.bodyStrong, maxLines = 1) },
        )
    }
}

/** The status color of a stage group: the icon of the group and of its rows (docs/design.md 8.4). */
@Composable
fun stageColor(stage: String): Color =
    when (stage) {
        "discuss" -> MaterialTheme.colorScheme.primary
        "ready" -> MaterialTheme.colorScheme.secondary
        "implement" -> infoColor()
        "review" -> waitColor()
        "done" -> okColor()
        else -> muted()
    }

/** The status icon of a stage: a ring in the stage color, dashed for Backlog. */
@Composable
fun StageIcon(
    stage: String,
    modifier: Modifier = Modifier,
) {
    val color = stageColor(stage)
    Canvas(modifier.size(STAGE_ICON)) {
        val width = STAGE_RING.toPx()
        val dash = if (stage == "backlog") PathEffect.dashPathEffect(floatArrayOf(width * 1.4f, width * 1.4f)) else null
        drawCircle(color, radius = (size.minDimension - width) / 2, style = Stroke(width, pathEffect = dash))
    }
}

private val STAGE_ICON = 14.dp
private val STAGE_RING = 2.dp

/**
 * The header of a group of the Tasks list (docs/design.md 8.4): 32 dp on the `canvas` color, the
 * arrow, the name in `text2` and the count. A tap closes or opens the group.
 */
@Composable
fun GroupHeader(
    name: String,
    count: Int,
    open: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerLowest)
            .clickable(role = Role.Button, onClickLabel = if (open) "Close group" else "Open group", onClick = onToggle)
            .heightIn(min = GROUP_HEIGHT)
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (open) "\u25BE" else "\u25B8", style = AwType.meta, color = muted())
        Text(name, style = AwType.bodyStrong.copy(fontSize = 13.sp), color = MaterialTheme.colorScheme.secondary)
        Text("$count", style = AwType.meta, color = muted())
    }
}

private val GROUP_HEIGHT = 32.dp
