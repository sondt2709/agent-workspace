package com.agentworkspace.identity

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.time.Instant
import java.time.format.DateTimeParseException

/** A code that is not a valid pairing code; the message is for the person. */
class PairingCodeException(
    message: String,
) : IllegalArgumentException(message)

/** The showing device of an offer. */
data class OfferDevice(
    val slug: String,
    /** The Ed25519 public key, base64. */
    val ed25519: String,
    val syncId: String,
)

/** The data of a pairing code (`pairingOfferSchema` of shared/identity/src/pairing.ts). */
data class PairingOffer(
    val user: String,
    /** The master public key, base64. */
    val master: String,
    val workspaceId: String,
    val workspaceName: String,
    val device: OfferDevice,
    val addresses: List<String>,
    /** 16 random bytes in hex: the pairing id and the folder `aw-pair-<nonce>`. */
    val nonce: String,
    /** 32 random bytes, base64url: the key of the request HMAC. */
    val secret: String,
    val expires: String,
) {
    val expiresAtMs: Long get() = Instant.parse(expires).toEpochMilli()

    fun isExpired(nowMs: Long): Boolean = expiresAtMs <= nowMs

    fun masterPublic(): ByteArray = Encoding.fromBase64(master)

    fun toJson(): JsonObject =
        buildJsonObject {
            put("v", 1)
            put("user", user)
            put("master", master)
            putJsonObject("workspace") {
                put("id", workspaceId)
                put("name", workspaceName)
            }
            putJsonObject("device") {
                put("slug", device.slug)
                put("ed25519", device.ed25519)
                put("sync_id", device.syncId)
            }
            put("addresses", buildJsonArray { addresses.forEach { add(JsonPrimitive(it)) } })
            put("nonce", nonce)
            put("secret", secret)
            put("expires", expires)
        }
}

/** The pairing request fields that the new device fills in (`PairingRequestFields`). */
data class PairingRequestFields(
    val nonce: String,
    val slug: String,
    val name: String,
    /** `remote` or `mobile`; the phone sends `mobile`. */
    val role: String,
    val ed25519: String,
    val x25519: String,
    val syncId: String,
    val addresses: List<String>,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("v", 1)
            put("nonce", nonce)
            put("slug", slug)
            put("name", name)
            put("role", role)
            putJsonObject("keys") {
                put("ed25519", ed25519)
                put("x25519", x25519)
            }
            put("sync_id", syncId)
            put("addresses", buildJsonArray { addresses.forEach { add(JsonPrimitive(it)) } })
        }
}

/**
 * The pairing formats of docs/phase-1.md 7 on the phone: the code, the signed request and the check
 * code. The texts and rules are those of shared/identity/src/pairing.ts.
 */
object Pairing {
    const val CODE_PREFIX = "aw1:"
    private const val REQUEST_DOMAIN = "aw-pair-request-v1\n"
    private const val REQUEST_SIG_DOMAIN = "aw-pair-request-sig-v1\n"
    private const val CHECK_DOMAIN = "aw-check-v2\n"
    private const val CHECK_MODULO = 1_000_000L
    private const val CHECK_DIGITS = 6
    private const val MAX_ADDRESSES = 16
    private const val MAX_NAME = 200
    private const val SIG_BYTES = 4

    val SLUG = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")
    val SYNC_ID = Regex("^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$")
    val NONCE = Regex("^[0-9a-f]{32}$")
    val UUID_V7 = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    private val USER = Regex("^u[a-z2-7]{26}$")
    private val SECRET = Regex("^[A-Za-z0-9_-]{43}$")
    private val DATETIME = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$")

    private val json = Json { ignoreUnknownKeys = true }

    private const val USER_ID_BYTES = 16

    /** The user id of a master public key: `u` and base32 of SHA-256[0..16] (`userIdOf`). */
    fun userIdOf(masterPublic: ByteArray): String =
        "u" + Encoding.toBase32Lower(Crypto.sha256(masterPublic).copyOf(USER_ID_BYTES))

    /** True when the user id of the offer is the user id of its master key. */
    fun ownsMaster(offer: PairingOffer): Boolean = userIdOf(offer.masterPublic()) == offer.user

    /** Encodes an offer (tests; the phone shows no code in phase 1). */
    fun encode(offer: PairingOffer): String =
        CODE_PREFIX + Encoding.toBase64Url(Encoding.utf8(offer.toJson().toString()))

    /** Decodes a code. It does not check the expiry: see [PairingOffer.isExpired]. */
    @Suppress("ThrowsCount")
    fun decode(code: String): PairingOffer {
        val text = code.trim()
        if (!text.startsWith(CODE_PREFIX)) throw PairingCodeException("A pairing code starts with $CODE_PREFIX")
        val bytes =
            Encoding.fromBase64UrlOrNull(text.removePrefix(CODE_PREFIX))
                ?: throw PairingCodeException("The pairing code is damaged: copy the full code again")
        val element =
            runCatching { json.parseToJsonElement(bytes.decodeToString(throwOnInvalidSequence = true)) }
                .getOrElse { throw PairingCodeException("The pairing code is damaged: copy the full code again") }
        val bad = mutableListOf<String>()
        val offer = parseOffer(element, bad)
        if (offer == null || bad.isNotEmpty()) {
            throw PairingCodeException(
                "The pairing code is not valid: ${bad.ifEmpty { listOf("(root)") }.joinToString(", ")}",
            )
        }
        return offer
    }

    private fun JsonObject.text(
        key: String,
        path: String,
        bad: MutableList<String>,
        rule: (String) -> Boolean,
    ): String {
        val value = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (value == null || !rule(value)) bad.add(path)
        return value.orEmpty()
    }

    private fun key32(text: String): Boolean = Encoding.fromBase64OrNull(text)?.size == Crypto.KEY_SIZE

    private fun datetime(text: String): Boolean =
        DATETIME.matches(text) &&
            try {
                Instant.parse(text)
                true
            } catch (_: DateTimeParseException) {
                false
            }

    private fun parseOffer(
        element: JsonElement,
        bad: MutableList<String>,
    ): PairingOffer? {
        val o = element as? JsonObject ?: return null
        val v = (o["v"] as? JsonPrimitive)?.takeIf { !it.isString }?.content
        if (v != "1") bad.add("v")
        val workspace = o["workspace"] as? JsonObject ?: JsonObject(emptyMap()).also { bad.add("workspace") }
        val device = o["device"] as? JsonObject ?: JsonObject(emptyMap()).also { bad.add("device") }
        val addresses =
            (o["addresses"] as? JsonArray)?.map {
                (it as? JsonPrimitive)
                    ?.takeIf { p ->
                        p.isString
                    }?.content
            }
        if (addresses == null || addresses.size > MAX_ADDRESSES || addresses.any { it.isNullOrEmpty() }) {
            bad.add("addresses")
        }
        return PairingOffer(
            user = o.text("user", "user", bad) { USER.matches(it) },
            master = o.text("master", "master", bad, ::key32),
            workspaceId = workspace.text("id", "workspace.id", bad) { UUID_V7.matches(it) },
            workspaceName = workspace.text("name", "workspace.name", bad) { it.length in 1..MAX_NAME },
            device =
                OfferDevice(
                    slug = device.text("slug", "device.slug", bad) { SLUG.matches(it) },
                    ed25519 = device.text("ed25519", "device.ed25519", bad, ::key32),
                    syncId = device.text("sync_id", "device.sync_id", bad) { SYNC_ID.matches(it) },
                ),
            addresses = addresses.orEmpty().filterNotNull(),
            nonce = o.text("nonce", "nonce", bad) { NONCE.matches(it) },
            secret = o.text("secret", "secret", bad) { SECRET.matches(it) },
            expires = o.text("expires", "expires", bad, ::datetime),
        )
    }

    private fun without(
        request: JsonObject,
        vararg keys: String,
    ): JsonObject = JsonObject(request.filterKeys { it !in keys })

    private fun mac(
        request: JsonObject,
        secret: String,
    ): ByteArray {
        val key = requireNotNull(Encoding.fromBase64UrlOrNull(secret)) { "The secret is not base64url" }
        return Crypto.hmacSha256(key, Encoding.utf8(REQUEST_DOMAIN + CanonicalJson.of(without(request, "mac"))))
    }

    private fun sigBytes(request: JsonObject): ByteArray =
        Encoding.utf8(REQUEST_SIG_DOMAIN + CanonicalJson.of(without(request, "mac", "sig")))

    /**
     * Signs a request with the Ed25519 secret of the device key (`sig`), then adds the HMAC with the
     * secret of the code (`mac`), as `signRequest()` does.
     */
    fun signRequest(
        fields: PairingRequestFields,
        secret: String,
        deviceSecret: ByteArray,
    ): JsonObject {
        require(fields.addresses.size <= MAX_ADDRESSES) { "A request has at most $MAX_ADDRESSES addresses" }
        val plain = fields.toJson()
        val signed =
            JsonObject(
                plain + ("sig" to JsonPrimitive(Encoding.toBase64(Crypto.ed25519Sign(deviceSecret, sigBytes(plain))))),
            )
        return JsonObject(signed + ("mac" to JsonPrimitive(Encoding.toBase64(mac(signed, secret)))))
    }

    /** True when the HMAC is the HMAC with this secret and `sig` is a valid signature of the request key. */
    fun checkRequest(
        request: JsonObject,
        secret: String,
    ): Boolean {
        val macText = (request["mac"] as? JsonPrimitive)?.content ?: return false
        val sig = (request["sig"] as? JsonPrimitive)?.content?.let(Encoding::fromBase64OrNull) ?: return false
        val given = Encoding.fromBase64OrNull(macText) ?: return false
        if (!Encoding.equalBytes(given, mac(request, secret))) return false
        val key =
            ((request["keys"] as? JsonObject)?.get("ed25519") as? JsonPrimitive)
                ?.content
                ?.let(Encoding::fromBase64OrNull) ?: return false
        return Crypto.ed25519Verify(key, sig, sigBytes(request))
    }

    /**
     * The 6-digit check code that both screens show (`checkCode()`): SHA-256 of `aw-check-v2\n` +
     * canonical JSON of the showing keys and the request without `sig` and `mac`, the first 4 bytes
     * big-endian, modulo 1,000,000.
     */
    fun checkCode(
        showing: OfferDevice,
        request: JsonObject,
    ): String {
        val body =
            buildJsonObject {
                putJsonObject("showing") {
                    put("ed25519", showing.ed25519)
                    put("sync_id", showing.syncId)
                }
                put("request", without(request, "mac", "sig"))
            }
        val digest = Crypto.sha256(Encoding.utf8(CHECK_DOMAIN + CanonicalJson.of(body)))
        var value = 0L
        for (i in 0 until SIG_BYTES) value = (value shl Byte.SIZE_BITS) or (digest[i].toLong() and BYTE_MASK)
        return (value % CHECK_MODULO).toString().padStart(CHECK_DIGITS, '0')
    }

    /** The check code as people read it: `123 456`. */
    fun formatCheckCode(code: String): String = code.take(CHECK_DIGITS / 2) + " " + code.drop(CHECK_DIGITS / 2)

    private const val BYTE_MASK = 0xffL
}
