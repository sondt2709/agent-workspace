package com.agentworkspace.android.ui

import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import com.agentworkspace.control.InboxCards
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.TaskPageLayout
import com.agentworkspace.control.TerminalPaneState
import com.agentworkspace.control.ThreadWindow
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.shared.merge.WorkspaceView
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.nio.file.Files
import java.nio.file.Path

/**
 * The golden screenshots of the Tasks list and the task page (openspec phone-desktop-parity), dark
 * scheme, at a phone (412 dp), a Fold inner screen (840 dp) and a tablet (1240 dp). The tasks are the
 * merge view of the shared fixture `contracts/fixtures/merge/task-rules`. Record them with
 * `task android:screenshots:record`; `task android:screenshots` compares them.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScreensScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private val snapshot: WorkspaceSnapshot by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        val json = Json { ignoreUnknownKeys = true }
        val expected = Json.parseToJsonElement(Files.readString(dir.resolve("fixtures/merge/task-rules/expected.json")))
        val view = json.decodeFromJsonElement(WorkspaceView.serializer(), expected.jsonObject.getValue("view"))
        WorkspaceSnapshot(
            workspace = "demo",
            phone = "pixel-9",
            keyPrefix = "AW",
            tasks = view.tasks,
            projects = view.projects,
            devices = view.devices,
            presence = emptyList(),
            issues = emptyList(),
            gateTexts = emptyMap(),
            bindings = emptyMap(),
        )
    }

    private fun tasks(name: String) {
        compose.setContent {
            AwTheme {
                Surface {
                    TasksScreen(
                        snapshot,
                        updates = emptyList(),
                        openTask = null,
                        openItem = null,
                        onOpen = {},
                        onOpenItem = {},
                        onSyncNow = {},
                        nowMs = NOW,
                    ) {}
                }
            }
        }
        compose.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }

    /** The Inbox cards of the shared fixture `contracts/fixtures/merge/inbox-cards` (openspec inbox-mattermost). */
    private val inbox: WorkspaceSnapshot by lazy {
        val dir = Path.of(requireNotNull(System.getProperty("aw.schema.dir")))
        val expected =
            Json.parseToJsonElement(
                Files.readString(dir.resolve("fixtures/merge/inbox-cards/expected.json")),
            )
        val view = expected.jsonObject.getValue("view").jsonObject
        snapshot.copy(
            cards = InboxCards.fromView(view),
            sources = (view["sources"] as? JsonArray)?.map { it.jsonObject }.orEmpty(),
        )
    }

    private fun inboxList(name: String) {
        compose.setContent {
            AwTheme { Surface { InboxScreen(inbox, openCard = null, onOpen = {}, onRun = {}) } }
        }
        compose.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }

    private fun card(name: String) {
        val question = inbox.cards.first { it.category == "question" }
        compose.setContent {
            AwTheme {
                Surface {
                    CardScreen(
                        card = question,
                        snapshot = inbox,
                        onSet = { _, _, _ -> },
                        onProject = {},
                        creating = false,
                        onReply = {},
                        onAsk = {},
                        onCreateTask = {},
                        onOpenTask = {},
                    )
                }
            }
        }
        compose.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }

    private fun taskPage(
        name: String,
        inPane: Boolean = false,
    ) {
        val task = snapshot.tasks.first { it.key == "AW-7" }
        compose.setContent {
            AwTheme {
                Surface {
                    CompositionLocalProvider(LocalNowMs provides NOW) {
                        TaskScreen(
                            task = task,
                            snapshot = snapshot,
                            nav =
                                TaskPageNavigation(
                                    {},
                                    {},
                                    listOn = false,
                                    onList = {},
                                    onOpenAsPage = if (inPane) ({}) else null,
                                ),
                            loadThread = { _, _ -> ThreadWindow.EMPTY },
                            loadTerminal = { TerminalPaneState(null, null, null) },
                            parts = TaskDetailParts({ _, _, _ -> null }, { emptyList() }, { false }, {}),
                            actions = TaskPageActions({ _, _, _, _ -> }, {}, { _, _ -> }),
                        )
                    }
                }
            }
        }
        compose.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }

    @Test
    @Config(sdk = [35], qualifiers = "w412dp-h900dp-night-xxhdpi")
    fun tasksPhone() = tasks("tasks-412dp")

    @Test
    @Config(sdk = [35], qualifiers = "w840dp-h900dp-night-xhdpi")
    fun tasksFold() = tasks("tasks-840dp")

    @Test
    @Config(sdk = [35], qualifiers = "w412dp-h900dp-night-xxhdpi")
    fun taskPagePhone() = taskPage("task-page-412dp")

    @Test
    @Config(sdk = [35], qualifiers = "w412dp-h900dp-night-xxhdpi")
    fun inboxPhone() = inboxList("inbox-412dp")

    @Test
    @Config(sdk = [35], qualifiers = "w412dp-h900dp-night-xxhdpi")
    fun cardPhone() = card("card-412dp")

    @Test
    @Config(sdk = [35], qualifiers = "w520dp-h900dp-night-xhdpi")
    fun taskPageNextToTheList() = taskPage("task-page-pane-520dp", inPane = true)

    @Test
    @Config(sdk = [35], qualifiers = "w1240dp-h800dp-night-mdpi")
    fun taskPageTablet() = taskPage("task-page-1240dp")

    private companion object {
        /** A fixed now of the fixture: 2026-11-22T15:20:00Z, 7 minutes after the newest task event. */
        const val NOW = 1_795_360_800_000L

        init {
            check(TaskPageLayout.CONTENT_MAX_DP == 840)
            check(ScreenStates.ARCHIVED_GROUP == "archived")
        }
    }
}
