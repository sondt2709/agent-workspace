// The sizes, columns and byte masks are the numbers of the age v1 specification.
@file:Suppress("MagicNumber")

package com.agentworkspace.identity

import java.io.ByteArrayOutputStream
import java.security.GeneralSecurityException
import java.util.Base64

/** A file that this identity cannot open, or a damaged age file. */
class AgeException(
    message: String,
) : GeneralSecurityException(message)

/**
 * The random values of one seal. Only the vectors give fixed values: [secure] is the normal case.
 */
class AgeRandomness(
    val fileKey: () -> ByteArray,
    val ephemeral: () -> ByteArray,
    val payloadNonce: () -> ByteArray,
) {
    companion object {
        fun secure() =
            AgeRandomness(
                fileKey = { Crypto.randomBytes(Age.FILE_KEY_SIZE) },
                ephemeral = { Crypto.x25519Secret() },
                payloadNonce = { Crypto.randomBytes(Age.NONCE_SIZE) },
            )
    }
}

/**
 * The age v1 format (age-encryption.org/v1) for X25519 recipients only: the format of the credential
 * files and of the phone outbox (task-model decision §4, docs/phase-1.md 10.2). `age-encryption` of
 * shared/identity opens what [seal] writes, and [open] opens what it writes (shared vectors). No
 * scrypt, no armor, no plugins.
 */
object Age {
    const val FILE_KEY_SIZE = 16
    const val NONCE_SIZE = 16
    private const val VERSION_LINE = "age-encryption.org/v1"
    private const val X25519_INFO = "age-encryption.org/v1/X25519"
    private const val CHUNK_SIZE = 64 * 1024
    private const val TAG_SIZE = 16
    private const val COLUMNS = 64
    private const val STREAM_NONCE_SIZE = 12
    private const val SHARE_TEXT_SIZE = 43
    private const val BODY_SIZE = FILE_KEY_SIZE + TAG_SIZE
    private const val RECIPIENT_HRP = "age"
    private const val IDENTITY_HRP = "age-secret-key-"
    private const val COUNTER_BYTES = 11

    private val b64Encoder = Base64.getEncoder().withoutPadding()

    fun recipientOf(x25519Public: ByteArray): String = Bech32.encode(RECIPIENT_HRP, x25519Public)

    fun identityOf(x25519Secret: ByteArray): String = Bech32.encode(IDENTITY_HRP, x25519Secret).uppercase()

    /** The X25519 public key of a recipient `age1…`. */
    fun parseRecipient(recipient: String): ByteArray {
        val decoded = Bech32.decode(recipient)
        require(decoded.hrp == RECIPIENT_HRP && decoded.bytes.size == Crypto.KEY_SIZE) {
            "The recipient is not an age X25519 recipient"
        }
        return decoded.bytes
    }

    /** The X25519 secret of an identity `AGE-SECRET-KEY-1…`. */
    fun parseIdentity(identity: String): ByteArray {
        val decoded = Bech32.decode(identity)
        require(decoded.hrp == IDENTITY_HRP && decoded.bytes.size == Crypto.KEY_SIZE) {
            "The identity is not an age X25519 identity"
        }
        return decoded.bytes
    }

    private fun b64(bytes: ByteArray): String = b64Encoder.encodeToString(bytes)

    /** Decodes canonical unpadded base64 (the age form); null for any other text. */
    private fun unb64(text: String): ByteArray? {
        if (text.contains('=') || text.contains('\r')) return null
        val bytes = runCatching { Base64.getDecoder().decode(text) }.getOrNull() ?: return null
        return bytes.takeIf { b64(it) == text }
    }

    private fun wrapKey(
        shared: ByteArray,
        share: ByteArray,
        recipient: ByteArray,
    ): ByteArray = Crypto.hkdf(shared, share + recipient, Encoding.utf8(X25519_INFO), Crypto.KEY_SIZE)

    private fun streamNonce(
        counter: Long,
        last: Boolean,
    ): ByteArray {
        val nonce = ByteArray(STREAM_NONCE_SIZE)
        var c = counter
        for (i in COUNTER_BYTES - 1 downTo 0) {
            nonce[i] = (c and 0xff).toByte()
            c = c ushr Byte.SIZE_BITS
        }
        if (last) nonce[COUNTER_BYTES] = 1
        return nonce
    }

    /** Encrypts [plain] to each X25519 public key. */
    fun seal(
        plain: ByteArray,
        recipients: List<ByteArray>,
        random: AgeRandomness = AgeRandomness.secure(),
    ): ByteArray {
        require(recipients.isNotEmpty()) { "Seal needs one recipient or more" }
        val fileKey = random.fileKey()
        try {
            val header = StringBuilder(VERSION_LINE).append('\n')
            for (recipient in recipients) {
                require(recipient.size == Crypto.KEY_SIZE) { "An X25519 public key has 32 bytes" }
                val ephemeral = random.ephemeral()
                val share = Crypto.x25519Public(ephemeral)
                val key = wrapKey(Crypto.x25519(ephemeral, recipient), share, recipient)
                val body = Crypto.chachaSeal(key, ByteArray(STREAM_NONCE_SIZE), fileKey)
                header.append("-> X25519 ").append(b64(share)).append('\n')
                appendBody(header, b64(body))
                ephemeral.fill(0)
            }
            header.append("---")
            val mac = Crypto.hmacSha256(headerKey(fileKey), Encoding.utf8(header.toString()))
            header.append(' ').append(b64(mac)).append('\n')
            val out = ByteArrayOutputStream()
            out.write(Encoding.utf8(header.toString()))
            val nonce = random.payloadNonce()
            require(nonce.size == NONCE_SIZE) { "The payload nonce has 16 bytes" }
            out.write(nonce)
            val payloadKey = Crypto.hkdf(fileKey, nonce, Encoding.utf8("payload"), Crypto.KEY_SIZE)
            var counter = 0L
            var at = 0
            do {
                val end = minOf(at + CHUNK_SIZE, plain.size)
                val last = end == plain.size
                // The chunk copy holds part of the value: clear it after the seal (android-identity spec).
                val chunk = plain.copyOfRange(at, end)
                try {
                    out.write(Crypto.chachaSeal(payloadKey, streamNonce(counter, last), chunk))
                } finally {
                    chunk.fill(0)
                }
                at = end
                counter += 1
            } while (!last)
            payloadKey.fill(0)
            return out.toByteArray()
        } finally {
            fileKey.fill(0)
        }
    }

    /** A stanza body in lines of 64 columns; the last line is shorter (it can be empty). */
    private fun appendBody(
        out: StringBuilder,
        text: String,
    ) {
        var at = 0
        while (true) {
            val end = minOf(at + COLUMNS, text.length)
            out.append(text, at, end).append('\n')
            if (end - at < COLUMNS) return
            at = end
        }
    }

    private fun headerKey(fileKey: ByteArray): ByteArray =
        Crypto.hkdf(fileKey, ByteArray(0), Encoding.utf8("header"), Crypto.KEY_SIZE)

    private class Stanza(
        val type: String,
        val args: List<String>,
        val body: ByteArray,
    )

    private class Header(
        val stanzas: List<Stanza>,
        /** The header text up to and including `---`. */
        val macInput: ByteArray,
        val mac: ByteArray,
        val payloadStart: Int,
    )

    @Suppress("ThrowsCount", "CyclomaticComplexMethod")
    private fun parseHeader(file: ByteArray): Header {
        var at = 0

        fun line(): String {
            val end =
                (at until file.size).firstOrNull { file[it] == '\n'.code.toByte() }
                    ?: throw AgeException("The age header has no end")
            val bytes = file.copyOfRange(at, end)
            if (bytes.any { it < 0x20 || it > 0x7e }) throw AgeException("The age header is not ASCII text")
            at = end + 1
            return bytes.decodeToString()
        }
        if (line() != VERSION_LINE) throw AgeException("The file is not an age v1 file")
        val stanzas = mutableListOf<Stanza>()
        while (true) {
            val start = at
            val text = line()
            if (text.startsWith("--- ")) {
                val mac = unb64(text.removePrefix("--- ")) ?: throw AgeException("The header MAC is not valid")
                return Header(stanzas, file.copyOfRange(0, start + 3), mac, at)
            }
            if (!text.startsWith("-> ")) throw AgeException("The age header has a line that is not a stanza")
            val parts = text.removePrefix("-> ").split(' ')
            if (parts.any { it.isEmpty() }) throw AgeException("A stanza has an empty argument")
            val body = StringBuilder()
            while (true) {
                val chunk = line()
                if (chunk.length > COLUMNS) throw AgeException("A stanza line is longer than 64 columns")
                body.append(chunk)
                if (chunk.length < COLUMNS) break
            }
            val bytes = unb64(body.toString()) ?: throw AgeException("A stanza body is not valid base64")
            stanzas.add(Stanza(parts[0], parts.drop(1), bytes))
        }
    }

    private fun unwrap(
        stanza: Stanza,
        secret: ByteArray,
        public: ByteArray,
    ): ByteArray? {
        if (stanza.type != "X25519") return null
        if (stanza.args.size != 1 || stanza.args[0].length != SHARE_TEXT_SIZE || stanza.body.size != BODY_SIZE) {
            throw AgeException("An X25519 stanza is not valid")
        }
        val share = unb64(stanza.args[0]) ?: throw AgeException("An X25519 share is not valid")
        val key = wrapKey(Crypto.x25519(secret, share), share, public)
        return try {
            Crypto.chachaOpen(key, ByteArray(STREAM_NONCE_SIZE), stanza.body)
        } catch (_: GeneralSecurityException) {
            null
        }
    }

    /** Decrypts an age file with the X25519 secret of an identity; AgeException when it cannot. */
    fun open(
        file: ByteArray,
        x25519Secret: ByteArray,
    ): ByteArray {
        val header = parseHeader(file)
        val public = Crypto.x25519Public(x25519Secret)
        val fileKey =
            header.stanzas.firstNotNullOfOrNull { unwrap(it, x25519Secret, public) }
                ?: throw AgeException("The file cannot be opened with the key of this device")
        try {
            val mac = Crypto.hmacSha256(headerKey(fileKey), header.macInput)
            if (!Encoding.equalBytes(mac, header.mac)) throw AgeException("The age header MAC is not valid")
            return payload(file, header.payloadStart, fileKey)
        } finally {
            fileKey.fill(0)
        }
    }

    @Suppress("ThrowsCount")
    private fun payload(
        file: ByteArray,
        start: Int,
        fileKey: ByteArray,
    ): ByteArray {
        if (file.size - start < NONCE_SIZE + TAG_SIZE) throw AgeException("The age payload is too short")
        val nonce = file.copyOfRange(start, start + NONCE_SIZE)
        val key = Crypto.hkdf(fileKey, nonce, Encoding.utf8("payload"), Crypto.KEY_SIZE)
        val out = ByteArrayOutputStream()
        var at = start + NONCE_SIZE
        var counter = 0L
        while (at < file.size) {
            val end = minOf(at + CHUNK_SIZE + TAG_SIZE, file.size)
            val last = end == file.size
            val chunk = file.copyOfRange(at, end)
            if (last && chunk.size == TAG_SIZE && counter > 0) throw AgeException("The last age chunk is empty")
            try {
                out.write(Crypto.chachaOpen(key, streamNonce(counter, last), chunk))
            } catch (_: GeneralSecurityException) {
                throw AgeException("The age payload is damaged")
            }
            at = end
            counter += 1
        }
        key.fill(0)
        return out.toByteArray()
    }
}
