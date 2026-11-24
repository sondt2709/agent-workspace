package com.agentworkspace.control

/** The tabs of the phone task detail (openspec phone-task-focus, docs/design.md 8.6). */
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
         * The tabs of the task detail. While the third pane of a large window shows the Session view,
         * the tab row has no Session tab, as the desktop has no Properties tab next to its right panel.
         */
        fun of(sessionInPane: Boolean): List<TaskTab> = if (sessionInPane) entries - SESSION else entries.toList()

        /** The selected tab, or Activity when the selected tab is not in [tabs]. */
        fun shown(
            selected: TaskTab,
            tabs: List<TaskTab>,
        ): TaskTab = if (selected in tabs) selected else ACTIVITY
    }
}
