/**
 * Secure Token Storage Manager
 * 
 * Provides encrypted storage for sensitive credentials like GitHub tokens
 * Uses device-specific encryption keys and secure file storage
 */

import { App, TFile, Notice, requestUrl } from 'obsidian';
import { CryptoManager, EncryptedData } from './crypto';

export interface TokenValidationResult {
  isValid: boolean;
  error?: string;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

export class SecureTokenManager {
  private static readonly TOKEN_FILE_PATH = '.mobile-git-sync/encrypted-token.json';
  private static readonly BACKUP_TOKEN_PATH = '.mobile-git-sync/token-backup.json';
  private cryptoManager: CryptoManager;
  private deviceFingerprint: string;

  constructor(private app: App) {
    this.cryptoManager = new CryptoManager();
    this.deviceFingerprint = this.cryptoManager.generateDeviceFingerprint();
  }

  /**
   * Stores a GitHub token securely with encryption
   */
  async storeToken(token: string): Promise<void> {
    try {
      // Validate token format before storing
      if (!this.isValidTokenFormat(token)) {
        throw new Error('Invalid GitHub token format');
      }

      // Encrypt the token
      const encryptedData = await this.cryptoManager.encrypt(token, this.deviceFingerprint);
      
      // Create secure storage directory if it doesn't exist
      await this.ensureSecureDirectory();
      
      // Store encrypted token with metadata
      const tokenData = {
        encrypted: encryptedData,
        timestamp: Date.now(),
        version: '1.0',
        deviceFingerprint: this.deviceFingerprint.substring(0, 8) // First 8 chars for verification
      };

      // Write to primary location
      await this.app.vault.adapter.write(
        SecureTokenManager.TOKEN_FILE_PATH,
        JSON.stringify(tokenData, null, 2)
      );

      // Create backup copy
      await this.app.vault.adapter.write(
        SecureTokenManager.BACKUP_TOKEN_PATH,
        JSON.stringify(tokenData, null, 2)
      );

      // Wipe the plaintext token from memory
      CryptoManager.secureWipe(token);

      new Notice('GitHub token stored securely', 2000);
    } catch (error) {
      console.error('Failed to store secure token:', error);
      throw new Error(`Failed to store token securely: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Retrieves and decrypts the stored GitHub token
   */
  async getToken(): Promise<string | null> {
    try {
      // Try primary location first
      let tokenData = await this.loadTokenData(SecureTokenManager.TOKEN_FILE_PATH);
      
      // Fall back to backup if primary fails
      if (!tokenData) {
        tokenData = await this.loadTokenData(SecureTokenManager.BACKUP_TOKEN_PATH);
      }

      if (!tokenData) {
        return null;
      }

      // Verify device fingerprint matches (basic tamper detection)
      const storedFingerprint = tokenData.deviceFingerprint;
      const currentFingerprint = this.deviceFingerprint.substring(0, 8);
      
      if (storedFingerprint && storedFingerprint !== currentFingerprint) {
        console.warn('Device fingerprint mismatch - token may have been moved');
        // Continue anyway as devices can change (updates, etc.)
      }

      // Decrypt the token
      const decryptedToken = await this.cryptoManager.decrypt(
        tokenData.encrypted,
        this.deviceFingerprint
      );

      return decryptedToken;
    } catch (error) {
      console.error('Failed to retrieve secure token:', error);
      throw new Error(`Failed to retrieve token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validates a GitHub token by making a test API call
   */
  async validateToken(token?: string): Promise<TokenValidationResult> {
    try {
      const tokenToValidate = token || await this.getToken();
      
      if (!tokenToValidate) {
        return { isValid: false, error: 'No token available' };
      }

      // Make a lightweight API call to validate the token
      const response = await requestUrl({
        url: 'https://api.github.com/user',
        method: 'GET',
        headers: {
          'Authorization': `token ${tokenToValidate}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Obsidian-Mobile-Git-Sync'
        }
      });

      // Extract rate limit information
      const rateLimitRemaining = parseInt(response.headers['X-RateLimit-Remaining'] || '0');
      const rateLimitReset = parseInt(response.headers['X-RateLimit-Reset'] || '0');

      if (response.status >= 200 && response.status < 300) {
        return {
          isValid: true,
          rateLimitRemaining,
          rateLimitReset
        };
      } else if (response.status === 401) {
        return {
          isValid: false,
          error: 'Token is invalid or expired',
          rateLimitRemaining,
          rateLimitReset
        };
      } else if (response.status === 403) {
        const responseBody = response.text || '';
        if (responseBody.includes('rate limit')) {
          return {
            isValid: true, // Token is valid, just rate limited
            error: 'Rate limit exceeded',
            rateLimitRemaining,
            rateLimitReset
          };
        } else {
          return {
            isValid: false,
            error: 'Insufficient permissions',
            rateLimitRemaining,
            rateLimitReset
          };
        }
      } else {
        return {
          isValid: false,
          error: `API returned ${response.status}`,
          rateLimitRemaining,
          rateLimitReset
        };
      }
    } catch (error) {
      return {
        isValid: false,
        error: `Validation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Clears stored token and removes all encrypted files
   */
  async clearToken(): Promise<void> {
    try {
      // Remove primary token file
      if (await this.app.vault.adapter.exists(SecureTokenManager.TOKEN_FILE_PATH)) {
        await this.app.vault.adapter.remove(SecureTokenManager.TOKEN_FILE_PATH);
      }

      // Remove backup token file
      if (await this.app.vault.adapter.exists(SecureTokenManager.BACKUP_TOKEN_PATH)) {
        await this.app.vault.adapter.remove(SecureTokenManager.BACKUP_TOKEN_PATH);
      }

      new Notice('Stored token cleared', 2000);
    } catch (error) {
      console.error('Failed to clear token:', error);
      throw new Error(`Failed to clear token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Checks if a token exists in secure storage
   */
  async hasToken(): Promise<boolean> {
    try {
      const token = await this.getToken();
      return token !== null && token.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Gets token metadata without decrypting the actual token
   */
  async getTokenMetadata(): Promise<{ timestamp: number; version: string } | null> {
    try {
      const tokenData = await this.loadTokenData(SecureTokenManager.TOKEN_FILE_PATH);
      if (!tokenData) {
        return null;
      }

      return {
        timestamp: tokenData.timestamp,
        version: tokenData.version
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Validates GitHub token format
   */
  private isValidTokenFormat(token: string): boolean {
    return (
      typeof token === 'string' &&
      token.length > 0 &&
      (token.startsWith('ghp_') || token.startsWith('github_pat_'))
    );
  }

  /**
   * Ensures the secure storage directory exists
   */
  private async ensureSecureDirectory(): Promise<void> {
    const dirPath = '.mobile-git-sync';
    
    if (!(await this.app.vault.adapter.exists(dirPath))) {
      await this.app.vault.adapter.mkdir(dirPath);
    }
  }

  /**
   * Loads and parses token data from file
   */
  private async loadTokenData(filePath: string): Promise<any | null> {
    try {
      if (!(await this.app.vault.adapter.exists(filePath))) {
        return null;
      }

      const fileContent = await this.app.vault.adapter.read(filePath);
      return JSON.parse(fileContent);
    } catch (error) {
      console.error(`Failed to load token data from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Migrates from old plain-text token storage
   */
  async migrateFromPlainTextToken(plainTextToken: string): Promise<void> {
    if (!plainTextToken || plainTextToken.length === 0) {
      return;
    }

    try {
      // Store the token securely
      await this.storeToken(plainTextToken);
      
      // Wipe the plain text token
      CryptoManager.secureWipe(plainTextToken);
      
      new Notice('Token successfully migrated to secure storage', 3000);
    } catch (error) {
      console.error('Failed to migrate token:', error);
      throw new Error(`Token migration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Checks if Web Crypto API is available
   */
  static isSupported(): boolean {
    return CryptoManager.isSupported();
  }
}