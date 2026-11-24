package com.agentworkspace.android.ui

import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.DeviceRowState
import com.agentworkspace.control.HomeState
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.WorkspaceSnapshot

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

/** The Inbox: each task that needs you, with its gate cards acted on in place. */
@Composable
fun InboxScreen(
    snapshot: WorkspaceSnapshot,
    openTask: String?,
    onOpen: (String) -> Unit,
    onSyncNow: () -> Unit,
    onAnswer: (task: String, gate: String, answer: String, comment: String?, sent: () -> Unit) -> Unit,
    onAssign: (task: String, assignee: String) -> Unit,
) {
    val rows = ScreenStates.inbox(snapshot)
    LazyColumn(Modifier.fillMaxSize().focusGroup()) {
        item { SectionHeader("Needs you · ${rows.size}") }
        if (rows.isEmpty()) item { EmptyText("Nothing here.") }
        items(rows, key = { it.id }) { row ->
            TaskRow(row, row.id == openTask, { onOpen(row.id) }, onSyncNow)
            snapshot.task(row.id)?.let { task ->
                for (card in ScreenStates.gateCards(task, snapshot)) {
                    GateCardView(
                        card,
                    ) { answer, comment, sent -> onAnswer(task.id, card.gate.gate, answer, comment, sent) }
                }
                if (ScreenStates.needsAssign(task)) {
                    AssignCard("${row.label} · Assign task", ScreenStates.agentChoices(snapshot, task.project)) {
                        onAssign(task.id, it)
                    }
                }
            }
            HorizontalDivider()
        }
    }
}

/** Tasks by stage, with the project filter and the Paused chip. */
@Composable
fun TasksScreen(
    snapshot: WorkspaceSnapshot,
    openTask: String?,
    onOpen: (String) -> Unit,
    onSyncNow: () -> Unit,
    onNewTask: () -> Unit,
) {
    var project by rememberSaveable { mutableStateOf<String?>(null) }
    val groups = ScreenStates.tasksByStage(snapshot, project)
    Column(Modifier.fillMaxSize()) {
        // The chips scroll; "New task" stays outside them at the end, so it is never cut (so-4).
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilterChip(selected = project == null, onClick = { project = null }, label = { Text("All projects") })
                for (p in snapshot.projects) {
                    FilterChip(selected = project == p.slug, onClick = { project = p.slug }, label = { Text(p.slug) })
                }
            }
            Button(onClick = onNewTask) { Text("New task", maxLines = 1, softWrap = false) }
        }
        LazyColumn(Modifier.fillMaxSize().focusGroup()) {
            for (group in groups) {
                item(key = "stage-${group.stage}") { SectionHeader("${group.label} · ${group.tasks.size}") }
                items(group.tasks, key = { it.id }) { row ->
                    TaskRow(row, row.id == openTask, { onOpen(row.id) }, onSyncNow)
                }
            }
        }
    }
}
