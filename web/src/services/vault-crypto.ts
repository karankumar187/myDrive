/**
 * Zero-Knowledge Client-Side Encryption Service
 * Implements PBKDF2 key derivation and AES-256-GCM encryption/decryption
 * directly in the browser memory using the native Web Crypto API.
 */

export class VaultCryptoService {
  /**
   * Derives a 256-bit AES-GCM key from the user's Master Passphrase.
   */
  static async deriveKeyFromPassphrase(passphrase: string, saltHex: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const passphraseKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const salt = new Uint8Array(
      saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      passphraseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Calculates raw SHA-256 hash of a file for zero-knowledge deduplication.
   */
  static async calculateSha256(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Encrypts a raw file ArrayBuffer using AES-256-GCM with a random 12-byte IV.
   */
  static async encryptBuffer(
    buffer: ArrayBuffer,
    key: CryptoKey
  ): Promise<{ encryptedBlob: Blob; ivHex: string }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      buffer
    );

    const ivHex = Array.from(iv)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return {
      encryptedBlob: new Blob([encryptedData]),
      ivHex,
    };
  }

  /**
   * Decrypts an encrypted ArrayBuffer in browser memory on-the-fly.
   */
  static async decryptBuffer(
    encryptedBuffer: ArrayBuffer,
    ivHex: string,
    key: CryptoKey
  ): Promise<ArrayBuffer> {
    const iv = new Uint8Array(
      ivHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    return await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encryptedBuffer
    );
  }
}
