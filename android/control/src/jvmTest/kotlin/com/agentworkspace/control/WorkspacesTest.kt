package com.agentworkspace.control

import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkspacesTest {
    private val root = Files.createTempDirectory("aw-workspaces-")
    private val file = root.resolve("selected-workspace")
    private val joined = mutableListOf(SIDE, PERSONAL)

    private fun switcher() = WorkspaceSwitcher({ joined.toList() }, WorkspaceSelectionStore(file))

    @OptIn(ExperimentalPathApi::class)
    @AfterTest
    fun cleanup() {
        root.deleteRecursively()
    }

    @Test
    fun firstStartShowsTheFirstWorkspace() {
        val s = switcher()
        assertEquals(listOf(PERSONAL, SIDE), s.workspaces.value)
        assertEquals(PERSONAL, s.selected.value)
        assertFalse(Files.exists(file))
    }

    @Test
    fun theSelectionStaysAfterARestart() {
        assertTrue(switcher().select(SIDE))
        assertEquals("$SIDE\n", file.readText())
        // A new process reads the file.
        assertEquals(SIDE, switcher().selected.value)
    }

    @Test
    fun aStoredWorkspaceThatIsGoneFallsBack() {
        file.writeText("$GONE\n")
        val s = switcher()
        assertEquals(PERSONAL, s.selected.value)
        // The file stays: the selection comes back with the folder.
        assertEquals("$GONE\n", file.readText())
        joined.add(GONE)
        s.refresh()
        assertEquals(GONE, s.selected.value)
    }

    @Test
    fun aWorkspaceThatIsNotJoinedIsRefused() {
        val s = switcher()
        assertFalse(s.select(GONE))
        assertEquals(PERSONAL, s.selected.value)
        assertFalse(Files.exists(file))
    }

    @Test
    fun aJoinSelectsTheNewWorkspace() {
        joined.remove(SIDE)
        val s = switcher()
        assertEquals(listOf(PERSONAL), s.workspaces.value)
        joined.add(SIDE)
        assertTrue(s.joined(SIDE))
        assertEquals(listOf(PERSONAL, SIDE), s.workspaces.value)
        assertEquals(SIDE, s.selected.value)
    }

    @Test
    fun aJoinResetsTheBackStack() {
        // Personal shows AW-3; the person joins Side projects from the menu (review phone-workspaces M4).
        joined.remove(SIDE)
        val s = switcher()
        val stack = mutableListOf<Route>(Route.Tasks, Route.Task("t3"), Route.Pairing)
        val nav = WorkspaceNavigation(s, Navigator(stack))
        joined.add(SIDE)
        assertTrue(nav.joined(SIDE))
        assertEquals(SIDE, s.selected.value)
        assertEquals(listOf<Route>(Route.Tasks), stack)
    }

    @Test
    fun aSwitchStaysWhenItsSaveFailed() {
        // The disk is full at the switch (review phone-workspaces L6): an app resume keeps Side projects.
        val s = switcher()
        assertTrue(s.select(PERSONAL))
        Files.createDirectories(file.resolveSibling("${file.fileName}.aw-new"))
        assertTrue(s.select(SIDE))
        s.refresh()
        assertEquals(SIDE, s.selected.value)
    }

    @Test
    fun aRemovedSelectionFallsBackOnRefresh() {
        val s = switcher()
        s.select(SIDE)
        joined.remove(SIDE)
        s.refresh()
        assertEquals(PERSONAL, s.selected.value)
        joined.clear()
        s.refresh()
        assertEquals(null, s.selected.value)
    }

    @Test
    fun entriesHaveTheNamesAndTheNeedsYouCounts() =
        runTest {
            TestWorkspace().use { ws ->
                // An open question on AW-7 puts it in the "Needs you" lane.
                ws.appendRaw("tasks/${TestWorkspace.AW7}/log/ubuntu-01.jsonl", TestWorkspace.questionLine())
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                assertEquals("Example workspace", snapshot.name)
                val needsYou = ScreenStates.inbox(snapshot).size
                assertTrue(needsYou > 0)
                val other = WorkspaceSnapshot.empty(SIDE, TestWorkspace.PHONE)
                val ids = listOf(SIDE, TestWorkspace.WORKSPACE)
                val entries =
                    WorkspaceSwitcher.entries(ids, SIDE, mapOf(TestWorkspace.WORKSPACE to snapshot, SIDE to other))
                assertEquals(
                    listOf(
                        WorkspaceEntry(TestWorkspace.WORKSPACE, "Example workspace", needsYou, false),
                        WorkspaceEntry(SIDE, "Workspace 01a20775", 0, true),
                    ),
                    entries,
                )
            }
        }

    @Test
    fun aSwitchResetsTheBackStackToTheTabRoot() {
        val s = switcher()
        val stack = mutableListOf<Route>(Route.Tasks, Route.Task("t1"), Route.NewTask)
        val nav = WorkspaceNavigation(s, Navigator(stack))
        assertTrue(nav.switchTo(SIDE))
        assertEquals(SIDE, s.selected.value)
        assertEquals(listOf<Route>(Route.Tasks), stack)
        // A workspace that is not joined changes nothing.
        stack.add(Route.Task("t2"))
        assertFalse(nav.switchTo(GONE))
        assertEquals(listOf(Route.Tasks, Route.Task("t2")), stack)
    }

    @Test
    fun aPushOpensItsWorkspaceAndTheTask() {
        val s = switcher()
        val stack = mutableListOf<Route>(Route.Home)
        val nav = WorkspaceNavigation(s, Navigator(stack))
        nav.openFromPush(SIDE, "t9")
        assertEquals(SIDE, s.selected.value)
        assertEquals(listOf(Route.Inbox, Route.Task("t9")), stack)
        // A push of a workspace that is not on this phone opens only the Inbox of the shown workspace.
        assertFalse(nav.openFromPush(GONE, "t8"))
        assertEquals(SIDE, s.selected.value)
        assertEquals(listOf<Route>(Route.Inbox), stack)
        // A push with no task still selects its workspace and opens the Inbox.
        assertTrue(nav.openFromPush(PERSONAL, null))
        assertEquals(PERSONAL, s.selected.value)
        assertEquals(listOf<Route>(Route.Inbox), stack)
    }

    private companion object {
        const val PERSONAL = "01a20775-5cf4-779a-a960-5e221c27fd6a"
        const val SIDE = "01a20775-67ed-7737-83e7-202c0ff9fc7f"
        const val GONE = "01a20775-0000-7000-8000-000000000000"
    }
}
