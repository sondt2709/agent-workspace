package com.agentworkspace.engine

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EngineSetupTest {
    private fun setup(
        paths: EnginePaths,
        community: Boolean = true,
    ) = EngineSetup(
        paths = paths,
        peers = PeerStore(paths.peers),
        workspaces = { listOf("ws1") },
        engineSettings = { EngineSettings("pixel-9") },
        setupSettings = { SetupSettings(community) },
    )

    @Test
    fun sharesTasksAndKnowledgeButNotSecure() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val api = FakeEngineApi()
                PeerStore(
                    paths.peers,
                ).write(listOf(peer("macbook-pro", Ids.MAC), peer("ubuntu-01", Ids.SERVER, "remote")))
                setup(paths).apply(api.client(), Ids.PHONE)

                assertEquals(setOf("aw-ws1-tasks", "aw-ws1-knowledge"), api.folders.keys)
                val tasks = api.folders.getValue("aw-ws1-tasks")
                assertEquals(paths.folder("ws1", FolderKind.TASKS).toString(), tasks["path"]?.jsonPrimitive?.content)
                assertEquals(
                    listOf(Ids.PHONE, Ids.MAC, Ids.SERVER).sorted(),
                    tasks["devices"]!!.jsonArray.map { it.jsonObject["deviceID"]!!.jsonPrimitive.content },
                )
                assertEquals("", tasks["versioning"]!!.jsonObject["type"]!!.jsonPrimitive.content)
                assertEquals("10", tasks["maxConflicts"]!!.jsonPrimitive.content)
                assertTrue(Files.isDirectory(paths.folder("ws1", FolderKind.KNOWLEDGE)))
                assertEquals(listOf("*.aw-tmp", "/*/artifacts"), api.ignores["aw-ws1-tasks"])
                assertEquals(listOf("*.aw-tmp"), api.ignores["aw-ws1-knowledge"])
                assertEquals(setOf(Ids.PHONE, Ids.MAC, Ids.SERVER), api.devices.keys)
                assertEquals(
                    "pixel-9",
                    api.devices
                        .getValue(Ids.PHONE)["name"]!!
                        .jsonPrimitive.content,
                )
                assertEquals(
                    true,
                    api.options["localAnnounceEnabled"]!!
                        .jsonPrimitive.content
                        .toBoolean(),
                )
                assertEquals(
                    true,
                    api.options["relaysEnabled"]!!
                        .jsonPrimitive.content
                        .toBoolean(),
                )
                assertEquals("false", api.options["natEnabled"]!!.jsonPrimitive.content)
            }
        }

    /** gate-full-context: a requested artifact gets a `!` line before the artifacts line; a bad path gets none. */
    @Test
    fun requestedArtifactsComeBeforeTheArtifactsLine() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val api = FakeEngineApi()
                PeerStore(paths.peers).write(listOf(peer("macbook-pro", Ids.MAC)))
                val task = "01a20800-0000-7000-8000-000000000001"
                val requests = mutableListOf<String>()
                val setup =
                    EngineSetup(
                        paths = paths,
                        peers = PeerStore(paths.peers),
                        workspaces = { listOf("ws1") },
                        engineSettings = { EngineSettings("pixel-9") },
                        setupSettings = { SetupSettings() },
                        artifactRequests = { ws -> if (ws == "ws1") requests.toList() else emptyList() },
                    )
                setup.apply(api.client(), Ids.PHONE)
                assertEquals(listOf("*.aw-tmp", "/*/artifacts"), api.ignores["aw-ws1-tasks"])
                requests +=
                    listOf(
                        "$task/artifacts/ubuntu-01/shot.png",
                        "$task/artifacts/ubuntu-01/*.png",
                        "$task/artifacts/../log/ubuntu-01.jsonl",
                        "$task/log/ubuntu-01.jsonl",
                        "$task/artifacts/ubuntu-01/report.xml",
                    )
                setup.applyIgnores(api.client(), "ws1")
                assertEquals(
                    listOf(
                        "*.aw-tmp",
                        "!/$task/artifacts/ubuntu-01/report.xml",
                        "!/$task/artifacts/ubuntu-01/shot.png",
                        "/*/artifacts",
                    ),
                    api.ignores["aw-ws1-tasks"],
                )
                assertEquals(listOf("*.aw-tmp"), api.ignores["aw-ws1-knowledge"])
            }
        }

    @Test
    fun sendsNoChangeWhenTheConfigIsEqual() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val api = FakeEngineApi()
                PeerStore(paths.peers).write(listOf(peer("macbook-pro", Ids.MAC)))
                val s = setup(paths)
                s.apply(api.client(), Ids.PHONE)
                api.seen.clear()
                s.apply(api.client(), Ids.PHONE)
                assertEquals(emptyList(), api.changes())
            }
        }

    @Test
    fun setsTheReconnectIntervalAndTheCommunitySwitch() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val api = FakeEngineApi()
                val s = setup(paths, community = false)
                s.apply(api.client(), Ids.PHONE)
                assertEquals("20", api.options["reconnectionIntervalS"]!!.jsonPrimitive.content)
                assertEquals("false", api.options["globalAnnounceEnabled"]!!.jsonPrimitive.content)
                assertEquals("false", api.options["relaysEnabled"]!!.jsonPrimitive.content)
                s.appOpen = true
                assertTrue(s.applyOptions(api.client()))
                assertEquals("5", api.options["reconnectionIntervalS"]!!.jsonPrimitive.content)
                assertFalse(s.applyOptions(api.client()))
                assertEquals(
                    JsonArray(listOf(JsonPrimitive(EngineConfig.DEFAULT_LISTEN))),
                    api.options["listenAddresses"],
                )
            }
        }

    @Test
    fun removesAnEngineDeviceThatIsNotAPeer() =
        runBlocking<Unit> {
            withTempDir { dir ->
                val paths = EnginePaths(dir)
                val api = FakeEngineApi()
                api.devices[Ids.SERVER] = api.device(Ids.SERVER, "ubuntu-01")
                setup(paths).apply(api.client(), Ids.PHONE)
                assertEquals(setOf(Ids.PHONE), api.devices.keys)
            }
        }
}

class PeerStoreTest {
    @Test
    fun checksTheDeviceIdAndKeepsOnePeerPerSlug() {
        withTempDir { dir ->
            val store = PeerStore(dir.resolve("sync-peers.json"))
            assertTrue(PeerStore.isSyncId(Ids.MAC))
            assertFalse(PeerStore.isSyncId(Ids.SERVER.replace("ZFSDHGU", "ZFSDHGV")))
            assertFailsWith<PeerInputException> { store.add(peer("mac", Ids.MAC.lowercase()), Ids.PHONE) }
            assertFailsWith<PeerInputException> { store.add(peer("Mac Book", Ids.MAC), Ids.PHONE) }
            assertFailsWith<PeerInputException> { store.add(peer("me", Ids.PHONE), Ids.PHONE) }
            assertFailsWith<PeerInputException> { store.add(peer("mac", Ids.MAC, role = "phone"), Ids.PHONE) }
            store.add(peer("mac", Ids.MAC), Ids.PHONE)
            assertFailsWith<PeerInputException> { store.add(peer("mac-2", Ids.MAC), Ids.PHONE) }
            store.add(peer("mac", Ids.SERVER), Ids.PHONE)
            assertEquals(listOf(peer("mac", Ids.SERVER)), store.read())
            assertTrue(Files.readString(dir.resolve("sync-peers.json")).contains("\"sync_id\""))
            assertEquals(emptyList(), store.remove(Ids.SERVER))
        }
    }
}
