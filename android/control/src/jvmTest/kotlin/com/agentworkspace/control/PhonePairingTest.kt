// The tests run the pairing loop in real time on Dispatchers.Default.
@file:Suppress("InjectDispatcher")

package com.agentworkspace.control

import com.agentworkspace.engine.PeerRecord
import com.agentworkspace.identity.DeviceKey
import com.agentworkspace.identity.DeviceKeyStore
import com.agentworkspace.identity.Encoding
import com.agentworkspace.identity.OfferDevice
import com.agentworkspace.identity.Pairing
import com.agentworkspace.identity.PairingOffer
import com.agentworkspace.identity.Records
import com.agentworkspace.identity.SecretBox
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.util.Collections
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Valid engine device ids (Luhn check characters), from plugins/sync-syncthing/src/units.test.ts. */
private object SyncIds {
    const val PHONE = "5NRSCRM-EBSEQFK-QNF5TAK-VWPOCL5-ZSWAWL3-RGEZFBQ-4Z53HNX-4RPKHQV"
    const val MAC = "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG"
    const val SERVER = "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5"
}

/** The engine calls of a pairing, in memory. */
private class FakeEnginePairing(
    private val root: Path,
) : EnginePairing {
    val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())
    var peers: List<PeerRecord> = emptyList()
    val added: MutableList<String> = Collections.synchronizedList(mutableListOf())

    var engineStarts = true

    override suspend fun start(): String? = (if (engineStarts) SyncIds.PHONE else null).also { calls.add("start") }

    override suspend fun addPairingDevice(
        syncId: String,
        name: String,
        addresses: List<String>,
    ) {
        calls.add("device+ $name $syncId")
    }

    override suspend fun addPairingFolder(
        id: String,
        path: String,
        device: String,
    ) {
        calls.add("folder+ $id $device")
    }

    override suspend fun scanFolder(id: String) {
        calls.add("scan $id")
    }

    override suspend fun removePairingFolder(id: String) {
        calls.add("folder- $id")
    }

    override suspend fun removePairingDevice(syncId: String) {
        calls.add("device- $syncId")
    }

    override suspend fun setPeers(peers: List<PeerRecord>) {
        this.peers = peers
    }

    override fun peers(): List<PeerRecord> = peers

    override suspend fun addWorkspace(id: String) {
        Files.createDirectories(workspaceRoot(id).resolve("tasks"))
        added.add(id)
    }

    @OptIn(ExperimentalPathApi::class)
    override suspend fun removeWorkspace(id: String) {
        workspaceRoot(id).deleteRecursively()
        calls.add("workspace- $id")
    }

    override suspend fun endPairing() {
        calls.add("end")
    }

    override fun workspaces(): List<String> = added.toList()

    override fun workspaceRoot(id: String): Path = root.resolve("aw").resolve(id)
}

private val vectorsFile: Path = Paths.get(System.getProperty("aw.schema.dir"), "test-vectors", "identity.json")

private object PlainBox : SecretBox {
    override fun seal(plain: ByteArray) = plain.copyOf()

    override fun open(sealed: ByteArray) = sealed.copyOf()
}

class PhonePairingTest {
    private val root = Files.createTempDirectory("aw-pairing-")
    private val vectors =
        Json
            .parseToJsonElement(vectorsFile.readText())
            .jsonObject
    private val master = vectors.getValue("master").jsonObject
    private val masterSecret = Encoding.fromHex(master.getValue("secret_hex").jsonPrimitive.content)
    private val showing = DeviceKey.generate()
    private val workspace = "019a8c3e-7f00-7abc-8def-0123456789ab"
    private val clock =
        TestClock(
            java.time.Instant
                .parse("2026-11-23T12:00:00Z")
                .toEpochMilli(),
        )
    private val offer =
        PairingOffer(
            user = master.getValue("user").jsonPrimitive.content,
            master = master.getValue("public").jsonPrimitive.content,
            workspaceId = workspace,
            workspaceName = "Acme",
            device = OfferDevice("macbook-pro", showing.ed25519, SyncIds.MAC),
            addresses = listOf("tcp://192.0.2.20:22300"),
            nonce = "0123456789abcdef0123456789abcdef",
            secret = Encoding.toBase64Url(ByteArray(32) { 7 }),
            expires =
                java.time.Instant
                    .ofEpochMilli(clock.now() + 60_000)
                    .toString(),
        )
    private val code = Pairing.encode(offer)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val engine = FakeEnginePairing(root)
    private val store = PhoneIdentityStore(root)
    private val pairing =
        PhonePairing(
            store = store,
            keys = DeviceKeyStore(root.resolve("device-key.bin"), PlainBox),
            engine = engine,
            clock = clock,
            scope = scope,
            addresses = { listOf("tcp://192.0.2.31:22300") },
            timing = PairingTiming(pollMs = 10, joinWaitMs = 60_000, doneWaitMs = 10),
        )
    private val dir = store.pairingDir(offer.nonce)

    @OptIn(ExperimentalPathApi::class)
    @AfterTest
    fun cleanup() {
        scope.cancel()
        root.deleteRecursively()
    }

    private fun record(
        slug: String,
        role: String,
        ed25519: String,
        x25519: String,
        sync: String,
        revoked: Boolean = false,
        secret: ByteArray = masterSecret,
    ): JsonObject =
        Records.sign(
            buildJsonObject {
                put("kind", "device")
                put("schema", 1)
                put("slug", slug)
                put("name", slug)
                put("role", role)
                putJsonObject("keys") {
                    put("ed25519", ed25519)
                    put("x25519", x25519)
                }
                put("sync_device_id", sync)
                put("seq", 1)
                put("revoked", revoked)
                put("revoked_at", if (revoked) JsonPrimitive("2026-11-23T12:30:00.000Z#0001") else JsonNull)
                put("addresses", buildJsonArray { add(JsonPrimitive("tcp://192.0.2.20:22300")) })
                put("paired_at", "2026-11-23T12:00:00.000Z")
            },
            secret,
        )

    /** The computer side: it checks the request and writes the response with the signed records. */
    private fun approve(
        approved: Boolean = true,
        secret: ByteArray = masterSecret,
        extra: List<JsonObject> = emptyList(),
        reason: String = "The human cancelled",
    ): JsonObject {
        val request = Json.parseToJsonElement(dir.resolve("request.json").readText()).jsonObject
        assertTrue(Pairing.checkRequest(request, offer.secret))
        val keys = request.getValue("keys").jsonObject
        val phone =
            record(
                request.getValue("slug").jsonPrimitive.content,
                request.getValue("role").jsonPrimitive.content,
                keys.getValue("ed25519").jsonPrimitive.content,
                keys.getValue("x25519").jsonPrimitive.content,
                request.getValue("sync_id").jsonPrimitive.content,
                secret = secret,
            )
        val computer = record("macbook-pro", "local", showing.ed25519, showing.x25519, SyncIds.MAC, secret = secret)
        val response =
            buildJsonObject {
                put("v", 1)
                put("nonce", offer.nonce)
                put("approved", approved)
                put("reason", if (approved) JsonNull else JsonPrimitive(reason))
                put("records", JsonArray(listOf(computer, phone) + extra))
                putJsonObject("workspace") {
                    put("id", workspace)
                    put("name", "Acme")
                }
                put("history", 0)
            }
        writeLikeTheEngine(dir.resolve("response.json"), response.toString())
        return request
    }

    private fun writeWorkspaceFile(id: String) =
        writeLikeTheEngine(
            engine.workspaceRoot(workspace).resolve("tasks/workspace.yaml"),
            "kind: workspace\nschema: 1\nid: $id\n",
        )

    /**
     * Writes a file that the pairing loop polls as the sync engine does: a temp file, then an atomic
     * move. With writeText (truncate, then write), a poll can read an empty or partial workspace.yaml
     * and end FAILED "file of another workspace (no id)" (fix list fc1-a4).
     */
    private fun writeLikeTheEngine(
        file: Path,
        text: String,
    ) {
        val temp = file.resolveSibling(".syncthing.${file.fileName}.tmp")
        temp.writeText(text)
        Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }

    private fun waitFor(state: PairingState) =
        runBlocking {
            withTimeout(5_000) { while (pairing.status.value?.state != state) delay(5) }
        }

    @Test
    fun joinsAndEndsDone() =
        runBlocking<Unit> {
            val status = pairing.join(code, "Pixel 9")
            assertEquals(PairingState.WAITING, status.state)
            assertEquals("pixel-9", status.slug)
            assertTrue(Regex("^\\d{3} \\d{3}$").matches(status.checkCode))
            assertTrue("device+ macbook-pro ${SyncIds.MAC}" in engine.calls)
            assertTrue("folder+ aw-pair-${offer.nonce} ${SyncIds.MAC}" in engine.calls)

            // Its own device key: the peers skip each key that a record revokes (openspec revoke-device).
            val other = DeviceKey.generate()
            val revoked = record("ubuntu-01", "remote", other.ed25519, other.x25519, SyncIds.SERVER, revoked = true)
            val request = approve(extra = listOf(revoked))
            assertEquals("mobile", request.getValue("role").jsonPrimitive.content)
            val sent = request.getValue("addresses").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(listOf("tcp://192.0.2.31:22300"), sent)
            // The computer shows the same check code.
            val computerCode = Pairing.formatCheckCode(Pairing.checkCode(offer.device, request))
            assertEquals(status.checkCode, computerCode)

            waitFor(PairingState.JOINING)
            assertEquals(PhoneIdentity(offer.user, offer.master), store.identity())
            assertEquals("pixel-9", store.slugFile.readText())
            assertEquals(3, store.records(workspace).size)
            assertTrue(store.verifier() != null)
            // The peers: the computer, not the phone, not the revoked device.
            assertEquals(listOf("macbook-pro"), engine.peers.map { it.device })
            assertEquals(listOf(workspace), engine.added)

            writeWorkspaceFile(workspace)
            waitFor(PairingState.DONE)
            assertNull(pairing.status.value?.error)
            assertTrue("scan aw-pair-${offer.nonce}" in engine.calls)
            assertTrue("folder- aw-pair-${offer.nonce}" in engine.calls)
            assertTrue("device- ${SyncIds.MAC}" in engine.calls)
            assertEquals("end", engine.calls.last())
            assertFalse(Files.exists(dir))
        }

    @Test
    fun aSecondJoinKeepsTheStoredSlug() =
        runBlocking<Unit> {
            // The phone joined the workspace "Personal" as pixel-9 ("Pixel 9") before.
            val first = "019a8c3e-7f00-7abc-8def-0000000000aa"
            store.saveIdentity(PhoneIdentity(offer.user, offer.master))
            store.saveSlug("pixel-9")
            val own = record("pixel-9", "mobile", showing.ed25519, showing.x25519, SyncIds.PHONE)
            store.saveRecords(first, listOf(JsonObject(own + ("name" to JsonPrimitive("Pixel 9")))))
            engine.addWorkspace(first)
            assertEquals("pixel-9", pairing.storedSlug())

            // The name field holds the phone model: the join still uses the stored slug and name.
            val status = pairing.join(code, "sdk_gphone64_x86_64")
            assertEquals("pixel-9", status.slug)
            assertEquals(workspace, status.workspaceId)
            val request = approve()
            assertEquals("pixel-9", request.getValue("slug").jsonPrimitive.content)
            assertEquals("Pixel 9", request.getValue("name").jsonPrimitive.content)
            waitFor(PairingState.JOINING)
            assertEquals("pixel-9", store.slugFile.readText())
        }

    @Test
    fun aJoinKeepsThePeersOfTheOtherWorkspaces() =
        runBlocking<Unit> {
            // ubuntu-01 and mac-mini-lab are peers through the first workspace (android-pairing low 3).
            val lab = "HP7QZUS-SAFI434-PU55Y3R-5BEC27W-QWYCED2-73NSVHL-HCVPMDN-WPUDBQJ"
            engine.peers =
                listOf(
                    PeerRecord("mac-mini-lab", lab, "remote", listOf("dynamic")),
                    PeerRecord("ubuntu-01", SyncIds.SERVER, "remote", listOf("dynamic")),
                )
            pairing.join(code, "Pixel 9")
            // The new workspace revokes ubuntu-01: it is no peer any more.
            val other = DeviceKey.generate()
            approve(
                extra =
                    listOf(
                        record("ubuntu-01", "remote", other.ed25519, other.x25519, SyncIds.SERVER, revoked = true),
                    ),
            )
            waitFor(PairingState.JOINING)
            assertEquals(listOf("mac-mini-lab", "macbook-pro"), engine.peers.map { it.device })
        }

    @Test
    fun aRefusedKeptSlugSaysWhatToDo() =
        runBlocking<Unit> {
            // The phone is pixel-9 in Personal; Acme has another device pixel-9 (review phone-workspaces M3).
            store.saveIdentity(PhoneIdentity(offer.user, offer.master))
            store.saveSlug("pixel-9")
            pairing.join(code, "Pixel 9")
            approve(
                approved = false,
                reason = "The device name pixel-9 is in use: run 'aw pair' again with --slug <other name>",
            )
            waitFor(PairingState.FAILED)
            assertEquals(
                "This phone is pixel-9 in your other workspaces and keeps that name, and Acme has another device " +
                    "pixel-9. Remove that device from Acme on the computer, then pair again.",
                pairing.status.value?.error,
            )
        }

    @Test
    fun aKeptSlugOfTheShowingDeviceSaysWhatToDo() =
        runBlocking<Unit> {
            store.saveIdentity(PhoneIdentity(offer.user, offer.master))
            store.saveSlug("macbook-pro")
            assertEquals(
                "This phone is macbook-pro in your other workspaces and keeps that name, and the showing device " +
                    "has the same name. Pair from another computer of Acme.",
                assertFailsWith<PairingRefused> { pairing.join(code, "Pixel 9") }.message,
            )
        }

    @Test
    fun aFirstJoinHasNoStoredSlug() {
        store.saveSlug("android")
        // No identity yet: the slug comes from the name of the screen.
        assertNull(pairing.storedSlug())
    }

    @Test
    fun failsForARecordOfAnotherKey() =
        runBlocking<Unit> {
            pairing.join(code, "Pixel 9")
            approve(secret = Encoding.fromHex("11".repeat(32)))
            waitFor(PairingState.FAILED)
            val error = pairing.status.value?.error
            assertEquals("A record of the response has no valid signature of the master key", error)
            assertNull(store.identity())
            assertEquals(emptyList(), engine.added)
            assertFalse(Files.exists(dir))
        }

    @Test
    fun failsWhenTheComputerRefuses() =
        runBlocking<Unit> {
            pairing.join(code, "Pixel 9")
            approve(approved = false)
            waitFor(PairingState.FAILED)
            assertEquals("The pairing was refused: The human cancelled", pairing.status.value?.error)
        }

    @Test
    fun expiresWithNoResponse() =
        runBlocking<Unit> {
            pairing.join(code, "Pixel 9")
            clock.time = offer.expiresAtMs
            waitFor(PairingState.EXPIRED)
            assertEquals("end", engine.calls.last())
        }

    @Test
    fun removesTheFoldersOfAnotherWorkspace() =
        runBlocking<Unit> {
            pairing.join(code, "Pixel 9")
            approve()
            waitFor(PairingState.JOINING)
            val other = "019a8c3e-7f00-7abc-8def-000000000000"
            writeWorkspaceFile(other)
            waitFor(PairingState.FAILED)
            assertTrue("workspace- $workspace" in engine.calls)
            val error = pairing.status.value?.error
            assertEquals("tasks/workspace.yaml is the file of another workspace ($other), not $workspace", error)
        }

    @Test
    fun refusesBeforeItStarts() =
        runBlocking<Unit> {
            assertEquals(
                "A pairing code starts with aw1:",
                assertFailsWith<PairingRefused> { pairing.join("aw2:x", "Pixel 9") }.message,
            )
            assertFailsWith<PairingRefused> { pairing.join(code, "MacBook Pro") }
            store.saveIdentity(PhoneIdentity("u" + "a".repeat(26), offer.master))
            assertEquals(
                "This phone belongs to the identity u${"a".repeat(26)}",
                assertFailsWith<PairingRefused> { pairing.join(code, "Pixel 9") }.message,
            )
            store.saveIdentity(PhoneIdentity(offer.user, offer.master))
            clock.time = offer.expiresAtMs
            val expired = assertFailsWith<PairingRefused> { pairing.join(code, "Pixel 9") }
            assertTrue(expired.message!!.startsWith("The pairing code expired"))
            assertEquals(emptyList(), engine.calls)
        }

    @Test
    fun refusesACodeWhoseUserIsNotTheUserOfItsMaster() =
        runBlocking<Unit> {
            // A forged code: the real user id, the master key of another person (android-pairing finding 1).
            val other =
                Encoding.toBase64(
                    com.agentworkspace.identity.Crypto
                        .ed25519Public(ByteArray(32) { 9 }),
                )
            val forged = Pairing.encode(offer.copy(master = other))
            assertEquals(
                "The pairing code is not valid: its user id is not the user id of its master key",
                assertFailsWith<PairingRefused> { pairing.join(forged, "Pixel 9") }.message,
            )
            assertEquals(emptyList(), engine.calls)
        }

    @Test
    fun refusesAnotherMasterKeyOnAPhoneWithAnIdentity() =
        runBlocking<Unit> {
            // The stored identity has the same user text but another master key: it cannot be this user.
            val other =
                Encoding.toBase64(
                    com.agentworkspace.identity.Crypto
                        .ed25519Public(ByteArray(32) { 9 }),
                )
            store.saveIdentity(PhoneIdentity(offer.user, other))
            assertEquals(
                "This phone belongs to the identity ${offer.user} with another master key",
                assertFailsWith<PairingRefused> { pairing.join(code, "Pixel 9") }.message,
            )
            assertEquals(emptyList(), engine.calls)
        }

    @Test
    fun aKeystoreErrorIsARefusalWithAText() =
        runBlocking<Unit> {
            // The Keystore fails at the first key (android-pairing finding 3): a message, no crash.
            val broken =
                object : SecretBox {
                    override fun seal(plain: ByteArray): ByteArray =
                        throw java.security.ProviderException("Keystore failed")

                    override fun open(sealed: ByteArray): ByteArray =
                        throw java.security.ProviderException("Keystore failed")
                }
            val other =
                PhonePairing(
                    store = store,
                    keys = DeviceKeyStore(root.resolve("device-key-2.bin"), broken),
                    engine = engine,
                    clock = clock,
                    scope = scope,
                    addresses = { emptyList() },
                )
            assertEquals(
                "The phone could not make or read its device key (Keystore failed): try again",
                assertFailsWith<PairingRefused> { other.join(code, "Pixel 9") }.message,
            )
            assertNull(other.status.value)
        }

    @Test
    fun aDiskErrorIsARefusalAndEndsThePairingOfTheEngine() =
        runBlocking<Unit> {
            // A file in the place of the folder pairing/: the request cannot be written.
            Files.writeString(dir.parent, "not a folder")
            val message = assertFailsWith<PairingRefused> { pairing.join(code, "Pixel 9") }.message.orEmpty()
            assertTrue(message.startsWith("The phone could not write the pairing request"), message)
            assertEquals("end", engine.calls.last())
        }

    @Test
    fun anEngineThatDoesNotStartEndsThePairingOfTheEngine() =
        runBlocking<Unit> {
            // android-pairing low 1: the pairing flag of the engine must not stay on.
            engine.engineStarts = false
            assertEquals(
                "The sync engine did not start: try again",
                assertFailsWith<PairingRefused> { pairing.join(code, "Pixel 9") }.message,
            )
            assertEquals(listOf("start", "end"), engine.calls)
        }

    @Test
    fun cancelEndsThePairing() =
        runBlocking<Unit> {
            pairing.join(code, "Pixel 9")
            assertFailsWith<PairingRefused> { pairing.join(code, "Pixel 9") }
            pairing.cancel()
            assertEquals(PairingState.CANCELLED, pairing.status.value?.state)
            assertFalse(Files.exists(dir))
        }

    @Test
    fun makesASlugFromTheName() {
        assertEquals("pixel-9", PhonePairing.slugOf("Pixel 9"))
        assertEquals("galaxy-z-fold7", PhonePairing.slugOf("  Galaxy Z Fold7! "))
        assertEquals("phone", PhonePairing.slugOf("✓✓"))
    }

    @Test
    fun peersComeFromTheRecords() {
        val mine = record("pixel-9", "mobile", showing.ed25519, showing.x25519, SyncIds.PHONE)
        val mac = record("macbook-pro", "local", showing.ed25519, showing.x25519, SyncIds.MAC)
        val notLuhn = List(7) { "AAAAAAA" }.joinToString("-") + "-AAAAAAB"
        val bad = record("broken", "remote", showing.ed25519, showing.x25519, notLuhn)
        val server = record("ubuntu-01", "remote", showing.ed25519, showing.x25519, SyncIds.SERVER)
        val noAddress = JsonObject(server - "addresses")
        val peers = RecordPeers.of(listOf(mine, mac, bad, noAddress), "pixel-9")
        assertEquals(listOf("macbook-pro", "ubuntu-01"), peers.map { it.device })
        assertEquals(listOf("dynamic"), peers.last().addresses)
        assertNull(RecordPeers.plan(listOf(emptyList(), emptyList()), "pixel-9"))
        assertEquals(emptyList(), RecordPeers.plan(listOf(listOf(mine)), "pixel-9"))
    }
}
