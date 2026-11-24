package com.agentworkspace.shared.files

/**
 * The write access of the phone to its own files of an AW folder. Each path is relative to the
 * workspace root, with `/` separators. Each failure throws.
 */
interface WorkspaceWriter {
    /**
     * Appends one line and a newline to a log file. When a crash cut the last line, it first writes a
     * newline, so the cut line stays a separate bad line (`appendLine` of shared/core). It creates the
     * folders.
     */
    fun appendLine(
        path: String,
        line: String,
    )

    /** Writes a file atomically: a temp file `<name>.aw-tmp`, then a move (`writeFileAtomic`). */
    fun writeAtomic(
        path: String,
        bytes: ByteArray,
    )

    /** Removes a file. A missing file is not an error. */
    fun delete(path: String)
}
