package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.SessionOptionRows
import com.agentworkspace.control.SessionOptionTexts
import com.agentworkspace.control.SessionOptionsDraft
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.control.WorktreeRule
import com.agentworkspace.shared.merge.SessionOptions
import com.agentworkspace.shared.merge.TaskView

// The session options on the phone (openspec session-options): the Session section of New task and
// New session, the chips of the task header, the rows of the Session view, and Stop session.

private val draftSaver =
    listSaver<SessionOptionsDraft, Any?>(
        save = { listOf(it.permissionMode, it.agentTeams, it.workIn, it.folder, it.switchBranch) },
        restore = {
            SessionOptionsDraft(it[0] as String?, it[1] as Boolean, it[2] as String, it[3] as String, it[4] as Boolean)
        },
    )

/** A draft that survives a rotation; [key] starts a new draft (another project or task). */
@Composable
fun rememberSessionOptionsDraft(
    key: Any?,
    initial: () -> SessionOptionsDraft = { SessionOptionsDraft() },
): MutableState<SessionOptionsDraft> = rememberSaveable(key, stateSaver = draftSaver) { mutableStateOf(initial()) }

/**
 * The Session section: the permission mode, agent teams and where the session works. The chip
 * "Project default" stands for no mode of the task, as on the desktop. [assignee] names the device of the
 * folder field. [worktreeAvailable] false disables "Separate worktree" with the hint ([WorktreeRule]);
 * the caller gives the fitting draft ([SessionOptionsDraft.fitting]).
 */
@Composable
fun SessionOptionsFields(
    draft: SessionOptionsDraft,
    onChange: (SessionOptionsDraft) -> Unit,
    projectMode: String?,
    assignee: String?,
    worktreeAvailable: Boolean = true,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Session", style = MaterialTheme.typography.titleSmall)
        Text("Permissions", style = MaterialTheme.typography.labelLarge)
        // The same choices as the desktop menu: the project default, then each mode.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = draft.permissionMode == null,
                onClick = { onChange(draft.copy(permissionMode = null)) },
                label = { Text(SessionOptionTexts.projectDefaultLabel(projectMode)) },
            )
            for (m in SessionOptionTexts.MODES) {
                FilterChip(
                    selected = m == draft.permissionMode,
                    onClick = { onChange(draft.copy(permissionMode = m)) },
                    label = { Text(SessionOptionTexts.modeLabel(m)) },
                )
            }
        }
        OptionSwitch(SessionOptionTexts.TEAMS, draft.agentTeams) { onChange(draft.copy(agentTeams = it)) }
        Text("Works in", style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (w in SessionOptionTexts.WORK_IN) {
                FilterChip(
                    selected = w == draft.workIn,
                    onClick = { onChange(draft.copy(workIn = w)) },
                    label = { Text(SessionOptionTexts.workInLabel(w)) },
                    enabled = w != SessionOptions.WORKTREE || worktreeAvailable,
                )
            }
        }
        if (!worktreeAvailable) {
            Text(SessionOptionTexts.NO_COMMIT_HINT, style = MaterialTheme.typography.bodySmall, color = muted())
        }
        if (draft.workIn == SessionOptions.CHECKOUT) {
            OptionSwitch(SessionOptionTexts.SWITCH_BRANCH, draft.switchBranch) {
                onChange(draft.copy(switchBranch = it))
            }
            if (!draft.switchBranch) {
                Text(SessionOptionTexts.NO_SWITCH_HELP, style = MaterialTheme.typography.bodySmall, color = muted())
            }
        }
        if (draft.workIn == SessionOptions.FOLDER) {
            OutlinedTextField(
                value = draft.folder,
                onValueChange = { onChange(draft.copy(folder = it)) },
                label = { Text(SessionOptionTexts.folderLabel(assignee)) },
                supportingText = { Text("An absolute path, for example /work/billing-api.") },
                isError = draft.folder.isNotBlank() && !draft.folder.trim().startsWith("/"),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        for (warning in SessionOptionTexts.warnings(draft, projectMode)) {
            Text(warning, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        }
    }
}

/** A row with a label and a switch; the whole row toggles. */
@Composable
private fun OptionSwitch(
    label: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** The chips of the task header: a red "Skips permissions" and "Agent teams". */
@Composable
fun SessionOptionChips(
    task: TaskView,
    projectMode: String?,
) {
    val skips = SessionOptionRows.skipsPermissions(task, projectMode)
    val teams = SessionOptionRows.agentTeams(task, projectMode)
    if (!skips && !teams) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (skips) {
            AssistChip(
                onClick = {},
                label = { Text(SessionOptionTexts.SKIP_CHIP) },
                colors =
                    AssistChipDefaults.assistChipColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        labelColor = MaterialTheme.colorScheme.onErrorContainer,
                    ),
                border = AssistChipDefaults.assistChipBorder(true, borderColor = MaterialTheme.colorScheme.error),
            )
        }
        if (teams) AssistChip(onClick = {}, label = { Text(SessionOptionTexts.TEAMS_CHIP) })
    }
}

/** The rows "Permissions", "Agent teams" and "Works in" of the Session view. */
fun LazyListScope.sessionOptionItems(
    task: TaskView,
    projectMode: String?,
) {
    items(SessionOptionRows.rows(task, projectMode), key = { "options-${it.first}" }) { (label, value) ->
        Row(Modifier.fillMaxWidth().widthIn(max = MaxContentWidth).padding(horizontal = 16.dp, vertical = 2.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(LABEL_SHARE))
            SelectionContainer(Modifier.weight(1f - LABEL_SHARE)) {
                Text(value, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/**
 * "New session" when no session runs. It opens a dialog with the agent and the Session section, then
 * assigns the task with them. "Stop session" is in the "⋯" menu of the header (openspec task-actions).
 */
@Composable
fun SessionActions(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    onNewSession: (assignee: String, options: SessionOptionsDraft?) -> Unit,
) {
    if (task.archived || task.stage == "done") return
    var newSession by rememberSaveable(task.id) { mutableStateOf(false) }
    if (!ScreenStates.canMessage(task) && task.assignee != null) {
        TextButton(onClick = { newSession = true }) { Text("New session") }
    }
    if (newSession) {
        NewSessionDialog(task, snapshot, onClose = { newSession = false }) { assignee, options ->
            newSession = false
            onNewSession(assignee, options)
        }
    }
}

/**
 * New session: the agent (the assignee is selected) and the Session section with the task values
 * ("Agent teams" on for a task with no options). "Separate worktree" follows [WorktreeRule] for the
 * device of the selected agent.
 */
@Composable
private fun NewSessionDialog(
    task: TaskView,
    snapshot: WorkspaceSnapshot,
    onClose: () -> Unit,
    onStart: (String, SessionOptionsDraft?) -> Unit,
) {
    val choices = ScreenStates.agentChoices(snapshot, task.project, task.assignee)
    var assignee by rememberSaveable(task.id) { mutableStateOf(task.assignee ?: choices.firstOrNull()) }
    val initial = SessionOptionsDraft.of(task)
    var draft by rememberSessionOptionsDraft(task.id) { SessionOptionsDraft.forNewSession(task) }
    val projectMode = SessionOptionRows.projectMode(task, snapshot.projects)
    val worktreeAvailable = WorktreeRule.available(snapshot, assignee, task.project)
    val shown = draft.fitting(worktreeAvailable)
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("New session") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Agent", style = MaterialTheme.typography.labelLarge)
                if (choices.isEmpty()) Text("No device of this project can run an agent.")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (choice in choices) {
                        FilterChip(
                            selected = assignee == choice,
                            onClick = { assignee = choice },
                            label = { Text(choice) },
                        )
                    }
                }
                SessionOptionsFields(shown, { draft = it }, projectMode, assignee, worktreeAvailable)
            }
        },
        confirmButton = {
            TextButton(
                enabled = assignee != null,
                onClick = { assignee?.let { onStart(it, shown.changedFrom(initial)) } },
            ) { Text("Start session") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}

/** The share of the row width for the field label, as the other field rows. */
private const val LABEL_SHARE = 0.35f
