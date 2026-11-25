package com.agentworkspace.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentworkspace.android.R
import com.agentworkspace.control.ArtifactList
import com.agentworkspace.control.ArtifactRow
import com.agentworkspace.control.NeedYouNav
import com.agentworkspace.control.ProposalVersions
import com.agentworkspace.control.QueueTexts
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.SessionOptionRows
import com.agentworkspace.control.StageProgress
import com.agentworkspace.control.TaskPage
import com.agentworkspace.control.TaskPageLayout
import com.agentworkspace.control.TaskRowState
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.shared.merge.TaskView
import kotlinx.coroutines.delay

// The parts of the task page (openspec task-review-layout): the header with the need-you navigation
// and the stage bar, the task list of "Show list", and the properties (a tab or the right panel).

/** The properties: the fields, the proposal versions and the artifacts (the tab or the right panel). */
internal fun LazyListScope.propertyItems(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    parts: TaskDetailParts,
    artifacts: List<ArtifactRow>,
    download: (ArtifactRow) -> Unit,
) {
    items(
        QueueTexts.withQueue(ScreenStates.fields(task), snapshot.queueEntries[task.id]),
        key = { "field-${it.first}" },
    ) { (label, value) -> FieldRow(label, value) }
    val versions = ProposalVersions.of(task)
    if (versions.isNotEmpty()) {
        item { SectionHeader("Proposal") }
        items(versions, key = { "proposal-${it.version}" }) { v ->
            ProposalVersionRow(task.id, v, parts.loadProposal)
        }
    }
    if (artifacts.isNotEmpty()) {
        item { SectionHeader("Artifacts · ${artifacts.size}") }
        items(artifacts, key = { "artifact-${it.path}" }) { row -> ArtifactLine(row, download, parts.onOpenArtifact) }
    }
}

/** The right panel of 280 dp of a wide task page: the properties, with its own scroll. */
@Composable
internal fun PropertiesPanel(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    parts: TaskDetailParts,
    modifier: Modifier,
) {
    val artifacts = rememberArtifacts(task, snapshot, parts)
    LazyColumn(modifier.focusGroup(), contentPadding = PaddingValues(vertical = 8.dp)) {
        item(key = "properties") { SectionHeader("Properties") }
        propertyItems(task, snapshot, parts, artifacts.rows, artifacts.download)
    }
}

/** The artifact rows of a task and "Download", read again every 3 s while a download waits. */
internal class Artifacts(
    val rows: List<ArtifactRow>,
    val download: (ArtifactRow) -> Unit,
)

@Composable
internal fun rememberArtifacts(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    parts: TaskDetailParts,
): Artifacts {
    // A request and a requested artifact change no event: read the list again every 3 s while one
    // waits. The loop restarts when the wait starts; an equal list does not stop it.
    var tick by remember(task.id) { mutableIntStateOf(0) }
    var asked by remember(task.id) { mutableStateOf(emptySet<String>()) }
    val rows by produceState(emptyList(), task.id, task.lastHlc, snapshot.loadedAtMs, tick) {
        value = parts.loadArtifacts(task.id)
    }
    val waiting = ArtifactList.waiting(rows, asked)
    LaunchedEffect(task.id, waiting) {
        while (waiting) {
            delay(ARTIFACT_CHECK_MS)
            tick++
        }
    }
    return Artifacts(rows) { row -> if (parts.onDownload(row)) asked = asked + row.request }
}

/**
 * The header of the task page, as the desktop: Back, the key, the project, the state chip, the
 * need-you navigation, "Show list", the actions; then the title, the stage bar and the chips.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TaskHeader(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    row: TaskRowState,
    layout: TaskPageLayout,
    nav: TaskPageNavigation,
    actions: TaskPageActions,
    /** The state chip "Needs you": it shows the row of Activity that needs the person. */
    onStateChip: () -> Unit = {},
    onAssignElsewhere: () -> Unit,
) {
    val need = NeedYouNav.of(ScreenStates.inbox(snapshot).map { it.id }, task.id)
    Column(
        Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = nav.onBack) {
                AwIcon(R.drawable.ic_back, null)
                Text("Back", modifier = Modifier.padding(start = 6.dp))
            }
            val scheme = MaterialTheme.colorScheme
            Text(row.label, style = MaterialTheme.typography.labelLarge.copy(fontFamily = MONO), color = muted())
            task.project?.let { HeaderChip(it, scheme.surfaceContainerHigh, scheme.onSurface) }
            TaskPage.stateChip(task)?.let {
                HeaderChip(
                    if (it.startsWith("Needs you")) it else "Needs you: $it",
                    MaterialTheme.colorScheme.primaryContainer,
                    MaterialTheme.colorScheme.primary,
                    Modifier.clip(CompactShape).clickable(role = Role.Button, onClickLabel = "Show in Activity") {
                        onStateChip()
                    },
                )
            }
            if (task.archived) Text("Archived", style = MaterialTheme.typography.labelMedium, color = muted())
            Spacer(Modifier.weight(1f))
            need.text?.let { text ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(text, style = MaterialTheme.typography.labelMedium, color = muted())
                    IconButton(enabled = need.previous != null, onClick = { need.previous?.let(nav.onOpen) }) {
                        AwIcon(R.drawable.ic_chevron_left, "Previous task that needs you")
                    }
                    IconButton(enabled = need.next != null, onClick = { need.next?.let(nav.onOpen) }) {
                        AwIcon(R.drawable.ic_chevron_right, "Next task that needs you")
                    }
                }
            }
            if (layout.canList) {
                OutlinedButton(onClick = { nav.onList(!layout.list) }) {
                    Text(if (layout.list) "Hide list" else "Show list")
                }
            }
            TaskActionsMenu(task, actions.onStopSession, actions.onArchive, actions.onUnarchive)
        }
        Column(Modifier.padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SelectionContainer { Text(row.title, style = MaterialTheme.typography.headlineSmall) }
            StageBar(task.stage)
            row.pause?.let { chip ->
                PauseChipView(chip)
                if (chip.canAssign) TextButton(onClick = onAssignElsewhere) { Text("Assign to another device…") }
            }
            row.queue?.let { QueueChipView(it, row.queueCause) }
            SessionOptionChips(task, SessionOptionRows.projectMode(task, snapshot.projects))
            SessionActions(task, snapshot, actions.onNewSession)
        }
    }
}

/** A small label of the header: the project or the state. */
@Composable
internal fun HeaderChip(
    text: String,
    container: Color,
    content: Color,
    modifier: Modifier = Modifier,
) = Text(
    text,
    style = MaterialTheme.typography.labelMedium,
    color = content,
    maxLines = 1,
    overflow = TextOverflow.Ellipsis,
    modifier = modifier.background(container, CompactShape).padding(horizontal = 8.dp, vertical = 3.dp),
)

/** The stage progress: 6 segments, the done ones in the info color, and "Discuss · stage 2 of 6". */
@Composable
internal fun StageBar(stage: String) {
    val progress = StageProgress.of(stage)
    val on = infoColor()
    val off = MaterialTheme.colorScheme.outline
    Row(
        Modifier.semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            repeat(progress.count) { i ->
                Box(
                    Modifier
                        .size(width = 22.dp, height = 4.dp)
                        .background(if (i <= progress.index) on else off, RoundedCornerShape(2.dp)),
                )
            }
        }
        Text(progress.text, style = MaterialTheme.typography.labelMedium, color = muted())
    }
}

/**
 * The task list of "Show list" (300 dp): the tasks that need the person first, in the Inbox order,
 * then the running, paused and queued tasks. A tap opens the task on the page.
 */
@Composable
internal fun TaskListPane(
    snapshot: WorkspaceSnapshot,
    current: String,
    onOpen: (String) -> Unit,
    modifier: Modifier,
) {
    LazyColumn(modifier.focusGroup(), contentPadding = PaddingValues(8.dp)) {
        for (group in TaskPage.listGroups(snapshot)) {
            item(key = "group-${group.label}") {
                Text(
                    group.label,
                    style = MaterialTheme.typography.labelMedium,
                    color = muted(),
                    modifier = Modifier.padding(start = 8.dp, top = 12.dp, bottom = 4.dp),
                )
            }
            items(group.rows, key = { "list-${it.id}" }) { r ->
                val on = r.id == current
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(CompactShape)
                        .background(if (on) MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent)
                        .border(1.dp, if (on) MaterialTheme.colorScheme.primary else Color.Transparent, CompactShape)
                        .clickable(role = Role.Button) { onOpen(r.id) }
                        .heightIn(min = ControlHeight)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    val state = r.reason?.removePrefix("Needs you: ") ?: r.stageLabel
                    Text(
                        "${r.label} · $state",
                        style = MaterialTheme.typography.labelSmall.copy(fontFamily = MONO),
                        color = muted(),
                    )
                    Text(
                        r.title,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
internal fun FieldRow(
    label: String,
    value: String,
) {
    Row(Modifier.fillMaxWidth().widthIn(max = MaxContentWidth).padding(horizontal = 16.dp, vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(LABEL_WEIGHT))
        SelectionContainer(Modifier.weight(1f - LABEL_WEIGHT)) {
            Text(value, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** The font of the task key, as the desktop. */
private val MONO = MonoFont

/** The wait between 2 reads of the artifact list while a download runs. */
private const val ARTIFACT_CHECK_MS = 3_000L

/** The share of the row width for the field label. */
private const val LABEL_WEIGHT = 0.35f
