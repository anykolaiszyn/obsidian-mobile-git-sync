/**
 * Cryptographic utilities for secure token storage
 * 
 * Uses Web Crypto API for encryption/decryption with AES-GCM
 * Generates device-specific keys for additional security
 */

export interface EncryptedData {
  data: string;
  iv: string;
  salt: string;
}

export class CryptoManager {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12;
  private static readonly SALT_LENGTH = 16;

  /**
   * Encrypts data using AES-GCM with a device-derived key
   */
  async encrypt(plaintext: string, deviceFingerprint?: string): Promise<EncryptedData> {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(plaintext);
      
      // Generate random IV and salt
      const iv = crypto.getRandomValues(new Uint8Array(CryptoManager.IV_LENGTH));
      const salt = crypto.getRandomValues(new Uint8Array(CryptoManager.SALT_LENGTH));
      
      // Derive key from device fingerprint and salt
      const key = await this.deriveKey(deviceFingerprint || 'default', salt);
      
      // Encrypt the data
      const encrypted = await crypto.subtle.encrypt(
        {
          name: CryptoManager.ALGORITHM,
          iv: iv
        },
        key,
        data
      );
      
      return {
        data: this.arrayBufferToBase64(encrypted),
        iv: this.arrayBufferToBase64(iv),
        salt: this.arrayBufferToBase64(salt)
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypts data using AES-GCM
   */
  async decrypt(encryptedData: EncryptedData, deviceFingerprint?: string): Promise<string> {
    try {
      // Convert base64 back to ArrayBuffer
      const data = this.base64ToArrayBuffer(encryptedData.data);
      const iv = this.base64ToArrayBuffer(encryptedData.iv);
      const salt = this.base64ToArrayBuffer(encryptedData.salt);
      
      // Derive the same key used for encryption
      const key = await this.deriveKey(deviceFingerprint || 'default', salt);
      
      // Decrypt the data
      const decrypted = await crypto.subtle.decrypt(
        {
          name: CryptoManager.ALGORITHM,
          iv: iv
        },
        key,
        data
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Derives a cryptographic key from device fingerprint and salt
   */
  private async deriveKey(deviceFingerprint: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(deviceFingerprint),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      {
        name: CryptoManager.ALGORITHM,
        length: CryptoManager.KEY_LENGTH
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Generates a device fingerprint based on available browser/environment data
   */
  generateDeviceFingerprint(): string {
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      new Date().getTimezoneOffset(),
      // Add Obsidian-specific identifiers if available
      (window as any).app?.appId || 'obsidian',
      // Platform identifier
      process.platform || 'unknown'
    ];
    
    // Create a hash of the components
    const fingerprint = components.join('|');
    return this.simpleHash(fingerprint);
  }

  /**
   * Simple hash function for device fingerprinting
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Converts ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Converts base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Validates that crypto operations are available
   */
  static isSupported(): boolean {
    return (
      typeof crypto !== 'undefined' &&
      typeof crypto.subtle !== 'undefined' &&
      typeof crypto.getRandomValues === 'function'
    );
  }

  /**
   * Securely wipes sensitive data from memory (best effort)
   */
  static secureWipe(data: string): void {
    // This is a best-effort attempt to clear sensitive data
    // JavaScript doesn't provide guaranteed memory wiping
    if (data && typeof data === 'string') {
      try {
        // Try to overwrite the string content (limited effectiveness in JS)
        for (let i = 0; i < data.length; i++) {
          (data as any)[i] = '0';
        }
      } catch (error) {
        // Readonly strings can't be modified, which is expected
      }
    }
  }
}