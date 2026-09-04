import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import { File } from '../models/File.js';
import { Folder } from '../models/Folder.js';
import { StorageAccount } from '../models/StorageAccount.js';
import { Device } from '../models/Device.js';
import { DeviceFileState } from '../models/DeviceFileState.js';
import { StorageEngineService } from '../services/storage-engine.service.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { getSocketIoInstance } from '../server.js';
import { CacheService } from '../services/cache.service.js';
import { google } from 'googleapis';

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
        driveOpaqueName,
        folderId,
        deviceAssetId,
        isEncrypted,
        iv,
        metadata,
      } = req.body;

      const deviceId = req.device?.deviceId || (req.headers['x-device-id'] as string) || undefined;

      const effectiveProviderId = providerFileId || driveOpaqueName || `file_${Date.now()}_${filename}`;

      const { file, isDuplicate } = await StorageEngineService.finalizeUpload({
        userId,
        folderId: folderId ? new Types.ObjectId(folderId) : null,
        filename,
        mimeType,
        sizeBytes,
        contentHash,
        storageAccountId: new Types.ObjectId(storageAccountId),
        providerFileId: effectiveProviderId,
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
   * Supports filter (all, favorites, videos, photos), search, and pagination.
   */
  static async getGallery(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { filter, search } = req.query;

      const mediaFilter: any = {
        userId,
        isTrash: false,
      };

      if (filter === 'favorites') {
        mediaFilter.isFavorite = true;
        mediaFilter.$or = [{ mimeType: { $regex: '^image/' } }, { mimeType: { $regex: '^video/' } }];
      } else if (filter === 'videos') {
        mediaFilter.mimeType = { $regex: '^video/' };
      } else if (filter === 'photos') {
        mediaFilter.mimeType = { $regex: '^image/' };
      } else {
        mediaFilter.$or = [{ mimeType: { $regex: '^image/' } }, { mimeType: { $regex: '^video/' } }];
      }

      if (search && typeof search === 'string' && search.trim()) {
        mediaFilter.filename = { $regex: search.trim(), $options: 'i' };
      }

      const cacheKey = `cache:user:${userId}:gallery:${filter || 'all'}:${search || ''}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const [mediaFiles, devices, folders, storageAccounts] = await Promise.all([
        File.find(mediaFilter).sort({
          'metadata.takenAt': -1,
          createdAt: -1,
        }).limit(500),
        Device.find({ userId }).select('deviceId deviceName deviceType status'),
        Folder.find({ userId }).select('_id name'),
        StorageAccount.find({ userId }).select('_id accountName accountEmail'),
      ]);

      const deviceMap = new Map<string, string>();
      devices.forEach((d) => deviceMap.set(d.deviceId, d.deviceName));

      const folderMap = new Map<string, string>();
      folders.forEach((f) => folderMap.set(f._id.toString(), f.name));

      const accountMap = new Map<string, string>();
      storageAccounts.forEach((a) => accountMap.set(a._id.toString(), `${a.accountName} (${a.accountEmail})`));

      const enrichedMedia = mediaFiles.map((file) => {
        const obj: any = file.toObject();
        obj.isFavorite = file.isFavorite || false;
        obj.sourceDeviceId = file.sourceDeviceIds?.length ? file.sourceDeviceIds[0] : 'web';
        obj.sourceDeviceName = file.sourceDeviceIds?.length && deviceMap.has(file.sourceDeviceIds[0])
          ? deviceMap.get(file.sourceDeviceIds[0])
          : 'Unified Drive (Web)';
        obj.folderName = file.folderId && folderMap.has(file.folderId.toString())
          ? folderMap.get(file.folderId.toString())
          : null;
        const latestStorageId = file.versions?.[file.versions.length - 1]?.storageAccountId?.toString();
        obj.storageAccountName = latestStorageId && accountMap.has(latestStorageId)
          ? accountMap.get(latestStorageId)
          : 'Google Drive Account';
        obj.status = 'safely_backed_up';
        return obj;
      });

      const payload = {
        media: enrichedMedia,
        devices: devices.map((d) => ({
          deviceId: d.deviceId,
          deviceName: d.deviceName,
          deviceType: d.deviceType || 'android',
          status: d.status || 'offline',
        })),
      };
      await CacheService.set(cacheKey, payload, 60);

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
      res.setHeader('Accept-Ranges', 'bytes');

      const range = req.headers.range;
      const driveStream = await GoogleDriveService.getFileStream(account, latestVersion.providerFileId, range);

      if (driveStream.status === 206) {
        res.status(206);
        if (driveStream.headers['content-range']) {
          res.setHeader('Content-Range', driveStream.headers['content-range']);
        }
        if (driveStream.headers['content-length']) {
          res.setHeader('Content-Length', driveStream.headers['content-length']);
        }
      } else {
        if (driveStream.headers['content-length']) {
          res.setHeader('Content-Length', driveStream.headers['content-length']);
        } else if (latestVersion.sizeBytes) {
          res.setHeader('Content-Length', latestVersion.sizeBytes.toString());
        }
      }

      driveStream.data.pipe(res);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Serves an optimized lightweight thumbnail for fast grid rendering.
   */
  static async streamThumbnail(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const file = await File.findOne({ _id: req.params.id, userId });
      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      // If file has a direct thumbnail link stored (URL or base64 data URI)
      if (file.metadata?.thumbnail) {
        if (file.metadata.thumbnail.startsWith('http')) {
          res.redirect(file.metadata.thumbnail);
          return;
        } else if (file.metadata.thumbnail.startsWith('data:image/')) {
          const matches = file.metadata.thumbnail.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            res.setHeader('Content-Type', matches[1]);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.send(Buffer.from(matches[2], 'base64'));
            return;
          }
        }
      }

      const latestVersion = file.versions[file.versions.length - 1];
      if (!latestVersion) {
        res.status(404).json({ error: 'No file versions available' });
        return;
      }

      const account = await StorageAccount.findOne({ _id: latestVersion.storageAccountId, userId });
      if (!account) {
        res.status(404).json({ error: 'Associated storage account not found' });
        return;
      }

      // Try fetching Google Drive's native thumbnail
      try {
        const oauth2Client = GoogleDriveService.getOAuth2Client(account);
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        let actualFileId = latestVersion.providerFileId;
        if (actualFileId.startsWith('blob_') || actualFileId.startsWith('file_') || actualFileId.includes('.enc')) {
          const lastUnderscore = actualFileId.lastIndexOf('_');
          const baseName = lastUnderscore !== -1 ? actualFileId.substring(lastUnderscore + 1) : actualFileId;
          const query = (baseName && baseName.includes('.'))
            ? `name contains '${baseName}' and trashed = false`
            : `name = '${actualFileId}' and trashed = false`;
          const listRes = await drive.files.list({
            q: query,
            fields: 'files(id, name, thumbnailLink)',
            pageSize: 1,
          });
          if (listRes.data.files?.[0]?.id) {
            actualFileId = listRes.data.files[0].id;
          }
        }

        const meta = await drive.files.get({
          fileId: actualFileId,
          fields: 'thumbnailLink',
        });

        if (meta.data.thumbnailLink) {
          // Google thumbnailLink is usually on lh3.googleusercontent.com
          // First attempt fetch without Bearer header (many Google CDN links reject Bearer with 401/403)
          let thumbRes = await fetch(meta.data.thumbnailLink);
          if (!thumbRes.ok) {
            const tokenRes = await oauth2Client.getAccessToken();
            if (tokenRes.token) {
              thumbRes = await fetch(meta.data.thumbnailLink, {
                headers: { Authorization: `Bearer ${tokenRes.token}` },
              });
            }
          }
          if (thumbRes.ok) {
            res.setHeader('Content-Type', thumbRes.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            const buffer = Buffer.from(await thumbRes.arrayBuffer());
            res.send(buffer);
            return;
          }
        }
      } catch (thumbErr) {
        // Fallback below
      }

      // If it is a video and no thumbnail image exists, return a crisp SVG video poster
      if (file.mimeType.startsWith('video/')) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#181824"/>
      <stop offset="100%" stop-color="#0E0E17"/>
    </linearGradient>
  </defs>
  <rect width="320" height="320" fill="url(#g)"/>
  <circle cx="160" cy="160" r="46" fill="#7C3AED" opacity="0.9"/>
  <polygon points="152,143 176,160 152,177" fill="#FFFFFF"/>
</svg>`;
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(svg);
        return;
      }

      // Fallback: stream file with client-side cache headers
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
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
   * Toggles or sets favorite status for a file.
   */
  static async toggleFavorite(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { isFavorite } = req.body;
      const file = await File.findOne({ _id: req.params.id, userId });
      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }
      file.isFavorite = typeof isFavorite === 'boolean' ? isFavorite : !file.isFavorite;
      await file.save();
      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, isFavorite: file.isFavorite, fileId: file._id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Renames a file.
   */
  static async renameFile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { filename } = req.body;
      if (!filename || typeof filename !== 'string' || !filename.trim()) {
        res.status(400).json({ error: 'Valid filename is required' });
        return;
      }
      const file = await File.findOneAndUpdate(
        { _id: req.params.id, userId },
        { filename: filename.trim() },
        { new: true }
      );
      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }
      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, file });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Moves a file to another folder or root.
   */
  static async moveFile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { folderId } = req.body;
      const file = await File.findOneAndUpdate(
        { _id: req.params.id, userId },
        { folderId: folderId || null },
        { new: true }
      );
      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }
      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, file });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Performs bulk actions (trash, favorite, unfavorite, move) across multiple files.
   */
  static async bulkAction(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { action, fileIds, folderId } = req.body;

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.status(400).json({ error: 'fileIds must be a non-empty array' });
        return;
      }

      if (action === 'trash') {
        await File.updateMany(
          { _id: { $in: fileIds }, userId },
          { isTrash: true, trashedAt: new Date(), trashedByDeviceId: req.device?.deviceId || 'web' }
        );
      } else if (action === 'favorite') {
        await File.updateMany(
          { _id: { $in: fileIds }, userId },
          { isFavorite: true }
        );
      } else if (action === 'unfavorite') {
        await File.updateMany(
          { _id: { $in: fileIds }, userId },
          { isFavorite: false }
        );
      } else if (action === 'move') {
        await File.updateMany(
          { _id: { $in: fileIds }, userId },
          { folderId: folderId || null }
        );
      } else {
        res.status(400).json({ error: 'Invalid action. Supported: trash, favorite, unfavorite, move' });
        return;
      }

      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, count: fileIds.length });
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
   * Renames a folder and updates descendant paths.
   */
  static async renameFolder(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const folderId = new Types.ObjectId(req.params.id);
      const { name } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Valid folder name is required' });
        return;
      }
      const newName = name.trim();
      const folder = await Folder.findOne({ _id: folderId, userId });
      if (!folder) {
        res.status(404).json({ error: 'Folder not found or access denied' });
        return;
      }

      if (folder.name === newName) {
        res.json({ success: true, folder });
        return;
      }

      const existing = await Folder.findOne({
        userId,
        parentFolderId: folder.parentFolderId,
        name: newName,
        _id: { $ne: folder._id },
        isTrash: { $ne: true },
      });
      if (existing) {
        res.status(409).json({ error: 'A folder with this name already exists in this location' });
        return;
      }

      const oldPath = folder.path;
      let newPath = `/${newName}/`;
      if (folder.parentFolderId) {
        const parent = await Folder.findOne({ _id: folder.parentFolderId, userId });
        if (parent) {
          newPath = `${parent.path}${newName}/`;
        }
      }

      folder.name = newName;
      folder.path = newPath;
      await folder.save();

      const escapedOldPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const descendants = await Folder.find({
        userId,
        path: new RegExp(`^${escapedOldPath}`),
        _id: { $ne: folder._id },
      });
      for (const desc of descendants) {
        desc.path = newPath + desc.path.slice(oldPath.length);
        await desc.save();
      }

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

  /**
   * Lists all files uploaded by a specific physical device.
   */
  static async listFilesByDevice(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const deviceId = req.params.deviceId || req.device?.deviceId;
      if (!deviceId) {
        res.status(400).json({ error: 'deviceId is required' });
        return;
      }

      // Query DeviceFileState to get fileIds linked to this device
      const states = await DeviceFileState.find({ userId, deviceId });
      const stateFileIds = states.map((s) => s.fileId);

      const files = await File.find({
        userId,
        isTrash: false,
        $or: [{ sourceDeviceIds: deviceId }, { _id: { $in: stateFileIds } }],
      })
        .populate('folderId', 'name path')
        .sort({ createdAt: -1 })
        .limit(250);

      res.json({ success: true, count: files.length, files });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Lists files synced from other paired devices based on the device's personalized sync policy.
   */
  static async listInboundSyncFiles(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const deviceId = req.params.deviceId || req.device?.deviceId;
      if (!deviceId) {
        res.status(400).json({ error: 'deviceId is required' });
        return;
      }

      // Load device and its policy
      const device = await Device.findOne({ deviceId, userId });
      const policy = device?.policy;
      const pairedRules = policy?.pairedDeviceRules || [];

      // Find all files belonging to the user that were uploaded by other devices or in cloud
      const candidateFiles = await File.find({
        userId,
        isTrash: false,
      })
        .populate('folderId', 'name path')
        .sort({ createdAt: -1 })
        .limit(200);

      // Fetch DeviceFileState records for this device to determine local sync and force-download status
      const localStates = await DeviceFileState.find({ userId, deviceId });
      const localStateMap = new Map<string, boolean>();
      const forceDownloadMap = new Map<string, boolean>();
      localStates.forEach((s) => {
        localStateMap.set(s.fileId.toString(), s.isLocallyPresent);
        if (s.forceDownloadRequested) {
          forceDownloadMap.set(s.fileId.toString(), true);
        }
      });

      // Find any files that have force download requested that might not be in candidateFiles
      const forceFileIds = Array.from(forceDownloadMap.keys());
      let extraForceFiles: any[] = [];
      if (forceFileIds.length > 0) {
        extraForceFiles = await File.find({
          _id: { $in: forceFileIds },
          userId,
          isTrash: false,
        }).populate('folderId', 'name path');
      }

      const combinedCandidates = [...candidateFiles];
      for (const ef of extraForceFiles) {
        if (!combinedCandidates.some((c) => c._id.toString() === ef._id.toString())) {
          combinedCandidates.unshift(ef);
        }
      }

      // Filter candidate files based on pairedDeviceRules or default policy
      const resultFiles = combinedCandidates.filter((file) => {
        const fileIdStr = file._id.toString();
        // If force download requested from web, always include regardless of policy!
        if (forceDownloadMap.get(fileIdStr)) {
          return true;
        }

        const isFromThisDeviceOnly =
          file.sourceDeviceIds.length === 1 && file.sourceDeviceIds[0] === deviceId;
        if (isFromThisDeviceOnly) {
          return false;
        }

        const mime = file.mimeType.toLowerCase();
        const isPhoto = mime.startsWith('image/');
        const isVideo = mime.startsWith('video/');
        const isDoc = !isPhoto && !isVideo;

        // If specific paired device rules exist, check matching rule
        if (pairedRules.length > 0) {
          const matchingRule = pairedRules.find((rule) =>
            file.sourceDeviceIds.includes(rule.sourceDeviceId)
          );
          if (matchingRule) {
            if (isPhoto && !matchingRule.syncPhotos) return false;
            if (isVideo && !matchingRule.syncVideos) return false;
            if (isDoc && !matchingRule.syncDocuments) return false;
            return true;
          }
        }

        // Default: respect general device media policy
        if (isPhoto && policy?.syncPhotos === false) return false;
        if (isVideo && policy?.syncVideos === false) return false;
        if (isDoc && policy?.syncDocuments === false) return false;
        return true;
      });

      const formatted = resultFiles.map((f: any) => {
        const fileObj = f.toObject();
        const fileIdStr = f._id.toString();
        fileObj.isDownloadedLocally = localStateMap.get(fileIdStr) || false;
        fileObj.isForceDownload = forceDownloadMap.get(fileIdStr) || false;
        const otherSources = f.sourceDeviceIds.filter((id: string) => id !== deviceId);
        fileObj.sourceDeviceLabel = otherSources.length > 0 ? otherSources[0] : 'Cloud Drive';
        return fileObj;
      });

      res.json({
        success: true,
        count: formatted.length,
        files: formatted,
        rules: pairedRules,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Marks a file as synced/downloaded locally on the device (e.g. saved to Gallery).
   */
  static async markFileSyncedLocally(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const deviceId = req.params.deviceId || req.device?.deviceId;
      const { fileId, deviceAssetId } = req.body;

      if (!deviceId || !fileId) {
        res.status(400).json({ error: 'deviceId and fileId are required' });
        return;
      }

      const state = await DeviceFileState.findOneAndUpdate(
        { userId, deviceId, fileId: new Types.ObjectId(fileId) },
        {
          deviceAssetId: deviceAssetId || null,
          isLocallyPresent: true,
          forceDownloadRequested: false, // Reset force download request!
          lastSeenLocalAt: new Date(),
        },
        { upsert: true, new: true }
      );

      res.json({ success: true, state });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
