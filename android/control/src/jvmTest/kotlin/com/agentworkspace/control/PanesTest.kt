package com.agentworkspace.control

import kotlin.test.Test
import kotlin.test.assertEquals

/** The panes of the routes (openspec phone-desktop-parity, "Adaptive layout"). */
class PanesTest {
    @Test
    fun aTaskOfTheTasksListShowsNextToTheList() {
        assertEquals(Pane.LIST, Route.Tasks.pane())
        assertEquals(Pane.DETAIL, Route.Task("AW-1").pane())
        assertEquals(Pane.SINGLE, Route.TaskPage("AW-1").pane())
    }

    @Test
    fun inboxAndFormsKeepTheirPanes() {
        assertEquals(Pane.LIST, Route.Inbox.pane())
        assertEquals(Pane.DETAIL, Route.InboxItem("AW-1").pane())
        assertEquals(Pane.DETAIL, Route.NewTask.pane())
        assertEquals(Pane.SINGLE, Route.Home.pane())
        assertEquals(Pane.SINGLE, Route.Devices.pane())
    }

    @Test
    fun theHeaderStaysNextToTheListAndOnATallPage() {
        // Next to the Tasks list on a Fold inner screen (a 440 dp pane, 880 dp high).
        assertEquals(true, TaskPageLayout.headerFixed(440, 880, inPane = true))
        // The full page on a Fold or a tablet.
        assertEquals(true, TaskPageLayout.headerFixed(760, 880, inPane = false))
        // A phone in portrait, and a phone in landscape: the header scrolls.
        assertEquals(false, TaskPageLayout.headerFixed(392, 800, inPane = false))
        assertEquals(false, TaskPageLayout.headerFixed(800, 360, inPane = false))
    }
}
