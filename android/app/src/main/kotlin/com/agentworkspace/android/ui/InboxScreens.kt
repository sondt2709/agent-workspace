package com.agentworkspace.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.CardFilter
import com.agentworkspace.control.InboxCard
import com.agentworkspace.control.InboxCards
import com.agentworkspace.control.NO_PROJECT
import com.agentworkspace.control.NewTaskDraft
import com.agentworkspace.control.ProjectFilter
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.shared.merge.ProjectView
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** The name of a project, else its slug. */
val ProjectView.label: String get() = (document["name"] as? JsonPrimitive)?.contentOrNull ?: slug

private val CATEGORY_LABEL = mapOf("action" to "Action", "question" to "Question", "info" to "Info")
private val CATEGORY_MARK = mapOf("action" to "✓", "question" to "?", "info" to "i")

private const val TIME_START = 11
private const val TIME_END = 16

/** The `HH:MM` of an ISO 8601 time (UTC). */
private fun clockTime(iso: String): String = if (iso.length >= TIME_END) iso.substring(TIME_START, TIME_END) else iso

/** The category in a fixed 24 dp box: each title starts at the same place (spec inbox-cards). */
@Composable
fun CategoryBox(category: String) {
    val color =
        when (category) {
            "action" -> MaterialTheme.colorScheme.primary
            "question" -> MaterialTheme.colorScheme.tertiary
            else -> MaterialTheme.colorScheme.onSurfaceVariant
        }
    Box(
        Modifier
            .size(24.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(6.dp))
            .semantics { contentDescription = CATEGORY_LABEL[category] ?: category },
        contentAlignment = Alignment.Center,
    ) {
        Text(CATEGORY_MARK[category] ?: "", color = color, style = MaterialTheme.typography.labelLarge)
    }
}

/** The Inbox of the phone (spec inbox-cards "Phone Inbox"): the rows, the filter and the sort of the desktop. */
@Composable
fun InboxScreen(
    snapshot: WorkspaceSnapshot,
    openCard: String?,
    onOpen: (String) -> Unit,
    onRun: (String) -> Unit,
) {
    var category by rememberSaveable { mutableStateOf("all") }
    var unread by rememberSaveable { mutableStateOf(false) }
    var done by rememberSaveable { mutableStateOf(false) }
    var newest by rememberSaveable { mutableStateOf(false) }
    var projects by rememberSaveable { mutableStateOf(listOf<String>()) }
    val counts = InboxCards.counts(snapshot.cards)
    val rows =
        InboxCards.rows(
            snapshot.cards,
            CardFilter(category, projects, unread, done, if (newest) "newest" else "urgency"),
        )
    val source = snapshot.sources.firstOrNull()
    val sourceId = source?.let { (it["source"] as? JsonPrimitive)?.contentOrNull }
    Column(Modifier.fillMaxSize()) {
        // "Inbox" and "Run now" on one line, as the title row of Tasks: Run now is never out of view.
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                buildAnnotatedString {
                    append("Inbox ")
                    withStyle(SpanStyle(color = muted(), fontWeight = FontWeight.Normal)) {
                        append("${counts.getValue("unread")} unread")
                    }
                },
                style = AwType.title,
                modifier = Modifier.weight(1f),
            )
            if (sourceId != null) {
                OutlinedButton(onClick = { onRun(sourceId) }) { Text("Run now", maxLines = 1, softWrap = false) }
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(
                    rememberScrollState(),
                ).padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilterChip(category == "all", { category = "all" }, label = { Text("All") })
            for (key in listOf("action", "question", "info")) {
                FilterChip(
                    category == key,
                    { category = key },
                    label = { Text("${CATEGORY_LABEL[key]} ${counts[key]}") },
                )
            }
            ProjectChips(snapshot, projects, allowNone = true) { projects = it }
            FilterChip(unread, { unread = !unread }, label = { Text("Unread") })
            FilterChip(done, { done = !done }, label = { Text("Done") })
            FilterChip(false, { newest = !newest }, label = { Text(if (newest) "Newest ↓" else "Urgency ↓") })
        }
        LazyColumn(Modifier.fillMaxSize().focusGroup()) {
            if (rows.isEmpty()) {
                item(key = "empty") {
                    EmptyText(if (source == null) "No source yet. Connect Mattermost on a computer." else "No cards.")
                }
            }
            items(
                rows,
                key = { it.card },
            ) { card -> CardRow(card, snapshot, card.card == openCard) { onOpen(card.card) } }
        }
    }
}

/** The project chip and its menu with a search field: many projects, and "No project" in the Inbox. */
@Composable
fun ProjectChips(
    snapshot: WorkspaceSnapshot,
    selected: List<String>,
    allowNone: Boolean,
    onChange: (List<String>) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    val names = snapshot.projects.associate { it.slug to it.label }
    Box {
        FilterChip(
            selected.isNotEmpty(),
            { open = true },
            label = { Text(ProjectFilter.label(selected) { names[it] ?: it }) },
        )
        DropdownMenu(expanded = open, onDismissRequest = {
            open = false
            search = ""
        }) {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                placeholder = { Text("Find a project") },
                singleLine = true,
                modifier = Modifier.padding(horizontal = 8.dp).widthIn(max = 280.dp),
            )
            for ((slug, name) in ProjectFilter.rows(names.entries.map { it.key to it.value }, search, allowNone)) {
                DropdownMenuItem(
                    text = { Text((if (slug in selected) "✓ " else "   ") + name) },
                    onClick = { onChange(if (slug in selected) selected - slug else selected + slug) },
                )
            }
            if (selected.isNotEmpty()) {
                DropdownMenuItem(text = { Text("Clear") }, onClick = { onChange(emptyList()) })
            }
        }
    }
}

@Composable
private fun CardRow(
    card: InboxCard,
    snapshot: WorkspaceSnapshot,
    selected: Boolean,
    onOpen: () -> Unit,
) {
    val project = card.project?.let { slug -> snapshot.projects.firstOrNull { it.slug == slug }?.label ?: slug }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .background(if (selected) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface)
            .clickable(onClick = onOpen)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(8.dp)
                .background(
                    if (card.read) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.primary,
                    CircleShape,
                ),
        )
        CategoryBox(card.category)
        Column(Modifier.weight(1f)) {
            Text(
                card.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontWeight = if (card.read) FontWeight.Normal else FontWeight.Bold,
            )
            Text(
                listOfNotNull(
                    project,
                    card.conversationName,
                    card.urgency.takeIf { it == "high" }?.let { "high urgency" },
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(clockTime(card.lastMessageAt), style = MaterialTheme.typography.bodySmall)
    }
}

/** A card as its own screen (spec inbox-cards "Phone Inbox"): the parts and actions of the desktop dialog. */
@Composable
fun CardScreen(
    card: InboxCard,
    snapshot: WorkspaceSnapshot,
    onSet: (read: Boolean?, done: Boolean?, category: String?) -> Unit,
    onProject: (String?) -> Unit,
    creating: Boolean,
    onReply: (String) -> Unit,
    onAsk: (String) -> Unit,
    onCreateTask: (NewTaskDraft) -> Unit,
    onOpenTask: (String) -> Unit,
) {
    // Opening a card marks it read, once per card: a rotation or a resize does not mark it again
    // after "Mark unread".
    var marked by rememberSaveable(card.card) { mutableStateOf(false) }
    LaunchedEffect(card.card) {
        if (!marked) {
            marked = true
            if (!card.read) onSet(true, null, null)
        }
    }
    var menu by remember { mutableStateOf(false) }
    var projectMenu by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            CategoryBox(card.category)
            Text(card.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box {
                FilterChip(false, { menu = true }, label = { Text("${CATEGORY_LABEL[card.category]} ▾") })
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    for (key in listOf("action", "question", "info")) {
                        DropdownMenuItem(text = { Text(CATEGORY_LABEL[key]!!) }, onClick = {
                            menu = false
                            if (key != card.category) onSet(null, null, key)
                        })
                    }
                }
            }
            Box {
                FilterChip(false, { projectMenu = true }, label = { Text("${projectLabel(snapshot, card.project)} ▾") })
                DropdownMenu(expanded = projectMenu, onDismissRequest = { projectMenu = false }) {
                    DropdownMenuItem(text = { Text("No project") }, onClick = {
                        projectMenu = false
                        if (card.project != null) onProject(null)
                    })
                    for (p in snapshot.openProjects) {
                        DropdownMenuItem(text = { Text(p.label) }, onClick = {
                            projectMenu = false
                            if (p.slug != card.project) onProject(p.slug)
                        })
                    }
                }
            }
        }
        Text(
            "${card.urgency} urgency · ${card.conversationName} · ${clockTime(card.lastMessageAt)}",
            style = MaterialTheme.typography.bodySmall,
            color = muted(),
        )
        // Done and Mark unread at the top, as in the footer of the desktop dialog: no scroll to reach them.
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { onSet(null, !card.done, null) }) { Text(if (card.done) "Not done" else "Done") }
            OutlinedButton(
                onClick = { onSet(!card.read, null, null) },
            ) { Text(if (card.read) "Mark unread" else "Mark read") }
        }
        if (card.summary.isNotBlank()) Text(card.summary)
        when (card.category) {
            "action" -> TaskPart(card, snapshot, creating, onCreateTask, onOpenTask)
            "question" -> AnswerPart(card, onReply)
        }
        CardSection("Messages")
        for (m in card.messages) {
            Column {
                Text("${m.author}  ${clockTime(m.at)}", style = MaterialTheme.typography.labelMedium)
                m.quote?.let { Text("> $it", style = MaterialTheme.typography.bodySmall) }
                Text(m.text)
            }
        }
        CardSection("Ask the agent")
        for (c in card.chat.filter { it.kind != "task" }) {
            Column {
                Text(if (c.kind == "ask") "You" else "Agent", style = MaterialTheme.typography.labelMedium)
                Text(c.text)
            }
        }
        if (card.chat.any { it.kind == "ask" && it.answered == false }) Text("The agent works on it…")
        var ask by rememberSaveable(card.card) { mutableStateOf("") }
        // The field and Send on one line, both 36 dp, as on the desktop.
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                ask,
                { ask = it },
                placeholder = { Text("Ask about this card") },
                modifier = Modifier.weight(1f),
            )
            Button(enabled = ask.isNotBlank(), onClick = {
                onAsk(ask)
                ask = ""
            }) { Text("Send") }
        }
        Spacer(Modifier.heightIn(min = 24.dp))
    }
}

@Composable
private fun TaskPart(
    card: InboxCard,
    snapshot: WorkspaceSnapshot,
    creating: Boolean,
    onCreateTask: (NewTaskDraft) -> Unit,
    onOpenTask: (String) -> Unit,
) {
    for (task in card.tasks) {
        val key = snapshot.task(task)?.key
        TextButton(onClick = { onOpenTask(task) }) { Text("${key ?: "Task"} created · Open task") }
    }
    val suggested = card.taskTitle
    if (card.tasks.isNotEmpty() || suggested == null) return
    var form by rememberSaveable(card.card) { mutableStateOf(false) }
    var title by rememberSaveable(card.card) { mutableStateOf(suggested) }
    var project by rememberSaveable(card.card) { mutableStateOf(card.taskProject ?: card.project ?: "") }
    var first by rememberSaveable(card.card) { mutableStateOf(card.taskFirstMessage ?: "") }
    var pick by remember { mutableStateOf(false) }
    CardSection(if (form) "New task" else "Suggested task")
    if (!form) {
        Text(suggested)
        Text(if (project.isEmpty()) "Choose a project" else project, style = MaterialTheme.typography.bodySmall)
        Button(onClick = { form = true }) { Text("Create task…") }
        return
    }
    OutlinedTextField(title, { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth())
    Box {
        OutlinedButton(onClick = { pick = true }) { Text(if (project.isEmpty()) "Choose a project" else project) }
        DropdownMenu(expanded = pick, onDismissRequest = { pick = false }) {
            for (p in snapshot.openProjects) {
                DropdownMenuItem(text = { Text(p.label) }, onClick = {
                    project = p.slug
                    pick = false
                })
            }
        }
    }
    OutlinedTextField(first, {
        first = it
    }, label = { Text("First message") }, modifier = Modifier.fillMaxWidth(), minLines = 4)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        // A task always has a project (decision of 2026-11-27).
        Button(enabled = !creating && project.isNotEmpty() && project != NO_PROJECT && title.isNotBlank(), onClick = {
            onCreateTask(NewTaskDraft(project = project, firstMessage = first, title = title))
            form = false
        }) { Text("Create task") }
        TextButton(onClick = { form = false }) { Text("Cancel") }
    }
}

@Composable
private fun AnswerPart(
    card: InboxCard,
    onReply: (String) -> Unit,
) {
    var replying by rememberSaveable(card.card) { mutableStateOf(false) }
    var text by rememberSaveable(card.card) { mutableStateOf(card.answer ?: "") }
    CardSection(if (replying) "Reply" else "Suggested answer")
    if (!replying) {
        card.answer?.let { Text(it + (card.answerFrom?.let { from -> " · $from" } ?: "")) }
        card.replies.lastOrNull()?.let { r ->
            Text(
                when (r.state) {
                    "sent" -> "Sent"
                    "failed" -> "Not sent: ${r.error ?: "error"}"
                    else -> "Not synced: the collecting computer sends it"
                },
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Button(onClick = {
            // Each reply starts from the current answer: the agent can have changed it.
            text = card.answer ?: ""
            replying = true
        }) { Text("Reply…") }
        return
    }
    OutlinedTextField(text, { text = it }, label = { Text("Reply") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
    Text("${card.conversationName} · in the thread", style = MaterialTheme.typography.bodySmall)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(enabled = text.isNotBlank(), onClick = {
            onReply(text)
            replying = false
        }) { Text("Send") }
        TextButton(onClick = { replying = false }) { Text("Cancel") }
    }
}

/** The name of the project of a card, or "No project". */
private fun projectLabel(
    snapshot: WorkspaceSnapshot,
    project: String?,
): String =
    if (project == null) {
        "No project"
    } else {
        snapshot.openProjects.firstOrNull { it.slug == project }?.label ?: project
    }

/** The title of a part of the card screen: the label style with no side padding (the screen has it). */
@Composable
private fun CardSection(text: String) =
    Text(text, style = AwType.label, color = muted(), modifier = Modifier.padding(top = 8.dp))
