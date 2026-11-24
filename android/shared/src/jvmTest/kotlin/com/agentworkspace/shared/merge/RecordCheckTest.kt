package com.agentworkspace.shared.merge

import com.agentworkspace.identity.Encoding
import com.agentworkspace.identity.Records
import com.agentworkspace.shared.FakeClock
import com.agentworkspace.shared.files.NioWorkspaceFiles
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.nio.file.Files
import java.nio.file.Paths
import kotlin.io.path.readText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The device record check of the Kotlin merge (openspec add-android-pairing, the rules of
 * `#checkRecord` and `#isStickyRevoke` of shared/core/src/merge/engine.ts). The records are signed
 * with the test master key of contracts/test-vectors/identity.json.
 */
class RecordCheckTest {
    private val ws = TestWorkspace()
    private val path = "tasks/devices/macbook-pro/device.yaml"
    private val master =
        Json
            .parseToJsonElement(
                Paths.get(System.getProperty("aw.schema.dir"), "test-vectors", "identity.json").readText(),
            ).jsonObject
            .getValue("master")
            .jsonObject
    private val secret = Encoding.fromHex(master.getValue("secret_hex").jsonPrimitive.content)
    private val verifier = Records.verifier(Encoding.fromBase64(master.getValue("public").jsonPrimitive.content))
    private val clock = FakeClock("2026-11-22T14:30:00.000Z")

    @AfterTest
    fun cleanup() = ws.remove()

    private fun record(
        seq: Int,
        name: String = "MacBook Pro",
        revoked: Boolean = false,
    ): JsonObject =
        Records.sign(
            buildJsonObject {
                put("kind", "device")
                put("schema", 1)
                put("slug", "macbook-pro")
                put("name", name)
                put("role", "local")
                putJsonObject("keys") {
                    put("ed25519", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")
                    put("x25519", "ERERERERERERERERERERERERERERERERERERERERERE=")
                }
                put("sync_device_id", "MACBOOK-PRO2AAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA")
                put("seq", seq)
                put("revoked", revoked)
                put("revoked_at", if (revoked) JsonPrimitive("2026-11-22T14:00:00.000Z#0000") else JsonNull)
                put("addresses", buildJsonArray {})
                put("paired_at", "2026-11-20T09:00:00.000Z")
            },
            secret,
        )

    /** JSON is YAML 1.2: the merge reads the record as the parsed value that was signed. */
    private fun write(record: JsonObject) = ws.write(path, "$record\n")

    private fun device(update: MergeUpdate) = update.view.devices.first { it.slug == "macbook-pro" }

    private fun issue(update: MergeUpdate) = update.view.issues.firstOrNull { it.path == path }

    private fun engine() = MergeEngine(NioWorkspaceFiles(ws.root), clock, verifyDeviceRecord = verifier)

    @Test
    fun keepsTheLastValidRecordForABadSignature() =
        runTest {
            val engine = engine()
            write(record(1))
            assertNull(issue(engine.update()))
            write(JsonObject(record(2) + ("name" to JsonPrimitive("Other name"))))
            val update = engine.update()
            assertEquals("bad_signature", issue(update)?.reason)
            assertEquals("MacBook Pro", device(update).name)
        }

    @Test
    fun keepsARevokeThatALaterValidRecordDrops() =
        runTest {
            val engine = engine()
            write(record(2, revoked = true))
            assertTrue(device(engine.update()).revoked)
            write(record(3, name = "Back again"))
            val update = engine.update()
            assertEquals("old_sequence", issue(update)?.reason)
            assertTrue(device(update).revoked)
        }

    @Test
    fun refusesALowerSequence() =
        runTest {
            val engine = engine()
            write(record(2, name = "Seq two"))
            engine.update()
            write(record(1, name = "Seq one"))
            val update = engine.update()
            assertEquals("old_sequence", issue(update)?.reason)
            assertEquals("Seq two", device(update).name)
        }

    @Test
    fun keepsARevokeWhenItsFileIsRemoved() =
        runTest {
            val engine = engine()
            write(record(2, revoked = true))
            engine.update()
            Files.delete(ws.root.resolve(path))
            val update = engine.update()
            assertEquals("revoke_removed", issue(update)?.reason)
            assertTrue(device(update).revoked)
            // The file comes back without the revoke: it is read and refused.
            write(record(3))
            val back = engine.update()
            assertEquals("old_sequence", issue(back)?.reason)
            assertTrue(device(back).revoked)
        }

    @Test
    fun checksNothingWithNoMasterKey() =
        runTest {
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            write(JsonObject(record(1) + ("name" to JsonPrimitive("Changed"))))
            val update = engine.update()
            assertNull(issue(update))
            assertEquals("Changed", device(update).name)
        }
}
