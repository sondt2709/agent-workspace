package com.agentworkspace.android.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.ActivityRule
import com.agentworkspace.control.LateAnswers
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.SessionOptionRows
import com.agentworkspace.control.SessionOptionsDraft
import com.agentworkspace.control.TaskDetail
import com.agentworkspace.control.TaskPageLayout
import com.agentworkspace.control.TaskRowState
import com.agentworkspace.control.TaskTab
import com.agentworkspace.control.TerminalPaneState
import com.agentworkspace.control.ThreadItem
import com.agentworkspace.control.ThreadKind
import com.agentworkspace.control.ThreadWindow
import com.agentworkspace.control.WorkspaceModel
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.shared.merge.TaskView

/** The actions of the task page: the task actions of the header and the answers of its cards. */
class TaskPageActions(
    val onAnswer: (gate: String, answer: String, comment: String?, sent: () -> Unit) -> Unit,
    val onAssign: (String) -> Unit,
    val onSend: (text: String, sent: () -> Unit) -> Unit,
    val onStopSession: () -> Unit = {},
    val onNewSession: (assignee: String, options: SessionOptionsDraft?) -> Unit = { _, _ -> },
    val onArchive: () -> Unit = {},
    val onUnarchive: () -> Unit = {},
)

/** The navigation of the task page: Back, another task, and the task list of "Show list". */
class TaskPageNavigation(
    val onBack: () -> Unit,
    val onOpen: (String) -> Unit,
    val listOn: Boolean,
    val onList: (Boolean) -> Unit,
)

/**
 * The task page (openspec task-review-layout, docs/design.md 8.6), the same parts as the desktop: the
 * header (Back, the key, the project, the state chip, the need-you navigation, "Show list", the
 * actions, the title and the stage bar), then the tabs Activity, Session, Terminal and Properties. The
 * width of the page decides the task list and the Properties panel ([TaskPageLayout]), not the window.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TaskScreen(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    nav: TaskPageNavigation,
    loadThread: suspend (String, Int) -> ThreadWindow,
    loadTerminal: suspend (TaskView) -> TerminalPaneState,
    parts: TaskDetailParts,
    actions: TaskPageActions,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val layout = TaskPageLayout.of(maxWidth.value.toInt(), nav.listOn)
        Row(Modifier.fillMaxSize()) {
            if (layout.list) {
                val width = TaskPageLayout.TASK_LIST_DP.dp
                TaskListPane(snapshot, task.id, nav.onOpen, Modifier.width(width).fillMaxHeight())
                VerticalDivider()
            }
            // Each task opens on Activity: the state belongs to the task (the desktop `key={task}`).
            key(task.id) {
                TaskMain(task, snapshot, layout, nav, loadThread, loadTerminal, parts, actions, Modifier.weight(1f))
            }
            if (layout.propertiesPanel) {
                VerticalDivider()
                PropertiesPanel(
                    task,
                    snapshot,
                    parts,
                    Modifier.width(TaskPageLayout.PROPERTIES_PANEL_DP.dp).fillMaxHeight(),
                )
            }
        }
    }
}

/** The header, the tabs and the message box of the task page. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TaskMain(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    layout: TaskPageLayout,
    nav: TaskPageNavigation,
    loadThread: suspend (String, Int) -> ThreadWindow,
    loadTerminal: suspend (TaskView) -> TerminalPaneState,
    parts: TaskDetailParts,
    actions: TaskPageActions,
    modifier: Modifier,
) {
    var selected by rememberSaveable(task.id) { mutableStateOf(TaskTab.ACTIVITY) }
    val tabs = layout.tabs
    val tab = TaskTab.shown(selected, tabs)
    // The newest 500 events; "Show older" adds 500 (fix list 0-20, prd TSK-24).
    var shown by rememberSaveable(task.id) { mutableIntStateOf(WorkspaceModel.THREAD_PAGE) }
    val thread by produceState(ThreadWindow.EMPTY, task.id, task.lastHlc, task.eventCount, shown) {
        value = loadThread(task.id, shown)
    }
    val artifacts = rememberArtifacts(task, snapshot, parts)
    // A snapshot file changes with no event: read it again at each reload of the model.
    val terminal by produceState<TerminalPaneState?>(null, task.id, snapshot.loadedAtMs) { value = loadTerminal(task) }
    var draft by rememberSaveable(task.id) { mutableStateOf("") }
    var assigning by rememberSaveable(task.id) { mutableStateOf(false) }
    val row = ScreenStates.row(task, snapshot)
    val older = { shown += WorkspaceModel.THREAD_PAGE }
    Column(modifier.fillMaxHeight()) {
        // The header scrolls with the list and the tab row stays at the top, so a short window (a phone
        // in landscape, the keyboard open) keeps the list. Each tab opens at the top with its own
        // scroll state, so the needs-you line shows. The content is 840 dp wide at most and centred.
        key(tab) {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth().focusGroup(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                item(key = "header") {
                    TaskHeader(task, snapshot, row, layout, nav, actions) {
                        assigning = true
                        selected = TaskTab.ACTIVITY
                    }
                }
                stickyHeader(key = "tabs") {
                    Surface(Modifier.fillMaxWidth()) {
                        PrimaryScrollableTabRow(selectedTabIndex = tabs.indexOf(tab), edgePadding = 8.dp) {
                            tabs.forEach { t ->
                                Tab(selected = t == tab, onClick = { selected = t }, text = { Text(t.label) })
                            }
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
                        cardItems(task, snapshot, row, assigning, actions) { assigning = false }
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
                        propertyItems(task, snapshot, parts, artifacts.rows, artifacts.download)
                    }
                }
            }
        }
        if (tab.hasMessageBox) {
            val can = ScreenStates.canMessage(task)
            HorizontalDivider()
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                MessageField(
                    value = draft,
                    onValueChange = { draft = it },
                    label = "Message to the agent",
                    placeholder = if (can) SEND_HINT else NO_SESSION,
                    enabled = can,
                    onSend = { actions.onSend(draft) { draft = "" } },
                    modifier =
                        Modifier
                            .widthIn(max = MaxContentWidth)
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
    }
}

/** The open gate cards, the late answers and the Assign card: first in Activity. */
private fun LazyListScope.cardItems(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    row: TaskRowState,
    assigning: Boolean,
    actions: TaskPageActions,
    onAssigned: () -> Unit,
) {
    items(ScreenStates.gateCards(task, snapshot), key = { it.gate.gate }) { card ->
        GateCardView(card) { answer, comment, sent -> actions.onAnswer(card.gate.gate, answer, comment, sent) }
    }
    items(LateAnswers.of(task, snapshot.phone), key = { "late-${it.gate}" }) { late ->
        Card(
            modifier = Modifier.listCard(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Text(late.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp))
        }
    }
    if (ScreenStates.needsAssign(task) || assigning) {
        item(key = "assign") {
            val title = if (assigning) "Assign to another device…" else "${row.label} · Assign task"
            val choices =
                if (assigning) {
                    ScreenStates.agentChoices(snapshot, task.project, except = task.assignee?.substringAfter('@'))
                } else {
                    ScreenStates.agentChoices(snapshot, task.project, task.assignee)
                }
            AssignCard(title, choices) {
                onAssigned()
                actions.onAssign(it)
            }
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

/** The newest terminal snapshot: the caption, the screen in a monospace block, or the note. */
@Composable
private fun TerminalCard(state: TerminalPaneState) {
    Column(
        Modifier.fillMaxWidth().widthIn(max = MaxContentWidth).padding(horizontal = 16.dp),
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
    items(thread.activity, key = { "activity-${it.id}" }) { ThreadLine(it, activity = true) }
}

private fun LazyListScope.olderItem(
    thread: ThreadWindow,
    onOlder: () -> Unit,
) {
    if (thread.hasOlder) {
        item(key = "thread-older") {
            Row(
                Modifier.fillMaxWidth().widthIn(max = MaxContentWidth).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
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

/**
 * One row of the thread as a line with a 2 dp edge in the color of its author, as on the desktop
 * (openspec task-review-layout, design decision 9): the info color for an agent and a subagent
 * report, the outline color for a person. [activity]: Activity shows the messages as Markdown with 6
 * lines and "Show more"; the Session view shows each raw event (principle 8).
 */
@Composable
private fun ThreadLine(
    item: ThreadItem,
    activity: Boolean = false,
) {
    val scheme = MaterialTheme.colorScheme
    val edge =
        when (item.kind) {
            ThreadKind.AGENT -> infoColor()
            ThreadKind.HUMAN, ThreadKind.SENT, ThreadKind.ANSWER, ThreadKind.COMMENT -> scheme.outline
            ThreadKind.GATE -> scheme.primary
            ThreadKind.SYSTEM -> null
        }
    val markdown = activity && ActivityRule.markdown(item.kind)
    // The edge is drawn behind the row: a Markdown table cannot give an intrinsic height.
    Row(
        Modifier
            .fillMaxWidth()
            .widthIn(max = MaxContentWidth)
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .drawBehind { if (edge != null) drawRect(edge, size = Size(EDGE.toPx(), size.height)) },
    ) {
        Column(
            Modifier.padding(start = if (edge != null) 16.dp else 0.dp, top = 2.dp, bottom = 2.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            val time =
                item.hlc
                    .substringBefore('#')
                    .replace('T', ' ')
                    .take(SHOWN_TIME)
            if (activity && item.kind == ThreadKind.SYSTEM) {
                // A line of the task, for example "Created by human@macbook-pro".
                Text("${item.text} · $time", style = MaterialTheme.typography.bodyMedium, color = muted())
                return@Column
            }
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = scheme.onSurface)) {
                        append(item.who)
                    }
                    for (part in listOfNotNull(item.note, time)) append(" · $part")
                },
                style = MaterialTheme.typography.labelSmall,
                color = muted(),
            )
            var all by rememberSaveable(item.id) { mutableStateOf(false) }
            val cut = if (markdown) ActivityRule.clamp(item.text) else ActivityRule.Clamp(item.text, false)
            val shown = if (cut.cut && !all) cut.head else item.text
            SelectionContainer {
                if (markdown) MarkdownText(shown) else Text(shown, style = MaterialTheme.typography.bodyMedium)
            }
            if (cut.cut) {
                TextButton(onClick = { all = !all }) { Text(if (all) "Show less" else "Show more") }
            }
        }
    }
}

/** The width of the colored edge of a thread row (2 dp, as on the desktop). */
private val EDGE = 2.dp

/** The placeholders of the message box: with a running session, and with none. */
private const val SEND_HINT = "It arrives as the next input of the session."
private const val NO_SESSION = "No session runs: assign the task first"

/** "2026-11-22 14:21:00": the time part of an HLC, to the second. */
private const val SHOWN_TIME = 19
