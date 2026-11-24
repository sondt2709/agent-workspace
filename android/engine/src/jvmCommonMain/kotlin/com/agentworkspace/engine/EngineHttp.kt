package com.agentworkspace.engine

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.net.Proxy
import java.nio.file.Files
import java.nio.file.Path
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Trusts only the engine certificate in `https-cert.pem` (exact bytes), for the HTTPS fallback on
 * 127.0.0.1 (docs/phase-1.md 6.7.3). Another server on the port fails the handshake, so it never gets
 * the API key. The file is read at each handshake: the engine writes it at its first TLS start.
 */
@Suppress("CustomX509TrustManager") // On purpose: it trusts one pinned certificate, no other one.
class PinnedCertificateTrust(
    private val certFile: Path,
) : X509TrustManager {
    fun pinned(): X509Certificate {
        if (!Files.isRegularFile(certFile)) throw CertificateException("No engine certificate at $certFile")
        val bytes = Files.readAllBytes(certFile)
        return CertificateFactory
            .getInstance(
                "X.509",
            ).generateCertificate(ByteArrayInputStream(bytes)) as X509Certificate
    }

    fun matches(certificate: java.security.cert.Certificate?): Boolean =
        certificate != null && runCatching { certificate.encoded.contentEquals(pinned().encoded) }.getOrDefault(false)

    override fun checkServerTrusted(
        chain: Array<out X509Certificate>?,
        authType: String?,
    ) {
        if (!matches(
                chain?.firstOrNull(),
            )
        ) {
            throw CertificateException("The server certificate is not the engine certificate")
        }
    }

    override fun checkClientTrusted(
        chain: Array<out X509Certificate>?,
        authType: String?,
    ): Unit = throw CertificateException("No client certificates")

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

    /** The host name check: the certificate of the session is the pinned one. */
    val hostnameVerifier = HostnameVerifier { _, session -> matches(session.peerCertificates.firstOrNull()) }
}

/** The HTTP client of the engine REST API (Ktor with the OkHttp engine, docs/tech-stack.md 2.5). */
object EngineHttp {
    /** The host name of the requests over the socket: the same as awd (`http://syncthing`). */
    const val SOCKET_HOST = "syncthing"
    const val DEFAULT_TIMEOUT_MS = 30_000L
    private const val CONNECT_TIMEOUT_MS = 5_000L
    private val loopbackBytes = byteArrayOf(127, 0, 0, 1)

    fun baseUrl(endpoint: RestEndpoint): String =
        when (endpoint) {
            is RestEndpoint.UnixSocket -> "http://$SOCKET_HOST/"
            is RestEndpoint.Loopback -> "https://${RestEndpoint.LOOPBACK_HOST}:${endpoint.port}/"
        }

    /**
     * A client for [endpoint]. Each request opens a new connection (no pool): a Unix socket connects
     * fast, and a pooled connection would get the OkHttp health check, which needs `SO_TIMEOUT`.
     */
    fun client(
        endpoint: RestEndpoint,
        apiKey: String,
        connector: UnixConnector,
        certFile: Path,
    ): HttpClient =
        HttpClient(OkHttp) {
            expectSuccess = false
            engine {
                config {
                    connectionPool(okhttp3.ConnectionPool(0, 1, TimeUnit.SECONDS))
                    proxy(Proxy.NO_PROXY)
                    retryOnConnectionFailure(false)
                    when (endpoint) {
                        is RestEndpoint.UnixSocket -> {
                            socketFactory(UnixSocketFactory(endpoint.path, connector))
                            // No DNS: the socket factory ignores the address.
                            dns { host -> listOf(InetAddress.getByAddress(host, loopbackBytes)) }
                        }

                        is RestEndpoint.Loopback -> {
                            val trust = PinnedCertificateTrust(certFile)
                            val context = SSLContext.getInstance("TLS")
                            context.init(null, arrayOf(trust), null)
                            sslSocketFactory(context.socketFactory, trust)
                            hostnameVerifier(trust.hostnameVerifier)
                        }
                    }
                }
            }
            // The socket (read) timeout too: OkHttp reads for 10 s by default, so a long poll or a long
            // scan failed after 10 s (review android-engine M1).
            install(HttpTimeout) {
                requestTimeoutMillis = DEFAULT_TIMEOUT_MS
                socketTimeoutMillis = DEFAULT_TIMEOUT_MS
                connectTimeoutMillis = CONNECT_TIMEOUT_MS
            }
            defaultRequest {
                url(baseUrl(endpoint))
                header(EngineRest.API_KEY_HEADER, apiKey)
            }
        }
}
