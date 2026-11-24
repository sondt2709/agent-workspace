package com.agentworkspace.control

/** One entry of the back stack (docs/tech-stack.md 2.5: Navigation 3 with a stack that AW owns). */
sealed interface Route {
    data object Home : Route

    data object Inbox : Route

    data object Tasks : Route

    data object Devices : Route

    /** The detail of a task. */
    data class Task(
        val id: String,
    ) : Route

    /** The Session view of a task (summary and raw thread): the third pane on a large window. */
    data class Thread(
        val id: String,
    ) : Route

    data object NewTask : Route

    data object AddCredential : Route

    /** Pair this phone with a computer: scan or paste a pairing code (docs/phase-1.md 7). */
    data object Pairing : Route
}

/** The top-level destinations of the navigation bar or rail. */
enum class Tab(
    val root: Route,
    val label: String,
) {
    HOME(Route.Home, "Home"),
    INBOX(Route.Inbox, "Inbox"),
    TASKS(Route.Tasks, "Tasks"),
    DEVICES(Route.Devices, "Devices"),
}

/**
 * The rules of the one back stack. A fold, an unfold or a resize keeps the stack, so the open item
 * stays open. The stack is never empty: its first entry is the root of a tab.
 */
class Navigator(
    private val stack: MutableList<Route>,
) {
    init {
        if (stack.isEmpty()) stack.add(Route.Home)
    }

    val entries: List<Route> get() = stack.toList()

    /** The tab of the first entry. */
    val tab: Tab get() = Tab.entries.first { it.root == stack.first() }

    /** A tab select replaces the stack with the root of the tab. */
    fun select(tab: Tab) = replace(listOf(tab.root))

    /**
     * Opens a route. A task replaces the open task (one detail at a time) and keeps the root, so Back
     * returns to the list; its thread goes on top of the task; a form goes on top of the stack once.
     */
    fun open(route: Route) {
        when (route) {
            is Route.Task -> {
                replace(listOf(stack.first(), route))
            }

            is Route.Thread -> {
                val task = Route.Task(route.id)
                if (task !in stack) open(task)
                val upTo = stack.indexOf(task)
                replace(stack.take(upTo + 1) + route)
            }

            Route.NewTask, Route.AddCredential, Route.Pairing -> {
                if (stack.last() != route) replace(stack.filter { it != route } + route)
            }

            else -> {
                Tab.entries.firstOrNull { it.root == route }?.let { select(it) }
            }
        }
    }

    /** A push opens the stack `[Inbox, Task(id)]` (docs/phase-1.md 10.8), or `[Inbox]` with no task. */
    fun openFromPush(task: String?) = replace(listOfNotNull(Route.Inbox, task?.let { Route.Task(it) }))

    /**
     * Closes [route] when it is the top entry, for the end of a form action: the person can have left the
     * form before the action ended. False when another entry is on top.
     */
    fun close(route: Route): Boolean = stack.lastOrNull() == route && back()

    /** Back and Esc close the top entry. False at the root: the system may close the app. */
    fun back(): Boolean {
        if (stack.size <= 1) return false
        stack.removeAt(stack.lastIndex)
        return true
    }

    /** The open task, or null. */
    val openTask: String? get() = stack.filterIsInstance<Route.Task>().lastOrNull()?.id

    private fun replace(entries: List<Route>) {
        if (entries == stack) return
        stack.clear()
        stack.addAll(entries)
    }
}
