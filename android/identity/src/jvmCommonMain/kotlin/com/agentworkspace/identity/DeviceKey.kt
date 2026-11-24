package com.agentworkspace.identity

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.GeneralSecurityException

/**
 * A device key (docs/architecture.md 4.1.2): an Ed25519 key that signs the pairing request, and an
 * age X25519 identity that opens the files sealed to this device.
 */
class DeviceKey(
    /** The 32-byte Ed25519 secret (the seed form of `@noble/curves`). */
    val ed25519Secret: ByteArray,
    /** The 32-byte X25519 secret of the age identity. */
    val x25519Secret: ByteArray,
) {
    init {
        require(ed25519Secret.size == Crypto.KEY_SIZE && x25519Secret.size == Crypto.KEY_SIZE) {
            "A device key has 32-byte secrets"
        }
    }

    /** The Ed25519 public key, base64 (the record form). */
    val ed25519: String = Encoding.toBase64(Crypto.ed25519Public(ed25519Secret))

    /** The X25519 public key, base64 (the record form). */
    val x25519: String = Encoding.toBase64(Crypto.x25519Public(x25519Secret))

    /** The age identity `AGE-SECRET-KEY-1…`. */
    val identity: String get() = Age.identityOf(x25519Secret)

    /** The age recipient `age1…`. */
    val recipient: String get() = Age.recipientOf(Encoding.fromBase64(x25519))

    /** The stored form: the JSON of `DeviceSecret` of shared/identity/src/keys.ts. */
    fun toJson(): JsonObject =
        buildJsonObject {
            put("v", 1)
            put("ed25519", Encoding.toBase64(ed25519Secret))
            put("x25519", identity)
        }

    companion object {
        fun generate(): DeviceKey = DeviceKey(Crypto.randomBytes(Crypto.KEY_SIZE), Crypto.x25519Secret())

        /** Reads the stored form; IllegalArgumentException when it is not a device secret. */
        fun fromJson(value: JsonObject): DeviceKey {
            fun text(key: String) =
                requireNotNull(
                    (value[key] as? JsonPrimitive)?.takeIf { it.isString }?.content,
                ) { "The device secret has no $key" }
            require((value["v"] as? JsonPrimitive)?.content == "1") { "The device secret is not version 1" }
            return DeviceKey(Encoding.fromBase64(text("ed25519")), Age.parseIdentity(text("x25519")))
        }
    }
}

/**
 * Encrypts the stored device key. On the phone it is AES-256-GCM with a non-exportable key of the
 * Android Keystore; the JVM tests use a box that changes nothing.
 */
interface SecretBox {
    fun seal(plain: ByteArray): ByteArray

    /** Throws GeneralSecurityException when the box cannot open the bytes. */
    fun open(sealed: ByteArray): ByteArray
}

/**
 * The device key of the phone in `<files>/device-key.bin`, encrypted by a [SecretBox]. The phone makes
 * the key once. A file that the box cannot open (for example a Keystore key that a restore lost) is
 * replaced by a new key: the phone then pairs again as a new device.
 */
class DeviceKeyStore(
    private val file: Path,
    private val box: SecretBox,
    private val onReplaced: (Exception) -> Unit = {},
) {
    @Volatile private var cached: DeviceKey? = null

    @Synchronized
    fun load(): DeviceKey {
        cached?.let { return it }
        val key = read() ?: DeviceKey.generate().also(::write)
        cached = key
        return key
    }

    /** True when a device key file exists. */
    fun exists(): Boolean = Files.isRegularFile(file)

    private fun read(): DeviceKey? {
        if (!Files.isRegularFile(file)) return null
        val plain =
            try {
                box.open(Files.readAllBytes(file))
            } catch (e: GeneralSecurityException) {
                onReplaced(e)
                return null
            }
        return try {
            DeviceKey.fromJson(Json.parseToJsonElement(plain.decodeToString()) as JsonObject)
        } catch (e: IllegalArgumentException) {
            onReplaced(e)
            null
        } catch (e: ClassCastException) {
            onReplaced(e)
            null
        } finally {
            plain.fill(0)
        }
    }

    private fun write(key: DeviceKey) {
        Files.createDirectories(file.parent)
        val plain = key.toJson().toString().encodeToByteArray()
        try {
            val tmp = file.resolveSibling("${file.fileName}.aw-tmp")
            Files.write(tmp, box.seal(plain))
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } finally {
            plain.fill(0)
        }
    }
}
