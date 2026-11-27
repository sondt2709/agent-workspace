package com.agentworkspace.android.ui

/**
 * The texts and heights that a lazy row loads or measures, kept while the app runs (openspec
 * phone-desktop-parity). A LazyColumn disposes a row that leaves the screen; when the row comes back,
 * it takes its proposal text and the height of its gate text from here at once, so it has its full
 * height in the first frame and the list does not jump while the person scrolls up. Only the main
 * thread reads and writes it.
 */
internal object KeptTexts {
    private const val SIZE = 200
    private const val LOAD_FACTOR = 0.75f

    private fun <V> lru() =
        object : LinkedHashMap<String, V>(SIZE, LOAD_FACTOR, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, V>?): Boolean = size > SIZE
        }

    private val proposals = lru<String>()
    private val heights = lru<Int>()

    /** The proposal text of [key] from an earlier load, or null. */
    fun proposal(key: String): String? = proposals[key]

    fun keepProposal(
        key: String,
        text: String?,
    ) {
        if (text != null) proposals[key] = text
    }

    /** The full height in px of a gate text from an earlier layout, or 0. */
    fun height(key: String): Int = heights[key] ?: 0

    fun keepHeight(
        key: String,
        px: Int,
    ) {
        heights[key] = px
    }
}
