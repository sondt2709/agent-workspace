package com.agentworkspace.engine

import android.net.LocalSocket
import android.net.LocalSocketAddress
import java.io.InputStream
import java.io.OutputStream

/**
 * A Unix socket connection on Android: `LocalSocket` in the filesystem namespace, to the REST socket
 * of the engine in the app files folder (docs/phase-1.md 6.7.3, spike S3).
 */
object LocalSocketConnector : UnixConnector {
    override fun connect(path: String): UnixConnection {
        val socket = LocalSocket()
        try {
            socket.connect(LocalSocketAddress(path, LocalSocketAddress.Namespace.FILESYSTEM))
        } catch (e: java.io.IOException) {
            socket.close()
            throw e
        }
        return object : UnixConnection {
            override val input: InputStream = socket.inputStream
            override val output: OutputStream = socket.outputStream

            override fun close() {
                // shutdown first: a close alone does not end a blocked read of another thread.
                runCatching { socket.shutdownInput() }
                runCatching { socket.shutdownOutput() }
                socket.close()
            }
        }
    }
}
