package com.agentworkspace.engine

/**
 * The address of the engine REST API (docs/phase-1.md 6.7.3): a Unix socket in the app files folder,
 * or the fallback on 127.0.0.1 with HTTPS (spike S3 is not proven yet).
 */
sealed interface RestEndpoint {
    /** The `<gui><address>` value of config.xml. */
    val guiAddress: String

    /** The `tls` attribute of `<gui>`. */
    val tls: Boolean

    data class UnixSocket(
        val path: String,
    ) : RestEndpoint {
        override val guiAddress: String get() = path
        override val tls: Boolean get() = false
    }

    data class Loopback(
        val port: Int,
    ) : RestEndpoint {
        init {
            require(port in 1..MAX_PORT) { "port $port is not valid" }
        }

        override val guiAddress: String get() = "$LOOPBACK_HOST:$port"
        override val tls: Boolean get() = true
    }

    companion object {
        const val LOOPBACK_HOST = "127.0.0.1"
        private const val MAX_PORT = 65535
        private val LOOPBACK = Regex("""^127\.0\.0\.1:(\d{1,5})$""")

        /**
         * The endpoint of a config: the AW socket with no TLS, or a loopback port with TLS. Any other
         * address (for example the `127.0.0.1:8384` of `generate`, which has no TLS) is null.
         */
        fun parse(
            address: String,
            tls: Boolean,
            socket: String,
        ): RestEndpoint? {
            if (address == socket && !tls) return UnixSocket(socket)
            val port =
                LOOPBACK
                    .find(address)
                    ?.groupValues
                    ?.get(1)
                    ?.toIntOrNull() ?: return null
            return if (tls && port in 1..MAX_PORT) Loopback(port) else null
        }
    }
}

/** The values of the AW template (docs/phase-1.md 6.2, with the phone values of 6.7). */
data class EngineTemplate(
    /** The config version of `generate`. */
    val version: String,
    val deviceId: String,
    /** The AW device slug of the phone: the engine device name. No OS host name. */
    val name: String,
    val endpoint: RestEndpoint,
    val apiKey: String,
    val listen: String,
    val reconnectS: Int,
)

/** The values of a config.xml text that AW reads. */
data class ConfigValues(
    val version: String?,
    val apiKey: String?,
    val guiAddress: String?,
    val guiTls: Boolean,
)

/**
 * The engine config.xml before the first start: a port of plugins/sync-syncthing/src/config.ts. The
 * same settings as awd, so the phone has no third-party traffic before the app reads the community
 * switch: global and local discovery, relays, NAT, usage and crash reports and upgrades are off.
 */
object EngineConfig {
    /** The listen port of AW engines: port 22000 stays free for a Syncthing of the user. */
    const val DEFAULT_LISTEN = "tcp://0.0.0.0:22300"

    /** The reconnect interval of the phone while the app is closed (docs/phase-1.md 6.2). */
    const val PHONE_RECONNECT_S = 20

    /** The reconnect interval while the app is open. */
    const val OPEN_RECONNECT_S = 5

    /** The config version when `generate` wrote none. */
    const val DEFAULT_VERSION = "52"

    private val escapes = mapOf('&' to "&amp;", '<' to "&lt;", '>' to "&gt;", '"' to "&quot;", '\'' to "&apos;")

    fun escapeXml(value: String): String =
        buildString {
            for (c in value) append(escapes[c] ?: c.toString())
        }

    fun unescapeXml(value: String): String =
        Regex("&(amp|lt|gt|quot|apos);").replace(value) { m ->
            escapes.entries
                .first { it.value == m.value }
                .key
                .toString()
        }

    fun render(t: EngineTemplate): String {
        val e = ::escapeXml
        val permissions =
            if (t.endpoint is RestEndpoint.UnixSocket) {
                "\n        <unixSocketPermissions>0600</unixSocketPermissions>"
            } else {
                ""
            }
        return """
            |<configuration version="${e(t.version)}">
            |    <device id="${e(
            t.deviceId,
        )}" name="${e(
            t.name,
        )}" compression="metadata" introducer="false" skipIntroductionRemovals="false" introducedBy="">
            |        <address>dynamic</address>
            |        <paused>false</paused>
            |        <autoAcceptFolders>false</autoAcceptFolders>
            |    </device>
            |    <gui enabled="true" tls="${t.endpoint.tls}" sendBasicAuthPrompt="false">
            |        <address>${e(t.endpoint.guiAddress)}</address>$permissions
            |        <apikey>${e(t.apiKey)}</apikey>
            |        <theme>default</theme>
            |    </gui>
            |    <options>
            |        <listenAddress>${e(t.listen)}</listenAddress>
            |        <globalAnnounceEnabled>false</globalAnnounceEnabled>
            |        <localAnnounceEnabled>false</localAnnounceEnabled>
            |        <relaysEnabled>false</relaysEnabled>
            |        <natEnabled>false</natEnabled>
            |        <urAccepted>-1</urAccepted>
            |        <crashReportingEnabled>false</crashReportingEnabled>
            |        <autoUpgradeIntervalH>0</autoUpgradeIntervalH>
            |        <startBrowser>false</startBrowser>
            |        <reconnectionIntervalS>${t.reconnectS}</reconnectionIntervalS>
            |        <announceLANAddresses>false</announceLANAddresses>
            |        <stunKeepaliveStartS>0</stunKeepaliveStartS>
            |    </options>
            |</configuration>
            |
            """.trimMargin()
    }

    /** Reads the config version, the API key and the REST address of a config.xml text. */
    fun read(text: String): ConfigValues {
        val version = Regex("""<configuration version="(\d+)"""").find(text)?.groupValues?.get(1)
        val gui = Regex("""<gui\b([^>]*)>([\s\S]*?)</gui>""").find(text)
        val attributes = gui?.groupValues?.get(1).orEmpty()
        val body = gui?.groupValues?.get(2).orEmpty()
        val apiKey = Regex("<apikey>([^<]*)</apikey>").find(body)?.groupValues?.get(1)
        val address = Regex("<address>([^<]*)</address>").find(body)?.groupValues?.get(1)
        val tls = Regex("""\btls="(true|false)"""").find(attributes)?.groupValues?.get(1) == "true"
        return ConfigValues(
            version = version,
            apiKey = apiKey?.let(::unescapeXml),
            guiAddress = address?.let(::unescapeXml),
            guiTls = tls,
        )
    }

    private fun element(
        text: String,
        name: String,
    ): String? = Regex("<$name>([^<]*)</$name>").find(text)?.groupValues?.get(1)

    /**
     * The endpoint of an AW config of this home, or null when the text is not an AW config: REST on
     * the AW socket or on a loopback port with TLS, an API key, and the template options that the app
     * never turns on (NAT, usage and crash reports, upgrades). The config of `generate` is not one.
     */
    fun awEndpoint(
        text: String,
        socket: String,
    ): RestEndpoint? {
        val values = read(text)
        if (values.apiKey.isNullOrEmpty()) return null
        val endpoint = RestEndpoint.parse(values.guiAddress ?: return null, values.guiTls, socket) ?: return null
        val templateOptions =
            element(text, "natEnabled") == "false" &&
                element(text, "crashReportingEnabled") == "false" &&
                element(text, "urAccepted") == "-1" &&
                element(text, "autoUpgradeIntervalH") == "0"
        return if (templateOptions) endpoint else null
    }

    fun isAwConfig(
        text: String,
        socket: String,
    ): Boolean = awEndpoint(text, socket) != null
}
