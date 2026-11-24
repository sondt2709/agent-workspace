package com.agentworkspace.control

/**
 * The links of Markdown that the phone opens (openspec polish-prototype-style): only `https://`
 * links, in the system browser. The desktop has the same rule (`MarkdownText` in common.tsx).
 */
object LinkRule {
    /** True when a tap on the link opens the system browser. */
    fun opens(url: String): Boolean = url.startsWith("https://")
}
