package com.agentworkspace.android.ui

import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.agentworkspace.android.R
import com.agentworkspace.control.DeviceRowState
import com.agentworkspace.control.PushState
import com.agentworkspace.engine.EngineState

/**
 * Devices: this phone (engine state, battery mode, push), then each device with its role, presence
 * and sync state, and the sync engine license with the third-party notices (raw resource).
 */
@Composable
fun DevicesScreen(
    devices: List<DeviceRowState>,
    engine: EngineState,
    push: PushState,
    battery: Boolean,
    issues: Int,
    syncing: Boolean,
    syncText: String?,
    syncthingTag: String,
    onBattery: () -> Unit,
    onSyncNow: () -> Unit,
    onAddCredential: () -> Unit,
    onPair: () -> Unit,
    mobileData: Boolean = false,
    onMobileData: (Boolean) -> Unit = {},
    keyReplaced: Boolean = false,
    onKeyReplacedRead: () -> Unit = {},
) {
    val uri = LocalUriHandler.current
    var notices by remember { mutableStateOf(false) }
    if (notices) NoticesDialog(onClose = { notices = false })
    LazyColumn(Modifier.fillMaxSize().focusGroup()) {
        item { SectionHeader("This phone") }
        item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text("Sync engine: ${engineText(engine)}", style = MaterialTheme.typography.bodyLarge)
                Text(pushText(push), style = MaterialTheme.typography.bodySmall)
                if (issues > 0) {
                    Text("Sync problem: $issues files could not be read", color = MaterialTheme.colorScheme.error)
                }
            }
        }
        if (battery) item { BatteryWarning(onBattery) }
        if (keyReplaced) {
            item {
                WarningCard(
                    "This phone could not read its device key and made a new one. The workspaces that it joined " +
                        "before have the old key: remove this phone there on a computer, then pair it again.",
                    "OK",
                    onKeyReplacedRead,
                )
            }
        }
        item { SyncNowRow(syncing, syncText, onSyncNow) }
        item {
            // Artifacts on request (docs/phase-1.md 10.3): mobile data only when the person allows it.
            Row(
                Modifier
                    .fillMaxWidth()
                    .toggleable(value = mobileData, role = Role.Switch, onValueChange = onMobileData)
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Use mobile data for artifacts", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        "Off: Download of an artifact works only on Wi-Fi.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Switch(checked = mobileData, onCheckedChange = null)
            }
        }
        item {
            FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAddCredential) { Text("Add credential") }
                OutlinedButton(onClick = onPair) { Text("Join another workspace") }
            }
        }
        item { SectionHeader("Devices · ${devices.size}") }
        if (devices.isEmpty()) item { EmptyText("No device record yet. The records arrive with the first sync.") }
        items(devices, key = { it.slug }) { DeviceLine(it) }
        item { SectionHeader("About") }
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(
                    "The sync engine is Syncthing $syncthingTag (Mozilla Public License 2.0), " +
                        "built from the unchanged source.",
                    style = MaterialTheme.typography.bodySmall,
                )
                TextButton(onClick = { uri.openUri("$SYNCTHING_REPO/tree/$syncthingTag") }) { Text("Syncthing source") }
                TextButton(onClick = {
                    uri.openUri("$SYNCTHING_REPO/blob/$syncthingTag/LICENSE")
                }) { Text("Syncthing license") }
                TextButton(onClick = { notices = true }) { Text("Third-party notices") }
            }
        }
    }
}

private const val SYNCTHING_REPO = "https://github.com/syncthing/syncthing"

/** The file THIRD_PARTY_NOTICES of the repository, shipped as `res/raw/third_party_notices.txt`. */
@Composable
private fun NoticesDialog(onClose: () -> Unit) {
    val resources = LocalResources.current
    val text =
        remember(resources) {
            resources
                .openRawResource(R.raw.third_party_notices)
                .bufferedReader()
                .use { it.readText() }
        }
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClick = onClose) { Text("Close") } },
        title = { Text("Third-party notices") },
        text = {
            Text(
                text,
                modifier = Modifier.verticalScroll(rememberScrollState()),
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
            )
        },
    )
}

internal fun engineText(state: EngineState): String =
    when (state) {
        EngineState.RUNNING -> "running"
        EngineState.STARTING -> "starting"
        EngineState.RESTARTING -> "restarting"
        EngineState.STOPPED -> "stopped"
        EngineState.FAILED -> "failed, it tries again"
        EngineState.NOT_INSTALLED -> "not installed in this build"
    }

private fun pushText(state: PushState): String =
    when (state) {
        PushState.ON -> {
            "Push: on"
        }

        PushState.REGISTERING -> {
            "Push: registering"
        }

        PushState.WAITING_FOR_COMPUTERS -> {
            "Push waits for the computers: none publishes a push key yet"
        }

        PushState.FAILED -> {
            "Push is off: the registration failed. Check Google Play services or your UnifiedPush app"
        }

        PushState.NO_DISTRIBUTOR -> {
            "Push is off: no push service on this phone (Google Play services, or a UnifiedPush app like ntfy)"
        }
    }
