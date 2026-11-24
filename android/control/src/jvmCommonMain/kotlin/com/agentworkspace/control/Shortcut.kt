package com.agentworkspace.control

/** The keyboard shortcuts of the app (docs/engineering-rules.md 5.21). */
enum class Shortcut(
    val label: String,
    /** The key with Ctrl, or null for a key with no modifier. */
    val ctrlKey: Char?,
) {
    NEW_TASK("New task", 'N'),
    SYNC_NOW("Sync now", 'R'),
    CLOSE("Close", null),
    ;

    companion object {
        /**
         * The shortcut of a key press. [key] is the key name: one letter, or `Escape`. A shortcut with
         * Ctrl needs Ctrl and no Alt, so AltGr text input is not a shortcut.
         */
        fun of(
            key: String,
            ctrl: Boolean,
            alt: Boolean = false,
        ): Shortcut? {
            if (key == "Escape") return if (ctrl || alt) null else CLOSE
            if (!ctrl || alt || key.length != 1) return null
            val letter = key[0].uppercaseChar()
            return entries.firstOrNull { it.ctrlKey == letter }
        }
    }
}
