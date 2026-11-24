package com.agentworkspace.engine

import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.Socket
import java.net.SocketAddress
import java.net.SocketException
import javax.net.SocketFactory

/** One open Unix socket connection. */
interface UnixConnection {
    val input: InputStream
    val output: OutputStream

    fun close()
}

/**
 * Opens a connection to a Unix socket path: `android.net.LocalSocket` on Android, a JDK
 * `SocketChannel` with `UnixDomainSocketAddress` on the JVM (tests).
 */
fun interface UnixConnector {
    fun connect(path: String): UnixConnection
}

/**
 * A `java.net.Socket` over a Unix socket, for OkHttp: OkHttp asks the factory for a socket and calls
 * `connect` with the address of the request host, which this socket ignores. OkHttp ends a timeout by
 * a close of the socket (Okio), so the read timeout works with no `SO_TIMEOUT`.
 */
class UnixSocket(
    private val path: String,
    private val connector: UnixConnector,
) : Socket() {
    @Volatile private var connection: UnixConnection? = null

    @Volatile private var closed = false
    private var timeout = 0
    private var inputShutdown = false
    private var outputShutdown = false

    override fun connect(
        endpoint: SocketAddress?,
        timeout: Int,
    ) {
        if (closed) throw SocketException("Socket is closed")
        connection = connector.connect(path)
    }

    override fun connect(endpoint: SocketAddress?) = connect(endpoint, 0)

    private fun open(): UnixConnection = connection ?: throw SocketException("Socket is not connected")

    override fun getInputStream(): InputStream = open().input

    override fun getOutputStream(): OutputStream = open().output

    override fun isConnected(): Boolean = connection != null

    override fun isClosed(): Boolean = closed

    override fun isBound(): Boolean = connection != null

    override fun close() {
        closed = true
        connection?.close()
    }

    override fun shutdownInput() {
        inputShutdown = true
    }

    override fun shutdownOutput() {
        outputShutdown = true
    }

    override fun isInputShutdown(): Boolean = inputShutdown

    override fun isOutputShutdown(): Boolean = outputShutdown

    override fun setSoTimeout(timeout: Int) {
        this.timeout = timeout
    }

    override fun getSoTimeout(): Int = timeout

    override fun getInetAddress(): InetAddress = InetAddress.getLoopbackAddress()

    override fun getPort(): Int = 0

    override fun setTcpNoDelay(on: Boolean) = Unit

    override fun setKeepAlive(on: Boolean) = Unit

    override fun toString(): String = "UnixSocket[$path]"
}

/** The `SocketFactory` that OkHttp uses for each connection to the engine socket. */
class UnixSocketFactory(
    private val path: String,
    private val connector: UnixConnector,
) : SocketFactory() {
    override fun createSocket(): Socket = UnixSocket(path, connector)

    override fun createSocket(
        host: String?,
        port: Int,
    ): Socket = connected()

    override fun createSocket(
        host: String?,
        port: Int,
        localHost: InetAddress?,
        localPort: Int,
    ): Socket = connected()

    override fun createSocket(
        host: InetAddress?,
        port: Int,
    ): Socket = connected()

    override fun createSocket(
        address: InetAddress?,
        port: Int,
        localAddress: InetAddress?,
        localPort: Int,
    ): Socket = connected()

    private fun connected(): Socket = UnixSocket(path, connector).also { it.connect(null) }
}
