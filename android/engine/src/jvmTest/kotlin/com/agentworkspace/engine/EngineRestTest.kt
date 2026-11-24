package com.agentworkspace.engine

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import java.io.ByteArrayOutputStream
import java.net.StandardProtocolFamily
import java.net.UnixDomainSocketAddress
import java.nio.ByteBuffer
import java.nio.channels.ServerSocketChannel
import java.nio.file.Files
import java.nio.file.Path
import java.util.Collections
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EngineRestTest {
    @Test
    fun namesTheRouteAndTheFieldOfAReplyThatIsNotValid() =
        runBlocking<Unit> {
            val api = FakeEngineApi()
            api.completion("f", "d", needItems = 0)
            api.completions["f|d"] = JsonObject(api.completions.getValue("f|d") - "remoteState")
            val error = assertFailsWith<EngineRestException> { api.client().completion("f", "d") }
            assertContains(error.message.orEmpty(), "rest/db/completion")
            assertContains(error.message.orEmpty(), "remoteState")
        }

    @Test
    fun givesNullForAMissingFolderAndAnErrorWithTheStatusElse() =
        runBlocking<Unit> {
            val api = FakeEngineApi()
            assertNull(api.client().folderJson("aw-ws-tasks"))
            api.pingOk = false
            val error = assertFailsWith<EngineRestException> { api.client().ping() }
            assertEquals(503, error.status)
        }
}

/**
 * The REST client over a real Unix socket: a small HTTP/1.1 server on a JDK `ServerSocketChannel`
 * answers like the engine. It checks the socket adapter that OkHttp uses on the phone.
 */
class UnixSocketTest {
    private fun serve(
        path: Path,
        replies: Map<String, String>,
        requests: MutableList<String>,
        delayMs: Long = 0,
    ): ServerSocketChannel {
        val server = ServerSocketChannel.open(StandardProtocolFamily.UNIX)
        server.bind(UnixDomainSocketAddress.of(path))
        thread(isDaemon = true) {
            while (server.isOpen) {
                val channel = runCatching { server.accept() }.getOrNull() ?: break
                channel.use {
                    val head = ByteArrayOutputStream()
                    val buffer = ByteBuffer.allocate(4096)
                    while (!head.toString().contains("\r\n\r\n")) {
                        buffer.clear()
                        if (it.read(buffer) < 0) break
                        head.write(buffer.array(), 0, buffer.position())
                    }
                    val text = head.toString()
                    requests.add(text)
                    val target = text.lineSequence().first().split(" ")[1]
                    val body = replies.entries.firstOrNull { (route, _) -> target.startsWith(route) }?.value
                    val status = if (body == null) "404 Not Found" else "200 OK"
                    val payload = body ?: "not found"
                    if (delayMs > 0) Thread.sleep(delayMs)
                    val reply =
                        "HTTP/1.1 $status\r\nContent-Type: application/json\r\n" +
                            "Content-Length: ${payload.toByteArray().size}\r\nConnection: close\r\n\r\n$payload"
                    it.write(ByteBuffer.wrap(reply.toByteArray()))
                }
            }
        }
        return server
    }

    @Test
    fun callsTheEngineOverTheUnixSocketWithTheApiKey() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val socket = dir.resolve("sync.sock")
                val requests = Collections.synchronizedList(mutableListOf<String>())
                val replies =
                    mapOf(
                        "/rest/system/ping" to """{"ping":"pong"}""",
                        "/rest/system/status" to """{"myID":"${Ids.PHONE}","uptime":3}""",
                    )
                serve(socket, replies, requests).use {
                    val endpoint = RestEndpoint.UnixSocket(socket.toString())
                    val client =
                        EngineRest(EngineHttp.client(endpoint, "secret-key", JdkUnixConnector, dir.resolve("none.pem")))
                    client.use { rest ->
                        rest.ping()
                        assertEquals(Ids.PHONE, rest.myId())
                        assertEquals(Ids.PHONE, rest.myId())
                        val missing = assertFailsWith<EngineRestException> { rest.options() }
                        assertEquals(404, missing.status)
                    }
                }
                assertEquals(4, requests.size)
                assertTrue(requests.all { it.contains("X-API-Key: secret-key") }, "each request has the key")
                assertTrue(requests.all { it.contains("Host: syncthing") })
            }
        }

    @Test
    fun aLongPollWaitsLongerThanTheReadTimeoutOfOkHttp() =
        runBlocking<Unit> {
            // The engine answers a long poll after 11 s; OkHttp reads for 10 s by default (review M1).
            withTempDir { dir ->
                val socket = dir.resolve("sync.sock")
                val requests = Collections.synchronizedList(mutableListOf<String>())
                serve(socket, mapOf("/rest/events" to "[]"), requests, delayMs = 11_000).use {
                    val endpoint = RestEndpoint.UnixSocket(socket.toString())
                    val http = EngineHttp.client(endpoint, "k", JdkUnixConnector, dir.resolve("none.pem"))
                    EngineRest(http).use { rest -> assertEquals(emptyList(), rest.events(since = 0, timeoutS = 30)) }
                }
            }
        }

    @Test
    fun failsWithNoReplyWhenTheSocketDoesNotExist() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val endpoint = RestEndpoint.UnixSocket(dir.resolve("no.sock").toString())
                val client = EngineRest(EngineHttp.client(endpoint, "k", JdkUnixConnector, dir))
                val error = client.use { assertFailsWith<EngineRestException> { it.ping() } }
                assertEquals(0, error.status)
                assertTrue(Files.notExists(dir.resolve("no.sock")))
            }
        }
}
