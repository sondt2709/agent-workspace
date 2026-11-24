package com.agentworkspace.control

import com.agentworkspace.identity.Age
import com.agentworkspace.identity.Encoding
import com.agentworkspace.identity.SealedCredential
import com.agentworkspace.shared.files.WorkspaceWriter
import com.agentworkspace.shared.model.TimeSource
import com.agentworkspace.shared.write.Uuid7
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/** A paired computer that a sealed credential is for: its slug and its X25519 public key (base64). */
data class SealRecipient(
    val device: String,
    val x25519: String,
)

/**
 * Seals a credential value to the paired computers (docs/phase-1.md 10.2): the phone can add or
 * replace a credential, but it cannot read one. The content is the outbox format of `@aw/identity`
 * `sealCredential()`: `{"kind":"sealed-credential","v":1,"name","value"}`, encrypted with age to the
 * X25519 key of each recipient.
 */
interface CredentialSealer {
    /** False when the sealer cannot seal (a test sealer). */
    val available: Boolean

    suspend fun seal(
        name: String,
        value: CharArray,
        recipients: List<SealRecipient>,
    ): ByteArray
}

/**
 * The age sealer of the phone (openspec add-android-pairing, design decision 11): the content of
 * `sealCredential()`, encrypted with age to the X25519 key of each recipient. The value never becomes
 * a `String`, and the content bytes are cleared after the seal.
 */
object AgeCredentialSealer : CredentialSealer {
    override val available: Boolean = true

    override suspend fun seal(
        name: String,
        value: CharArray,
        recipients: List<SealRecipient>,
    ): ByteArray {
        val keys = recipients.map { Encoding.fromBase64(it.x25519) }
        val content = SealedCredential.content(name, value)
        try {
            return Age.seal(content, keys)
        } finally {
            content.fill(0)
        }
    }
}

/** The credential outbox of the phone: `tasks/devices/<phone>/sealed/<id>.age`. */
class CredentialOutbox(
    private val files: WorkspaceWriter,
    private val sealer: CredentialSealer,
    private val time: TimeSource,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val newId: (Long) -> String = { Uuid7.next(it) },
) {
    val available: Boolean get() = sealer.available

    /**
     * The computers that get the value: each device record (`device.yaml`) of a computer that is not
     * revoked and has an X25519 key.
     */
    fun recipients(records: Map<String, JsonObject>): List<SealRecipient> =
        records
            .mapNotNull { (slug, record) ->
                val role = (record["role"] as? JsonPrimitive)?.contentOrNull
                val revoked = (record["revoked"] as? JsonPrimitive)?.booleanOrNull ?: false
                val key = ((record["keys"] as? JsonObject)?.get("x25519") as? JsonPrimitive)?.contentOrNull
                val computer = role != null && role != "mobile" && !revoked
                if (computer && key != null) SealRecipient(slug, key) else null
            }.sortedBy { it.device }

    /**
     * Seals [value] and writes the sealed file. The value array is cleared after the seal, also on a
     * failure; it never goes to an event, a log or the index.
     */
    suspend fun add(
        phone: String,
        name: String,
        value: CharArray,
        recipients: List<SealRecipient>,
    ): ActionResult {
        try {
            problem(name, value, recipients)?.let { return ActionResult.Refused(it) }
            val sealed = sealer.seal(name, value, recipients)
            val path = "tasks/devices/$phone/sealed/${newId(time.now())}.age"
            withContext(io) { files.writeAtomic(path, sealed) }
            return ActionResult.Done(name, path)
        } finally {
            value.fill('\u0000')
        }
    }

    private fun problem(
        name: String,
        value: CharArray,
        recipients: List<SealRecipient>,
    ): String? =
        when {
            !NAME.matches(name) -> "Use a name like github-token: small letters, digits and -_."
            value.isEmpty() -> "Enter the value."
            !sealer.available -> "Credential add needs the device keys: pair this phone first."
            recipients.isEmpty() -> "No paired computer can get the credential."
            else -> null
        }

    companion object {
        /** The credential name rule (`entryName` of shared/schema, at most 63 characters). */
        val NAME = Regex("^(?=.{1,63}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$")
    }
}
