package com.agentworkspace.control

/** The tabs of the phone task page (openspec phone-task-focus and task-review-layout, docs/design.md 8.6). */
enum class TaskTab(
    val label: String,
) {
    ACTIVITY("Activity"),
    SESSION("Session"),
    TERMINAL("Terminal"),
    PROPERTIES("Properties"),
    ;

    /** The message box shows below the tabs that show the conversation. */
    val hasMessageBox: Boolean get() = this == ACTIVITY || this == SESSION

    companion object {
        /**
         * The tabs of the task page. Next to the Properties panel of a wide task page
         * ([TaskPageLayout.propertiesPanel]), the tab row has no Properties tab, as on the desktop.
         */
        fun of(propertiesPanel: Boolean): List<TaskTab> =
            if (propertiesPanel) entries - PROPERTIES else entries.toList()

        /** The selected tab, or Activity when the selected tab is not in [tabs]. */
        fun shown(
            selected: TaskTab,
            tabs: List<TaskTab>,
        ): TaskTab = if (selected in tabs) selected else ACTIVITY
    }
}
