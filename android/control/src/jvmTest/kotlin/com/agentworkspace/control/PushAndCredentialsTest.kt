package com.agentworkspace.control

import com.agentworkspace.identity.Age
import com.agentworkspace.identity.DeviceKey
import com.agentworkspace.shared.files.NioWorkspaceFiles
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Files
import kotlin.io.path.readBytes
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PushAndCredentialsTest {
    private val vapid = "B" + "a".repeat(86)

    private fun sub(
        computer: String,
        key: String = vapid,
    ) = PushSubscription(
        computer,
        "https://push.example/$computer",
        "p-$computer",
        "a-$computer",
        key,
        "org.example",
        "2026-11-22T14:21:00.000Z#0000",
    )

    @Test
    fun pushFileKeepsTheOtherComputers() =
        runTest {
            TestWorkspace().use { ws ->
                val files = NioWorkspaceFiles(ws.root)
                val start = PushFile.read(files, "pixel-9")
                assertTrue(start.subscriptions.isEmpty())
                PushRegistry.write(ws.files, start.with(sub("ubuntu-01")).with(sub("macbook-pro")))
                val read = PushFile.read(files, "pixel-9")
                assertEquals(listOf("macbook-pro", "ubuntu-01"), read.subscriptions.map { it.computer })
                assertEquals(sub("ubuntu-01"), read.subscriptions.last())
                // A new endpoint of one computer replaces only its entry.
                val newer = sub("ubuntu-01").copy(endpoint = "https://push.example/new")
                PushRegistry.write(ws.files, read.with(newer))
                val again = PushFile.read(files, "pixel-9")
                assertEquals(listOf(sub("macbook-pro"), newer), again.subscriptions)
                val text = String(ws.root.resolve("tasks/devices/pixel-9/push.yaml").readBytes())
                assertTrue(text.contains("kind: push\nschema: 1\ndevice: \"pixel-9\"\n"), text)
                // A broken file reads as empty: the phone writes it again.
                ws.root.resolve("tasks/devices/pixel-9/push.yaml").writeText("subscriptions: [")
                assertTrue(PushFile.read(files, "pixel-9").subscriptions.isEmpty())
            }
        }

    @Test
    fun vapidKeysComeFromTheBindingsOfTheComputers() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                assertTrue(PushRegistry.vapidKeys(snapshot).isEmpty())
                val bindings =
                    snapshot.bindings +
                        mapOf(
                            "ubuntu-01" to
                                JsonObject(
                                    snapshot.bindings.getValue("ubuntu-01") +
                                        ("vapid_public_key" to JsonPrimitive(vapid)),
                                ),
                            "macbook-pro" to JsonObject(mapOf("vapid_public_key" to JsonPrimitive("short"))),
                            "pixel-9" to JsonObject(mapOf("vapid_public_key" to JsonPrimitive(vapid))),
                        )
                val keys = PushRegistry.vapidKeys(snapshot.copy(bindings = bindings))
                assertEquals(mapOf("ubuntu-01" to vapid), keys)
                val (register, remove) = PushRegistry.plan(keys, PushFile("pixel-9", listOf(sub("macbook-pro"))))
                assertEquals(mapOf("ubuntu-01" to vapid), register)
                assertEquals(listOf("macbook-pro"), remove)
                val (none, _) = PushRegistry.plan(keys, PushFile("pixel-9", listOf(sub("ubuntu-01"))))
                assertTrue(none.isEmpty())
                assertEquals("ws/ubuntu-01", PushRegistry.instance("ws", "ubuntu-01"))
                assertEquals("ws" to "ubuntu-01", PushRegistry.parseInstance("ws/ubuntu-01"))
                assertNull(PushRegistry.parseInstance("default"))
            }
        }

    @Test
    fun pushPreview() {
        val task = TestWorkspace.AW7
        val preview =
            PushPreview.parse(
                """{"event":"e1","task":"$task","key":"AW-7","gate_kind":"question","text":"Which limit?"}"""
                    .encodeToByteArray(),
            )
        assertEquals("AW-7 · Answer question", preview.title)
        assertEquals("Which limit?", preview.text)
        assertEquals(task, preview.task)
        assertEquals("e1", preview.tag)
        val generic = PushPreview.parse("not json".encodeToByteArray())
        assertEquals("AW · A gate needs you", generic.title)
        assertNull(generic.task)
        assertNull(PushPreview.parse("""{"task":"../x"}""".encodeToByteArray()).task)
        assertEquals("AW · A gate needs you", PushPreview.parse(ByteArray(PushPreview.MAX_BYTES + 1)).title)
    }

    /** M23: a Done push and a login push name what happened, not "A gate needs you". */
    @Test
    fun pushTitlesOfDoneAndLogin() {
        fun title(kind: String?): String {
            val field = kind?.let { ""","kind":"$it"""" }.orEmpty()
            val json = """{"event":null,"task":null,"key":"AW-12","gate_kind":null$field,"text":"x"}"""
            return PushPreview.parse(json.encodeToByteArray()).title
        }
        assertEquals("AW-12 · Done", title("done"))
        assertEquals("AW-12 · Login expired", title("login_expired"))
        assertEquals("AW-12 · Login ends soon", title("login_ends"))
        assertEquals("AW-12 · A gate needs you", title(null))
        assertEquals("AW-12 · A gate needs you", title("something_new"))
    }

    private class FakeSealer : CredentialSealer {
        override val available = true
        var seen: List<SealRecipient> = emptyList()

        override suspend fun seal(
            name: String,
            value: CharArray,
            recipients: List<SealRecipient>,
        ): ByteArray {
            seen = recipients
            return "sealed:$name".encodeToByteArray()
        }
    }

    @Test
    fun theOutboxWritesOnlyTheSealedBytes() =
        runTest {
            TestWorkspace().use { ws ->
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                // No paired computer: nothing is written, and the value is cleared.
                val age = CredentialOutbox(ws.files, AgeCredentialSealer, ws.clock, TestWorkspace.io)
                assertTrue(age.available)
                val value = "s3cret".toCharArray()
                val refused = assertIs<ActionResult.Refused>(age.add("pixel-9", "github-token", value, emptyList()))
                assertEquals("No paired computer can get the credential.", refused.message)
                assertTrue(value.all { it == '\u0000' })
                assertFalse(Files.exists(ws.root.resolve("tasks/devices/pixel-9/sealed")))

                val sealer = FakeSealer()
                val outbox = CredentialOutbox(ws.files, sealer, ws.clock, TestWorkspace.io)
                val recipients = outbox.recipients(snapshot.records)
                assertEquals(listOf("macbook-pro", "ubuntu-01"), recipients.map { it.device })
                assertEquals("EhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhI=", recipients.last().x25519)
                assertIs<ActionResult.Refused>(outbox.add("pixel-9", "Bad Name", "v".toCharArray(), recipients))
                val done =
                    assertIs<ActionResult.Done>(
                        outbox.add("pixel-9", "github-token", "s3cret".toCharArray(), recipients),
                    )
                assertTrue(Regex("^tasks/devices/pixel-9/sealed/[0-9a-f-]{36}\\.age$").matches(done.path), done.path)
                assertEquals("sealed:github-token", String(ws.root.resolve(done.path).readBytes()))
                assertEquals(recipients, sealer.seen)
            }
        }

    @Test
    fun theAgeSealerSealsTheContentOfSealCredentialToEachComputer() =
        runTest {
            val a = DeviceKey.generate()
            val b = DeviceKey.generate()
            val value = "ghp_test \"quoted\"".toCharArray()
            val file =
                AgeCredentialSealer.seal(
                    "github-token",
                    value,
                    listOf(SealRecipient("macbook-pro", a.x25519), SealRecipient("ubuntu-01", b.x25519)),
                )
            val expected =
                "{\"kind\":\"sealed-credential\",\"v\":1,\"name\":\"github-token\"," +
                    "\"value\":\"ghp_test \\\"quoted\\\"\"}"
            assertEquals(expected, Age.open(file, a.x25519Secret).decodeToString())
            assertEquals(expected, Age.open(file, b.x25519Secret).decodeToString())
            assertFalse(String(file, Charsets.ISO_8859_1).contains("ghp_test"))
        }
}
