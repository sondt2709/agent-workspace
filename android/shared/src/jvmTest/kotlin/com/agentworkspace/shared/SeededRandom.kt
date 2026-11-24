package com.agentworkspace.shared

/** The seeded generator of the TypeScript tests (mulberry32): the same seed gives the same numbers. */
class SeededRandom(
    seed: Long,
) {
    private var state: Int = seed.toInt()

    fun next(): Double {
        state += 0x6d2b79f5
        var t = state
        t = (t xor (t ushr 15)) * (t or 1)
        t = t xor (t + (t xor (t ushr 7)) * (t or 61))
        return ((t xor (t ushr 14)).toLong() and 0xffffffffL).toDouble() / 4294967296.0
    }
}

/** A shuffled copy of a list (Fisher-Yates), the same as `shuffle` of the TypeScript tests. */
fun <T> shuffle(
    items: List<T>,
    random: SeededRandom,
): List<T> {
    val copy = items.toMutableList()
    for (i in copy.size - 1 downTo 1) {
        val j = kotlin.math.floor(random.next() * (i + 1)).toInt()
        val swap = copy[i]
        copy[i] = copy[j]
        copy[j] = swap
    }
    return copy
}
