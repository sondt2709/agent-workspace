package com.agentworkspace.shared.files

/**
 * One entry of a folder. Both flags read the entry itself, not the end of a symbolic link: a link is
 * not a folder and not a regular file.
 */
data class FileEntry(
    val name: String,
    val isDirectory: Boolean,
    val isFile: Boolean,
)

/** An open file of a log: its size and reads at an offset. */
interface ReadableFile : AutoCloseable {
    val size: Long

    /** Reads up to `length` bytes at `offset`. A shorter result means the end of the file. */
    fun read(
        offset: Long,
        length: Int,
    ): ByteArray
}

/**
 * The read access of the merge to an AW folder. Each path is relative to the workspace root, with
 * `/` separators. A missing file or folder is not an error: `list` gives an empty list, `readText`
 * and `open` give null. Each other failure (for example a read error) throws.
 */
interface WorkspaceFiles {
    fun list(path: String): List<FileEntry>

    fun exists(path: String): Boolean

    fun readText(path: String): String?

    fun open(path: String): ReadableFile?
}
