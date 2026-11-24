package com.agentworkspace.control

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The tabs of the phone task detail (openspec phone-task-focus). */
class TaskTabTest {
    @Test
    fun theTabsFollowTheDesktopAndTheThirdPaneTakesTheSessionTab() {
        assertEquals(listOf("Activity", "Session", "Terminal", "Properties"), TaskTab.of(false).map { it.label })
        assertEquals(listOf("Activity", "Terminal", "Properties"), TaskTab.of(true).map { it.label })
    }

    @Test
    fun aSelectedTabThatIsGoneShowsActivity() {
        assertEquals(TaskTab.ACTIVITY, TaskTab.shown(TaskTab.SESSION, TaskTab.of(true)))
        assertEquals(TaskTab.TERMINAL, TaskTab.shown(TaskTab.TERMINAL, TaskTab.of(true)))
    }

    @Test
    fun theMessageBoxIsBelowActivityAndSession() {
        assertTrue(TaskTab.ACTIVITY.hasMessageBox && TaskTab.SESSION.hasMessageBox)
        assertFalse(TaskTab.TERMINAL.hasMessageBox || TaskTab.PROPERTIES.hasMessageBox)
    }
}
