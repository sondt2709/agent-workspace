package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp

/**
 * The queue of a waiting task: the chip "Queued · 2nd for claude@ubuntu-01" and the cause
 * (queue-and-assign). The chip and the cause wrap as whole items: a long chip moves the cause to the
 * next line, and the cause never gets the width of one letter (openspec phone-desktop-parity).
 */
@Composable
fun QueueChipView(
    text: String,
    cause: String?,
) = FlowRow(
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalArrangement = Arrangement.spacedBy(4.dp),
    itemVerticalAlignment = Alignment.CenterVertically,
) {
    StateChip(text, ChipTone.WAIT)
    cause?.let { Text(it, style = AwType.meta, color = muted()) }
}
