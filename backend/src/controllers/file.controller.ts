import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import { File } from '../models/File.js';
import { Folder } from '../models/Folder.js';
import { StorageAccount } from '../models/StorageAccount.js';
import { StorageEngineService } from '../services/storage-engine.service.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { getSocketIoInstance } from '../server.js';
import { CacheService } from '../services/cache.service.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class FileController {
  /**
   * Step 1 of Upload: Allocates target Drive account and returns direct Resumable Upload URL.
   * Also checks if identical file hash already exists (instant deduplication).
   */
  static async initiateUpload(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { filename, mimeType, sizeBytes, contentHash, folderId, isEncrypted } = req.body;

      if (!filename || !mimeType || !sizeBytes || !contentHash) {
        res.status(400).json({ error: 'Missing required fields: filename, mimeType, sizeBytes, contentHash' });
        return;
      }

      // Check for exact content duplicate (Zero-Knowledge Deduplication)
      const existingDuplicate = await StorageEngineService.findExistingDuplicate(userId, contentHash);
      if (existingDuplicate) {
        // Instant deduplication: No bytes need to be uploaded to Google Drive!
        res.json({
          isDuplicate: true,
          message: 'Exact duplicate already exists in your cloud library. Byte upload skipped!',
          fileId: existingDuplicate._id,
        });
        return;
      }

      // Select target Google Drive account with sufficient room
      const targetAccount = await StorageEngineService.selectTargetAccount(userId, sizeBytes);

      // Unique opaque filename for Google Drive (opaque for Zero-Knowledge privacy)
      const driveOpaqueName = isEncrypted
        ? `blob_${Date.now()}_${new Types.ObjectId().toString()}.enc`
        : `file_${Date.now()}_${filename}`;

      const clientOrigin = (req.headers.origin as string) || (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
      const resumableSessionUri = await GoogleDriveService.createResumableUploadSession(targetAccount, {
        name: driveOpaqueName,
        mimeType: isEncrypted ? 'application/octet-stream' : mimeType,
        sizeBytes,
        origin: clientOrigin,
      });

      res.json({
        isDuplicate: false,
        storageAccountId: targetAccount._id,
        uploadSessionUrl: resumableSessionUri,
        targetAccountEmail: targetAccount.accountEmail,
        driveOpaqueName,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Step 2 of Upload: Client notifies backend that byte upload to Google Drive finished.
   */
  static async completeUpload(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const {
        filename,
        mimeType,
        sizeBytes,
        contentHash,
        storageAccountId,
        providerFileId,
        folderId,
        deviceAssetId,
        isEncrypted,
        iv,
        metadata,
      } = req.body;

      const deviceId = req.device?.deviceId || (req.headers['x-device-id'] as string) || undefined;

      const { file, isDuplicate } = await StorageEngineService.finalizeUpload({
        userId,
        folderId: folderId ? new Types.ObjectId(folderId) : null,
        filename,
        mimeType,
        sizeBytes,
        contentHash,
        storageAccountId: new Types.ObjectId(storageAccountId),
        providerFileId: providerFileId || `file_${Date.now()}`,
        deviceId,
        deviceAssetId,
        isEncrypted: !!isEncrypted,
        iv,
        metadata,
      });

      // Emit real-time notification over Socket.io
      const io = getSocketIoInstance();
      if (io) {
        io.to(`user:${userId}`).emit('file:uploaded', {
          fileId: file._id,
          filename: file.filename,
          sizeBytes: file.sizeBytes,
          isDuplicate,
        });
      }

      // Invalidate user cache on new upload
      await CacheService.invalidateUser(userId.toString());

      res.json({ success: true, file, isDuplicate });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Lists files in a virtual folder or root, with pagination and search.
   */
  static async listFiles(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const folderId = req.query.folderId as string;
      const search = req.query.search as string;
      const isTrash = req.query.isTrash === 'true';
      const all = req.query.all === 'true';

      // Check Redis cache for standard (non-search) directory listings
      const cacheKey = `cache:user:${userId}:files:${folderId || (all ? 'all' : 'root')}:${isTrash}`;
      if (!search) {
        const cached = await CacheService.get(cacheKey);
        if (cached) {
          res.json(cached);
          return;
        }
      }

      const filter: any = {
        userId, // Strict IDOR protection
        isTrash,
      };

      if (folderId && folderId !== 'root') {
        filter.folderId = new Types.ObjectId(folderId);
      } else if (!search && !isTrash && !all) {
        filter.folderId = null; // Root folder
      }

      if (search) {
        filter.filename = { $regex: search, $options: 'i' };
      }

      const files = await File.find(filter).sort({ createdAt: -1 }).limit(200);

      let recentFiles: any[] = [];
      if ((!folderId || folderId === 'root') && !search && !isTrash) {
        recentFiles = await File.find({ userId, isTrash: false })
          .sort({ createdAt: -1 })
          .limit(20);
      }

      const responsePayload = { files, recentFiles };
      if (!search) {
        await CacheService.set(cacheKey, responsePayload, 120);
      }

      res.json(responsePayload);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Returns media files (photos & videos) grouped by date for the Gallery timeline.
   */
  static async getGallery(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const cacheKey = `cache:user:${userId}:gallery`;
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const mediaFilter = {
        userId,
        isTrash: false,
        $or: [{ mimeType: { $regex: '^image/' } }, { mimeType: { $regex: '^video/' } }],
      };

      const mediaFiles = await File.find(mediaFilter).sort({
        'metadata.takenAt': -1,
        createdAt: -1,
      }).limit(500);

      const payload = { media: mediaFiles };
      await CacheService.set(cacheKey, payload, 120);

      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Streams a file from Google Drive for client download or browser decryption.
   */
  static async streamFile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const file = await File.findOne({
        _id: req.params.id,
        userId, // Strict IDOR check
      });

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      const latestVersion = file.versions[file.versions.length - 1];
      if (!latestVersion) {
        res.status(404).json({ error: 'No file versions available' });
        return;
      }

      const account = await StorageAccount.findOne({
        _id: latestVersion.storageAccountId,
        userId,
      });

      if (!account) {
        res.status(404).json({ error: 'Associated storage account not found' });
        return;
      }

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);

      const driveStream = await GoogleDriveService.getFileStream(account, latestVersion.providerFileId);
      driveStream.data.pipe(res);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Soft-delete: Moves a file to Trash (stays 100% safe in Google Drive).
   */
  static async moveToTrash(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const file = await File.findOneAndUpdate(
        { _id: req.params.id, userId },
        { isTrash: true, trashedAt: new Date(), trashedByDeviceId: req.device?.deviceId || 'web' },
        { new: true }
      );

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, message: 'Moved to Trash' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Restores a file from Trash.
   */
  static async restoreFromTrash(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const file = await File.findOneAndUpdate(
        { _id: req.params.id, userId },
        { isTrash: false, trashedAt: null },
        { new: true }
      );

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, message: 'Restored from Trash' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Permanently deletes a file from Google Drive and database.
   */
  static async permanentDelete(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const file = await File.findOne({
        _id: req.params.id,
        userId,
      });

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      // Delete each physical version from Google Drive
      for (const version of file.versions) {
        try {
          const account = await StorageAccount.findById(version.storageAccountId);
          if (account) {
            await GoogleDriveService.deleteFile(account, version.providerFileId);
            await StorageAccount.findByIdAndUpdate(account._id, {
              $inc: { usedStorageBytes: -version.sizeBytes },
            });
          }
        } catch (delError) {
          console.warn(`Failed to delete physical file ${version.providerFileId}:`, delError);
        }
      }

      await File.findByIdAndDelete(file._id);
      await CacheService.invalidateUser(userId.toString());

      res.json({ success: true, message: 'Permanently purged from cloud storage' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Folder Operations: Create a new virtual folder.
   */
  static async createFolder(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { name, parentFolderId } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Folder name is required' });
        return;
      }

      let path = `/${name}/`;
      if (parentFolderId) {
        const parent = await Folder.findOne({ _id: parentFolderId, userId });
        if (parent) {
          path = `${parent.path}${name}/`;
        }
      }

      const folder = await Folder.create({
        userId,
        parentFolderId: parentFolderId ? new Types.ObjectId(parentFolderId) : null,
        name,
        path,
      });

      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, folder });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete folder: moves folder and all its contents to Trash.
   */
  static async deleteFolder(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const folderId = new Types.ObjectId(req.params.id);
      const folder = await Folder.findOne({ _id: folderId, userId });
      if (!folder) {
        res.status(404).json({ error: 'Folder not found or access denied' });
        return;
      }

      // Find all subfolder IDs recursively
      const allFolderIds: Types.ObjectId[] = [folder._id];
      const findChildFolders = async (parentId: Types.ObjectId) => {
        const children = await Folder.find({ parentFolderId: parentId, userId });
        for (const child of children) {
          allFolderIds.push(child._id);
          await findChildFolders(child._id);
        }
      };
      await findChildFolders(folder._id);

      // Mark folders as trash
      await Folder.updateMany(
        { _id: { $in: allFolderIds }, userId },
        { isTrash: true, trashedAt: new Date() }
      );

      // Move files in these folders to trash
      await File.updateMany(
        { folderId: { $in: allFolderIds }, userId },
        { isTrash: true, trashedAt: new Date() }
      );

      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, message: `Folder "${folder.name}" and contents moved to Trash` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * List all folders.
   */
  static async listFolders(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const parentFolderId = req.query.parentFolderId as string;

      // Check Redis cache for folder tree
      const cacheKey = `cache:user:${userId}:folders:${parentFolderId || 'root'}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const filter: any = {
        userId,
        isTrash: false,
      };

      let currentFolder = null;
      let breadcrumbs: Array<{ id: string | null; name: string }> = [
        { id: null, name: 'My Drive' },
      ];

      if (parentFolderId && parentFolderId !== 'root' && Types.ObjectId.isValid(parentFolderId)) {
        filter.parentFolderId = new Types.ObjectId(parentFolderId);
        currentFolder = await Folder.findOne({ _id: parentFolderId, userId });

        // Trace breadcrumbs upwards
        const trail: Array<{ id: string; name: string }> = [];
        let curr = currentFolder;
        while (curr) {
          trail.unshift({ id: curr._id.toString(), name: curr.name });
          if (curr.parentFolderId) {
            curr = await Folder.findOne({ _id: curr.parentFolderId, userId });
          } else {
            break;
          }
        }
        breadcrumbs = [{ id: null, name: 'My Drive' }, ...trail];
      } else {
        filter.parentFolderId = null;
      }

      const folders = await Folder.find(filter).sort({ name: 1 });
      const responsePayload = { folders, currentFolder, breadcrumbs };
      await CacheService.set(cacheKey, responsePayload, 180);

      res.json(responsePayload);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
