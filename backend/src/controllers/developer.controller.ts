import { Request, Response } from 'express';
import crypto from 'crypto';
import { ApiKey } from '../models/ApiKey.js';
import { User } from '../models/User.js';
import { CryptoService } from '../services/crypto.service.js';

export class DeveloperController {
  /**
   * Lists all API keys and cloud settings for the authenticated user.
   */
  static async listKeys(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user!;
      const userId = user._id;

      const keys = await ApiKey.find({ userId }).sort({ createdAt: -1 });

      const defaultCloudName = (user.cloudName || user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '')).toLowerCase();

      res.json({
        cloudName: defaultCloudName,
        keys: keys.map((k) => ({
          _id: k._id,
          name: k.name,
          apiKey: k.apiKey,
          apiSecretPrefix: k.apiSecretPrefix,
          permissions: k.permissions,
          isActive: k.isActive,
          lastUsedAt: k.lastUsedAt,
          requestCount: k.requestCount,
          createdAt: k.createdAt,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Generates a new API Key & Secret pair.
   * Returns the plain-text secret ONCE to the user.
   */
  static async createKey(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user!;
      const userId = user._id;
      const { name, permissions } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Key name / description is required.' });
        return;
      }

      // Generate secure credentials
      const apiKey = `cld_live_${crypto.randomBytes(16).toString('hex')}`;
      const rawSecret = `sec_live_${crypto.randomBytes(24).toString('hex')}`;
      const apiSecretHash = CryptoService.hashSecret(rawSecret);
      const apiSecretPrefix = `sec_live_•••••••${rawSecret.slice(-4)}`;

      const newKey = new ApiKey({
        userId,
        name: name.trim(),
        apiKey,
        apiSecretHash,
        apiSecretPrefix,
        permissions: Array.isArray(permissions) && permissions.length > 0 ? permissions : ['upload', 'read', 'delete', 'transform'],
        isActive: true,
        requestCount: 0,
      });

      await newKey.save();

      // Ensure user has cloudName assigned
      if (!user.cloudName) {
        user.cloudName = user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        await user.save();
      }

      res.status(201).json({
        key: {
          _id: newKey._id,
          name: newKey.name,
          apiKey: newKey.apiKey,
          apiSecret: rawSecret, // Plain text returned only once!
          apiSecretPrefix: newKey.apiSecretPrefix,
          permissions: newKey.permissions,
          isActive: newKey.isActive,
          createdAt: newKey.createdAt,
        },
        cloudName: user.cloudName,
        message: 'API key created successfully. Store your API Secret securely; it will not be displayed again.',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Revokes or deletes an API key.
   */
  static async revokeKey(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { id } = req.params;

      const deleted = await ApiKey.findOneAndDelete({ _id: id, userId });
      if (!deleted) {
        res.status(404).json({ error: 'API key not found or access denied.' });
        return;
      }

      res.json({ success: true, message: 'API key revoked successfully.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Updates user custom cloudName.
   */
  static async updateCloudName(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user!;
      const { cloudName } = req.body;

      if (!cloudName || typeof cloudName !== 'string') {
        res.status(400).json({ error: 'Valid cloudName is required.' });
        return;
      }

      const clean = cloudName.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
      if (clean.length < 3) {
        res.status(400).json({ error: 'Cloud name must be at least 3 characters long.' });
        return;
      }

      // Check uniqueness
      const existing = await User.findOne({ cloudName: clean, _id: { $ne: user._id } });
      if (existing) {
        res.status(409).json({ error: 'This cloud name is already taken. Please pick another name.' });
        return;
      }

      user.cloudName = clean;
      await user.save();

      res.json({ success: true, cloudName: clean });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
