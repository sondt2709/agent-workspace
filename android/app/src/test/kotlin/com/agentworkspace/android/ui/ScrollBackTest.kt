package com.agentworkspace.android.ui

import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A row that scrolls back keeps its height (openspec phone-desktop-parity): a LazyColumn disposes a
 * row off the screen, and a long gate text that comes back must show "Show more" in its first frame.
 * A second layout pass adds the button later, and the list jumps while the person scrolls up.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w412dp-h900dp-xxhdpi")
class ScrollBackTest {
    @get:Rule
    val compose = createComposeRule()

    private companion object {
        const val FRAMES_MS = 2_000L
    }

    @Test
    fun aGateTextThatComesBackHasShowMoreInItsFirstFrame() {
        val text = (1..40).joinToString("\n\n") { "Line $it of the plan." }
        var shown by mutableStateOf(true)
        compose.setContent {
            AwTheme { Surface { if (shown) GateText(text, "scroll-back-test") } }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Show more").assertIsDisplayed()

        // The row leaves the screen, then comes back: one frame only, no second layout pass.
        shown = false
        compose.waitForIdle()
        compose.onNodeWithText("Show more").assertDoesNotExist()
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread { shown = true }
        // Frame by frame until the text is back; "Show more" must be in that same frame.
        compose.mainClock.advanceTimeUntil(FRAMES_MS) {
            compose.onAllNodesWithText("Line 1 of the plan.", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Show more").assertExists()
    }
}
