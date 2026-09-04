import { Request, Response } from 'express';
import { StorageAccount } from '../models/StorageAccount.js';
import { StorageEngineService } from '../services/storage-engine.service.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { CryptoService } from '../services/crypto.service.js';
import { CacheService } from '../services/cache.service.js';

export class StorageController {
  /**
   * Returns aggregated pooled storage metrics across all connected accounts.
   */
  static async getPoolSummary(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const cacheKey = `cache:user:${req.user._id}:summary`;
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const summary = await StorageEngineService.getPoolSummary(req.user._id);
      await CacheService.set(cacheKey, summary, 60);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Generates Google Drive OAuth authorization URL for linking a storage account.
   */
  static async getConnectUrl(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      // Encode user ID into encrypted state token to prevent CSRF
      const statePayload = CryptoService.encrypt(
        JSON.stringify({ userId: req.user._id.toString(), timestamp: Date.now() })
      );
      const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

      const authUrl = GoogleDriveService.generateAuthUrl(state);
      res.json({ url: authUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Callback from Google OAuth when linking a new Drive storage account.
   */
  static async connectCallback(req: Request, res: Response): Promise<void> {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;
      const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();

      if (!code || !state) {
        return res.redirect(`${clientUrl}/?error=missing_code_or_state`);
      }

      // Decrypt state to verify user identity
      const stateJson = Buffer.from(state, 'base64url').toString('utf8');
      const decryptedState = JSON.parse(CryptoService.decrypt(JSON.parse(stateJson)));
      const userId = decryptedState.userId;

      // Exchange code for permanent refresh token and account info
      const tokens = await GoogleDriveService.exchangeCodeForTokens(code);

      // Encrypt the refresh token with AES-256-GCM
      const encrypted = CryptoService.encrypt(tokens.refreshToken);

      // Upsert storage account in database
      let storageAccount = await StorageAccount.findOne({
        userId,
        googleDriveAccountId: tokens.googleSubId,
      });

      if (storageAccount) {
        storageAccount.accountEmail = tokens.email;
        storageAccount.accountName = tokens.name;
        storageAccount.encryptedRefreshToken = encrypted.ciphertext;
        storageAccount.refreshTokenIv = encrypted.iv;
        storageAccount.refreshTokenAuthTag = encrypted.authTag;
        storageAccount.status = 'healthy';
      } else {
        storageAccount = new StorageAccount({
          userId,
          accountEmail: tokens.email,
          accountName: tokens.name,
          googleDriveAccountId: tokens.googleSubId,
          encryptedRefreshToken: encrypted.ciphertext,
          refreshTokenIv: encrypted.iv,
          refreshTokenAuthTag: encrypted.authTag,
          status: 'healthy',
        });
      }

      // Query Google Drive API directly to sync real quota
      try {
        await GoogleDriveService.syncAccountQuota(storageAccount);
      } catch (quotaError) {
        console.warn('Initial quota sync notice:', quotaError);
      }

      await storageAccount.save();

      res.redirect(`${clientUrl}/?success=account_connected&email=${encodeURIComponent(tokens.email)}`);
    } catch (error: any) {
      console.error('Error linking storage account:', error);
      const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
      res.redirect(`${clientUrl}/?error=${encodeURIComponent(error.message)}`);
    }
  }

  /**
   * Lists all connected storage accounts for the authenticated user.
   */
  static async listAccounts(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const accounts = await StorageAccount.find({ userId: req.user._id }).select(
        '-encryptedRefreshToken -refreshTokenIv -refreshTokenAuthTag'
      );

      res.json({ accounts });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Forces a quota synchronization directly with Google Drive API.
   */
  static async syncAccount(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const account = await StorageAccount.findOne({
        _id: req.params.id,
        userId: req.user._id, // Strict IDOR protection
      });

      if (!account) {
        res.status(404).json({ error: 'Storage account not found or access denied' });
        return;
      }

      const quota = await GoogleDriveService.syncAccountQuota(account);
      await CacheService.invalidateUser(req.user._id.toString());
      res.json({ success: true, quota });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Unlinks a storage account from the user's pool.
   */
  static async removeAccount(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const account = await StorageAccount.findOneAndDelete({
        _id: req.params.id,
        userId: req.user._id, // Strict IDOR protection
      });

      if (!account) {
        res.status(404).json({ error: 'Storage account not found or access denied' });
        return;
      }

      await CacheService.invalidateUser(req.user._id.toString());
      res.json({ success: true, message: `Account ${account.accountEmail} unlinked successfully` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Dev helper: Simulates adding a mock 15 GB Google Drive storage account for testing.
   */
  static async devAddAccount(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const email = req.body.email || `mock.drive.${Date.now()}@gmail.com`;
      const dummyEncrypted = CryptoService.encrypt('mock_refresh_token_dev');

      const account = await StorageAccount.create({
        userId: req.user._id,
        accountEmail: email,
        accountName: req.body.name || 'Mock 15GB Google Drive',
        googleDriveAccountId: `sub_mock_${Date.now()}`,
        encryptedRefreshToken: dummyEncrypted.ciphertext,
        refreshTokenIv: dummyEncrypted.iv,
        refreshTokenAuthTag: dummyEncrypted.authTag,
        totalStorageBytes: 15 * 1024 * 1024 * 1024,
        usedStorageBytes: Math.floor(Math.random() * 2 * 1024 * 1024 * 1024), // Random 0-2GB used
        status: 'healthy',
      });

      res.json({ success: true, account });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
