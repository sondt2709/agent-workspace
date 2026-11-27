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
}
