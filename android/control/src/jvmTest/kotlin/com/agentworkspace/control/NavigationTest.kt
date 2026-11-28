package com.agentworkspace.control

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NavigationTest {
    @Test
    fun widthClassesAtTheBreakpoints() {
        val widths = listOf(360, 599, 600, 839, 840, 1199, 1200, 1599, 1600)
        assertEquals(
            listOf(
                WidthClass.COMPACT,
                WidthClass.COMPACT,
                WidthClass.MEDIUM,
                WidthClass.MEDIUM,
                WidthClass.EXPANDED,
                WidthClass.EXPANDED,
                WidthClass.LARGE,
                WidthClass.LARGE,
                WidthClass.EXTRA_LARGE,
            ),
            widths.map { WidthClass.of(it) },
        )
        assertEquals(NavKind.BAR, WidthClass.COMPACT.navigation)
        assertEquals(NavKind.RAIL, WidthClass.MEDIUM.navigation)
        assertEquals(NavKind.RAIL, WidthClass.EXPANDED.navigation)
        assertEquals(NavKind.DRAWER, WidthClass.LARGE.navigation)
        assertFalse(WidthClass.COMPACT.twoPanes)
        assertTrue(WidthClass.MEDIUM.twoPanes)
    }

    @Test
    fun aFormClosesOnlyWhenItIsOnTop() {
        // The person left New task before the create ended and opened AW-7 (android-ui L3).
        val stack = mutableListOf<Route>(Route.Tasks, Route.Task("a"))
        val nav = Navigator(stack)
        assertFalse(nav.close(Route.NewTask))
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("a")), stack)
        nav.open(Route.NewTask)
        assertTrue(nav.close(Route.NewTask))
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("a")), stack)
    }

    @Test
    fun anInboxItemOpensItsTaskAndBackReturnsToTheInbox() {
        val stack = mutableListOf<Route>()
        val nav = Navigator(stack)
        nav.select(Tab.INBOX)
        nav.open(Route.InboxItem("a"))
        assertEquals(listOf<Route>(Route.Inbox, Route.InboxItem("a")), stack)
        assertEquals("a", nav.openInboxItem)
        // One item at a time; "Open task" replaces the item with its task page.
        nav.open(Route.InboxItem("b"))
        assertEquals(listOf<Route>(Route.Inbox, Route.InboxItem("b")), stack)
        nav.open(Route.Task("b"))
        assertEquals(listOf<Route>(Route.Inbox, Route.Task("b")), stack)
        assertNull(nav.openInboxItem)
        assertTrue(nav.back())
        assertEquals(listOf<Route>(Route.Inbox), stack)
    }

    @Test
    fun theStackOfTabsTasksAndPushes() {
        val stack = mutableListOf<Route>()
        val nav = Navigator(stack)
        assertEquals(listOf<Route>(Route.Home), nav.entries)
        nav.select(Tab.TASKS)
        nav.open(Route.Task("a"))
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("a")), stack)
        // One task page at a time (openspec task-review-layout: no Session pane on top of it).
        nav.open(Route.Task("b"))
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("b")), stack)
        assertEquals("b", nav.openTask)
        // Esc closes the top entry; at the root, back is false.
        assertTrue(nav.back())
        assertEquals(listOf<Route>(Route.Tasks), stack)
        assertFalse(nav.back())
        assertNull(nav.openTask)
        // A push opens [Tasks, Task(id)]; a push with no task opens [Inbox] (nav-tasks-needs-you).
        nav.openFromPush(null)
        assertEquals(listOf<Route>(Route.Inbox), stack)
        nav.openFromPush("c")
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("c")), stack)
        assertEquals(Tab.TASKS, nav.tab)
        // A card of the Inbox replaces the open card and keeps the root (inbox-mattermost).
        nav.select(Tab.INBOX)
        nav.open(Route.Card("k1"))
        nav.open(Route.Card("k2"))
        assertEquals(listOf<Route>(Route.Inbox, Route.Card("k2")), stack)
        nav.openFromPush("c")
        // New task goes on top once.
        nav.open(Route.NewTask)
        nav.open(Route.NewTask)
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("c"), Route.NewTask), stack)
        // A tab select replaces the stack.
        nav.open(Route.Devices)
        assertEquals(listOf<Route>(Route.Devices), stack)
        // The pairing form goes on top of Devices once.
        nav.open(Route.Pairing)
        nav.open(Route.Pairing)
        assertEquals(listOf<Route>(Route.Devices, Route.Pairing), stack)
        assertEquals(true, nav.back())
        // A task opens on top of the root of the tab, at each width.
        nav.open(Route.Task("d"))
        assertEquals(listOf<Route>(Route.Devices, Route.Task("d")), stack)
    }

    @Test
    fun aTaskOfTheTasksListOpensNextToTheListAndAsAPage() {
        val stack = mutableListOf<Route>(Route.Tasks)
        val nav = Navigator(stack)
        // From the Tasks list: next to the list.
        nav.openTask("a")
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("a")), stack)
        // "Open as page" goes on top; Back returns to the list with the same task.
        nav.openAsPage()
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("a"), Route.TaskPage("a")), stack)
        assertEquals("a", nav.openTask)
        // Next on the page: the other task as a page, and Back still returns to the list.
        nav.openTask("b")
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("b"), Route.TaskPage("b")), stack)
        assertTrue(nav.back())
        assertEquals(listOf<Route>(Route.Tasks, Route.Task("b")), stack)
        assertEquals("b", nav.openTask)
        // "Open as page" does nothing when no task shows next to the list.
        nav.select(Tab.TASKS)
        nav.openAsPage()
        assertEquals(listOf<Route>(Route.Tasks), stack)
    }

    @Test
    fun homeAndInboxOpenTheTaskPage() {
        val stack = mutableListOf<Route>(Route.Home)
        val nav = Navigator(stack)
        nav.openTask("a")
        assertEquals(listOf<Route>(Route.Home, Route.TaskPage("a")), stack)
        nav.select(Tab.INBOX)
        nav.open(Route.InboxItem("b"))
        nav.openTask("b")
        assertEquals(listOf<Route>(Route.Inbox, Route.TaskPage("b")), stack)
    }

    @Test
    fun shortcuts() {
        assertEquals(Shortcut.NEW_TASK, Shortcut.of("N", ctrl = true))
        assertEquals(Shortcut.NEW_TASK, Shortcut.of("n", ctrl = true))
        assertEquals(Shortcut.SYNC_NOW, Shortcut.of("R", ctrl = true))
        assertEquals(Shortcut.CLOSE, Shortcut.of("Escape", ctrl = false))
        assertNull(Shortcut.of("N", ctrl = false))
        assertNull(Shortcut.of("N", ctrl = true, alt = true))
        assertNull(Shortcut.of("Escape", ctrl = true))
        assertNull(Shortcut.of("Enter", ctrl = true))
    }
}
