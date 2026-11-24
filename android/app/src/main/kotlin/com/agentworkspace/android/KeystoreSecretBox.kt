package com.agentworkspace.android

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.agentworkspace.identity.SecretBox
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The box of the phone device key (openspec add-android-pairing, design decision 5): AES-256-GCM with
 * a non-exportable key of the Android Keystore. The platform keystore has no Ed25519 before API 33 and
 * no X25519 before API 31, so the device key itself is made in software and kept encrypted here. The
 * sealed form is a version byte, the 12-byte IV and the ciphertext with its tag.
 */
class KeystoreSecretBox(
    private val alias: String = "aw-device-key",
) : SecretBox {
    private fun key(): SecretKey =
        try {
            val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
            (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator
                .getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
                .apply {
                    init(
                        KeyGenParameterSpec
                            .Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .setKeySize(KEY_BITS)
                            .build(),
                    )
                }.generateKey()
        } catch (e: IOException) {
            throw GeneralSecurityException("The Android Keystore cannot be read", e)
        }

    override fun seal(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return byteArrayOf(VERSION) + cipher.iv + cipher.doFinal(plain)
    }

    override fun open(sealed: ByteArray): ByteArray {
        if (sealed.size <= 1 + IV_BYTES ||
            sealed[0] != VERSION
        ) {
            throw GeneralSecurityException("The sealed device key is not valid")
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, sealed, 1, IV_BYTES))
        return cipher.doFinal(sealed, 1 + IV_BYTES, sealed.size - 1 - IV_BYTES)
    }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val VERSION: Byte = 1
        const val IV_BYTES = 12
        const val TAG_BITS = 128
        const val KEY_BITS = 256
    }
}
