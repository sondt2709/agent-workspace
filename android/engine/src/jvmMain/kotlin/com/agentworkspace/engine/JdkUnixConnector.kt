package com.agentworkspace.engine

import java.io.InputStream
import java.io.OutputStream
import java.net.StandardProtocolFamily
import java.net.UnixDomainSocketAddress
import java.nio.channels.Channels
import java.nio.channels.SocketChannel

/** A Unix socket connection of the JDK (16+): the JVM tests and the JVM target. */
object JdkUnixConnector : UnixConnector {
    override fun connect(path: String): UnixConnection {
        val channel = SocketChannel.open(StandardProtocolFamily.UNIX)
        try {
            channel.connect(UnixDomainSocketAddress.of(path))
        } catch (e: java.io.IOException) {
            channel.close()
            throw e
        }
        return object : UnixConnection {
            override val input: InputStream = Channels.newInputStream(channel)
            override val output: OutputStream = Channels.newOutputStream(channel)

            override fun close() = channel.close()
        }
    }
}
