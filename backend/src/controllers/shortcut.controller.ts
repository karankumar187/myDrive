import { Request, Response } from 'express';
import crypto from 'crypto';
import { DeviceFileState } from '../models/DeviceFileState.js';
import { StorageEngineService } from '../services/storage-engine.service.js';
import { GoogleDriveService } from '../services/gdrive.service.js';

export class ShortcutController {
  /**
   * Shortcut sync-check: Shortcut asks for last backup timestamp so it only searches recent photos.
   */
  static async syncCheck(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.device) {
        res.status(401).json({ error: 'Device authentication required' });
        return;
      }

      // Find the most recently backed up file for this device
      const latestState = await DeviceFileState.findOne({
        userId: req.user._id,
        deviceId: req.device.deviceId,
      }).sort({ createdAt: -1 });

      const lastSyncedDate = latestState ? latestState.createdAt.toISOString() : '2000-01-01T00:00:00.000Z';

      res.json({
        deviceName: req.device.deviceName,
        lastSyncedDate,
        wifiOnly: req.device.policy.wifiOnly,
        status: 'ready',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Direct upload endpoint for Apple Shortcuts 'Get Contents of URL' POST request.
   */
  static async uploadFromShortcut(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.device) {
        res.status(401).json({ error: 'Device authentication required' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No media file provided in request' });
        return;
      }

      const deviceAssetId = (req.body.deviceAssetId as string) || `iphone_${Date.now()}`;
      const originalName = req.body.filename || file.originalname || `Photo_${Date.now()}.jpg`;
      const mimeType = file.mimetype || 'image/jpeg';
      const sizeBytes = file.size;

      // Compute raw SHA-256 for instant deduplication
      const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

      // Check if duplicate already exists
      const existingDuplicate = await StorageEngineService.findExistingDuplicate(req.user._id, contentHash);
      if (existingDuplicate) {
        // Link existing file without re-uploading bytes to Google Drive!
        await StorageEngineService.finalizeUpload({
          userId: req.user._id,
          filename: originalName,
          mimeType,
          sizeBytes,
          contentHash,
          storageAccountId: existingDuplicate.versions[0].storageAccountId,
          providerFileId: existingDuplicate.versions[0].providerFileId,
          deviceId: req.device.deviceId,
          deviceAssetId,
        });

        res.json({
          status: 'success',
          isDuplicate: true,
          message: 'Exact duplicate already in cloud. Skipped upload.',
          fileId: existingDuplicate._id,
        });
        return;
      }

      // Select target Google Drive account
      const targetAccount = await StorageEngineService.selectTargetAccount(req.user._id, sizeBytes);

      let providerFileId = `shortcut_${Date.now()}`;

      const isMock =
        targetAccount.googleDriveAccountId.startsWith('sub_mock_') ||
        targetAccount.accountEmail.includes('mock.drive') ||
        targetAccount.encryptedRefreshToken === 'mock_refresh_token_dev' ||
        process.env.GDRIVE_CLIENT_ID === 'mock_gdrive_client_id';

      // If real account, upload to Google Drive
      if (!isMock) {
        const oauth2Client = GoogleDriveService.getOAuth2Client(targetAccount);
        const { google } = await import('googleapis');
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        const { Readable } = await import('stream');

        const driveResponse = await drive.files.create({
          requestBody: {
            name: originalName,
            mimeType,
          },
          media: {
            mimeType,
            body: Readable.from(file.buffer),
          },
        });

        providerFileId = driveResponse.data.id || providerFileId;
      }

      // Record in unified cloud library
      const { file: savedFile } = await StorageEngineService.finalizeUpload({
        userId: req.user._id,
        filename: originalName,
        mimeType,
        sizeBytes,
        contentHash,
        storageAccountId: targetAccount._id,
        providerFileId,
        deviceId: req.device.deviceId,
        deviceAssetId,
      });

      res.json({
        status: 'success',
        isDuplicate: false,
        message: 'Successfully backed up to personal cloud',
        fileId: savedFile._id,
        filename: savedFile.filename,
      });
    } catch (error: any) {
      console.error('Shortcut upload error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Reconciles deletions: Apple Shortcut sends current local photo IDs;
   * missing files are marked "Cloud Only" without being deleted from Google Drive.
   */
  static async reconcileDeletions(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.device) {
        res.status(401).json({ error: 'Device authentication required' });
        return;
      }

      const { currentLocalAssetIds } = req.body;
      if (!Array.isArray(currentLocalAssetIds)) {
        res.status(400).json({ error: 'currentLocalAssetIds must be an array of string IDs' });
        return;
      }

      const idSet = new Set(currentLocalAssetIds);

      // Find all file states previously tracked for this device
      const states = await DeviceFileState.find({
        userId: req.user._id,
        deviceId: req.device.deviceId,
        isLocallyPresent: true,
      });

      let markedCloudOnlyCount = 0;

      for (const state of states) {
        if (state.deviceAssetId && !idSet.has(state.deviceAssetId)) {
          state.isLocallyPresent = false;
          await state.save();
          markedCloudOnlyCount++;
        }
      }

      res.json({
        status: 'success',
        reconciledCount: states.length,
        markedCloudOnlyCount,
        message: `${markedCloudOnlyCount} items marked as Cloud Only (preserved safely in cloud).`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
