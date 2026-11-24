package com.agentworkspace.identity

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The device record check (`verifyRecord()` of shared/identity/src/records.ts, docs/architecture.md
 * 4.1.3): an Ed25519 signature of the master key over `aw-device-record-v1\n` + canonical JSON of the
 * record as written (the parsed YAML value), without `signature`.
 */
object Records {
    const val DOMAIN = "aw-device-record-v1\n"

    fun signedBytes(record: JsonObject): ByteArray =
        Encoding.utf8(DOMAIN + CanonicalJson.of(JsonObject(record.filterKeys { it != "signature" })))

    /** True when the raw record has a valid signature of the master public key. */
    fun verify(
        raw: JsonElement,
        masterPublic: ByteArray,
    ): Boolean {
        val record = raw as? JsonObject ?: return false
        val text = (record["signature"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return false
        val signature = Encoding.fromBase64OrNull(text) ?: return false
        val bytes =
            try {
                signedBytes(record)
            } catch (_: IllegalArgumentException) {
                return false
            }
        return Crypto.ed25519Verify(masterPublic, signature, bytes)
    }

    /** Signs a record with a master secret (tests and the vectors; the phone has no master key). */
    fun sign(
        record: JsonObject,
        masterSecret: ByteArray,
    ): JsonObject {
        val signature = Encoding.toBase64(Crypto.ed25519Sign(masterSecret, signedBytes(record)))
        return JsonObject(record.filterKeys { it != "signature" } + ("signature" to JsonPrimitive(signature)))
    }

    /** The verifier of the merge for one master public key. */
    fun verifier(masterPublic: ByteArray): (JsonElement) -> Boolean = { verify(it, masterPublic) }
}
