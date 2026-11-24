package com.agentworkspace.android.ui

import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import com.agentworkspace.control.Shortcut

/** The key name of a key event for [Shortcut.of]: a letter or `Escape`, else null. */
fun KeyEvent.shortcut(): Shortcut? {
    if (type != KeyEventType.KeyDown) return null
    val name =
        when (key) {
            Key.Escape -> "Escape"
            Key.N -> "N"
            Key.R -> "R"
            else -> return null
        }
    return Shortcut.of(name, ctrl = isCtrlPressed, alt = isAltPressed)
}

/** Enter sends; Shift+Enter keeps the new line (docs/engineering-rules.md 5.21). */
fun Modifier.sendOnEnter(send: () -> Unit): Modifier =
    onPreviewKeyEvent { event ->
        val enter = event.key == Key.Enter || event.key == Key.NumPadEnter
        if (enter && !event.isShiftPressed && event.type == KeyEventType.KeyDown) {
            send()
            true
        } else {
            enter && !event.isShiftPressed && event.type == KeyEventType.KeyUp
        }
    }
