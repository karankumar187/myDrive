import { Request, Response } from 'express';
import { Types } from 'mongoose';
import crypto from 'crypto';
import { DeviceFileState } from '../models/DeviceFileState.js';
import { Device } from '../models/Device.js';
import { CryptoService } from '../services/crypto.service.js';
import { StorageEngineService } from '../services/storage-engine.service.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { ShortcutGeneratorService } from '../services/shortcut-generator.service.js';
import { getSocketIoInstance } from '../server.js';
import { CacheService } from '../services/cache.service.js';

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

      // Notify web dashboard of device check
      const io = getSocketIoInstance();
      if (io) {
        io.to(`user:${req.user._id}`).emit('device:sync_status', {
          deviceId: req.device.deviceId,
          status: 'online',
          currentSyncActivity: 'Syncing gallery...',
          lastSeenAt: new Date().toISOString(),
        });
      }

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
        console.warn('[Shortcut Upload] Unauthorized: missing user or device context');
        res.status(401).json({ error: 'Device authentication required' });
        return;
      }

      console.log(`[Shortcut Upload] Request from device: ${req.device.deviceId} (${req.device.deviceName}) - User: ${req.user.email || req.user._id}`);
      if (req.file) {
        console.log(`[Shortcut Upload] Multipart file received: name=${req.file.originalname}, size=${req.file.size}, type=${req.file.mimetype}`);
      } else if (Buffer.isBuffer(req.body)) {
        console.log(`[Shortcut Upload] Raw binary stream received: size=${req.body.length}, type=${req.headers['content-type']}`);
      } else if (req.body?.media) {
        console.log(`[Shortcut Upload] Base64 JSON received: name=${req.body.filename}, base64 len=${typeof req.body.media === 'string' ? req.body.media.length : 'not string'}`);
      } else {
        console.warn(`[Shortcut Upload] No media or file in request. req.body keys: ${Object.keys(req.body || {})}`);
      }

      let fileBuffer: Buffer | null = null;
      let mimeType = 'image/jpeg';
      let sizeBytes = 0;
      let originalName = (req.body?.filename as string) || `Media_${Date.now()}`;

      if (req.file) {
        fileBuffer = req.file.buffer;
        sizeBytes = req.file.size;
        originalName = req.body?.filename || req.file.originalname || originalName;
      } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        fileBuffer = req.body;
        sizeBytes = req.body.length;
        const headerFilename = req.headers['x-filename'] as string | undefined;
        const queryFilename = req.query.filename as string | undefined;
        const contentDisposition = req.headers['content-disposition'] as string | undefined;
        let cdFilename: string | undefined;
        if (contentDisposition) {
          const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(contentDisposition);
          if (match) cdFilename = decodeURIComponent(match[1]);
        }
        originalName = headerFilename
          ? decodeURIComponent(headerFilename)
          : queryFilename
          ? decodeURIComponent(queryFilename)
          : cdFilename || originalName;
      } else if (req.body?.media && typeof req.body.media === 'string') {
        const base64Data = req.body.media.replace(/^data:[^;]+;base64,/, '');
        fileBuffer = Buffer.from(base64Data, 'base64');
        sizeBytes = fileBuffer.length;
        console.log(`[Shortcut Upload] Decoded base64 buffer: ${sizeBytes} bytes`);
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        res.status(400).json({ error: 'No media file provided in request' });
        return;
      }

      // Auto-detect format from magic bytes & ensure proper extension
      const detected = ShortcutController.detectMediaFormat(
        fileBuffer,
        originalName,
        req.file?.mimetype || (typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined) || req.body?.mimeType
      );
      mimeType = detected.mimeType;
      originalName = detected.filename;
      console.log(`[Shortcut Upload] Processing ${originalName} (${sizeBytes} bytes, ${mimeType})`);

      const deviceAssetId =
        (req.body?.deviceAssetId as string) ||
        (req.headers['x-device-asset-id'] as string) ||
        originalName ||
        `iphone_${Date.now()}`;

      // Compute raw SHA-256 for instant deduplication
      const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      const targetFolderId = req.device?.policy?.targetFolderId
        ? new Types.ObjectId(req.device.policy.targetFolderId)
        : null;

      // Generate auto-rotated thumbnail for image uploads
      let thumbnailBase64: string | undefined;
      if (mimeType.startsWith('image/')) {
        try {
          const sharp = (await import('sharp')).default;
          const thumbBuffer = await sharp(fileBuffer)
            .rotate() // Automatically rotates based on EXIF Orientation!
            .resize(360, 360, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toBuffer();
          thumbnailBase64 = `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;
          console.log(`[Shortcut Upload] Generated auto-rotated thumbnail (${thumbBuffer.length} bytes) for ${originalName}`);
        } catch (err) {
          console.warn('[Shortcut Upload] Sharp thumbnail generation failed:', err);
        }
      }

      // Check if duplicate already exists
      const existingDuplicate = await StorageEngineService.findExistingDuplicate(req.user._id, contentHash);
      if (existingDuplicate) {
        // Link existing file without re-uploading bytes to Google Drive!
        await StorageEngineService.finalizeUpload({
          userId: req.user._id,
          folderId: targetFolderId,
          filename: originalName,
          mimeType,
          sizeBytes,
          contentHash,
          storageAccountId: existingDuplicate.versions[0].storageAccountId,
          providerFileId: existingDuplicate.versions[0].providerFileId,
          deviceId: req.device.deviceId,
          deviceAssetId,
          metadata: thumbnailBase64 ? { thumbnail: thumbnailBase64 } : undefined,
        });

        // Invalidate user cache & broadcast real-time Socket.IO notification
        await CacheService.invalidateUser(req.user._id.toString());
        const io = getSocketIoInstance();
        if (io) {
          io.to(`user:${req.user._id}`).emit('file:uploaded', {
            fileId: existingDuplicate._id,
            filename: originalName,
            sizeBytes,
            isDuplicate: true,
            thumbnail: thumbnailBase64,
          });
          io.to(`user:${req.user._id}`).emit('device:sync_status', {
            deviceId: req.device.deviceId,
            status: 'online',
            currentSyncActivity: `Synced ${originalName}`,
            lastSeenAt: new Date().toISOString(),
          });
        }

        console.log(`[Shortcut Upload DUPLICATE] ${originalName} (${contentHash.substring(0, 8)}) already in cloud. Skipped.`);
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

      // Upload to Google Drive
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
          body: Readable.from(fileBuffer),
        },
      });

      const providerFileId = driveResponse.data.id || `file_${Date.now()}`;

      // Record in unified cloud library
      const { file: savedFile } = await StorageEngineService.finalizeUpload({
        userId: req.user._id,
        folderId: targetFolderId,
        filename: originalName,
        mimeType,
        sizeBytes,
        contentHash,
        storageAccountId: targetAccount._id,
        providerFileId,
        deviceId: req.device.deviceId,
        deviceAssetId,
        metadata: thumbnailBase64 ? { thumbnail: thumbnailBase64 } : undefined,
      });

      // Invalidate user cache & broadcast real-time Socket.IO notification
      await CacheService.invalidateUser(req.user._id.toString());
      const io = getSocketIoInstance();
      if (io) {
        io.to(`user:${req.user._id}`).emit('file:uploaded', {
          fileId: savedFile._id,
          filename: savedFile.filename,
          sizeBytes: savedFile.sizeBytes,
          isDuplicate: false,
        });
        io.to(`user:${req.user._id}`).emit('device:sync_status', {
          deviceId: req.device.deviceId,
          status: 'online',
          currentSyncActivity: `Backed up ${savedFile.filename}`,
          lastSeenAt: new Date().toISOString(),
        });
      }

      console.log(`[Shortcut Upload SUCCESS] Saved file ${savedFile.filename} (${savedFile._id}) to account ${targetAccount.accountEmail || targetAccount._id}`);
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

  /**
   * Generates and serves a pre-configured Apple Shortcuts .shortcut plist file.
   * The file has Device ID, Device Key, and Server URL baked in — zero manual setup.
   * The user opens this link on their iPhone → iOS auto-imports it into the Shortcuts app.
   *
   * Query params:
   *   ?type=auto-sync  (default) → "myDrive Auto Sync" shortcut
   *   ?type=upload               → "myDrive Upload" shortcut (manual picker)
   *   ?deviceName=My iPhone      → name to register device under (optional, default "My iPhone")
   *
   * Auth: requireUserAuth (JWT Bearer token via Authorization header or ?token= query param)
   */
  static async downloadShortcut(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      const type = (req.query.type as string) || 'auto-sync';
      const deviceName = (req.query.deviceName as string) || 'My iPhone';

      const serverUrl = (process.env.CLOUDFLARE_WORKER_URL || process.env.FRONTEND_URL || 'https://drive-edge-cache.karan9302451907.workers.dev').replace(/\/+$/, '');

      // Register a new iPhone device and generate a fresh key
      const deviceId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const { key: rawApiKey, hash: apiKeyHash, prefix: apiKeyPrefix } = CryptoService.generateDeviceKey('dkey_iphone');

      await Device.create({
        userId: req.user._id,
        deviceId,
        apiKeyHash,
        apiKeyPrefix,
        deviceName,
        deviceType: 'iphone',
        status: 'online',
        lastSeenAt: new Date(),
        policy: {
          uploadFolders: ['Camera', 'Screenshots'],
          wifiOnly: true,
          chargingOnly: false,
          autoDeleteLocalAfterBackup: false,
          downloadMode: 'cloud_only',
          autoDownloadFolders: [],
          deletionMode: 'keep_in_cloud',
          syncPhotos: true,
          syncVideos: true,
          syncDocuments: true,
          syncOthers: false,
          pairedDeviceRules: [],
        },
      });

      // Generate the shortcut plist with credentials embedded
      let plistXml: string;
      let filename: string;

      if (type === 'upload') {
        plistXml = ShortcutGeneratorService.generateUploadShortcut(serverUrl, deviceId, rawApiKey);
        filename = 'myDrive Upload.shortcut';
      } else {
        plistXml = ShortcutGeneratorService.generateAutoSyncShortcut(serverUrl, deviceId, rawApiKey);
        filename = 'myDrive Auto Sync.shortcut';
      }

      // Serve as a downloadable .shortcut file — iOS Shortcuts app intercepts this automatically
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(plistXml, 'utf8'));
    } catch (error: any) {
      console.error('Shortcut download error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Sniffs magic bytes to accurately detect format for video (MOV, MP4) and images (HEIC, JPEG, PNG, GIF, WEBP).
   * Automatically adds the extension to the filename if omitted.
   */
  private static detectMediaFormat(
    buffer: Buffer,
    originalFilename: string,
    providedMime?: string
  ): { mimeType: string; filename: string } {
    let mimeType = providedMime && providedMime !== 'application/octet-stream' ? providedMime : 'image/jpeg';
    let ext = '';

    if (buffer.length >= 8) {
      const boxType = buffer.subarray(4, 8).toString('ascii');
      if (boxType === 'ftyp') {
        const brand = buffer.length >= 12 ? buffer.subarray(8, 12).toString('ascii').toLowerCase() : '';
        if (brand.startsWith('qt') || brand.startsWith('moov')) {
          mimeType = 'video/quicktime';
          ext = '.mov';
        } else if (brand.startsWith('heic') || brand.startsWith('mif1')) {
          mimeType = 'image/heic';
          ext = '.heic';
        } else {
          mimeType = 'video/mp4';
          ext = '.mp4';
        }
      } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        mimeType = 'image/jpeg';
        ext = '.jpg';
      } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        mimeType = 'image/png';
        ext = '.png';
      } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        mimeType = 'image/gif';
        ext = '.gif';
      } else if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer.length >= 12 &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      ) {
        mimeType = 'image/webp';
        ext = '.webp';
      }
    }

    let filename = originalFilename;
    const hasValidExt = /\.(jpe?g|png|heic|mov|mp4|gif|webp|m4v)$/i.test(filename);
    if (!hasValidExt && ext) {
      filename = `${filename}${ext}`;
    } else if (hasValidExt) {
      const lower = filename.toLowerCase();
      if (lower.endsWith('.mov')) mimeType = 'video/quicktime';
      else if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) mimeType = 'video/mp4';
      else if (lower.endsWith('.heic')) mimeType = 'image/heic';
      else if (lower.endsWith('.png')) mimeType = 'image/png';
      else if (lower.endsWith('.gif')) mimeType = 'image/gif';
      else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mimeType = 'image/jpeg';
      else if (lower.endsWith('.webp')) mimeType = 'image/webp';
    }

    return { mimeType, filename };
  }
}

