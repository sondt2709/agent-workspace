package com.agentworkspace.control

/** The pane of a route in the list-detail scene of the app window (docs/design.md 8.6, android-app). */
enum class Pane {
    /** A list: Inbox (the cards) and Tasks. From medium width, a detail entry shows next to it. */
    LIST,

    /** A detail: it shows next to the list before it from medium width, and alone on a compact window. */
    DETAIL,

    /** One pane at the full width at each window size. */
    SINGLE,
}

/** The pane of each route. */
fun Route.pane(): Pane =
    when (this) {
        Route.Inbox, Route.Tasks -> Pane.LIST

        is Route.Task, is Route.InboxItem, is Route.Card,
        Route.NewTask, Route.AddCredential, Route.Pairing,
        -> Pane.DETAIL

        Route.Home, Route.Devices, is Route.TaskPage -> Pane.SINGLE
    }
