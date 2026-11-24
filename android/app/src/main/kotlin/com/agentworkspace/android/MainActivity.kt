package com.agentworkspace.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import android.view.Menu
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.agentworkspace.android.push.GateNotifications
import com.agentworkspace.android.ui.AppViewModel
import com.agentworkspace.android.ui.AwApp
import com.agentworkspace.android.ui.AwTheme
import com.agentworkspace.control.Shortcut

/**
 * The one activity of the app: the adaptive Compose screens (docs/phase-1.md 10.7). The manifest
 * handles each configuration change, so a fold, a resize or a keyboard attach keeps the activity and
 * its back stack. A tap on a gate notification opens the workspace of the push and `[Inbox, Task(id)]`.
 */
class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels { viewModelFactory { initializer { AppViewModel(application.graph) } } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        GateNotifications.createChannel(this)
        if (savedInstanceState == null) openFrom(intent)
        setContent { AwTheme { AwApp(vm) } }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_REQUEST)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openFrom(intent)
    }

    override fun onResume() {
        super.onResume()
        vm.resumed()
    }

    /**
     * Reads "open task" only from an intent of AW's own notifications (owner decision Q9): they start the
     * activity through the alias `.OpenFromNotification`, which the manifest does not export. Another app
     * can start the exported launcher component only, so its extras change nothing.
     */
    private fun openFrom(intent: Intent?) {
        if (intent?.component?.className != GateNotifications.OPEN_ALIAS) return
        val workspace = intent.getStringExtra(GateNotifications.EXTRA_WORKSPACE)
        val task = intent.getStringExtra(GateNotifications.EXTRA_TASK)
        if (workspace == null && task == null) return
        vm.openFromPush(workspace, task)
    }

    /** The shortcuts for Meta+/ (docs/engineering-rules.md 5.21). */
    override fun onProvideKeyboardShortcuts(
        data: MutableList<KeyboardShortcutGroup>,
        menu: Menu?,
        deviceId: Int,
    ) {
        val items =
            listOf(
                KeyboardShortcutInfo(Shortcut.NEW_TASK.label, KeyEvent.KEYCODE_N, KeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo(Shortcut.SYNC_NOW.label, KeyEvent.KEYCODE_R, KeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo(Shortcut.CLOSE.label, KeyEvent.KEYCODE_ESCAPE, 0),
                KeyboardShortcutInfo("Send", KeyEvent.KEYCODE_ENTER, 0),
            )
        data.add(KeyboardShortcutGroup(getString(R.string.app_name), items))
    }

    private companion object {
        const val NOTIFICATION_REQUEST = 1
    }
}
