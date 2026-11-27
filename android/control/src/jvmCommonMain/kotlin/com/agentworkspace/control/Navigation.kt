package com.agentworkspace.control

/** One entry of the back stack (docs/tech-stack.md 2.5: Navigation 3 with a stack that AW owns). */
sealed interface Route {
    data object Home : Route

    data object Inbox : Route

    data object Tasks : Route

    data object Devices : Route

    /**
     * A task of the Tasks list: from medium width its task page shows next to the list; on a compact
     * window it is the full task page (openspec phone-desktop-parity).
     */
    data class Task(
        val id: String,
    ) : Route

    /** The task page at the full width at each window size: "Open as page", Home, Inbox and a push. */
    data class TaskPage(
        val id: String,
    ) : Route

    /** The item screen of an Inbox row: the rows of Activity that need the person (proposal-and-discussion). */
    data class InboxItem(
        val task: String,
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
     * Opens a route. A task or an Inbox item replaces the open task or item (one at a time) and keeps
     * the root, so Back returns to the list; a form goes on top of the stack once.
     */
    fun open(route: Route) {
        when (route) {
            is Route.Task, is Route.TaskPage, is Route.InboxItem -> {
                replace(listOf(stack.first(), route))
            }

            Route.NewTask, Route.AddCredential, Route.Pairing -> {
                if (stack.last() != route) replace(stack.filter { it != route } + route)
            }

            else -> {
                Tab.entries.firstOrNull { it.root == route }?.let { select(it) }
            }
        }
    }

    /**
     * Opens a task (openspec phone-desktop-parity). From the Tasks list the task shows next to the list:
     * `[Tasks, Task(id)]`. On a task page opened with "Open as page", the other task opens as a page and
     * Back still returns to the list: `[Tasks, Task(id), TaskPage(id)]`. Elsewhere (Home, Inbox) the task
     * page opens at the full width: `[root, TaskPage(id)]`.
     */
    fun openTask(id: String) {
        val root = stack.first()
        when {
            root == Route.Tasks && stack.last() is Route.TaskPage -> {
                replace(
                    listOf(root, Route.Task(id), Route.TaskPage(id)),
                )
            }

            root == Route.Tasks -> {
                replace(listOf(root, Route.Task(id)))
            }

            else -> {
                replace(listOf(root, Route.TaskPage(id)))
            }
        }
    }

    /** "Open as page": the task next to the list opens at the full width; Back returns to the list. */
    fun openAsPage() {
        val top = stack.last()
        if (top is Route.Task) stack.add(Route.TaskPage(top.id))
    }

    /** A push opens the stack `[Inbox, TaskPage(id)]` (docs/phase-1.md 10.8), or `[Inbox]` with no task. */
    fun openFromPush(task: String?) = replace(listOfNotNull(Route.Inbox, task?.let { Route.TaskPage(it) }))

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
    val openTask: String?
        get() =
            when (val top = stack.lastOrNull { it is Route.Task || it is Route.TaskPage }) {
                is Route.Task -> top.id
                is Route.TaskPage -> top.id
                else -> null
            }

    /** The task of the open Inbox item, or null. */
    val openInboxItem: String? get() = stack.filterIsInstance<Route.InboxItem>().lastOrNull()?.task

    private fun replace(entries: List<Route>) {
        if (entries == stack) return
        stack.clear()
        stack.addAll(entries)
    }
}
