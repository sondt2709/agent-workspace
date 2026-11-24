package com.agentworkspace.engine

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import kotlinx.coroutines.runBlocking
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyStore
import java.util.Base64
import java.util.Collections
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The HTTPS fallback on 127.0.0.1 (docs/phase-1.md 6.7.3): the client trusts only `https-cert.pem`.
 * The certificates come from `keytool` of the test JDK, like the self-signed GUI certificate that the
 * engine writes.
 */
class PinnedTrustTest {
    private fun keytool(vararg args: String) {
        val tool = Path.of(System.getProperty("java.home"), "bin", "keytool").toString()
        val process = ProcessBuilder(listOf(tool) + args).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        check(process.waitFor() == 0) { "keytool failed: $output" }
    }

    /** A key store with a self-signed certificate, and the certificate as PEM. */
    private fun certificate(
        dir: Path,
        name: String,
    ): Pair<Path, Path> {
        val store = dir.resolve("$name.p12")
        keytool(
            "-genkeypair",
            "-keystore",
            store.toString(),
            "-storetype",
            "PKCS12",
            "-storepass",
            PASSWORD,
            "-alias",
            name,
            "-keyalg",
            "EC",
            "-groupname",
            "secp256r1",
            "-dname",
            "CN=syncthing",
            "-validity",
            "2",
        )
        val der = dir.resolve("$name.der")
        keytool(
            "-exportcert",
            "-keystore",
            store.toString(),
            "-storepass",
            PASSWORD,
            "-alias",
            name,
            "-file",
            der.toString(),
        )
        val pem = dir.resolve("$name.pem")
        val base64 = Base64.getMimeEncoder(PEM_LINE, "\n".toByteArray()).encodeToString(Files.readAllBytes(der))
        Files.writeString(pem, "-----BEGIN CERTIFICATE-----\n$base64\n-----END CERTIFICATE-----\n")
        return store to pem
    }

    private fun server(
        store: Path,
        keys: MutableList<String?>,
    ): HttpsServer {
        val keyStore =
            KeyStore.getInstance("PKCS12").apply {
                Files.newInputStream(store).use { load(it, PASSWORD.toCharArray()) }
            }
        val factory =
            KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
                init(keyStore, PASSWORD.toCharArray())
            }
        val context = SSLContext.getInstance("TLS").apply { init(factory.keyManagers, null, null) }
        val server = HttpsServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.httpsConfigurator = HttpsConfigurator(context)
        server.createContext("/rest/system/ping") { exchange ->
            keys.add(exchange.requestHeaders.getFirst(EngineRest.API_KEY_HEADER))
            val body = """{"ping":"pong"}""".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        return server
    }

    @Test
    fun trustsOnlyTheEngineCertificate() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val (engineStore, enginePem) = certificate(dir, "engine")
                val (_, otherPem) = certificate(dir, "other")
                val keys = Collections.synchronizedList(mutableListOf<String?>())
                val server = server(engineStore, keys)
                try {
                    val endpoint = RestEndpoint.Loopback(server.address.port)
                    EngineRest(EngineHttp.client(endpoint, "secret-key", JdkUnixConnector, enginePem)).use { it.ping() }
                    assertEquals(listOf<String?>("secret-key"), keys.toList())

                    val refused =
                        EngineRest(EngineHttp.client(endpoint, "secret-key", JdkUnixConnector, otherPem)).use {
                            assertFailsWith<EngineRestException> { it.ping() }
                        }
                    assertEquals(0, refused.status)
                    val missing =
                        EngineRest(
                            EngineHttp.client(endpoint, "secret-key", JdkUnixConnector, dir.resolve("none.pem")),
                        ).use {
                            assertFailsWith<EngineRestException> { it.ping() }
                        }
                    assertEquals(0, missing.status)
                    // The server got no request (and so no API key) from the refused clients.
                    assertEquals(1, keys.size)
                    assertTrue(PinnedCertificateTrust(enginePem).matches(PinnedCertificateTrust(enginePem).pinned()))
                } finally {
                    server.stop(0)
                }
            }
        }

    private companion object {
        const val PASSWORD = "test-pass"
        const val PEM_LINE = 64
    }
}
