package com.agentworkspace.identity

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.test.fail

/** The shared vectors of contracts/test-vectors/identity.json (written by shared/identity). */
object Vectors {
    val path: Path = Paths.get(System.getProperty("aw.contracts.dir"), "test-vectors", "identity.json")
    val root: JsonObject = Json.parseToJsonElement(path.readText()).jsonObject

    fun obj(vararg keys: String): JsonObject = keys.fold(root) { o, k -> o.getValue(k).jsonObject }

    fun text(
        o: JsonObject,
        key: String,
    ): String = o.getValue(key).jsonPrimitive.content

    fun large(size: Int): ByteArray = ByteArray(size) { (it % 251).toByte() }
}

class VectorsTest {
    private val pairing = Vectors.obj("pairing")
    private val age = Vectors.obj("age")

    @Test
    fun canonicalJsonEqualsTypeScript() {
        val cases = Vectors.root.getValue("canonical_json").jsonArray
        assertEquals(5, cases.size)
        for (case in cases) {
            val o = case.jsonObject
            assertEquals(Vectors.text(o, "canonical"), CanonicalJson.of(o.getValue("value")))
        }
    }

    @Test
    fun verifiesEachRecordAsTypeScript() {
        val master = Encoding.fromBase64(Vectors.text(Vectors.obj("master"), "public"))
        val records = Vectors.root.getValue("records").jsonArray
        assertTrue(records.size > 5)
        for (record in records) {
            val o = record.jsonObject
            assertEquals(
                o.getValue("valid").jsonPrimitive.boolean,
                Records.verify(o.getValue("raw"), master),
                Vectors.text(o, "name"),
            )
        }
    }

    @Test
    fun signsRecordsAsTypeScript() {
        val master = Vectors.obj("master")
        val secret = Encoding.fromHex(Vectors.text(master, "secret_hex"))
        assertEquals(Vectors.text(master, "public"), Encoding.toBase64(Crypto.ed25519Public(secret)))
        val raw =
            Vectors.root
                .getValue("records")
                .jsonArray[0]
                .jsonObject
                .getValue("raw")
                .jsonObject
        assertEquals(raw, Records.sign(JsonObject(raw - "signature"), secret))
    }

    @Test
    fun derivesTheUserIdAsTypeScript() {
        val master = Vectors.obj("master")
        assertEquals(
            Vectors.text(master, "user"),
            Pairing.userIdOf(Encoding.fromBase64(Vectors.text(master, "public"))),
        )
    }

    @Test
    fun decodesTheCode() {
        val offer = Pairing.decode(Vectors.text(pairing, "code"))
        assertEquals(pairing.getValue("offer"), offer.toJson())
        assertEquals(Vectors.text(pairing, "code"), Pairing.encode(offer))
        assertTrue(offer.isExpired(offer.expiresAtMs))
        assertTrue(!offer.isExpired(offer.expiresAtMs - 1))
    }

    @Test
    fun refusesEachBadCode() {
        val bad = pairing.getValue("bad_codes").jsonArray
        assertEquals(7, bad.size)
        for (item in bad) {
            assertFailsWith<PairingCodeException>(Vectors.text(item.jsonObject, "name")) {
                Pairing.decode(Vectors.text(item.jsonObject, "code"))
            }
        }
    }

    @Test
    fun signsTheRequestAndComputesTheCheckCode() {
        val phone = pairing.getValue("phone").jsonObject
        val key =
            DeviceKey(
                Encoding.fromBase64(Vectors.text(phone, "ed25519_secret")),
                Encoding.fromHex(Vectors.text(phone, "x25519_secret_hex")),
            )
        assertEquals(Vectors.text(phone, "ed25519"), key.ed25519)
        assertEquals(Vectors.text(phone, "x25519"), key.x25519)
        assertEquals(Vectors.text(phone, "recipient"), key.recipient)
        assertContentEquals(key.x25519Secret, Age.parseIdentity(key.identity))

        val f = pairing.getValue("request_fields").jsonObject
        val keys = f.getValue("keys").jsonObject
        val fields =
            PairingRequestFields(
                nonce = Vectors.text(f, "nonce"),
                slug = Vectors.text(f, "slug"),
                name = Vectors.text(f, "name"),
                role = Vectors.text(f, "role"),
                ed25519 = Vectors.text(keys, "ed25519"),
                x25519 = Vectors.text(keys, "x25519"),
                syncId = Vectors.text(f, "sync_id"),
                addresses = f.getValue("addresses").jsonArray.map { it.jsonPrimitive.content },
            )
        assertEquals(f, fields.toJson())
        val offer = Pairing.decode(Vectors.text(pairing, "code"))
        val request = Pairing.signRequest(fields, offer.secret, key.ed25519Secret)
        assertEquals(pairing.getValue("request"), request)
        assertTrue(Pairing.checkRequest(request, offer.secret))
        assertEquals(Vectors.text(pairing, "check_code"), Pairing.checkCode(offer.device, request))
        // Another secret, or a changed field, fails the check.
        assertTrue(!Pairing.checkRequest(request, Encoding.toBase64Url(ByteArray(32))))
        assertTrue(!Pairing.checkRequest(JsonObject(request + ("slug" to JsonPrimitive("other"))), offer.secret))
    }

    @Test
    fun opensTheFilesThatTypeScriptSealed() {
        val (credential, large) = age.getValue("typescript_sealed").jsonArray.map { it.jsonObject }
        for (identity in age.getValue("identities").jsonArray) {
            val secret = Encoding.fromHex(Vectors.text(identity.jsonObject, "secret_hex"))
            assertEquals(Vectors.text(identity.jsonObject, "recipient"), Age.recipientOf(Crypto.x25519Public(secret)))
            val c = credential.getValue("credential").jsonObject
            val content = SealedCredential.content(Vectors.text(c, "name"), Vectors.text(c, "value").toCharArray())
            assertContentEquals(content, Age.open(Encoding.fromBase64(Vectors.text(credential, "file")), secret))
            assertContentEquals(
                Vectors.large(large.getValue("size").jsonPrimitive.int),
                Age.open(Encoding.fromBase64(Vectors.text(large, "file")), secret),
            )
        }
    }

    /**
     * The Kotlin sealer with the fixed random values of the vectors gives the bytes of the file, which
     * the TypeScript test opens. When a file is missing or differs, the test writes the new values to
     * build/kotlin-sealed.json (copy them into the vectors after a review) and fails.
     */
    @Test
    fun sealsTheKotlinFilesOfTheVectors() {
        val recipients =
            age.getValue("identities").jsonArray.map {
                Age.parseRecipient(Vectors.text(it.jsonObject, "recipient"))
            }
        val made = mutableMapOf<String, String>()
        val entries = age.getValue("kotlin_sealed").jsonArray.map { it.jsonObject }
        for (entry in entries) {
            val ephemerals =
                entry
                    .getValue(
                        "ephemeral_hex",
                    ).jsonArray
                    .map { Encoding.fromHex(it.jsonPrimitive.content) }
                    .iterator()
            val random =
                AgeRandomness(
                    fileKey = { Encoding.fromHex(Vectors.text(entry, "file_key_hex")) },
                    ephemeral = { ephemerals.next() },
                    payloadNonce = { Encoding.fromHex(Vectors.text(entry, "nonce_hex")) },
                )
            val content =
                (entry["credential"] as? JsonObject)?.let {
                    SealedCredential.content(Vectors.text(it, "name"), Vectors.text(it, "value").toCharArray())
                } ?: Vectors.large(entry.getValue("size").jsonPrimitive.int)
            val file = Age.seal(content, recipients, random)
            made[Vectors.text(entry, "name")] = Encoding.toBase64(file)
            for (identity in age.getValue("identities").jsonArray) {
                assertContentEquals(
                    content,
                    Age.open(file, Encoding.fromHex(Vectors.text(identity.jsonObject, "secret_hex"))),
                )
            }
        }
        val differ = entries.filter { made[Vectors.text(it, "name")] != Vectors.text(it, "file") }
        if (differ.isNotEmpty()) {
            val out = Paths.get("build", "kotlin-sealed.json")
            Files.createDirectories(out.parent)
            out.writeText(JsonObject(made.mapValues { JsonPrimitive(it.value) }).toString())
            fail(
                "The Kotlin age files differ from the vectors: ${differ.map {
                    Vectors.text(
                        it,
                        "name",
                    )
                }}; new values in $out",
            )
        }
        assertEquals(3, (age.getValue("kotlin_sealed") as JsonArray).size)
    }
}
