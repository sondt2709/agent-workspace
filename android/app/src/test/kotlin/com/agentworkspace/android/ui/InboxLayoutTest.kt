package com.agentworkspace.android.ui

import androidx.compose.material3.Surface
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import com.agentworkspace.control.InboxCards
import com.agentworkspace.control.WorkspaceSnapshot
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.nio.file.Files
import java.nio.file.Path

/**
 * The layout of the phone Inbox (openspec inbox-mattermost), checked on the emulator on 2026-11-28:
 * "Run now" was a 36 dp button at the end of the 32 dp filter chips, out of view at 412 dp; Done and
 * Mark unread were at the end of the card screen, under the ask field.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w412dp-h900dp-xxhdpi")
class InboxLayoutTest {
    @get:Rule
    val compose = createComposeRule()

    private val snapshot: WorkspaceSnapshot by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        val expected =
            Json.parseToJsonElement(
                Files.readString(dir.resolve("fixtures/merge/inbox-cards/expected.json")),
            )
        val view = expected.jsonObject.getValue("view").jsonObject
        WorkspaceSnapshot(
            workspace = "demo",
            phone = "pixel-9",
            keyPrefix = "AW",
            tasks = emptyList(),
            projects = emptyList(),
            devices = emptyList(),
            presence = emptyList(),
            issues = emptyList(),
            gateTexts = emptyMap(),
            bindings = emptyMap(),
            cards = InboxCards.fromView(view),
            sources = (view["sources"] as? JsonArray)?.map { it.jsonObject }.orEmpty(),
        )
    }

    @Test
    fun runNowIsInTheTitleRowAndInView() {
        compose.setContent { AwTheme { Surface { InboxScreen(snapshot, openCard = null, onOpen = {}, onRun = {}) } } }
        compose.onNodeWithText("Run now").assertIsDisplayed().assertHeightIsEqualTo(36.dp)
    }

    @Test
    fun theCardActionsAreInViewAndOneHeight() {
        val card = snapshot.cards.first { it.category == "question" }
        compose.setContent {
            AwTheme {
                Surface {
                    CardScreen(card, snapshot, { _, _, _ -> }, {}, false, {}, {}, {}, {})
                }
            }
        }
        compose.onNodeWithText("Done").assertIsDisplayed().assertHeightIsEqualTo(36.dp)
        val unread = if (card.read) "Mark unread" else "Mark read"
        compose.onNodeWithText(unread).assertIsDisplayed().assertHeightIsEqualTo(36.dp)
        // Done is at the top, above the messages, not at the end under the ask field.
        val done = compose.onNodeWithText("Done").getUnclippedBoundsInRoot().top
        val messages = compose.onNodeWithText("Messages").getUnclippedBoundsInRoot().top
        assertTrue("Done at $done is not above Messages at $messages", done < messages)
    }
}
