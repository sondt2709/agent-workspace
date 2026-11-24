package com.agentworkspace.shared.files

import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile
import kotlin.io.path.name

/** The AW folder on the file system of the JVM and of Android (`java.nio.file`). */
class NioWorkspaceFiles(
    private val root: Path,
) : WorkspaceFiles {
    private fun resolve(path: String): Path = path.split("/").fold(root) { dir, part -> dir.resolve(part) }

    override fun list(path: String): List<FileEntry> {
        val dir = resolve(path)
        if (!Files.isDirectory(dir)) return emptyList()
        return try {
            // A symlink to a folder is not a folder, like `Dirent.isDirectory()` of Node (findSources).
            // A DirectoryStream, not Files.list(...).toList(): Stream.toList needs Android API 34 (fix list 0-30).
            Files.newDirectoryStream(dir).use { entries ->
                entries.map {
                    FileEntry(
                        it.name,
                        it.isDirectory(LinkOption.NOFOLLOW_LINKS),
                        it.isRegularFile(LinkOption.NOFOLLOW_LINKS),
                    )
                }
            }
        } catch (_: NoSuchFileException) {
            emptyList()
        }
    }

    override fun exists(path: String): Boolean = Files.exists(resolve(path))

    override fun readText(path: String): String? =
        try {
            // Like Node `readFile(path, "utf8")`: a bad byte becomes U+FFFD.
            Charsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .onUnmappableCharacter(CodingErrorAction.REPLACE)
                .decode(ByteBuffer.wrap(Files.readAllBytes(resolve(path))))
                .toString()
        } catch (_: NoSuchFileException) {
            null
        }

    override fun open(path: String): ReadableFile? {
        val channel =
            try {
                FileChannel.open(resolve(path), StandardOpenOption.READ)
            } catch (_: NoSuchFileException) {
                return null
            }
        val size =
            try {
                channel.size()
            } catch (e: IOException) {
                channel.close()
                throw e
            }
        return object : ReadableFile {
            override val size: Long = size

            override fun read(
                offset: Long,
                length: Int,
            ): ByteArray {
                val buffer = ByteBuffer.allocate(length)
                var position = offset
                while (buffer.hasRemaining()) {
                    val count = channel.read(buffer, position)
                    if (count <= 0) break
                    position += count
                }
                return buffer.array().copyOf(buffer.position())
            }

            override fun close() = channel.close()
        }
    }
}
