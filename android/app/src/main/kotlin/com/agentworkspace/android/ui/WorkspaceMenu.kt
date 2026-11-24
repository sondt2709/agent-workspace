package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Badge
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentworkspace.android.R
import com.agentworkspace.control.WorkspaceEntry

/** The widest name in the top bar; a longer name ends with "…". */
private val MaxNameWidth = 280.dp

/**
 * The workspace switcher (openspec phone-workspaces): the name of the shown workspace in the top bar
 * at each width class, and a menu with each joined workspace, its "Needs you" count and "Join another
 * workspace". The button and the items take touch, a keyboard (Tab, arrows, Enter) and a mouse.
 */
@Composable
fun WorkspaceMenu(
    entries: List<WorkspaceEntry>,
    onSelect: (String) -> Unit,
    onJoin: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val current = entries.firstOrNull { it.selected }
    Box {
        TextButton(onClick = { open = true }) {
            Text(
                current?.name ?: "Workspace",
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = MaxNameWidth),
            )
            AwIcon(R.drawable.ic_expand, "Switch workspace")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (entry in entries) {
                DropdownMenuItem(
                    text = { Text(entry.name) },
                    leadingIcon = {
                        if (entry.selected) AwIcon(R.drawable.ic_check, "Shown") else Spacer(Modifier.size(24.dp))
                    },
                    trailingIcon = { if (entry.needsYou > 0) Badge { Text("${entry.needsYou}") } },
                    onClick = {
                        open = false
                        onSelect(entry.id)
                    },
                )
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text("Join another workspace") },
                onClick = {
                    open = false
                    onJoin()
                },
            )
        }
    }
}
