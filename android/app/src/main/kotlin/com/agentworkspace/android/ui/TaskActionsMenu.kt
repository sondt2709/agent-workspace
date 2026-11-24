package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.agentworkspace.control.ConfirmText
import com.agentworkspace.control.TaskActions
import com.agentworkspace.shared.merge.TaskView

// The "⋯" menu of the task header (openspec task-actions): Stop session, Archive task and Unarchive
// task, with a confirm for Stop and Archive. The texts come from android/control TaskActions.

private enum class TaskConfirm { STOP, ARCHIVE }

@Composable
fun TaskActionsMenu(
    task: TaskView,
    onStop: () -> Unit,
    onArchive: () -> Unit,
    onUnarchive: () -> Unit,
) {
    var open by remember(task.id) { mutableStateOf(false) }
    var confirm by rememberSaveable(task.id) { mutableStateOf<TaskConfirm?>(null) }
    val canStop = TaskActions.canStop(task)
    Box {
        TextButton(
            onClick = { open = true },
            modifier = Modifier.semantics { contentDescription = "Task actions" },
        ) { Text("⋯", style = MaterialTheme.typography.titleLarge) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (canStop) {
                DropdownMenuItem(text = { Text("Stop session…") }, onClick = {
                    open = false
                    confirm = TaskConfirm.STOP
                })
            }
            if (task.archived) {
                DropdownMenuItem(text = { Text("Unarchive task") }, onClick = {
                    open = false
                    onUnarchive()
                })
            } else {
                DropdownMenuItem(
                    text = { Text("Archive task…", color = MaterialTheme.colorScheme.error) },
                    onClick = {
                        open = false
                        confirm = TaskConfirm.ARCHIVE
                    },
                )
            }
        }
    }
    // The session can end while the confirm is open: then the dialog goes away.
    if (confirm == TaskConfirm.STOP && canStop) {
        ConfirmDialog(TaskActions.stopConfirm(task), onClose = { confirm = null }, onConfirm = onStop)
    }
    if (confirm == TaskConfirm.ARCHIVE) {
        ConfirmDialog(TaskActions.archiveConfirm(task), onClose = { confirm = null }, onConfirm = onArchive)
    }
}

@Composable
private fun ConfirmDialog(
    text: ConfirmText,
    onClose: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(text.title) },
        text = { Text(text.body) },
        confirmButton = {
            TextButton(
                onClick = {
                    onClose()
                    onConfirm()
                },
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text(text.action) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}
