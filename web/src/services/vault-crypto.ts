/**
 * Zero-Knowledge Client-Side Encryption Service
 * Implements PBKDF2 key derivation and AES-256-GCM encryption/decryption
 * directly in browser memory using the native Web Crypto API.
 */

export class VaultCryptoService {
  /**
   * Generates a cryptographically secure random salt in hex.
   */
  static generateSaltHex(byteLength: number = 16): string {
    const salt = window.crypto.getRandomValues(new Uint8Array(byteLength));
    return Array.from(salt)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Derives a 256-bit AES-GCM key from the user's 4-digit PIN (or passphrase).
   * Uses PBKDF2 with 100,000 iterations of SHA-256.
   */
  static async deriveKeyFromPin(pin: string, saltHex: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const pinKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(pin.trim()),
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
      pinKey,
      { name: 'AES-GCM', length: 256 },
      true, // Allow exporting to sessionStorage
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Derives a 256-bit AES-GCM key from a passphrase (alias for backwards compatibility).
   */
  static async deriveKeyFromPassphrase(passphrase: string, saltHex: string): Promise<CryptoKey> {
    return this.deriveKeyFromPin(passphrase, saltHex);
  }

  /**
   * Initializes a brand-new zero-knowledge vault using a 4-digit PIN.
   * Returns the salt, encrypted verification token, and the active derived CryptoKey.
   */
  static async setupVaultWithPin(pin: string): Promise<{
    saltHex: string;
    encryptedVaultKey: string;
    key: CryptoKey;
  }> {
    const saltHex = this.generateSaltHex(16);
    const key = await this.deriveKeyFromPin(pin, saltHex);

    const challengePayload = JSON.stringify({
      check: 'MYDRIVE_VAULT_OK',
      v: 1,
      createdAt: Date.now(),
    });

    const encryptedVaultKey = await this.encryptString(challengePayload, key);
    return { saltHex, encryptedVaultKey, key };
  }

  /**
   * Verifies the 4-digit PIN against the user's stored salt and encrypted verification token.
   * Returns the valid CryptoKey on success, or null if PIN is incorrect.
   */
  static async verifyVaultPin(
    pin: string,
    saltHex: string,
    encryptedVaultKey: string
  ): Promise<CryptoKey | null> {
    try {
      const candidateKey = await this.deriveKeyFromPin(pin, saltHex);
      const decryptedJson = await this.decryptString(encryptedVaultKey, candidateKey);
      const parsed = JSON.parse(decryptedJson);
      if (parsed && parsed.check === 'MYDRIVE_VAULT_OK') {
        return candidateKey;
      }
      return null;
    } catch {
      // Decryption failure (AES-GCM authentication tag mismatch = wrong PIN)
      return null;
    }
  }

  /**
   * Encrypts a plaintext string with AES-256-GCM.
   * Returns a JSON payload containing base64 iv and ciphertext data.
   */
  static async encryptString(plaintext: string, key: CryptoKey): Promise<string> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );

    const ivB64 = btoa(String.fromCharCode(...new Uint8Array(iv)));
    const dataB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
    return JSON.stringify({ iv: ivB64, data: dataB64 });
  }

  /**
   * Decrypts an encrypted JSON payload ({ iv, data }) back to string using AES-256-GCM.
   */
  static async decryptString(encryptedJsonStr: string, key: CryptoKey): Promise<string> {
    const { iv: ivB64, data: dataB64 } = JSON.parse(encryptedJsonStr);
    const iv = new Uint8Array(
      atob(ivB64)
        .split('')
        .map((c) => c.charCodeAt(0))
    );
    const ciphertext = new Uint8Array(
      atob(dataB64)
        .split('')
        .map((c) => c.charCodeAt(0))
    );

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted);
  }

  /**
   * Encrypts file metadata (filename, mimeType, dimensions, etc.) into an opaque JSON payload.
   */
  static async encryptMetadata(metadata: Record<string, any>, key: CryptoKey): Promise<string> {
    return this.encryptString(JSON.stringify(metadata), key);
  }

  /**
   * Decrypts file metadata back into a Javascript object. Returns null on failure.
   */
  static async decryptMetadata(
    encryptedMetaStr: string,
    key: CryptoKey
  ): Promise<Record<string, any> | null> {
    try {
      if (!encryptedMetaStr) return null;
      const str = await this.decryptString(encryptedMetaStr, key);
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  /**
   * Persists derived key in browser sessionStorage so page refreshes don't re-lock vault.
   */
  static async exportKeyToSession(key: CryptoKey): Promise<void> {
    try {
      const jwk = await window.crypto.subtle.exportKey('jwk', key);
      sessionStorage.setItem('drive_vault_jwk', JSON.stringify(jwk));
    } catch (e) {
      console.warn('Could not save vault key to session:', e);
    }
  }

  /**
   * Restores derived key from browser sessionStorage if available.
   */
  static async restoreKeyFromSession(): Promise<CryptoKey | null> {
    try {
      const stored = sessionStorage.getItem('drive_vault_jwk');
      if (!stored) return null;
      const jwk = JSON.parse(stored);
      return await window.crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch {
      return null;
    }
  }

  /**
   * Clears derived key from sessionStorage (locks vault).
   */
  static clearSessionKey(): void {
    sessionStorage.removeItem('drive_vault_jwk');
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
