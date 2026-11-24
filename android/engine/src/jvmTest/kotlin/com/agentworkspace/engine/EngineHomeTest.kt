package com.agentworkspace.engine

import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EngineConfigTest {
    private val socket = "/data/user/0/com.agentworkspace.android/files/run/sync.sock"

    private fun template(endpoint: RestEndpoint = RestEndpoint.UnixSocket(socket)) =
        EngineTemplate(
            version = "51",
            deviceId = Ids.PHONE,
            name = "pixel-9",
            endpoint = endpoint,
            apiKey = "key&<\"x",
            listen = EngineConfig.DEFAULT_LISTEN,
            reconnectS = EngineConfig.PHONE_RECONNECT_S,
        )

    @Test
    fun rendersThePhoneTemplateWithEachSettingOff() {
        val text = EngineConfig.render(template())
        for (off in listOf(
            "globalAnnounceEnabled",
            "localAnnounceEnabled",
            "relaysEnabled",
            "natEnabled",
            "crashReportingEnabled",
        )) {
            assertContains(text, "<$off>false</$off>")
        }
        assertContains(text, "<urAccepted>-1</urAccepted>")
        assertContains(text, "<autoUpgradeIntervalH>0</autoUpgradeIntervalH>")
        assertContains(text, "<reconnectionIntervalS>20</reconnectionIntervalS>")
        assertContains(text, "<listenAddress>tcp://0.0.0.0:22300</listenAddress>")
        assertContains(text, "<unixSocketPermissions>0600</unixSocketPermissions>")
        assertContains(text, "name=\"pixel-9\"")
        val values = EngineConfig.read(text)
        assertEquals("key&<\"x", values.apiKey)
        assertEquals(socket, values.guiAddress)
        assertFalse(values.guiTls)
        assertEquals(RestEndpoint.UnixSocket(socket), EngineConfig.awEndpoint(text, socket))
    }

    @Test
    fun acceptsTheLoopbackFallbackOnlyWithTls() {
        val text = EngineConfig.render(template(RestEndpoint.Loopback(41234)))
        assertContains(text, "tls=\"true\"")
        assertEquals(RestEndpoint.Loopback(41234), EngineConfig.awEndpoint(text, socket))
        assertNull(EngineConfig.awEndpoint(text.replace("tls=\"true\"", "tls=\"false\""), socket))
    }

    @Test
    fun refusesTheConfigOfGenerate() {
        assertFalse(EngineConfig.isAwConfig(FakeLauncher.GENERATED_CONFIG, socket))
        // An AW config whose options were changed to the defaults of generate is not trusted.
        val text =
            EngineConfig
                .render(
                    template(),
                ).replace("<natEnabled>false</natEnabled>", "<natEnabled>true</natEnabled>")
        assertFalse(EngineConfig.isAwConfig(text, socket))
        val other = EngineConfig.render(template(RestEndpoint.UnixSocket("/tmp/other.sock")))
        assertFalse(EngineConfig.isAwConfig(other, socket))
    }
}

class EngineVersionTest {
    private fun properties(): Properties =
        Properties().apply {
            Files.newInputStream(Path.of(System.getProperty("aw.engine.versionFile"))).use { load(it) }
        }

    @Test
    fun usesTheSyncthingTagOfTheComputers() {
        val desktop = Path.of(System.getProperty("aw.engine.desktopPins")).readText()
        val tag = Regex("\"tag\":\\s*\"([^\"]+)\"").find(desktop)?.groupValues?.get(1)
        assertEquals(tag, properties().getProperty("SYNCTHING_TAG"))
        assertContains(properties().getProperty("SYNCTHING_SOURCE_URL"), "/$tag/syncthing-source-$tag.tar.gz")
    }

    @Test
    fun pinsEachDownloadWithASha256() {
        val p = properties()
        val sha = Regex("^[0-9a-f]{64}$")
        val pins = p.stringPropertyNames().filter { it.endsWith("_SHA256") || it.contains("_SHA256_") }
        assertTrue(pins.size >= 7, "pins: $pins")
        for (name in pins) {
            val value = p.getProperty(name)
            // A built-file pin may be empty until the first build records it.
            if (name.startsWith("LIBAWSYNC_") && value.isEmpty()) continue
            assertTrue(sha.matches(value), "$name=$value")
        }
        assertTrue(Regex("""^\d+\.\d+\.\d+$""").matches(p.getProperty("NDK_VERSION")))
        assertTrue(Regex("""^\d+\.\d+\.\d+$""").matches(p.getProperty("GO_VERSION")))
    }
}

class EngineHomeTest {
    @Test
    fun writesTheAwConfigBeforeTheFirstStart() =
        runTest {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val launcher = FakeLauncher(paths)
                val identity =
                    EngineHome(
                        paths,
                        launcher,
                    ).prepare("pixel-9", EngineConfig.DEFAULT_LISTEN, loopback = false)
                assertTrue(identity.created)
                assertEquals(Ids.PHONE, identity.deviceId)
                assertEquals(RestEndpoint.UnixSocket(paths.socket.toString()), identity.endpoint)
                assertEquals(listOf("generate", "device-id"), launcher.commands.map { it.first() })
                val text = paths.config.readText()
                assertTrue(EngineConfig.isAwConfig(text, paths.socket.toString()))
                assertEquals(identity.apiKey, EngineConfig.read(text).apiKey)
                assertEquals("51", EngineConfig.read(text).version)
                assertEquals(
                    setOf("rw-------"),
                    setOf(
                        java.nio.file.attribute.PosixFilePermissions.toString(
                            Files.getPosixFilePermissions(paths.config),
                        ),
                    ),
                )
            }
        }

    @Test
    fun keepsTheApiKeyOfAnExistingAwConfig() =
        runTest {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val launcher = FakeLauncher(paths)
                val home = EngineHome(paths, launcher)
                val first = home.prepare("pixel-9", EngineConfig.DEFAULT_LISTEN, loopback = false)
                launcher.commands.clear()
                val second = home.prepare("pixel-9", EngineConfig.DEFAULT_LISTEN, loopback = false)
                assertFalse(second.created)
                assertEquals(first.apiKey, second.apiKey)
                assertEquals(listOf("device-id"), launcher.commands.map { it.first() })
            }
        }

    @Test
    fun replacesTheConfigOfGenerateBeforeServe() =
        runTest {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                Files.createDirectories(paths.home)
                Files.writeString(paths.config, FakeLauncher.GENERATED_CONFIG)
                val identity =
                    EngineHome(
                        paths,
                        FakeLauncher(paths),
                    ).prepare("pixel-9", EngineConfig.DEFAULT_LISTEN, false)
                assertTrue(identity.replaced)
                assertEquals(Ids.PHONE, identity.deviceId)
                assertTrue(EngineConfig.isAwConfig(paths.config.readText(), paths.socket.toString()))
            }
        }

    @Test
    fun switchesToTheLoopbackFallback() =
        runTest {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val home = EngineHome(paths, FakeLauncher(paths), freePort = { 45678 })
                home.prepare("pixel-9", EngineConfig.DEFAULT_LISTEN, loopback = false)
                val fallback = home.prepare("pixel-9", EngineConfig.DEFAULT_LISTEN, loopback = true)
                assertEquals(RestEndpoint.Loopback(45678), fallback.endpoint)
                assertTrue(fallback.replaced)
                assertIs<RestEndpoint.Loopback>(
                    EngineConfig.awEndpoint(paths.config.readText(), paths.socket.toString()),
                )
            }
        }

    @Test
    fun failsWhenGenerateFailsOrTheSocketPathIsTooLong() =
        runTest {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val launcher = FakeLauncher(paths).apply { generateExit = 1 }
                val error =
                    assertFailsWith<EngineHomeException> { EngineHome(paths, launcher).prepare("p", "tcp://:1", false) }
                assertContains(error.message.orEmpty(), "generate")
                val long = EnginePaths(dir.resolve("x".repeat(120)))
                assertFailsWith<EngineHomeException> {
                    EngineHome(
                        long,
                        FakeLauncher(long),
                    ).prepare("p", "tcp://:1", false)
                }
            }
        }
}
