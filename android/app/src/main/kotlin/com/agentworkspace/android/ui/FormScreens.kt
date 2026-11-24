package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedSecureTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.editableText
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentworkspace.android.R
import com.agentworkspace.control.NewTaskChoices
import com.agentworkspace.control.NewTaskDraft
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.WorkspaceSnapshot

/**
 * New task (docs/workflow.md 4.1) with each field of the desktop New task (openspec
 * polish-skip-default): the first message, the title, the project, the assignee and "Start the
 * agent now", the test server, the parent task, the credential names and the session options
 * ("Skip permissions" preselected). With no assignee the task opens "Needs you: assign".
 */
@Composable
fun NewTaskScreen(
    snapshot: WorkspaceSnapshot,
    creating: Boolean,
    onCreate: (NewTaskDraft) -> Unit,
    onCancel: () -> Unit,
) {
    var project by rememberSaveable { mutableStateOf(snapshot.openProjects.firstOrNull()?.slug) }
    var message by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    // The choices of one project: another project starts with none, so the form never sends an
    // assignee, a test server or a parent that it does not show (android-ui M4).
    var assignee by rememberSaveable(project) { mutableStateOf<String?>(null) }
    var testServer by rememberSaveable(project) { mutableStateOf<String?>(null) }
    var parent by rememberSaveable(project) { mutableStateOf<String?>(null) }
    var credentials by rememberSaveable { mutableStateOf(listOf<String>()) }
    // The session options (openspec session-options), "Skip permissions" first (polish-skip-default).
    var options by rememberSessionOptionsDraft(Unit) { NewTaskDraft.START_OPTIONS }
    val projectMode = snapshot.projects.firstOrNull { it.slug == project }?.permissionMode
    val servers = ScreenStates.testServers(snapshot, project)
    val start = NewTaskChoices.startAgent(snapshot, project)
    // The form scrolls above a pinned action bar, so "Create task" shows with no scroll (prc-16).
    Column(Modifier.fillMaxSize().imePadding()) {
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
                .widthIn(max = MaxContentWidth),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("New task", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = message,
                onValueChange = { message = it },
                label = { Text("First message") },
                supportingText = {
                    Text("Write what you want. You can start with a command of your workflow. AW passes it as is.")
                },
                minLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Title (optional)") },
                supportingText = { Text("Empty: the first line of the first message.") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Project", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (p in snapshot.openProjects) {
                    FilterChip(selected = p.slug == project, onClick = { project = p.slug }, label = { Text(p.slug) })
                }
            }
            if (snapshot.openProjects.isEmpty()) Text("The workspace has no project yet. Create one on a computer.")
            Text("Assignee (optional)", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = assignee == null, onClick = { assignee = null }, label = { Text("None") })
                for (choice in ScreenStates.agentChoices(snapshot, project)) {
                    FilterChip(selected = assignee == choice, onClick = { assignee = choice }, label = { Text(choice) })
                }
            }
            SwitchRow(
                label = "Start the agent now",
                checked = assignee != null,
                enabled = start != null,
                onChange = { on -> assignee = if (on) start else null },
            )
            Text(
                when {
                    start == null -> "The project has no device. Add a device in the project settings on a computer."
                    assignee != null -> "Assigns $assignee. It starts when its device gets the task."
                    else -> "Off: the task waits in \u201cNeeds you: assign\u201d. AW never assigns a task alone."
                },
                style = MaterialTheme.typography.bodySmall,
                color = muted(),
            )
            Text("Test server", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = testServer == null, onClick = { testServer = null }, label = { Text("None") })
                for (server in servers) {
                    FilterChip(
                        selected = testServer == server,
                        onClick = { testServer = server },
                        label = { Text(server) },
                    )
                }
            }
            ChoiceMenu(
                label = "Parent task",
                choices = NewTaskChoices.parentChoices(snapshot, project),
                selected = parent,
                onSelect = { parent = it },
            )
            CredentialChips(NewTaskChoices.credentialNames(snapshot), credentials) { credentials = it }
            SessionOptionsFields(options, { options = it }, projectMode, assignee)
        }
        HorizontalDivider()
        Surface(tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth()) {
            Row(
                Modifier
                    .widthIn(max = MaxContentWidth)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onCancel) { Text("Cancel") }
                Button(
                    enabled = NewTaskDraft.canCreate(project, message, creating),
                    onClick = {
                        onCreate(
                            NewTaskDraft(
                                project = project.orEmpty(),
                                firstMessage = message,
                                assignee = assignee,
                                testServer = testServer,
                                credentials = credentials,
                                parent = parent,
                                sessionOptions = options,
                                title = title,
                            ),
                        )
                    },
                ) { Text("Create task") }
            }
        }
    }
}

/** A row with a label and a switch; the whole row toggles. */
@Composable
private fun SwitchRow(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

/** One choice of a list, with "None": an outlined button that opens a menu (the desktop select). */
@Composable
private fun ChoiceMenu(
    label: String,
    choices: List<Pair<String, String>>,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    Text(label, style = MaterialTheme.typography.labelLarge)
    Box {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text(
                choices.firstOrNull { it.first == selected }?.second ?: "None",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            AwIcon(R.drawable.ic_expand, null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("None") }, onClick = {
                onSelect(null)
                open = false
            })
            for ((id, text) in choices) {
                DropdownMenuItem(text = { Text(text, maxLines = 2, overflow = TextOverflow.Ellipsis) }, onClick = {
                    onSelect(id)
                    open = false
                })
            }
        }
    }
}

/**
 * The credential names as chips: the names that the workspace uses, and a field to add another
 * name. Names only: the values stay encrypted on the implementing devices.
 */
@Composable
private fun CredentialChips(
    known: List<String>,
    selected: List<String>,
    onChange: (List<String>) -> Unit,
) {
    var other by rememberSaveable { mutableStateOf("") }
    Text("Credentials", style = MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (name in (known + selected).distinct()) {
            val on = name in selected
            FilterChip(
                selected = on,
                onClick = { onChange(if (on) selected - name else selected + name) },
                label = { Text(name) },
            )
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = other,
            onValueChange = { other = it.lowercase().trim() },
            label = { Text("Another name, for example github-token") },
            singleLine = true,
            modifier = Modifier.weight(1f),
        )
        TextButton(enabled = other.isNotBlank(), onClick = {
            if (other !in selected) onChange(selected + other)
            other = ""
        }) { Text("Add") }
    }
    Text(
        "Names only. The values stay encrypted on the implementing devices.",
        style = MaterialTheme.typography.bodySmall,
        color = muted(),
    )
}

/**
 * Add or replace a credential (docs/phase-1.md 10.2): the phone seals the value to the paired
 * computers and cannot read it again. The value is never shown again, logged or saved in the state.
 */
@Composable
fun CredentialScreen(
    available: Boolean,
    onAdd: (name: String, value: CharArray) -> Unit,
    onCancel: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    // Not saveable: the value must not go to the saved instance state.
    val value = remember { TextFieldState() }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
            .widthIn(max = MaxContentWidth),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Add credential", style = MaterialTheme.typography.headlineSmall)
        Text(
            if (available) {
                "The phone seals the value to your paired computers. After this, the phone cannot read it."
            } else {
                "Credential add needs a paired computer. Pair this phone first."
            },
        )
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.lowercase() },
            label = { Text("Name, for example github-token") },
            singleLine = true,
            enabled = available,
            modifier = Modifier.fillMaxWidth(),
        )
        // Accessibility services get only the masked value: the secure field gives them the clear text
        // (fix list 0-37). The outer semantics of the same node replace its editable text.
        val masked = AnnotatedString(MASK.toString().repeat(value.text.length))
        OutlinedSecureTextField(
            state = value,
            label = { Text("Value") },
            enabled = available,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth().semantics { editableText = masked },
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = available && name.isNotBlank() && value.text.isNotEmpty(), onClick = {
                val chars = CharArray(value.text.length) { value.text[it] }
                value.clearText()
                onAdd(name, chars)
            }) { Text("Seal and add") }
            TextButton(onClick = onCancel) { Text("Cancel") }
        }
    }
}

/** The mask character of a secret value, as on the screen. */
private const val MASK = '\u2022'
