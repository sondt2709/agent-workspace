package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.ArtifactRow
import com.agentworkspace.control.ArtifactState
import com.agentworkspace.control.ProposalTextSize
import com.agentworkspace.control.ProposalVersion

// The parts of the full context of a task on the phone (openspec gate-full-context, prd TSK-08 to
// TSK-12): the proposal versions with their full text, and the artifacts with Download and Open.

/** The loaders and actions of the proposal versions and the artifacts (openspec gate-full-context). */
class TaskDetailParts(
    /** The full text of a proposal version: the file of its event, or null to look in both folders. */
    val loadProposal: suspend (task: String, version: Long, file: String?) -> String?,
    val loadArtifacts: suspend (task: String) -> List<ArtifactRow>,
    /** Starts a download; false when the phone refused it (mobile data, a path of another form). */
    val onDownload: (ArtifactRow) -> Boolean,
    val onOpenArtifact: (ArtifactRow) -> Unit,
    /** The text size of the proposals in dp (the file `proposal-text-px`), and A+ or A−. */
    val textSize: Int = ProposalTextSize.DEFAULT,
    val onTextSize: (larger: Boolean) -> Unit = {},
)

/** One proposal version: its state, and its full file text when the person opens it. */
@Composable
fun ProposalVersionRow(
    task: String,
    version: ProposalVersion,
    load: suspend (String, Long, String?) -> String?,
) {
    var open by rememberSaveable(task, version.version) { mutableStateOf(false) }
    val text by produceState<String?>(null, task, version.version, open) {
        value = if (open) load(task, version.version, null) else null
    }
    Column(Modifier.listCard()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { open = !open }) { Text("v${version.version}") }
            Text(version.state, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
        }
        if (open) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                SelectionContainer(Modifier.padding(12.dp)) {
                    val body = text
                    if (body == null) {
                        Text(
                            "The file of proposal v${version.version} is not on this phone yet.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else {
                        MarkdownText(body)
                    }
                }
            }
        }
    }
}

/** One artifact: its name, its size and Download or Open (docs/phase-1.md 10.3). */
@Composable
fun ArtifactLine(
    row: ArtifactRow,
    onDownload: (ArtifactRow) -> Unit,
    onOpen: (ArtifactRow) -> Unit,
) {
    Row(Modifier.listCard(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(row.name, style = MaterialTheme.typography.bodyMedium)
            val size = row.size?.let(::sizeText) ?: "size not known"
            val state =
                when (row.state) {
                    ArtifactState.LOCAL -> "On this phone"
                    ArtifactState.REQUESTED -> "Downloading…"
                    ArtifactState.REMOTE -> "Not on this phone"
                }
            Text("$size · $state", style = MaterialTheme.typography.labelSmall)
        }
        when (row.state) {
            ArtifactState.LOCAL -> TextButton(onClick = { onOpen(row) }) { Text("Open") }
            ArtifactState.REMOTE -> TextButton(onClick = { onDownload(row) }) { Text("Download") }
            ArtifactState.REQUESTED -> Unit
        }
    }
}

/** "135 B", "2 KB", "1.2 MB". */
private fun sizeText(size: Long): String =
    when {
        size < KB -> "$size B"
        size < KB * KB -> "${size / KB} KB"
        else -> "%.1f MB".format(size.toDouble() / (KB * KB))
    }

private const val KB = 1024L
