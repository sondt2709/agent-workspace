package com.agentworkspace.control

/**
 * The window width classes of docs/phase-1.md 10.7 (`currentWindowAdaptiveInfo` with the large and
 * extra-large widths). The layout depends only on the class, never on the device model.
 */
enum class WidthClass {
    COMPACT,
    MEDIUM,
    EXPANDED,
    LARGE,
    EXTRA_LARGE,
    ;

    /** The navigation of the class: a bottom bar, a rail, or a drawer with labels (the expanded rail). */
    val navigation: NavKind
        get() =
            when (this) {
                COMPACT -> NavKind.BAR
                MEDIUM, EXPANDED -> NavKind.RAIL
                LARGE, EXTRA_LARGE -> NavKind.DRAWER
            }

    /**
     * Inbox and Tasks show the list and a detail placeholder side by side from medium width (spike
     * S14). A task opens as the task page in one pane at each width (openspec task-review-layout).
     */
    val twoPanes: Boolean get() = this != COMPACT

    companion object {
        const val MEDIUM_DP = 600
        const val EXPANDED_DP = 840
        const val LARGE_DP = 1200
        const val EXTRA_LARGE_DP = 1600

        fun of(widthDp: Int): WidthClass =
            when {
                widthDp < MEDIUM_DP -> COMPACT
                widthDp < EXPANDED_DP -> MEDIUM
                widthDp < LARGE_DP -> EXPANDED
                widthDp < EXTRA_LARGE_DP -> LARGE
                else -> EXTRA_LARGE
            }
    }
}

enum class NavKind { BAR, RAIL, DRAWER }
