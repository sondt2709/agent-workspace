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
        // A push opens [Inbox, Task(id)].
        nav.openFromPush("c")
        assertEquals(listOf<Route>(Route.Inbox, Route.Task("c")), stack)
        assertEquals(Tab.INBOX, nav.tab)
        // New task goes on top once.
        nav.open(Route.NewTask)
        nav.open(Route.NewTask)
        assertEquals(listOf<Route>(Route.Inbox, Route.Task("c"), Route.NewTask), stack)
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
