package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The queue text of a task row (openspec phone-desktop-parity, "Queue on the phone"): a long chip
 * must not leave its cause one letter wide, which showed "starts soon" one letter per line.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w280dp-h800dp-xxhdpi")
class QueueChipTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun causeKeepsWholeWordsNextToALongChip() {
        compose.setContent {
            AwTheme {
                Box(Modifier.width(280.dp)) {
                    QueueChipView("Queued · 1st for claude@mac-mini-lab", "starts soon")
                }
            }
        }
        val cause = compose.onNodeWithText("starts soon").getBoundsInRoot()
        val width = cause.right - cause.left
        assertTrue("The cause \"starts soon\" is $width wide; it must be at least 40 dp", width >= 40.dp)
    }
}
