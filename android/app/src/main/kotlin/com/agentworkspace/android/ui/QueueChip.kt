package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AssistChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp

/** The queue of a waiting task: "Queued · 2nd for claude@ubuntu-01" and the cause (queue-and-assign). */
@Composable
fun QueueChipView(
    text: String,
    cause: String?,
) = Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    AssistChip(onClick = {}, label = { Text(text) })
    cause?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = muted()) }
}
