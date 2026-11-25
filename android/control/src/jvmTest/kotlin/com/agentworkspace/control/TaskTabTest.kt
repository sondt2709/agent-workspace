package com.agentworkspace.control

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The tabs of the phone task page (openspec phone-task-focus and task-review-layout). */
class TaskTabTest {
    @Test
    fun thePropertiesPanelTakesThePropertiesTab() {
        assertEquals(listOf("Activity", "Session", "Terminal", "Properties"), TaskTab.of(false).map { it.label })
        assertEquals(listOf("Activity", "Session", "Terminal"), TaskTab.of(true).map { it.label })
    }

    @Test
    fun aSelectedTabThatIsGoneShowsActivity() {
        assertEquals(TaskTab.ACTIVITY, TaskTab.shown(TaskTab.PROPERTIES, TaskTab.of(true)))
        assertEquals(TaskTab.TERMINAL, TaskTab.shown(TaskTab.TERMINAL, TaskTab.of(true)))
    }

    @Test
    fun theMessageBoxIsBelowActivityAndSession() {
        assertTrue(TaskTab.ACTIVITY.hasMessageBox && TaskTab.SESSION.hasMessageBox)
        assertFalse(TaskTab.TERMINAL.hasMessageBox || TaskTab.PROPERTIES.hasMessageBox)
    }

    @Test
    fun theWidthRuleOfTheTaskPage() {
        // A 412 dp phone: no "Show list", Properties is a tab.
        assertEquals(TaskPageLayout(false, false, false), TaskPageLayout.of(412, true))
        // "Show list" from 700 dp of task page width.
        assertFalse(TaskPageLayout.of(699, false).canList)
        assertTrue(TaskPageLayout.of(700, false).canList)
        // An 840 dp Fold window next to the rail: the list shows only on request.
        assertEquals(TaskPageLayout(true, false, false), TaskPageLayout.of(760, false))
        assertTrue(TaskPageLayout.of(760, true).list)
        // The Properties panel from 1,000 dp of the page without the task list.
        assertFalse(TaskPageLayout.of(999, false).propertiesPanel)
        assertTrue(TaskPageLayout.of(1000, false).propertiesPanel)
        // A 1220 dp DeX window: the panel, and the tab row is Activity, Session and Terminal.
        val dex = TaskPageLayout.of(1220, false)
        assertTrue(dex.propertiesPanel)
        assertEquals(listOf(TaskTab.ACTIVITY, TaskTab.SESSION, TaskTab.TERMINAL), dex.tabs)
        // The task list of 300 dp takes the width of the panel: 1220 - 300 is below 1,000.
        val listed = TaskPageLayout.of(1220, true)
        assertTrue(listed.list)
        assertFalse(listed.propertiesPanel)
        assertEquals(TaskTab.entries.toList(), listed.tabs)
        assertTrue(TaskPageLayout.of(1300, true).propertiesPanel)
        assertEquals(840, TaskPageLayout.CONTENT_MAX_DP)
    }
}
