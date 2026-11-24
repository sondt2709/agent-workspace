package com.agentworkspace.identity

import java.nio.file.Files
import java.security.GeneralSecurityException
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class AgeTest {
    private val a = DeviceKey.generate()
    private val b = DeviceKey.generate()
    private val recipients = listOf(Encoding.fromBase64(a.x25519), Encoding.fromBase64(b.x25519))

    @Test
    fun eachRecipientOpensTheFile() {
        for (size in listOf(0, 1, 65_535, 65_536, 65_537, 200_000)) {
            val plain = ByteArray(size) { (it * 7).toByte() }
            val file = Age.seal(plain, recipients)
            assertContentEquals(plain, Age.open(file, a.x25519Secret), "size $size")
            assertContentEquals(plain, Age.open(file, b.x25519Secret), "size $size")
        }
    }

    @Test
    fun anotherKeyCannotOpen() {
        val file = Age.seal("secret".encodeToByteArray(), recipients)
        assertFailsWith<AgeException> { Age.open(file, DeviceKey.generate().x25519Secret) }
    }

    @Test
    fun aChangedByteFails() {
        val file = Age.seal(ByteArray(100) { it.toByte() }, recipients)
        val headerEnd = String(file, Charsets.ISO_8859_1).indexOf("\n--- ")
        // A byte of the share, a byte of the MAC line, a byte of the payload.
        for (at in listOf(40, headerEnd + 8, file.size - 20)) {
            val changed = file.copyOf()
            changed[at] = (changed[at].toInt() xor 1).toByte()
            assertFailsWith<GeneralSecurityException>("byte $at") { Age.open(changed, a.x25519Secret) }
        }
        assertFailsWith<AgeException> { Age.open(file.copyOf(file.size - 1), a.x25519Secret) }
    }

    @Test
    fun theHeaderHasOneStanzaPerRecipient() {
        val text = String(Age.seal(ByteArray(1), recipients), Charsets.ISO_8859_1)
        assertTrue(text.startsWith("age-encryption.org/v1\n-> X25519 "))
        assertEquals(2, Regex("\n-> X25519 ").findAll(text).count())
    }

    @Test
    fun keysRoundTripInBech32() {
        assertTrue(a.recipient.startsWith("age1"))
        assertTrue(a.identity.startsWith("AGE-SECRET-KEY-1"))
        assertContentEquals(Encoding.fromBase64(a.x25519), Age.parseRecipient(a.recipient))
        assertContentEquals(a.x25519Secret, Age.parseIdentity(a.identity))
        assertFailsWith<IllegalArgumentException> { Age.parseRecipient(a.identity) }
        val broken = a.recipient.dropLast(1) + (if (a.recipient.last() == 'q') 'p' else 'q')
        assertFailsWith<Bech32Exception> { Age.parseRecipient(broken) }
    }

    @Test
    fun sealedCredentialEscapesAsJsonStringify() {
        val value = "a\"b\\c\n\u0001é😀\uD800".toCharArray()
        val text = SealedCredential.content("github-token", value).decodeToString()
        assertEquals(
            "{\"kind\":\"sealed-credential\",\"v\":1,\"name\":\"github-token\"," +
                "\"value\":\"a\\\"b\\\\c\\n\\u0001é😀\\ud800\"}",
            text,
        )
    }
}

class DeviceKeyStoreTest {
    private object Plain : SecretBox {
        override fun seal(plain: ByteArray) = plain.copyOf()

        override fun open(sealed: ByteArray) = sealed.copyOf()
    }

    /** A box that adds a fixed byte; another byte means another key. */
    private class Tagged(
        val tag: Byte,
    ) : SecretBox {
        override fun seal(plain: ByteArray) = byteArrayOf(tag) + plain

        override fun open(sealed: ByteArray): ByteArray {
            if (sealed.firstOrNull() != tag) throw GeneralSecurityException("other key")
            return sealed.copyOfRange(1, sealed.size)
        }
    }

    @Test
    fun keepsTheSameKey() {
        val file = Files.createTempDirectory("aw-key-").resolve("device-key.bin")
        val first = DeviceKeyStore(file, Plain).load()
        val second = DeviceKeyStore(file, Plain).load()
        assertEquals(first.ed25519, second.ed25519)
        assertEquals(first.x25519, second.x25519)
        assertTrue(Files.readString(file).contains("AGE-SECRET-KEY-1"))
    }

    @Test
    fun replacesAKeyThatTheBoxCannotOpen() {
        val file = Files.createTempDirectory("aw-key-").resolve("device-key.bin")
        val first = DeviceKeyStore(file, Tagged(1)).load()
        assertFalse(Files.readAllBytes(file).decodeToString().contains(first.ed25519))
        var replaced = false
        val second = DeviceKeyStore(file, Tagged(2)) { replaced = true }.load()
        assertTrue(replaced)
        assertNotEquals(first.ed25519, second.ed25519)
        assertEquals(second.ed25519, DeviceKeyStore(file, Tagged(2)).load().ed25519)
    }
}
