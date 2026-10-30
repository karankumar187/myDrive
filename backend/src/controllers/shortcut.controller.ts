import { Request, Response } from 'express';
import { Types } from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { File } from '../models/File.js';
import { Tombstone } from '../models/Tombstone.js';
import { DeviceFileState } from '../models/DeviceFileState.js';
import { Device } from '../models/Device.js';
import { CryptoService } from '../services/crypto.service.js';
import { StorageEngineService } from '../services/storage-engine.service.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { ShortcutGeneratorService } from '../services/shortcut-generator.service.js';
import { getSocketIoInstance } from '../server.js';
import { CacheService } from '../services/cache.service.js';

const STAGING_DIR = path.resolve(process.cwd(), 'uploads', 'staging');
if (!fs.existsSync(STAGING_DIR)) {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
}

interface StagedUploadTask {
  userId: Types.ObjectId;
  deviceId: string;
  deviceAssetId: string;
  targetFolderId: Types.ObjectId | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  thumbnailBase64?: string;
  tempFilePath: string;
}

/**
 * Background queue for streaming large media files to Google Drive asynchronously.
 * Prevents iOS Shortcuts client-side 60-second timeouts by allowing the server
 * to respond 200 OK immediately once bytes are received on the server.
 */
class ShortcutUploadQueue {
  private static queue: StagedUploadTask[] = [];
  private static isProcessing = false;

  static enqueue(task: StagedUploadTask) {
    this.queue.push(task);
    this.processNext();
  }

  private static async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      try {
        console.log(`[Shortcut Queue] Starting background Google Drive upload for ${task.originalName} (${(task.sizeBytes / (1024 * 1024)).toFixed(2)} MB)...`);

        const targetAccount = await StorageEngineService.selectTargetAccount(task.userId, task.sizeBytes);

        // Log that Google Drive upload is in progress
        await Device.findOneAndUpdate(
          { deviceId: task.deviceId, userId: task.userId },
          {
            $set: {
              status: 'syncing',
              currentSyncActivity: `Streaming ${task.originalName} (${(task.sizeBytes / (1024 * 1024)).toFixed(1)} MB) to Google Drive...`,
              lastSeenAt: new Date(),
            },
            $push: {
              syncLogs: {
                $each: [
                  {
                    timestamp: new Date(),
                    message: `Streaming ${task.originalName} to Google Drive`,
                    level: 'processing',
                    filename: task.originalName,
                    sizeBytes: task.sizeBytes,
                    details: `Selected storage account: ${targetAccount.accountEmail || targetAccount._id}`,
                  },
                ],
                $slice: -1000,
              },
            },
          }
        );

        const oauth2Client = GoogleDriveService.getOAuth2Client(targetAccount);
        const { google } = await import('googleapis');
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const driveResponse = await drive.files.create({
          requestBody: {
            name: task.originalName,
            mimeType: task.mimeType,
          },
          media: {
            mimeType: task.mimeType,
            body: fs.createReadStream(task.tempFilePath),
          },
        });

        const providerFileId = driveResponse.data.id || `file_${Date.now()}`;

        const { file: savedFile } = await StorageEngineService.finalizeUpload({
          userId: task.userId,
          folderId: task.targetFolderId,
          filename: task.originalName,
          mimeType: task.mimeType,
          sizeBytes: task.sizeBytes,
          contentHash: task.contentHash,
          storageAccountId: targetAccount._id,
          providerFileId,
          deviceId: task.deviceId,
          deviceAssetId: task.deviceAssetId,
          metadata: task.thumbnailBase64 ? { thumbnail: task.thumbnailBase64 } : undefined,
        });

        await CacheService.invalidateUser(task.userId.toString());

        // Persist completion log to Device
        await Device.findOneAndUpdate(
          { deviceId: task.deviceId, userId: task.userId },
          {
            $set: {
              status: 'online',
              currentSyncActivity: `Backed up ${savedFile.filename}`,
              lastSeenAt: new Date(),
              lastSyncCompletedAt: new Date(),
            },
            $push: {
              syncLogs: {
                $each: [
                  {
                    timestamp: new Date(),
                    message: `✓ Backed up ${savedFile.filename} to cloud`,
                    level: 'uploaded',
                    filename: savedFile.filename,
                    sizeBytes: task.sizeBytes,
                    details: `Stored in Google Drive (${targetAccount.accountEmail || targetAccount._id}) • Provider File ID: ${providerFileId}`,
                  },
                ],
                $slice: -1000,
              },
            },
          }
        );

        const io = getSocketIoInstance();
        if (io) {
          io.to(`user:${task.userId}`).emit('file:uploaded', {
            fileId: savedFile._id,
            filename: savedFile.filename,
            sizeBytes: savedFile.sizeBytes,
            isDuplicate: false,
          });
          io.to(`user:${task.userId}`).emit('device:sync_status', {
            deviceId: task.deviceId,
            status: 'online',
            currentSyncActivity: `Backed up ${savedFile.filename}`,
            lastSeenAt: new Date().toISOString(),
          });
        }

        console.log(`[Shortcut Queue SUCCESS] ${task.originalName} (${savedFile._id}) saved to Google Drive (${targetAccount.accountEmail || targetAccount._id})`);
      } catch (err: any) {
        console.error(`[Shortcut Queue ERROR] Failed background upload for ${task.originalName}:`, err);
        await Device.findOneAndUpdate(
          { deviceId: task.deviceId, userId: task.userId },
          {
            $set: {
              status: 'online',
              currentSyncActivity: `Error uploading ${task.originalName}: ${err.message}`,
              lastSeenAt: new Date(),
            },
            $push: {
              syncLogs: {
                $each: [
                  {
                    timestamp: new Date(),
                    message: `⚠️ Cloud backup failed: ${task.originalName}`,
                    level: 'error',
                    filename: task.originalName,
                    sizeBytes: task.sizeBytes,
                    details: err.message || 'Unknown network error during Google Drive upload',
                  },
                ],
                $slice: -1000,
              },
            },
          }
        );
      } finally {
        fs.promises.unlink(task.tempFilePath).catch(() => {});
      }
    }

    this.isProcessing = false;
  }
}

export class ShortcutController {
  /**
   * Fast pre-flight deduplication check for Apple Shortcuts.
   * Checks if an image is already in user's active cloud storage by filename or deviceAssetId in ~10ms.
   * Responds with plain text "EXISTS" or "NEW".
   * This completely prevents Shortcuts from transmitting heavy 15MB-50MB binary files just to be told it's a duplicate!
   */
  static async checkFile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.device) {
        res.status(401).send('UNAUTHORIZED');
        return;
      }

      const rawName = (
        (req.headers['x-filename'] as string) ||
        (req.query.filename as string) ||
        (req.query.name as string) ||
        ''
      ).trim();

      if (!rawName) {
        res.send('NEW');
        return;
      }

      // Check without extension as well (e.g. IMG_0882 matches IMG_0882.JPG, IMG_0882.HEIC, IMG_0882.MOV)
      const baseName = rawName.replace(/\.[^/.]+$/, '');
      const escapedRaw = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Check active files in MongoDB
      const existing = await File.findOne({
        userId: req.user._id,
        isTrash: false,
        $or: [
          { filename: { $regex: new RegExp(`^${escapedRaw}$`, 'i') } },
          { filename: { $regex: new RegExp(`^${escapedBase}\\.[a-zA-Z0-9]+$`, 'i') } },
        ],
      }).select('_id filename sizeBytes');

      let existingState = null;
      if (!existing) {
        existingState = await DeviceFileState.findOne({
          userId: req.user._id,
          deviceId: req.device.deviceId,
          deviceAssetId: { $in: [rawName, baseName] },
        });
      }

      if (existing || existingState) {
        await Device.findOneAndUpdate(
          { deviceId: req.device.deviceId, userId: req.user._id },
          {
            $set: {
              status: 'syncing',
              currentSyncActivity: `Skipped ${rawName} (duplicate detected)`,
              lastSeenAt: new Date(),
            },
            $push: {
              syncLogs: {
                $each: [
                  {
                    timestamp: new Date(),
                    message: `⚡ Duplicate detected: ${rawName}`,
                    level: 'duplicate',
                    filename: rawName,
                    sizeBytes: existing?.sizeBytes || null,
                    details: 'Pre-flight check found copy already stored in cloud library. Skipped upload (0 MB transferred).',
                  },
                ],
                $slice: -1000,
              },
            },
          }
        );

        const io = getSocketIoInstance();
        if (io) {
          io.to(`user:${req.user._id}`).emit('device:sync_status', {
            deviceId: req.device.deviceId,
            status: 'syncing',
            currentSyncActivity: `Skipped ${rawName} (duplicate detected)`,
            lastSeenAt: new Date().toISOString(),
          });
        }

        console.log(`[Shortcut Fast Check] ${rawName} already in cloud. Skipping upload.`);
        res.setHeader('Content-Type', 'text/plain');
        res.send('EXISTS');
        return;
      }

      // New photo or revival candidate: signal Shortcut to proceed with upload
      console.log(`[Shortcut Fast Check] ${rawName} is NEW. Proceeding with upload.`);

      await Device.findOneAndUpdate(
        { deviceId: req.device.deviceId, userId: req.user._id },
        {
          $set: {
            status: 'syncing',
            currentSyncActivity: `Processing ${rawName}...`,
            lastSeenAt: new Date(),
          },
          $push: {
            syncLogs: {
              $each: [
                {
                  timestamp: new Date(),
                  message: `Processing: ${rawName} (preparing upload)`,
                  level: 'processing',
                  filename: rawName,
                  sizeBytes: null,
                  details: 'New photo not found in cloud. Converting and initiating upload from camera roll...',
                },
              ],
              $slice: -1000,
            },
          },
        }
      );

      const io = getSocketIoInstance();
      if (io) {
        io.to(`user:${req.user._id}`).emit('device:sync_status', {
          deviceId: req.device.deviceId,
          status: 'syncing',
          currentSyncActivity: `Processing ${rawName}...`,
          lastSeenAt: new Date().toISOString(),
        });
      }

      res.setHeader('Content-Type', 'text/plain');
      res.send('NEW');
    } catch (error: any) {
      console.error('[Shortcut Fast Check ERROR]', error);
      res.status(500).send('ERROR');
    }
  }

  /**
   * Returns a list of all actively synced filenames and asset IDs for this user.
   */
  static async syncedAssets(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.device) {
        res.status(401).json({ error: 'Device authentication required' });
        return;
      }

      const files = await File.find({
        userId: req.user._id,
        isTrash: false,
      }).select('filename sizeBytes');

      const names = files.map((f) => f.filename);
      res.json({
        total: files.length,
        filenames: names,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Batch pre-flight check endpoint:
   * Accepts an array of filenames or asset IDs, returns which are already in cloud and which are unsynced.
   */
  static async checkBatch(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.device) {
        res.status(401).json({ error: 'Device authentication required' });
        return;
      }

      const items = (req.body?.items || req.body?.filenames || []) as any[];
      const namesToCheck: string[] = items.map((it) => (typeof it === 'string' ? it : it.name || it.filename || ''));

      const activeFiles = await File.find({
        userId: req.user._id,
        isTrash: false,
        filename: { $in: namesToCheck },
      }).select('filename');

      const activeStates = await DeviceFileState.find({
        userId: req.user._id,
        deviceAssetId: { $in: namesToCheck },
      }).select('deviceAssetId');

      const existingSet = new Set<string>();
      activeFiles.forEach((f) => {
        existingSet.add(f.filename.toLowerCase());
      });
      activeStates.forEach((s) => {
        if (s.deviceAssetId) existingSet.add(s.deviceAssetId.toLowerCase());
      });

      const duplicates = namesToCheck.filter((n) => existingSet.has(n.toLowerCase()));
      const unsynced = namesToCheck.filter((n) => !existingSet.has(n.toLowerCase()));

      res.json({
        total: namesToCheck.length,
        syncedCount: duplicates.length,
        unsyncedCount: unsynced.length,
        duplicates,
        unsynced,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Shortcut sync-check: Shortcut asks for last backup timestamp so it only searches recent photos.
   */
  static async syncCheck(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.device) {
        res.status(401).json({ error: 'Device authentication required' });
        return;
      }

      // Checkpoint date: strictly uses device.lastSyncedPhotoDate checkpoint (defaults to 2000-01-01 if null/reset)
      const lastSyncedDate = req.device.lastSyncedPhotoDate
        ? req.device.lastSyncedPhotoDate.toISOString()
        : '2000-01-01T00:00:00.000Z';

      // Record sync start in Device document
      await Device.findOneAndUpdate(
        { deviceId: req.device.deviceId, userId: req.user._id },
        {
          $set: {
            status: 'syncing',
            currentSyncActivity: 'Checking camera roll for new photos...',
            lastSeenAt: new Date(),
            lastSyncStartedAt: new Date(),
          },
          $push: {
            syncLogs: {
              $each: [{ timestamp: new Date(), message: `🔄 Started sync check from ${req.device.deviceName}` }],
              $slice: -1000,
            },
          },
        }
      );

      // Notify web dashboard of device check
      const io = getSocketIoInstance();
      if (io) {
        io.to(`user:${req.user._id}`).emit('device:sync_status', {
          deviceId: req.device.deviceId,
          status: 'syncing',
          currentSyncActivity: 'Checking camera roll for new photos...',
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

      // Extract photo creation timestamp to continuously advance sync checkpoint
      let photoTakenDate: Date | null = null;
      if (req.body?.photoDate) {
        const parsed = new Date(req.body.photoDate);
        if (!isNaN(parsed.getTime())) photoTakenDate = parsed;
      }
      if (!photoTakenDate && mimeType.startsWith('image/')) {
        try {
          const sharp = (await import('sharp')).default;
          const meta = await sharp(fileBuffer).metadata();
          if (meta.exif) {
            const exifStr = meta.exif.toString('binary');
            const dateMatch = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(exifStr);
            if (dateMatch) {
              const [, y, m, day, h, min, s] = dateMatch;
              photoTakenDate = new Date(`${y}-${m}-${day}T${h}:${min}:${s}`);
            }
          }
        } catch {
          // ignore
        }
      }
      if (!photoTakenDate || isNaN(photoTakenDate.getTime())) {
        photoTakenDate = new Date();
      }

      // Check if duplicate already exists (by cryptographic contentHash, or filename + sizeBytes)
      const existingDuplicate = await StorageEngineService.findExistingDuplicate(
        req.user._id,
        contentHash,
        originalName,
        sizeBytes
      );
      if (existingDuplicate) {
        if ((existingDuplicate as any).isTombstone) {
          // User previously purged this file, but is now syncing it from camera roll — clear tombstone and proceed with fresh upload
          await Tombstone.deleteOne({ _id: existingDuplicate._id });
        } else if (existingDuplicate.isTrash) {
          // File was in Trash (e.g. user deleted a bad/rotated upload), and is now syncing the clean original from phone!
          // Revive from Trash, update with the phone's auto-rotated upright thumbnail, and restore to active library!
          await File.updateOne(
            { _id: existingDuplicate._id },
            {
              $set: {
                isTrash: false,
                deletedAt: null,
                ...(thumbnailBase64 ? { 'metadata.thumbnail': thumbnailBase64 } : {}),
              },
              $addToSet: { sourceDeviceIds: req.device.deviceId },
            }
          );

          await Device.findOneAndUpdate(
            { deviceId: req.device.deviceId, userId: req.user._id },
            {
              $set: {
                status: 'online',
                currentSyncActivity: `Restored ${originalName} from trash`,
                lastSeenAt: new Date(),
              },
              $push: {
                syncLogs: {
                  $each: [
                    {
                      timestamp: new Date(),
                      message: `🔄 Revived from trash: ${originalName}`,
                      level: 'revived',
                      filename: originalName,
                      sizeBytes,
                      details: 'Restored clean upright photo from phone to active library. Trashed copy replaced.',
                    },
                  ],
                  $slice: -1000,
                },
              },
            }
          );

          await CacheService.invalidateUser(req.user._id.toString());
          const io = getSocketIoInstance();
          if (io) {
            io.to(`user:${req.user._id}`).emit('file:uploaded', {
              fileId: existingDuplicate._id,
              filename: originalName,
              sizeBytes,
              isDuplicate: false,
              thumbnail: thumbnailBase64,
            });
            io.to(`user:${req.user._id}`).emit('device:sync_status', {
              deviceId: req.device.deviceId,
              status: 'online',
              currentSyncActivity: `Synced ${originalName}`,
              lastSeenAt: new Date().toISOString(),
            });
          }

          console.log(`[Shortcut Upload REVIVED] Revived trashed ${originalName} with clean phone copy.`);
          res.json({
            status: 'success',
            isDuplicate: false,
            message: 'Restored from trash with clean orientation',
            filename: originalName,
          });
          return;
        } else {
          // Active file: Link existing file without re-uploading bytes to Google Drive!
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

          await Device.findOneAndUpdate(
            { deviceId: req.device.deviceId, userId: req.user._id },
            {
              $set: {
                status: 'online',
                currentSyncActivity: `Synced ${originalName} (linked duplicate)`,
                lastSeenAt: new Date(),
              },
              $max: {
                lastSyncedPhotoDate: photoTakenDate,
              },
              $push: {
                syncLogs: {
                  $each: [
                    {
                      timestamp: new Date(),
                      message: `⚡ Duplicate detected: ${originalName}`,
                      level: 'duplicate',
                      filename: originalName,
                      sizeBytes,
                      details: `SHA-256 hash match (${contentHash.substring(0, 10)}...). Linked device without re-uploading bytes to cloud.`,
                    },
                  ],
                  $slice: -1000,
                },
              },
            }
          );

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
      }

      // Fast response for iOS Shortcuts:
      // Stage file to disk and enqueue for asynchronous Google Drive upload.
      // This guarantees iOS Shortcuts never hits its hardcoded 60-second request timeout!
      const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const tempFileName = `staged_${Date.now()}_${contentHash.substring(0, 10)}_${safeName}`;
      const tempFilePath = path.join(STAGING_DIR, tempFileName);

      await fs.promises.writeFile(tempFilePath, fileBuffer);

      ShortcutUploadQueue.enqueue({
        userId: req.user._id,
        deviceId: req.device.deviceId,
        deviceAssetId,
        targetFolderId,
        originalName,
        mimeType,
        sizeBytes,
        contentHash,
        thumbnailBase64,
        tempFilePath,
      });

      await Device.findOneAndUpdate(
        { deviceId: req.device.deviceId, userId: req.user._id },
        {
          $set: {
            status: 'syncing',
            currentSyncActivity: `Uploaded ${originalName} (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB)`,
            lastSeenAt: new Date(),
          },
          $max: {
            lastSyncedPhotoDate: photoTakenDate,
          },
          $push: {
            syncLogs: {
              $each: [
                {
                  timestamp: new Date(),
                  message: `✓ Uploaded: ${originalName} (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB)`,
                  level: 'uploaded',
                  filename: originalName,
                  sizeBytes,
                  details: `File received on server (${mimeType}) • Queued for async Google Drive streaming`,
                },
              ],
              $slice: -1000,
            },
          },
        }
      );

      console.log(`[Shortcut Upload QUEUED] ${originalName} (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB) staged for background Google Drive backup`);
      res.json({
        status: 'success',
        isDuplicate: false,
        message: 'Successfully backed up to personal cloud',
        filename: originalName,
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

      // Check if user specified deviceId or already has an existing iPhone registered
      let deviceId = (req.query.deviceId as string) || '';
      let rawApiKey: string;

      let targetDevice = deviceId
        ? await Device.findOne({ deviceId, userId: req.user._id })
        : await Device.findOne({ deviceName, deviceType: 'iphone', userId: req.user._id });

      if (targetDevice) {
        // Reuse existing device so device cards don't multiply on every download
        const { key, hash, prefix } = CryptoService.generateDeviceKey('dkey_iphone');
        targetDevice.apiKeyHash = hash;
        targetDevice.apiKeyPrefix = prefix;
        targetDevice.status = 'online';
        targetDevice.lastSeenAt = new Date();
        await targetDevice.save();
        deviceId = targetDevice.deviceId;
        rawApiKey = key;
      } else {
        // Register a new iPhone device
        deviceId = deviceId || `dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const { key, hash, prefix } = CryptoService.generateDeviceKey('dkey_iphone');
        rawApiKey = key;

        await Device.create({
          userId: req.user._id,
          deviceId,
          apiKeyHash: hash,
          apiKeyPrefix: prefix,
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
      }

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
      if (boxType === 'ftyp' || boxType === 'moov' || boxType === 'wide' || boxType === 'mdat') {
        const brand = buffer.length >= 12 ? buffer.subarray(8, 12).toString('ascii').toLowerCase() : '';
        if (brand.startsWith('qt') || brand.startsWith('moov') || boxType === 'wide' || boxType === 'moov') {
          mimeType = 'video/quicktime';
          ext = '.mov';
        } else if (
          brand.startsWith('heic') ||
          brand.startsWith('heix') ||
          brand.startsWith('mif1') ||
          brand.startsWith('msf1') ||
          brand.startsWith('heim') ||
          brand.startsWith('heis')
        ) {
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

