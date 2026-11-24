package com.agentworkspace.shared.files

import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.FileSystemException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.OpenOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.BasicFileAttributes
import java.util.UUID

/**
 * The writes of the phone into its AW folder (`java.nio.file`). A peer can sync a symbolic link into
 * the folder, so the writer never writes through a link. It refuses a folder below the root that is
 * a link or not a folder, and a log that is a link or not a regular file. Each refusal writes nothing.
 */
class NioWorkspaceWriter(
    private val root: Path,
) : WorkspaceWriter {
    private fun attributes(file: Path): BasicFileAttributes? =
        try {
            Files.readAttributes(file, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
        } catch (_: NoSuchFileException) {
            null
        }

    private fun refuse(
        path: String,
        reason: String,
    ): Nothing = throw FileSystemException(path, null, reason)

    /**
     * The file of [path]. It refuses a folder below the root that is a symbolic link or not a folder.
     * With [create], it creates the missing folders; without, it gives null for a missing folder. The
     * root itself can be a link.
     */
    private fun resolve(
        path: String,
        create: Boolean,
    ): Path? {
        val parts = path.split("/")
        require(parts.none { it.isEmpty() || it == "." || it == ".." }) { "Not a relative workspace path: $path" }
        var dir = root
        for ((index, part) in parts.dropLast(1).withIndex()) {
            dir = dir.resolve(part)
            if (create && attributes(dir) == null) {
                try {
                    Files.createDirectory(dir)
                } catch (_: FileAlreadyExistsException) {
                    // Another writer made it: the check below reads it again.
                }
            }
            val attrs = attributes(dir) ?: return null
            val folder = parts.take(index + 1).joinToString("/")
            if (attrs.isSymbolicLink) refuse(path, "the folder $folder is a symbolic link")
            if (!attrs.isDirectory) refuse(path, "$folder is not a folder")
        }
        return dir.resolve(parts.last())
    }

    private fun resolveForWrite(path: String): Path = checkNotNull(resolve(path, create = true))

    override fun appendLine(
        path: String,
        line: String,
    ) {
        require('\n' !in line) { "A log line must not contain a newline" }
        try {
            appendOnce(path, line)
        } catch (_: FileAlreadyExistsException) {
            // Another writer made the log between the check and the open: append to that file.
            appendOnce(path, line)
        }
    }

    private fun appendOnce(
        path: String,
        line: String,
    ) {
        val file = resolveForWrite(path)
        val attrs = attributes(file)
        if (attrs != null && attrs.isSymbolicLink) refuse(path, "the log is a symbolic link")
        if (attrs != null && !attrs.isRegularFile) refuse(path, "the log is not a regular file")
        // NOFOLLOW_LINKS: a link that a peer puts here after the check fails the open. A missing log
        // becomes a new regular file (CREATE_NEW), never a file at the end of a link. APPEND: each
        // write goes to the end of the file, also with a second writer of the same log.
        val prefix =
            if (attrs == null) {
                ""
            } else {
                FileChannel.open(file, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { channel ->
                    if (endsWithNewline(channel, channel.size())) "" else "\n"
                }
            }
        val options =
            mutableSetOf<OpenOption>(StandardOpenOption.WRITE, StandardOpenOption.APPEND, LinkOption.NOFOLLOW_LINKS)
        if (attrs == null) options += StandardOpenOption.CREATE_NEW
        FileChannel.open(file, options).use { channel ->
            val buffer = ByteBuffer.wrap("$prefix$line\n".encodeToByteArray())
            while (buffer.hasRemaining()) channel.write(buffer)
            channel.force(false)
        }
    }

    private fun endsWithNewline(
        channel: FileChannel,
        size: Long,
    ): Boolean {
        if (size == 0L) return true
        val last = ByteBuffer.allocate(1)
        channel.read(last, size - 1)
        return last.get(0) == '\n'.code.toByte()
    }

    override fun writeAtomic(
        path: String,
        bytes: ByteArray,
    ) {
        val file = resolveForWrite(path)
        // A new temp name for each write: 2 writes of one file never share a temp file. CREATE_NEW
        // with NOFOLLOW_LINKS never writes through a link that a peer put here.
        val temp = file.resolveSibling("${file.fileName}.${UUID.randomUUID()}.aw-tmp")
        FileChannel
            .open(temp, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS)
            .use { channel ->
                val buffer = ByteBuffer.wrap(bytes)
                while (buffer.hasRemaining()) channel.write(buffer)
                channel.force(true)
            }
        // The move replaces a link at the path itself, not the file at the end of the link.
        try {
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING)
        }
    }

    override fun delete(path: String) {
        // Files.deleteIfExists removes a link itself, not the file at its end.
        resolve(path, create = false)?.let(Files::deleteIfExists)
    }
}
