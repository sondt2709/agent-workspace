package com.agentworkspace.android.ui

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertTouchHeightIsEqualTo
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * One button style (openspec phone-desktop-parity, "Compact phone components"): the buttons of
 * Compact.kt are 36 dp high, as on the desktop, with a touch target of 48 dp.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w412dp-h900dp-xxhdpi")
class ControlHeightTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun buttonsAre36DpWithA48DpTouchTarget() {
        compose.setContent {
            AwTheme {
                androidx.compose.foundation.layout.Row {
                    Button(onClick = {}) { Text("New task") }
                    OutlinedButton(onClick = {}) { Text("Show list") }
                    TextButton(onClick = {}) { Text("Show more") }
                }
            }
        }
        for (label in listOf("New task", "Show list", "Show more")) {
            val button = compose.onNodeWithText(label, useUnmergedTree = false)
            button.assertHeightIsEqualTo(36.dp)
            button.assertTouchHeightIsEqualTo(48.dp)
        }
    }

    @Test
    fun aOneLineFieldIs36Dp() {
        compose.setContent {
            AwTheme {
                ControlField(value = "claude@ubuntu-01", onValueChange = {}, singleLine = true)
            }
        }
        compose.onNodeWithText("claude@ubuntu-01").assertHeightIsEqualTo(36.dp)
    }
}
