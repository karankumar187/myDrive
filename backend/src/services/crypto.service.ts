import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

export interface EncryptedPayload {
  ciphertext: string; // hex
  iv: string; // hex
  authTag: string; // hex
}

export class CryptoService {
  private static getEncryptionKey(): Buffer {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!rawKey) {
      throw new Error('TOKEN_ENCRYPTION_KEY environment variable is not configured');
    }
    // If hex-encoded 64 characters (32 bytes)
    if (rawKey.length === 64) {
      return Buffer.from(rawKey, 'hex');
    }
    // If raw 32 characters
    if (rawKey.length === 32) {
      return Buffer.from(rawKey, 'utf-8');
    }
    // Fallback: derive 32-byte key via SHA-256
    return crypto.createHash('sha256').update(rawKey).digest();
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a random 96-bit IV.
   * Perfect for sensitive OAuth refresh tokens and credentials.
   */
  static encrypt(plaintext: string): EncryptedPayload {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  /**
   * Decrypts an AES-256-GCM ciphertext payload with authentication tag verification.
   * Fails if any byte has been tampered with.
   */
  static decrypt(payload: EncryptedPayload): string {
    const key = this.getEncryptionKey();
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(payload.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  }

  /**
   * Hashes a device API key or secret using SHA-256 for secure constant-time verification.
   */
  static hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  /**
   * Generates a cryptographically strong device API key.
   */
  static generateDeviceKey(prefix: string = 'dkey'): { key: string; hash: string; prefix: string } {
    const randomEntropy = crypto.randomBytes(24).toString('base64url');
    const fullKey = `${prefix}_${randomEntropy}`;
    const hash = this.hashSecret(fullKey);
    const displayPrefix = fullKey.substring(0, 12) + '...';

    return {
      key: fullKey,
      hash,
      prefix: displayPrefix,
    };
  }

  /**
   * Generates a random cryptographic salt for PBKDF2 passphrase key derivation.
   */
  static generateSalt(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
