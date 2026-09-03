import { describe, it, expect, beforeAll } from 'vitest';
import { CryptoService } from '../services/crypto.service.js';

describe('CryptoService (Security & Encryption)', () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  it('should successfully encrypt and decrypt a Google Drive refresh token using AES-256-GCM', () => {
    const originalToken = '1//04_AbCdEfGhIjKlMnOpQrStUvWxYz_123456789';
    const encrypted = CryptoService.encrypt(originalToken);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toHaveLength(24); // 12 bytes hex
    expect(encrypted.authTag).toHaveLength(32); // 16 bytes hex

    const decrypted = CryptoService.decrypt(encrypted);
    expect(decrypted).toBe(originalToken);
  });

  it('should fail decryption if ciphertext or authTag is tampered with', () => {
    const originalToken = 'secret_token_data';
    const encrypted = CryptoService.encrypt(originalToken);

    // Tamper with authTag
    const tamperedPayload = {
      ...encrypted,
      authTag: '00000000000000000000000000000000',
    };

    expect(() => CryptoService.decrypt(tamperedPayload)).toThrow();
  });

  it('should generate secure device API keys and verify their SHA-256 hashes', () => {
    const { key, hash, prefix } = CryptoService.generateDeviceKey('dkey_android');

    expect(key.startsWith('dkey_android_')).toBe(true);
    expect(prefix.startsWith('dkey_android')).toBe(true);
    expect(hash).toHaveLength(64); // SHA-256 hex length

    // Verifying same hash
    const computedHash = CryptoService.hashSecret(key);
    expect(computedHash).toBe(hash);
  });
});
