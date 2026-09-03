package com.drive.sync.crypto

import java.io.InputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Zero-Knowledge Client-Side Encryption for Android.
 * Derives AES-256 keys via PBKDF2 and encrypts local photos before transmission.
 */
object VaultCrypto {

    private const val ALGORITHM = "AES/GCM/NoPadding"
    private const val TAG_LENGTH_BITS = 128
    private const val IV_LENGTH_BYTES = 12
    private const val PBKDF2_ITERATIONS = 100_000

    /**
     * Derives a 256-bit AES SecretKey from the user's Master Passphrase and salt.
     */
    fun deriveKey(passphrase: String, saltHex: String): SecretKeySpec {
        val saltBytes = saltHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(passphrase.toCharArray(), saltBytes, PBKDF2_ITERATIONS, 256)
        val secretKey = factory.generateSecret(spec)
        return SecretKeySpec(secretKey.encoded, "AES")
    }

    /**
     * Calculates the raw SHA-256 hash of an InputStream for zero-knowledge deduplication.
     */
    fun calculateSha256(inputStream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        var bytesRead: Int
        while (inputStream.read(buffer).also { bytesRead = it } != -1) {
            digest.update(buffer, 0, bytesRead)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Encrypts raw bytes using AES-256-GCM with a random 12-byte IV.
     * Returns the IV and ciphertext.
     */
    fun encrypt(data: ByteArray, secretKey: SecretKeySpec): Pair<ByteArray, ByteArray> {
        val iv = ByteArray(IV_LENGTH_BYTES)
        SecureRandom().nextBytes(iv)

        val cipher = Cipher.getInstance(ALGORITHM)
        val spec = GCMParameterSpec(TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)

        val ciphertext = cipher.doFinal(data)
        return Pair(iv, ciphertext)
    }

    /**
     * Decrypts AES-256-GCM ciphertext using the given IV and secret key.
     */
    fun decrypt(ciphertext: ByteArray, iv: ByteArray, secretKey: SecretKeySpec): ByteArray {
        val cipher = Cipher.getInstance(ALGORITHM)
        val spec = GCMParameterSpec(TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        return cipher.doFinal(ciphertext)
    }
}
