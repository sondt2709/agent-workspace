package com.agentworkspace.engine

import java.net.ServerSocket
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermissions
import java.security.SecureRandom
import java.util.Base64
import kotlin.io.path.exists
import kotlin.io.path.readText

/** The identity of a prepared engine home. */
data class EngineIdentity(
    val deviceId: String,
    val apiKey: String,
    val endpoint: RestEndpoint,
    /** True when the app wrote a new config.xml. */
    val created: Boolean,
    /** True when an existing config.xml was not an AW config (or not the wanted endpoint). */
    val replaced: Boolean,
)

/** A failure to prepare the engine home: the state becomes `failed` and the supervisor tries again. */
class EngineHomeException(
    message: String,
) : Exception(message)

/**
 * Prepares the engine home before each start (docs/phase-1.md 6.1 with the phone values of 6.7): at
 * the first start `generate`, `device-id` and the AW config.xml; at a later start, the API key of the
 * existing AW config. A config.xml that is not an AW config, or that has another endpoint than the
 * wanted one (the socket or the loopback fallback), gets the AW template again before the engine
 * starts; `generate` keeps the certificate, so the device id stays.
 */
class EngineHome(
    private val paths: EnginePaths,
    private val launcher: EngineLauncher,
    private val random: SecureRandom = SecureRandom(),
    /** Gives a free loopback port for the HTTPS fallback. */
    private val freePort: () -> Int = { ServerSocket(0).use { it.localPort } },
) {
    private fun env(): Map<String, String> = mapOf("STNODEFAULTFOLDER" to "1", "STHOMEDIR" to paths.home.toString())

    /** A new random API key: 32 bytes, base64url. */
    fun newApiKey(): String {
        val bytes = ByteArray(API_KEY_BYTES)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    /** The device id of the engine home, from its certificate (`device-id`). */
    suspend fun deviceId(): String {
        val result = launcher.run(listOf("device-id", "--home=${paths.home}"), env())
        val id =
            result.output
                .trim()
                .lines()
                .lastOrNull()
                ?.trim()
                .orEmpty()
        if (result.exitCode != 0 || !DEVICE_ID.matches(id)) {
            throw EngineHomeException("The engine gave no valid device id (exit ${result.exitCode}): $id")
        }
        return id
    }

    /**
     * True when the AW config of the home uses the HTTPS fallback endpoint: an earlier app process moved
     * to it, so a new process keeps it and does not write the config again (review android-engine M3).
     */
    fun usesLoopback(): Boolean {
        if (!paths.config.exists()) return false
        val text = runCatching { paths.config.readText() }.getOrNull() ?: return false
        return EngineConfig.awEndpoint(text, paths.socket.toString()) is RestEndpoint.Loopback
    }

    /**
     * Makes the home ready. [loopback] asks for the HTTPS fallback endpoint instead of the socket.
     * [name] is the phone slug, [listen] the listen address.
     */
    suspend fun prepare(
        name: String,
        listen: String,
        loopback: Boolean,
    ): EngineIdentity {
        val socket = paths.socket.toString()
        if (socket.toByteArray().size > MAX_SOCKET_BYTES) {
            throw EngineHomeException("The socket path is longer than $MAX_SOCKET_BYTES bytes: $socket")
        }
        createPrivateDirectory(paths.home)
        createPrivateDirectory(paths.socket.parent)
        var replaced = false
        if (paths.config.exists()) {
            val text = paths.config.readText()
            val endpoint = EngineConfig.awEndpoint(text, socket)
            val apiKey = EngineConfig.read(text).apiKey
            if (endpoint != null && apiKey != null && (endpoint is RestEndpoint.Loopback) == loopback) {
                return EngineIdentity(deviceId(), apiKey, endpoint, created = false, replaced = false)
            }
            replaced = true
        }
        val generate = launcher.run(listOf("generate", "--home=${paths.home}", "--no-port-probing"), env())
        if (generate.exitCode != 0) {
            throw EngineHomeException(
                "The engine generate step failed (exit ${generate.exitCode}): ${generate.output.trim()}",
            )
        }
        val version = if (paths.config.exists()) EngineConfig.read(paths.config.readText()).version else null
        val deviceId = deviceId()
        val apiKey = newApiKey()
        val endpoint = if (loopback) RestEndpoint.Loopback(freePort()) else RestEndpoint.UnixSocket(socket)
        val text =
            EngineConfig.render(
                EngineTemplate(
                    version = version ?: EngineConfig.DEFAULT_VERSION,
                    deviceId = deviceId,
                    name = name,
                    endpoint = endpoint,
                    apiKey = apiKey,
                    listen = listen,
                    reconnectS = EngineConfig.PHONE_RECONNECT_S,
                ),
            )
        writePrivate(paths.config, text)
        return EngineIdentity(deviceId, apiKey, endpoint, created = true, replaced = replaced)
    }

    companion object {
        /** A Unix socket path of 104 bytes or more fails (`bind: invalid argument`). */
        const val MAX_SOCKET_BYTES = 103
        private const val API_KEY_BYTES = 32
        val DEVICE_ID = Regex("^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$")

        private val ownerOnly = PosixFilePermissions.fromString("rwx------")
        private val ownerFile = PosixFilePermissions.fromString("rw-------")

        fun createPrivateDirectory(dir: Path) {
            Files.createDirectories(dir)
            runCatching { Files.setPosixFilePermissions(dir, ownerOnly) }
        }

        /** Writes a file with mode 0600 through a temp file and a rename. */
        fun writePrivate(
            file: Path,
            text: String,
        ) {
            val temp = file.resolveSibling("${file.fileName}.aw-new")
            // Files.write, not writeString: android.jar of API 29 has no Files.writeString.
            Files.write(temp, text.toByteArray())
            runCatching { Files.setPosixFilePermissions(temp, ownerFile) }
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
    }
}
