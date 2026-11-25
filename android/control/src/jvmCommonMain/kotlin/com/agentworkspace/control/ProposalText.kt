package com.agentworkspace.control

import java.nio.file.Files
import java.nio.file.Path

/**
 * The text size of a proposal in dp (openspec proposal-and-discussion, design decision 7): 14 to 24
 * in steps of 2, 16 by default. The same rule as `proposalTextSize` of `shared/client`; both run
 * `contracts/fixtures/gates/proposal-text-size.json`.
 */
object ProposalTextSize {
    const val MIN = 14
    const val MAX = 24
    const val STEP = 2
    const val DEFAULT = 16

    private val WHOLE = Regex("^-?[0-9]+\\z")

    /**
     * The size from the saved value of the device: the default for no value, a value that is not a
     * whole number or not on a step; a whole number out of range gets the nearest limit.
     */
    fun load(saved: String?): Int {
        val text = saved?.trim() ?: return DEFAULT
        if (!WHOLE.matches(text)) return DEFAULT
        val n = text.toLongOrNull() ?: return if (text.startsWith("-")) MIN else MAX
        return when {
            n < MIN -> MIN
            n > MAX -> MAX
            (n - MIN) % STEP == 0L -> n.toInt()
            else -> DEFAULT
        }
    }

    /** The next size for A+ ([larger] true) or A− ([larger] false), within the limits. */
    fun change(
        size: Int,
        larger: Boolean,
    ): Int = (size + if (larger) STEP else -STEP).coerceIn(MIN, MAX)

    fun canLarger(size: Int): Boolean = size < MAX

    fun canSmaller(size: Int): Boolean = size > MIN
}

/** The text size of the proposals on this phone: the file `proposal-text-px` of the app files folder. */
class ProposalTextSetting(
    private val file: Path,
) {
    // Byte reads and writes: Android has no Files.readString or Files.writeString.
    fun size(): Int =
        ProposalTextSize.load(
            if (Files.isRegularFile(file)) Files.readAllBytes(file).decodeToString() else null,
        )

    fun set(size: Int) {
        Files.createDirectories(file.parent)
        Files.write(file, "${ProposalTextSize.load(size.toString())}\n".encodeToByteArray())
    }
}
