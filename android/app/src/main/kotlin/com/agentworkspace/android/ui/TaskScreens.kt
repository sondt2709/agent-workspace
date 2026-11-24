package com.agentworkspace.android.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.ActivityRule
import com.agentworkspace.control.ApproachVersions
import com.agentworkspace.control.ArtifactList
import com.agentworkspace.control.ArtifactRow
import com.agentworkspace.control.LateAnswers
import com.agentworkspace.control.QueueTexts
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.SessionOptionRows
import com.agentworkspace.control.SessionOptionsDraft
import com.agentworkspace.control.TaskDetail
import com.agentworkspace.control.TaskTab
import com.agentworkspace.control.TerminalPaneState
import com.agentworkspace.control.Texts
import com.agentworkspace.control.ThreadItem
import com.agentworkspace.control.ThreadKind
import com.agentworkspace.control.ThreadWindow
import com.agentworkspace.control.WorkspaceModel
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.shared.merge.TaskView
import kotlinx.coroutines.delay

/**
 * The task detail (openspec phone-task-focus, docs/design.md 8.6): the header, then the tabs Activity
 * (the gate cards, the description and the key activity), Session (the session summary and each raw
 * event), Terminal and Properties. [sessionInPane] is true while the third pane of a large window
 * shows the Session view: the tab row then has no Session tab.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TaskScreen(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    sessionInPane: Boolean,
    loadThread: suspend (String, Int) -> ThreadWindow,
    loadTerminal: suspend (TaskView) -> TerminalPaneState,
    parts: TaskDetailParts,
    onAnswer: (gate: String, answer: String, comment: String?, sent: () -> Unit) -> Unit,
    onAssign: (String) -> Unit,
    onSend: (text: String, sent: () -> Unit) -> Unit,
    onStopSession: () -> Unit = {},
    onNewSession: (assignee: String, options: SessionOptionsDraft?) -> Unit = { _, _ -> },
    onArchive: () -> Unit = {},
    onUnarchive: () -> Unit = {},
) {
    // Each task opens on Activity: the state belongs to the task (the desktop `key={task}`).
    var selected by rememberSaveable(task.id) { mutableStateOf(TaskTab.ACTIVITY) }
    val tabs = TaskTab.of(sessionInPane)
    val tab = TaskTab.shown(selected, tabs)
    // The newest 500 events; "Show older" adds 500 (fix list 0-20, prd TSK-24).
    var shown by rememberSaveable(task.id) { mutableIntStateOf(WorkspaceModel.THREAD_PAGE) }
    val thread by produceState(ThreadWindow.EMPTY, task.id, task.lastHlc, task.eventCount, shown) {
        value = loadThread(task.id, shown)
    }
    // A request and a requested artifact change no event: read the list again every 3 s while one
    // waits. The loop restarts when the wait starts; an equal list does not stop it.
    var tick by remember(task.id) { mutableIntStateOf(0) }
    var asked by remember(task.id) { mutableStateOf(emptySet<String>()) }
    val artifacts by produceState(emptyList(), task.id, task.lastHlc, snapshot.loadedAtMs, tick) {
        value = parts.loadArtifacts(task.id)
    }
    val waiting = ArtifactList.waiting(artifacts, asked)
    LaunchedEffect(task.id, waiting) {
        while (waiting) {
            delay(ARTIFACT_CHECK_MS)
            tick++
        }
    }
    val download = { row: ArtifactRow ->
        if (parts.onDownload(row)) asked = asked + row.request
    }
    // A snapshot file changes with no event: read it again at each reload of the model.
    val terminal by produceState<TerminalPaneState?>(null, task.id, snapshot.loadedAtMs) { value = loadTerminal(task) }
    var draft by rememberSaveable(task.id) { mutableStateOf("") }
    var assigning by rememberSaveable(task.id) { mutableStateOf(false) }
    val row = ScreenStates.row(task, snapshot)
    val older = { shown += WorkspaceModel.THREAD_PAGE }
    Column(Modifier.fillMaxSize()) {
        // The header scrolls with the list and the tab row stays at the top, so a short window (a phone
        // in landscape, the keyboard open) keeps the list. Each tab opens at the top with its own
        // scroll state, so the needs-you line shows.
        key(tab) {
            LazyColumn(Modifier.weight(1f).fillMaxWidth().focusGroup()) {
                item(key = "header") {
                    Column(
                        Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp).widthIn(max = MaxContentWidth),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                row.label,
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.weight(1f),
                            )
                            if (task.archived) Text("Archived", style = MaterialTheme.typography.labelMedium)
                            TaskActionsMenu(task, onStopSession, onArchive, onUnarchive)
                        }
                        SelectionContainer { Text(row.title, style = MaterialTheme.typography.headlineSmall) }
                        row.pause?.let { chip ->
                            PauseChipView(chip)
                            if (chip.canAssign) {
                                TextButton(onClick = {
                                    assigning = true
                                    selected = TaskTab.ACTIVITY
                                }) { Text("Assign to another device…") }
                            }
                        }
                        row.queue?.let { QueueChipView(it, row.queueCause) }
                        val projectMode = SessionOptionRows.projectMode(task, snapshot.projects)
                        SessionOptionChips(task, projectMode)
                        SessionActions(task, snapshot, onNewSession)
                    }
                }
                stickyHeader(key = "tabs") {
                    PrimaryScrollableTabRow(selectedTabIndex = tabs.indexOf(tab), edgePadding = 8.dp) {
                        tabs.forEach { t ->
                            Tab(selected = t == tab, onClick = { selected = t }, text = { Text(t.label) })
                        }
                    }
                }
                if (tab != TaskTab.ACTIVITY) {
                    TaskDetail.needsYouLine(task)?.let { line ->
                        item(key = "needs-you") { NeedsYouLine(line) { selected = TaskTab.ACTIVITY } }
                    }
                }
                when (tab) {
                    TaskTab.ACTIVITY -> {
                        items(ScreenStates.gateCards(task, snapshot), key = { it.gate.gate }) { card ->
                            GateCardView(
                                card,
                            ) { answer, comment, sent -> onAnswer(card.gate.gate, answer, comment, sent) }
                        }
                        items(LateAnswers.of(task, snapshot.phone), key = { "late-${it.gate}" }) { late ->
                            Card(
                                modifier = Modifier.listCard(),
                                colors =
                                    CardDefaults.cardColors(
                                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                    ),
                            ) {
                                Text(
                                    late.text,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.padding(16.dp),
                                )
                            }
                        }
                        if (ScreenStates.needsAssign(task) || assigning) {
                            item(key = "assign") {
                                val title = if (assigning) "Assign to another device…" else "${row.label} · Assign task"
                                val choices =
                                    if (assigning) {
                                        ScreenStates.agentChoices(
                                            snapshot,
                                            task.project,
                                            except = task.assignee?.substringAfter('@'),
                                        )
                                    } else {
                                        ScreenStates.agentChoices(snapshot, task.project, task.assignee)
                                    }
                                AssignCard(title, choices) {
                                    assigning = false
                                    onAssign(it)
                                }
                            }
                        }
                        item(key = "description") { Description(task.firstMessage) }
                        activityItems(thread, older)
                    }

                    TaskTab.SESSION -> {
                        sessionItems(task, thread, older, SessionOptionRows.projectMode(task, snapshot.projects))
                    }

                    TaskTab.TERMINAL -> {
                        item(key = "terminal") { terminal?.let { TerminalCard(it) } }
                    }

                    TaskTab.PROPERTIES -> {
                        items(
                            QueueTexts.withQueue(ScreenStates.fields(task), snapshot.queueEntries[task.id]),
                            key = { "field-${it.first}" },
                        ) { (label, value) -> FieldRow(label, value) }
                        val versions = ApproachVersions.of(task)
                        if (versions.isNotEmpty()) {
                            item { SectionHeader("Approach") }
                            items(versions, key = { "approach-${it.version}" }) { v ->
                                ApproachRow(task.id, v, parts.loadApproach)
                            }
                        }
                        if (artifacts.isNotEmpty()) {
                            item { SectionHeader("Artifacts · ${artifacts.size}") }
                            items(artifacts, key = { "artifact-${it.path}" }) { row ->
                                ArtifactLine(row, download, parts.onOpenArtifact)
                            }
                        }
                    }
                }
            }
        }
        if (tab.hasMessageBox) {
            val can = ScreenStates.canMessage(task)
            MessageField(
                value = draft,
                onValueChange = { draft = it },
                label = if (can) "Message to the session" else "No session runs: assign the task first",
                enabled = can,
                onSend = { onSend(draft) { draft = "" } },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).widthIn(max = MaxContentWidth),
            )
        }
    }
}

/** "1 item needs you" with "Show in Activity": a gate never hides behind a tab (as the desktop, tvfc-1). */
@Composable
private fun NeedsYouLine(
    text: String,
    onShow: () -> Unit,
) {
    Card(
        modifier = Modifier.listCard(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
    ) {
        Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = onShow) { Text("Show in Activity") }
        }
    }
}

/** The first message once, as the description of the task: its raw text (principle 8). */
@Composable
private fun Description(text: String?) {
    Column(Modifier.listCard(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Description", style = MaterialTheme.typography.labelLarge, color = muted())
        val body = text?.ifEmpty { null }
        if (body == null) {
            Text("No description.", style = MaterialTheme.typography.bodyLarge, color = muted())
        } else {
            SelectionContainer { MarkdownText(body) }
        }
    }
}

@Composable
private fun FieldRow(
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

/** The newest terminal snapshot: the caption, the screen in a monospace block, or the note. */
@Composable
private fun TerminalCard(state: TerminalPaneState) {
    Column(
        Modifier.padding(horizontal = 16.dp).widthIn(max = MaxContentWidth),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        state.caption?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
        state.text?.let { text ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                SelectionContainer {
                    Text(
                        text.ifEmpty { " " },
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier.padding(12.dp).horizontalScroll(rememberScrollState()),
                    )
                }
            }
        }
        state.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    }
}

/** The Session view of a task in the third pane of a large window: the summary and each raw event. */
@Composable
fun SessionPane(
    task: TaskView,
    loadThread: suspend (String, Int) -> ThreadWindow,
    projectMode: String? = null,
) {
    var shown by rememberSaveable(task.id) { mutableIntStateOf(WorkspaceModel.THREAD_PAGE) }
    val thread by produceState(ThreadWindow.EMPTY, task.id, task.lastHlc, task.eventCount, shown) {
        value = loadThread(task.id, shown)
    }
    LazyColumn(Modifier.fillMaxSize().focusGroup()) {
        item { SectionHeader("Session · ${Texts.taskLabel(task.id, task.key)}") }
        sessionItems(task, thread, { shown += WorkspaceModel.THREAD_PAGE }, projectMode)
    }
}

/** The Session view: the session summary, then each raw event and "Show older" (principle 8). */
private fun LazyListScope.sessionItems(
    task: TaskView,
    thread: ThreadWindow,
    onOlder: () -> Unit,
    projectMode: String?,
) {
    item(key = "summary-header") { SectionHeader("Session summary") }
    items(
        TaskDetail.sessionSummary(task),
        key = { "summary-${it.first}" },
    ) { (label, value) -> FieldRow(label, value) }
    sessionOptionItems(task, projectMode)
    item(key = "events-header") { SectionHeader("Events") }
    olderItem(thread, onOlder)
    if (thread.items.isEmpty()) item { EmptyText("No events yet.") }
    items(thread.items, key = { "event-${it.id}" }) { ThreadLine(it) }
}

/** The key activity: the rows of the Activity rule, with the same window as the Session view. */
private fun LazyListScope.activityItems(
    thread: ThreadWindow,
    onOlder: () -> Unit,
) {
    item(key = "activity-header") { SectionHeader("Activity") }
    olderItem(thread, onOlder)
    if (thread.activity.isEmpty()) {
        item(key = "activity-empty") {
            EmptyText(
                if (thread.hasOlder) {
                    "No activity in the newest ${thread.items.size} events. \u201cShow older\u201d loads more."
                } else {
                    "No activity yet."
                },
            )
        }
    }
    items(thread.activity, key = { "activity-${it.id}" }) { ThreadLine(it, clamp = it.kind == ThreadKind.AGENT) }
}

private fun LazyListScope.olderItem(
    thread: ThreadWindow,
    onOlder: () -> Unit,
) {
    if (thread.hasOlder) {
        item(key = "thread-older") {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = onOlder) { Text("Show older") }
                Text(
                    "The thread shows the newest ${thread.items.size} events.",
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(start = 12.dp),
                )
            }
        }
    }
}

/** One row of the thread. [clamp]: Activity shows 6 lines of a long agent message and "Show more". */
@Composable
private fun ThreadLine(
    item: ThreadItem,
    clamp: Boolean = false,
) {
    val container =
        when (item.kind) {
            ThreadKind.HUMAN, ThreadKind.SENT, ThreadKind.ANSWER -> MaterialTheme.colorScheme.primaryContainer
            ThreadKind.AGENT -> MaterialTheme.colorScheme.surfaceVariant
            ThreadKind.GATE -> MaterialTheme.colorScheme.secondaryContainer
            ThreadKind.COMMENT, ThreadKind.SYSTEM -> MaterialTheme.colorScheme.surface
        }
    Card(
        modifier = Modifier.listCard(),
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val time =
                item.hlc
                    .substringBefore('#')
                    .replace('T', ' ')
                    .take(SHOWN_TIME)
            val head = listOfNotNull(item.who, item.note, time)
            Text(head.joinToString(" · "), style = MaterialTheme.typography.labelSmall)
            var all by rememberSaveable(item.id) { mutableStateOf(false) }
            val cut = if (clamp) ActivityRule.clamp(item.text) else ActivityRule.Clamp(item.text, false)
            val shown = if (cut.cut && !all) cut.head else item.text
            SelectionContainer {
                // Activity shows the text of the agent as Markdown; the Session view shows each raw
                // event (principle 8).
                if (clamp) MarkdownText(shown) else Text(shown, style = MaterialTheme.typography.bodyMedium)
            }
            if (cut.cut) {
                TextButton(onClick = { all = !all }) { Text(if (all) "Show less" else "Show more") }
            }
        }
    }
}

/** The wait between 2 reads of the artifact list while a download runs. */
private const val ARTIFACT_CHECK_MS = 3_000L

/** The share of the row width for the field label. */
private const val LABEL_WEIGHT = 0.35f

/** "2026-11-22 14:21:00": the time part of an HLC, to the second. */
private const val SHOWN_TIME = 19
