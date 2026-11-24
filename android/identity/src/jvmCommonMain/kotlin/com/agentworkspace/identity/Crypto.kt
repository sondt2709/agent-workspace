package com.agentworkspace.identity

import com.google.crypto.tink.aead.internal.InsecureNonceChaCha20Poly1305
import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Ed25519Verify
import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The one wrapper of the crypto primitives (docs/tech-stack.md 1.5: Tink behind an own interface).
 * Tink 1.24 gives Ed25519, X25519, HKDF and ChaCha20-Poly1305 with a given nonce on each Android
 * version from API 29 (the platform has Ed25519 only from API 33). HMAC-SHA256 and SHA-256 come from
 * the JDK, which each Android version has. The shared vectors fail when an update changes an output.
 */
object Crypto {
    const val KEY_SIZE = 32
    const val SIGNATURE_SIZE = 64
    private val random = SecureRandom()

    fun randomBytes(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)

    /** The Ed25519 public key of a 32-byte secret (the seed form of `@noble/curves`). */
    fun ed25519Public(secret: ByteArray): ByteArray = Ed25519Sign.KeyPair.newKeyPairFromSeed(secret).publicKey

    fun ed25519Sign(
        secret: ByteArray,
        message: ByteArray,
    ): ByteArray = Ed25519Sign(secret).sign(message)

    /** False for a wrong signature, a key or a signature of a wrong size. */
    fun ed25519Verify(
        public: ByteArray,
        signature: ByteArray,
        message: ByteArray,
    ): Boolean {
        if (public.size != KEY_SIZE || signature.size != SIGNATURE_SIZE) return false
        return try {
            Ed25519Verify(public).verify(signature, message)
            true
        } catch (_: GeneralSecurityException) {
            false
        }
    }

    fun x25519Secret(): ByteArray = X25519.generatePrivateKey()

    fun x25519Public(secret: ByteArray): ByteArray = X25519.publicFromPrivate(secret)

    /** The X25519 shared secret. It refuses an all-zero result (a low-order point), as age does. */
    fun x25519(
        secret: ByteArray,
        public: ByteArray,
    ): ByteArray {
        val shared = X25519.computeSharedSecret(secret, public)
        if (shared.all { it == 0.toByte() }) throw GeneralSecurityException("The X25519 share is a low-order point")
        return shared
    }

    /** HKDF-SHA256. An empty salt is the zero key of RFC 5869. */
    fun hkdf(
        ikm: ByteArray,
        salt: ByteArray,
        info: ByteArray,
        size: Int,
    ): ByteArray = Hkdf.computeHkdf("HMACSHA256", ikm, salt, info, size)

    /** ChaCha20-Poly1305 (RFC 8439) with a given 12-byte nonce and no extra data: the ciphertext and the tag. */
    fun chachaSeal(
        key: ByteArray,
        nonce: ByteArray,
        plain: ByteArray,
    ): ByteArray = InsecureNonceChaCha20Poly1305(key).encrypt(nonce, plain, ByteArray(0))

    /** Opens a ChaCha20-Poly1305 box; GeneralSecurityException for a wrong key or a changed byte. */
    fun chachaOpen(
        key: ByteArray,
        nonce: ByteArray,
        sealed: ByteArray,
    ): ByteArray = InsecureNonceChaCha20Poly1305(key).decrypt(nonce, sealed, ByteArray(0))

    fun hmacSha256(
        key: ByteArray,
        data: ByteArray,
    ): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(data)
        }

    fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
}
