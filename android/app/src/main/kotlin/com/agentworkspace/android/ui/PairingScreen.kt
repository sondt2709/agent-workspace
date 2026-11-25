package com.agentworkspace.android.ui

import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.agentworkspace.android.QrScanner
import com.agentworkspace.control.PairingState
import com.agentworkspace.control.PairingStatus
import com.agentworkspace.control.PhonePairing

/** Android 17 (API 37): the local network permission (docs/phase-1.md 6.7.7). */
private const val API_LOCAL_NETWORK = 37
private const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

/**
 * "Pair with a computer" (docs/phase-1.md 7): scan the QR code of the computer or paste its code,
 * confirm the name of this phone (a phone that paired before keeps its name), then compare the check
 * code with the computer and approve there.
 * The code is not saved in the instance state: it holds the one-time secret.
 */
@Composable
fun PairingScreen(
    status: PairingStatus?,
    joining: Boolean,
    storedSlug: String?,
    onJoin: (code: String, name: String) -> Unit,
    onCancel: () -> Unit,
    onMessage: (String) -> Unit,
    onClose: (() -> Unit)?,
) {
    val context = LocalContext.current
    val scanner = remember(context) { QrScanner(context) }
    val scannerAvailable = remember(scanner) { scanner.available() }
    var code by remember { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf(Build.MODEL.orEmpty()) }
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            // A refusal does not block the join: sync then uses Tailscale, discovery or relays.
            pending?.invoke()
            pending = null
        }
    val needsPermission =
        Build.VERSION.SDK_INT >= API_LOCAL_NETWORK &&
            context.checkSelfPermission(LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED
    val open = status != null && !status.state.terminal

    fun join() {
        val action = { onJoin(code.trim(), name) }
        if (needsPermission) {
            pending = action
            permission.launch(LOCAL_NETWORK)
        } else {
            action()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
            .widthIn(max = MaxContentWidth),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Pair with a computer", style = MaterialTheme.typography.headlineSmall)
        if (open) {
            PairingProgress(checkNotNull(status), onCancel)
            return@Column
        }
        status?.let { PairingResult(it) }
        Text("On your computer, open Devices and select \"Add device\". Then scan the QR code, or paste the code.")
        if (scannerAvailable) {
            OutlinedButton(
                onClick = { scanner.scan(onCode = { code = it }, onError = onMessage) },
            ) { Text("Scan QR code") }
        }
        OutlinedTextField(
            value = code,
            onValueChange = { code = it },
            label = { Text("Pairing code (aw1:…)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth(),
        )
        if (storedSlug != null) {
            // A phone that paired before keeps its device name in each workspace.
            Text("This phone joins as $storedSlug", style = MaterialTheme.typography.bodyLarge)
        } else {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Name of this phone") },
                supportingText = { Text("Device name in AW: ${PhonePairing.slugOf(name)}") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (Build.VERSION.SDK_INT >= API_LOCAL_NETWORK) {
            Text(
                "AW asks for local network access, so this phone finds your computers on the same Wi-Fi. " +
                    "Without it, sync uses Tailscale or the internet path.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = !joining && code.isNotBlank(), onClick = { join() }) { Text("Join") }
            onClose?.let { TextButton(onClick = it) { Text("Close") } }
        }
    }
}

@Composable
private fun PairingProgress(
    status: PairingStatus,
    onCancel: () -> Unit,
) {
    Text("Check code", style = MaterialTheme.typography.titleMedium)
    Text(status.checkCode, style = MaterialTheme.typography.displayMedium.copy(fontFamily = MonoFont))
    when (status.state) {
        PairingState.WAITING -> {
            Text("Check that ${status.showing} shows the same code, then approve this phone there.")
            TextButton(onClick = onCancel) { Text("Cancel") }
        }

        else -> {
            Text("Approved. The files of ${status.workspaceName} sync now.")
        }
    }
}

@Composable
private fun PairingResult(status: PairingStatus) {
    val text =
        when (status.state) {
            PairingState.DONE -> "Paired with ${status.showing}. ${status.workspaceName} is on this phone."
            PairingState.CANCELLED -> "The pairing was cancelled."
            else -> status.error ?: "The pairing did not finish."
        }
    val color =
        if (status.state ==
            PairingState.DONE
        ) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.error
        }
    Text(text, color = color)
}
