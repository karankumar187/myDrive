/**
 * Client-side PIN + Biometric (WebAuthn) lock screen security service.
 * 
 * PIN is hashed with PBKDF2 (SHA-256, 100K iterations) via Web Crypto API.
 * Biometric uses WebAuthn platform authenticator (Touch ID / Windows Hello).
 * All data stored in localStorage — this is a client-side access gate,
 * not a replacement for server-side OAuth authentication.
 */

const PIN_HASH_KEY = 'drive_lock_pin_hash';
const PIN_SALT_KEY = 'drive_lock_pin_salt';
const BIOMETRIC_CRED_KEY = 'drive_lock_biometric_cred';
const LOCK_USER_KEY = 'drive_lock_user_id';
const AUTO_LOCK_KEY = 'drive_lock_timeout';
const RESET_PENDING_KEY = 'drive_lock_reset_pending';
const PBKDF2_ITERATIONS = 100_000;

export class LockSecurityService {
  // ─── PIN Management ────────────────────────────────────────

  static isPinSet(): boolean {
    return !!localStorage.getItem(PIN_HASH_KEY);
  }

  static async setPin(pin: string, userId: string): Promise<void> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await this.hashPin(pin, salt);
    localStorage.setItem(PIN_HASH_KEY, hash);
    localStorage.setItem(PIN_SALT_KEY, this.bufferToHex(salt));
    localStorage.setItem(LOCK_USER_KEY, userId);
  }

  static async verifyPin(pin: string): Promise<boolean> {
    const storedHash = localStorage.getItem(PIN_HASH_KEY);
    const storedSalt = localStorage.getItem(PIN_SALT_KEY);
    if (!storedHash || !storedSalt) return false;
    const salt = this.hexToBuffer(storedSalt);
    const hash = await this.hashPin(pin, salt);
    return hash === storedHash;
  }

  static async changePin(oldPin: string, newPin: string, userId: string): Promise<boolean> {
    const valid = await this.verifyPin(oldPin);
    if (!valid) return false;
    await this.setPin(newPin, userId);
    return true;
  }

  static removePin(): void {
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.removeItem(PIN_SALT_KEY);
    localStorage.removeItem(LOCK_USER_KEY);
    localStorage.removeItem(BIOMETRIC_CRED_KEY);
    localStorage.removeItem(AUTO_LOCK_KEY);
  }

  static getLockedUserId(): string | null {
    return localStorage.getItem(LOCK_USER_KEY);
  }

  // ─── Forgot PIN (Google Re-auth) ──────────────────────────

  /** Set flag before redirecting to Google OAuth for PIN reset */
  static setResetPending(): void {
    localStorage.setItem(RESET_PENDING_KEY, 'true');
  }

  /** Check if a PIN reset is pending after Google re-auth */
  static isResetPending(): boolean {
    return localStorage.getItem(RESET_PENDING_KEY) === 'true';
  }

  /** Complete the reset: verify user matches, clear PIN */
  static completeReset(currentUserId: string): boolean {
    const lockedUserId = this.getLockedUserId();
    localStorage.removeItem(RESET_PENDING_KEY);

    // Only allow reset if the re-authenticated user matches the PIN owner
    if (lockedUserId && lockedUserId !== currentUserId) {
      return false; // Wrong account
    }

    this.removePin();
    return true;
  }

  static clearResetPending(): void {
    localStorage.removeItem(RESET_PENDING_KEY);
  }

  // ─── Auto-lock Timeout ────────────────────────────────────

  static getAutoLockTimeout(): number {
    const val = localStorage.getItem(AUTO_LOCK_KEY);
    return val ? parseInt(val, 10) : 0; // 0 = immediately
  }

  static setAutoLockTimeout(ms: number): void {
    localStorage.setItem(AUTO_LOCK_KEY, ms.toString());
  }

  // ─── Biometric (WebAuthn) ─────────────────────────────────

  static async isBiometricAvailable(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  static isBiometricRegistered(): boolean {
    return !!localStorage.getItem(BIOMETRIC_CRED_KEY);
  }

  static async registerBiometric(userId: string, userName: string): Promise<boolean> {
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'myDrive', id: window.location.hostname },
          user: {
            id: new TextEncoder().encode(userId),
            name: userName,
            displayName: userName,
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' as const },    // ES256
            { alg: -257, type: 'public-key' as const },   // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform' as const,
            userVerification: 'required' as const,
            residentKey: 'discouraged' as const,
          },
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;

      if (credential) {
        const credId = this.bufferToBase64(credential.rawId);
        localStorage.setItem(BIOMETRIC_CRED_KEY, credId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  static async authenticateBiometric(): Promise<boolean> {
    const credId = localStorage.getItem(BIOMETRIC_CRED_KEY);
    if (!credId) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: this.base64ToBuffer(credId),
            type: 'public-key' as const,
            transports: ['internal' as const],
          }],
          userVerification: 'required' as const,
          timeout: 60000,
        },
      });
      return !!assertion;
    } catch {
      return false;
    }
  }

  // ─── Crypto Helpers ───────────────────────────────────────

  private static async hashPin(pin: string, salt: Uint8Array): Promise<string> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pin),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as any,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    );
    return this.bufferToHex(new Uint8Array(bits));
  }

  private static bufferToHex(buf: Uint8Array): string {
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private static hexToBuffer(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  private static bufferToBase64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  private static base64ToBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
