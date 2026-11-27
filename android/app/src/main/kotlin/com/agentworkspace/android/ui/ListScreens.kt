package com.agentworkspace.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.ActivityContent
import com.agentworkspace.control.DeviceRowState
import com.agentworkspace.control.HomeState
import com.agentworkspace.control.InboxItems
import com.agentworkspace.control.InboxNote
import com.agentworkspace.control.RowStyle
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.Texts
import com.agentworkspace.control.ThreadWindow
import com.agentworkspace.control.WorkspaceModel
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.shared.merge.TaskView

/** The "Needs you" items, the devices with Sync now, then the working and the paused tasks. */
@Composable
fun HomeScreen(
    home: HomeState,
    snapshot: WorkspaceSnapshot,
    openTask: String?,
    syncing: Boolean,
    syncText: String?,
    battery: Boolean,
    onBattery: () -> Unit,
    onOpen: (String) -> Unit,
    onSyncNow: () -> Unit,
    onAnswer: (task: String, gate: String, answer: String, comment: String?, sent: () -> Unit) -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize().focusGroup()) {
        if (battery) item { BatteryWarning(onBattery) }
        item { SectionHeader("Needs you · ${home.needsYou.size}") }
        if (home.needsYou.isEmpty()) item { EmptyText("Nothing needs you. ${home.working.size} agents working.") }
        items(home.needsYou, key = { "needs-${it.id}" }) { row ->
            TaskRow(row, row.id == openTask, { onOpen(row.id) }, onSyncNow)
            snapshot.task(row.id)?.let { task ->
                for (card in ScreenStates.gateCards(task, snapshot)) {
                    GateCardView(
                        card,
                    ) { answer, comment, sent -> onAnswer(task.id, card.gate.gate, answer, comment, sent) }
                }
            }
        }
        item { SectionHeader("Devices") }
        items(home.devices, key = { "dev-${it.slug}" }) { DeviceLine(it) }
        item { SyncNowRow(syncing, syncText, onSyncNow) }
        if (home.issueCount > 0) {
            item { EmptyText("Sync problem: ${home.issueCount} files could not be read. See Devices.") }
        }
        item { SectionHeader("Working · ${home.working.size}") }
        items(home.working, key = { "work-${it.id}" }) { row ->
            TaskRow(row, row.id == openTask, { onOpen(row.id) }, onSyncNow)
        }
        if (home.paused.isNotEmpty()) {
            item { SectionHeader("Paused · ${home.paused.size}") }
            items(home.paused, key = { "pause-${it.id}" }) { row ->
                TaskRow(row, row.id == openTask, { onOpen(row.id) }, onSyncNow)
            }
        }
    }
}

@Composable
fun BatteryWarning(onBattery: () -> Unit) =
    WarningCard(
        "Battery mode \"Restricted\" stops the sync engine. Gates and pushes do not arrive. Set it to \"Optimized\".",
        "Open battery settings",
        onBattery,
    )

@Composable
fun DeviceLine(device: DeviceRowState) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(device.name, style = MaterialTheme.typography.bodyLarge)
            Text(device.role, style = MaterialTheme.typography.labelSmall, color = muted())
            Text(
                when {
                    device.revoked -> "Revoked"
                    device.online -> "Online"
                    else -> "Offline"
                },
                style = MaterialTheme.typography.labelSmall,
                color = if (device.online) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            )
        }
        Text(device.heartbeat, style = MaterialTheme.typography.bodySmall)
        device.sync?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
fun SyncNowRow(
    syncing: Boolean,
    syncText: String?,
    onSyncNow: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            syncText ?: "This phone runs no agents. It syncs while the app is open and after a push.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f),
        )
        Button(onClick = onSyncNow, enabled = !syncing) { Text(if (syncing) "Syncing…" else "Sync now") }
    }
}

/** One row of the Inbox: the reason in the accent, the title, and the key with the project. */
@Composable
private fun InboxRowView(
    reason: String,
    title: String,
    key: String?,
    sub: String?,
    selected: Boolean,
    onClick: (() -> Unit)?,
) {
    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier
            .fillMaxWidth()
            .background(if (selected) scheme.surfaceContainerHigh else Color.Transparent)
            .then(if (onClick == null) Modifier else Modifier.clickable(role = Role.Button, onClick = onClick))
            .heightIn(min = TouchHeight)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(reason, style = MaterialTheme.typography.labelMedium, color = scheme.primary)
        Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
        val line = listOfNotNull(key, sub).joinToString(" · ")
        if (line.isNotEmpty()) {
            Text(
                line,
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFont),
                color = muted(),
            )
        }
    }
}

/** One task of a group of the Inbox: the key and the title. A tap opens the task. */
@Composable
private fun GroupRow(
    key: String,
    title: String,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = TouchHeight)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            key,
            style = MaterialTheme.typography.labelMedium.copy(fontFamily = MonoFont),
            color = muted(),
            modifier = Modifier.width(KEY_WIDTH),
        )
        Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * The item screen of an Inbox row (openspec proposal-and-discussion): the reason and "Open task", the
 * key, the project and the stage, the title, then the rows of Activity that need the person (the
 * question message with its buttons and a reply field, the proposal card, or the gate card), and the
 * Assign card or the pause.
 */
@Composable
fun InboxItemScreen(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    loadThread: suspend (String, Int) -> ThreadWindow,
    parts: TaskDetailParts,
    onAnswer: GateAnswer,
    onAssign: (String) -> Unit,
    onOpenTask: () -> Unit,
) {
    val thread by produceState(ThreadWindow.EMPTY, task.id, task.lastHlc, task.eventCount) {
        value = loadThread(task.id, WorkspaceModel.THREAD_PAGE)
    }
    val activity = ActivityContent.of(task, snapshot, thread)
    val row = ScreenStates.row(task, snapshot)
    var fullScreen by rememberSaveable(task.id) { mutableStateOf<String?>(null) }
    val rowParts = ActivityRowParts(task, parts, onAnswer, replyField = true) { fullScreen = it }
    val reason = InboxItems.reason(InboxItems.taskOf(task, snapshot)).takeIf { task.needsYouLane }
    LazyColumn(Modifier.fillMaxSize().focusGroup(), horizontalAlignment = Alignment.CenterHorizontally) {
        item(key = "head") {
            Column(
                Modifier.fillMaxWidth().widthIn(max = MaxContentWidth).padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        reason ?: "Nothing needs you",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(onClick = onOpenTask) { Text("Open task") }
                }
                Text(
                    listOfNotNull(row.label, task.project, row.stageLabel).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFont),
                    color = muted(),
                )
                Text(row.title, style = MaterialTheme.typography.titleLarge)
                row.pause?.let { PauseChipView(it) }
            }
        }
        items(activity.topCards, key = { "card-${it.gate.gate}" }) { card ->
            GateCardView(card) { answer, comment, sent -> onAnswer(card.gate.gate, answer, comment, sent) }
        }
        items(activity.needsYou, key = { "row-${it.event}" }) { r -> ActivityRowView(r, activity, rowParts) }
        if (activity.assign) {
            item(key = "assign") {
                AssignCard(
                    "${row.label} · Assign task",
                    ScreenStates.agentChoices(snapshot, task.project, task.assignee),
                ) {
                    onAssign(it)
                }
            }
        }
        if (activity.topCards.isEmpty() && activity.needsYou.isEmpty() && !activity.assign) {
            item(key = "nothing") { EmptyText("Nothing of this task needs you now.") }
        }
    }
    activity.rows.firstOrNull { it.event == fullScreen && it.style == RowStyle.PROPOSAL }?.let { proposal ->
        // "Discuss" opens the task: its message box is on the task page.
        ProposalFullScreenOf(task, proposal, activity, parts, onAnswer, { fullScreen = null }) {
            fullScreen = null
            onOpenTask()
        }
    }
}

/** The width of the key column of a group row. */
private val KEY_WIDTH = 56.dp

/**
 * Tasks (openspec nav-tasks-needs-you, spec tasks-view "Phone Tasks"): the tabs "Needs you",
 * "Working" and "All", and the project filter. "Needs you" has the rows of the old Inbox tab and
 * the files to fix, then the section Updates; "Working" the groups Working now, Paused and Queued;
 * "All" the tasks by stage.
 */
@Composable
fun TasksScreen(
    snapshot: WorkspaceSnapshot,
    updates: List<InboxNote>,
    openTask: String?,
    openItem: String?,
    onOpen: (String) -> Unit,
    onOpenItem: (String) -> Unit,
    onSyncNow: () -> Unit,
    nowMs: Long,
    /** The bar of the list pane while a task shows next to the list, else null. */
    header: (@Composable () -> Unit)? = null,
    onNewTask: () -> Unit,
) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    // The project filter (openspec nav-tasks-needs-you): none selected keeps each project.
    var projects by rememberSaveable { mutableStateOf(listOf<String>()) }
    // A tap on a group header closes or opens it; "Archived" is closed at the start (docs/design.md 8.4).
    var closed by rememberSaveable { mutableStateOf(setOf(ScreenStates.ARCHIVED_GROUP)) }
    val inProjects = { project: String? -> projects.isEmpty() || project in projects }
    val state = InboxItems.of(snapshot)
    val rows = state.rows.filter { inProjects(it.project) }
    val files = InboxItems.files(snapshot.issues)
    val groups = state.groups.map { g -> g to g.tasks.filter { inProjects(snapshot.task(it.id)?.project) } }
    val working = groups.sumOf { it.second.size }
    val stages = ScreenStates.tasksByStage(snapshot, projects = projects)
    val all = stages.sumOf { it.tasks.size }
    Column(Modifier.fillMaxSize()) {
        header?.invoke()
        // "Tasks" and "New task" on one line, above the tabs, so the button is never cut.
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                buildAnnotatedString {
                    append("Tasks ")
                    withStyle(SpanStyle(color = muted(), fontWeight = FontWeight.Normal)) { append("$all") }
                },
                style = AwType.title,
                modifier = Modifier.weight(1f),
            )
            Button(onClick = onNewTask) { Text("New task", maxLines = 1, softWrap = false) }
        }
        // The project filter is a filter, not a tab (several projects at once, decision of 2026-11-27):
        // it stays at the end of the tab row, as on the desktop.
        AwTabRow(
            labels = listOf("Needs you · ${rows.size + files.size}", "Working · $working", "All · $all"),
            selected = tab,
            onSelect = { tab = it },
            trailing = {
                // The end padding of the screen: the trailing slot has none.
                Box(Modifier.padding(end = 16.dp)) {
                    ProjectChips(snapshot, projects, allowNone = false) { projects = it }
                }
            },
        )
        LazyColumn(Modifier.fillMaxSize().focusGroup()) {
            when (tab) {
                0 -> {
                    if (rows.isEmpty() && files.isEmpty()) item(key = "empty") { EmptyText("Nothing needs you.") }
                    items(rows, key = { "row-${it.task}" }) { row ->
                        InboxRowView(row.reason, row.title, row.key, row.project, row.task == openItem) {
                            onOpenItem(row.task)
                        }
                    }
                    items(files, key = { it.id }) { note ->
                        InboxRowView(note.reason, note.title, null, note.sub, false, null)
                    }
                    if (updates.isNotEmpty()) {
                        item(key = "updates") { SectionHeader("Updates · ${updates.size}") }
                        items(updates, key = { it.id }) { note ->
                            InboxRowView(note.reason, note.title, null, note.sub, false, null)
                        }
                    }
                }

                1 -> {
                    if (working == 0) item(key = "none") { EmptyText("Nothing works now.") }
                    for ((group, tasks) in groups) {
                        if (tasks.isEmpty()) continue
                        item(key = "group-${group.id}") { SectionHeader("${group.label} · ${tasks.size}") }
                        items(tasks, key = { "${group.id}-${it.id}" }) { task ->
                            GroupRow(Texts.taskLabel(task.id, task.key), task.title) { onOpen(task.id) }
                        }
                    }
                }

                else -> {
                    for (group in stages) {
                        val open = group.stage !in closed
                        item(key = "stage-${group.stage}") {
                            GroupHeader(group.label, group.tasks.size, open) {
                                closed = if (open) closed + group.stage else closed - group.stage
                            }
                        }
                        if (open) {
                            items(group.tasks, key = { it.id }) { row ->
                                TaskRow(
                                    row,
                                    row.id == openTask,
                                    { onOpen(row.id) },
                                    onSyncNow,
                                    Texts.age(row.lastHlc, nowMs),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
