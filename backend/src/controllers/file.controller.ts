import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import { File } from '../models/File.js';
import { Folder } from '../models/Folder.js';
import { Tombstone } from '../models/Tombstone.js';
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

// Helper to resolve accurate MIME types for common media extensions (mov, mkv, webm, etc.)
export function getEffectiveMimeType(filename: string, mimeType?: string): string {
  if (mimeType && mimeType.length > 0 && mimeType !== 'application/octet-stream') {
    return mimeType;
  }
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'mov': return 'video/quicktime';
    case 'mp4': return 'video/mp4';
    case 'm4v': return 'video/x-m4v';
    case 'mkv': return 'video/x-matroska';
    case 'webm': return 'video/webm';
    case 'avi': return 'video/x-msvideo';
    case '3gp': return 'video/3gpp';
    case 'wmv': return 'video/x-ms-wmv';
    case 'flv': return 'video/x-flv';
    case 'ts':
    case 'mts':
    case 'm2ts': return 'video/mp2t';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'heic': return 'image/heic';
    case 'pdf': return 'application/pdf';
    default: return mimeType || 'application/octet-stream';
  }
}

// In-memory LRU thumbnail cache (serves hot thumbnails in 0-1ms without hitting MongoDB or Google Drive)
interface CachedThumbnail {
  buffer: Buffer;
  contentType: string;
  etag: string;
}
const memoryThumbnailCache = new Map<string, CachedThumbnail>();
const MAX_MEMORY_THUMBNAILS = 400;

export class FileController {
  /**
   * Step 1 of Upload: Checks for duplicates and requests a direct Google Drive Resumable Upload Session URL.
   */
  static async initiateUpload(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const { filename, mimeType, sizeBytes, contentHash, folderId, isEncrypted } = req.body;

      if (!filename || !mimeType || !sizeBytes || !contentHash) {
        res.status(400).json({ error: 'Missing required fields: filename, mimeType, sizeBytes, contentHash' });
        return;
      }

      // Check for exact content duplicate (Zero-Knowledge Deduplication + Name/Size fallback)
      const existingDuplicate = await StorageEngineService.findExistingDuplicate(
        userId,
        contentHash,
        filename,
        sizeBytes
      );
      if (existingDuplicate) {
        // Instant deduplication: No bytes need to be uploaded to Google Drive!
        const isDeleted = Boolean((existingDuplicate as any).isTrash || (existingDuplicate as any).isTombstone);
        res.json({
          isDuplicate: true,
          isDeletedOnCloud: isDeleted,
          message: isDeleted
            ? 'File was deleted from cloud storage. Sync will permanently skip re-uploading!'
            : 'Exact duplicate already exists in your cloud library. Byte upload skipped!',
          fileId: existingDuplicate._id,
        });
        return;
      }

      // Select target Google Drive account with sufficient room
      const targetAccount = await StorageEngineService.selectTargetAccount(userId, sizeBytes);

      // Target Google Drive filename sanitized
      const sanitizedName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const driveOpaqueName = `file_${Date.now()}_${sanitizedName}`;

      const clientOrigin = (req.headers.origin as string) || (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
      const effectiveMime = getEffectiveMimeType(filename, mimeType);
      const resumableSessionUri = await GoogleDriveService.createResumableUploadSession(targetAccount, {
        name: driveOpaqueName,
        mimeType: effectiveMime,
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
        thumbnail,
      } = req.body;

      const deviceId = req.device?.deviceId || (req.headers['x-device-id'] as string) || undefined;
      const effectiveProviderId = providerFileId || driveOpaqueName || `file_${Date.now()}_${filename}`;

      const finalMetadata = {
        ...(metadata || {}),
        ...(thumbnail ? { thumbnail } : {}),
      };

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
        isEncrypted: false,
        iv,
        metadata: finalMetadata,
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

      let fileQuery = File.find(filter).sort({ createdAt: -1 }).lean();
      if (req.query.limit) {
        const parsedLimit = parseInt(req.query.limit as string, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          fileQuery = fileQuery.limit(parsedLimit);
        }
      }
      const rawFiles: any[] = await fileQuery;

      const cleanFile = (f: any) => {
        const obj = { ...f };
        obj.hasThumbnail = !!(obj.metadata?.thumbnail && obj.metadata.thumbnail.length > 0);
        obj.thumbnailUrl = `/api/v1/files/${obj._id}/thumbnail`;
        if (obj.metadata?.thumbnail) {
          delete obj.metadata.thumbnail;
        }
        return obj;
      };

      const files = rawFiles.map(cleanFile);

      let recentFiles: any[] = [];
      if ((!folderId || folderId === 'root') && !search && !isTrash) {
        const rawRecent: any[] = await File.find({ userId, isTrash: false })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();
        recentFiles = rawRecent.map(cleanFile);
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

      const videoExtRegex = '\\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|3gp|ts)$';
      const imageExtRegex = '\\.(jpg|jpeg|png|webp|gif|heic|bmp|tiff)$';
      if (filter === 'favorites') {
        mediaFilter.isFavorite = true;
        mediaFilter.$or = [
          { mimeType: { $regex: '^image/' } },
          { mimeType: { $regex: '^video/' } },
          { filename: { $regex: videoExtRegex, $options: 'i' } },
          { filename: { $regex: imageExtRegex, $options: 'i' } },
        ];
      } else if (filter === 'videos') {
        mediaFilter.$or = [
          { mimeType: { $regex: '^video/' } },
          { filename: { $regex: videoExtRegex, $options: 'i' } },
        ];
      } else if (filter === 'photos') {
        mediaFilter.$or = [
          { mimeType: { $regex: '^image/' } },
          { filename: { $regex: imageExtRegex, $options: 'i' } },
        ];
      } else {
        mediaFilter.$or = [
          { mimeType: { $regex: '^image/' } },
          { mimeType: { $regex: '^video/' } },
          { filename: { $regex: videoExtRegex, $options: 'i' } },
          { filename: { $regex: imageExtRegex, $options: 'i' } },
        ];
      }

      if (search && typeof search === 'string' && search.trim()) {
        mediaFilter.filename = { $regex: search.trim(), $options: 'i' };
      }

      let parsedLimit: number | null = null;
      if (req.query.limit) {
        const pl = parseInt(req.query.limit as string, 10);
        if (!isNaN(pl) && pl > 0) {
          parsedLimit = pl;
        }
      }

      const cursorStr = req.query.cursor as string | undefined;
      if (cursorStr && typeof cursorStr === 'string' && cursorStr.trim()) {
        try {
          const cursorData = JSON.parse(Buffer.from(cursorStr.trim(), 'base64url').toString('utf8'));
          const cTaken = cursorData.takenAt ? new Date(cursorData.takenAt) : null;
          const cCreated = cursorData.createdAt ? new Date(cursorData.createdAt) : null;
          const cId = cursorData.id && Types.ObjectId.isValid(cursorData.id) ? new Types.ObjectId(cursorData.id) : null;

          const cursorConditions: any[] = [];
          if (cTaken) {
            cursorConditions.push({ 'metadata.takenAt': { $lt: cTaken } });
            if (cCreated) {
              cursorConditions.push({
                'metadata.takenAt': cTaken,
                createdAt: { $lt: cCreated },
              });
              if (cId) {
                cursorConditions.push({
                  'metadata.takenAt': cTaken,
                  createdAt: cCreated,
                  _id: { $lt: cId },
                });
              }
            }
            if (cCreated) {
              cursorConditions.push({
                'metadata.takenAt': null,
                createdAt: { $lt: cCreated },
              });
            }
          } else if (cCreated) {
            cursorConditions.push({ createdAt: { $lt: cCreated } });
            if (cId) {
              cursorConditions.push({
                createdAt: cCreated,
                _id: { $lt: cId },
              });
            }
          }

          if (cursorConditions.length > 0) {
            if (mediaFilter.$and) {
              mediaFilter.$and.push({ $or: cursorConditions });
            } else if (mediaFilter.$or) {
              const existingOr = mediaFilter.$or;
              delete mediaFilter.$or;
              mediaFilter.$and = [{ $or: existingOr }, { $or: cursorConditions }];
            } else {
              mediaFilter.$or = cursorConditions;
            }
          }
        } catch (err) {
          console.warn('Failed to parse gallery cursor:', err);
        }
      }

      const cacheKey = `cache:user:${userId}:gallery:${filter || 'all'}:${search || ''}:${parsedLimit || 'all'}:${cursorStr || 'first'}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      let galleryQuery = File.find(mediaFilter).sort({
        'metadata.takenAt': -1,
        createdAt: -1,
        _id: -1,
      }).lean();

      if (parsedLimit) {
        // Fetch parsedLimit + 1 to detect if next page exists
        galleryQuery = galleryQuery.limit(parsedLimit + 1);
      }

      const [mediaFiles, devices, folders, storageAccounts] = await Promise.all([
        galleryQuery,
        Device.find({ userId }).select('deviceId deviceName deviceType status').lean(),
        Folder.find({ userId }).select('_id name').lean(),
        StorageAccount.find({ userId }).select('_id accountName accountEmail').lean(),
      ]);

      const deviceMap = new Map<string, string>();
      devices.forEach((d) => deviceMap.set(d.deviceId, d.deviceName));

      const folderMap = new Map<string, string>();
      folders.forEach((f) => folderMap.set(f._id.toString(), f.name));

      const accountMap = new Map<string, string>();
      storageAccounts.forEach((a) => accountMap.set(a._id.toString(), `${a.accountName} (${a.accountEmail})`));

      // Filter out redundant duplicates so the gallery is 100% unique
      const uniqueMediaFiles: any[] = [];
      const seenHashes = new Set<string>();
      const seenNameSizes = new Set<string>();

      for (const file of mediaFiles as any[]) {
        const cleanHash = file.contentHash?.trim().toLowerCase();
        const nameSizeKey = `${file.filename?.trim()}_${file.sizeBytes}`;

        if (cleanHash && seenHashes.has(cleanHash)) continue;
        if (nameSizeKey && seenNameSizes.has(nameSizeKey)) continue;

        if (cleanHash) seenHashes.add(cleanHash);
        if (nameSizeKey) seenNameSizes.add(nameSizeKey);
        uniqueMediaFiles.push(file);
      }

      let hasMore = false;
      let nextCursor: string | null = null;
      if (parsedLimit && uniqueMediaFiles.length > parsedLimit) {
        hasMore = true;
        uniqueMediaFiles.splice(parsedLimit); // Retain exactly parsedLimit
      }

      if (hasMore && uniqueMediaFiles.length > 0) {
        const lastItem = uniqueMediaFiles[uniqueMediaFiles.length - 1];
        nextCursor = Buffer.from(
          JSON.stringify({
            takenAt: lastItem.metadata?.takenAt || null,
            createdAt: lastItem.createdAt,
            id: lastItem._id.toString(),
          })
        ).toString('base64url');
      }

      const enrichedMedia = uniqueMediaFiles.map((file: any) => {
        const obj: any = { ...file };
        obj.mimeType = getEffectiveMimeType(file.filename, file.mimeType);
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
        
        // Strip heavy base64 strings and short-lived HTTP links from list JSON.
        // Provide lightweight flag and thumbnail URL so clients fetch via cached /thumbnail endpoint.
        const hasThumb = !!(obj.metadata?.thumbnail && obj.metadata.thumbnail.length > 0);
        obj.hasThumbnail = hasThumb;
        obj.thumbnailUrl = `/api/v1/files/${file._id}/thumbnail`;
        if (obj.metadata?.thumbnail) {
          delete obj.metadata.thumbnail;
        }
        return obj;
      });

      const payload = {
        media: enrichedMedia,
        nextCursor,
        hasMore,
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
   * Returns a short-lived direct Google Drive stream URL for the file.
   * Android video player uses this URL to bypass the Render proxy server,
   * streaming directly from Google's CDN for far lower buffering.
   */
  static async getDirectStreamUrl(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const file = await File.findOne({ _id: req.params.id, userId });
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
        res.status(404).json({ error: 'Storage account not found' });
        return;
      }

      const oauth2Client = GoogleDriveService.getOAuth2Client(account);
      const tokenResponse = await oauth2Client.getAccessToken();
      const accessToken = tokenResponse.token;
      if (!accessToken) {
        res.status(503).json({ error: 'Could not obtain access token' });
        return;
      }

      // Resolve the real Google Drive file ID if stored as an opaque name
      const driveFileId = await GoogleDriveService.resolveDriveFileId(account, latestVersion.providerFileId);
      if (driveFileId !== latestVersion.providerFileId) {
        File.updateOne(
          { _id: file._id, 'versions.versionNumber': latestVersion.versionNumber },
          { $set: { 'versions.$.providerFileId': driveFileId } }
        ).exec();
      }

      // Direct Google Drive API download URL with embedded access token.
      // This URL is valid for ~1 hour (access token lifetime) and served
      // from Google's CDN — no Render proxy, no buffering.
      const directUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media&access_token=${accessToken}`;

      res.json({
        directUrl,
        mimeType: file.mimeType,
        filename: file.filename,
        sizeBytes: latestVersion.sizeBytes,
        expiresInSeconds: 3500, // conservative; tokens last ~3600s
      });
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
      const file: any = await File.findOne({
        _id: req.params.id,
        userId, // Strict IDOR check
      }).lean();

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      const latestVersion = file.versions?.[file.versions.length - 1];
      if (!latestVersion) {
        res.status(404).json({ error: 'No file versions available' });
        return;
      }

      const account: any = await StorageAccount.findOne({
        _id: latestVersion.storageAccountId,
        userId,
      }).lean();

      if (!account) {
        res.status(404).json({ error: 'Associated storage account not found' });
        return;
      }

      let responseMime = getEffectiveMimeType(file.filename, file.mimeType);
      if (file.mimeType === 'application/octet-stream' && responseMime !== 'application/octet-stream') {
        file.mimeType = responseMime;
        File.updateOne({ _id: file._id }, { $set: { mimeType: responseMime } }).exec();
      }
      if (responseMime === 'video/quicktime' || file.filename.toLowerCase().endsWith('.mov')) {
        responseMime = 'video/mp4';
      }

      res.setHeader('Content-Type', responseMime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=43200');

      const range = req.headers.range;
      const driveStream = await GoogleDriveService.getFileStream(account, latestVersion.providerFileId, range);

      if (driveStream.resolvedFileId && driveStream.resolvedFileId !== latestVersion.providerFileId) {
        File.updateOne(
          { _id: file._id, 'versions.versionNumber': latestVersion.versionNumber },
          { $set: { 'versions.$.providerFileId': driveStream.resolvedFileId } }
        ).exec();
      }

      if (driveStream.status === 206) {
        res.status(206);
        const cr = driveStream.headers['content-range'] || driveStream.headers['Content-Range'];
        if (cr) {
          res.setHeader('Content-Range', cr);
        }
        const cl = driveStream.headers['content-length'] || driveStream.headers['Content-Length'];
        if (cl) {
          res.setHeader('Content-Length', cl);
        }
      } else {
        const cl = driveStream.headers['content-length'] || driveStream.headers['Content-Length'];
        if (cl) {
          res.setHeader('Content-Length', cl);
        } else if (latestVersion.sizeBytes) {
          res.setHeader('Content-Length', latestVersion.sizeBytes.toString());
        }
      }

      req.on('close', () => {
        try {
          if (driveStream.data && typeof driveStream.data.destroy === 'function') {
            driveStream.data.destroy();
          }
        } catch {}
      });

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
      const fileId = req.params.id;

      // Fast path: In-memory thumbnail cache check (0ms response without DB or Drive lookup)
      const cached = memoryThumbnailCache.get(fileId);
      if (cached) {
        res.setHeader('ETag', cached.etag);
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        if (req.headers['if-none-match'] === cached.etag) {
          res.status(304).end();
          return;
        }
        res.setHeader('Content-Type', cached.contentType);
        res.send(cached.buffer);
        return;
      }

      const file: any = await File.findOne({ _id: fileId, userId })
        .select('metadata mimeType filename updatedAt versions')
        .lean();

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      const etag = `"${file._id.toString()}_${new Date(file.updatedAt || 0).getTime()}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');

      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      const saveAndSend = (buffer: Buffer, contentType: string) => {
        if (memoryThumbnailCache.size >= MAX_MEMORY_THUMBNAILS) {
          const oldestKey = memoryThumbnailCache.keys().next().value;
          if (oldestKey) memoryThumbnailCache.delete(oldestKey);
        }
        memoryThumbnailCache.set(fileId, { buffer, contentType, etag });
        res.setHeader('Content-Type', contentType);
        res.send(buffer);
      };

      // If previously stored as application/octet-stream, auto-correct based on filename extension
      if (file.mimeType === 'application/octet-stream') {
        const effMime = getEffectiveMimeType(file.filename, file.mimeType);
        if (effMime !== file.mimeType) {
          file.mimeType = effMime;
          File.updateOne({ _id: file._id }, { $set: { mimeType: effMime } }).exec();
        }
      }

      // If file has a direct thumbnail link stored (URL or base64 data URI)
      if (file.metadata?.thumbnail) {
        if (file.metadata.thumbnail.startsWith('data:image/')) {
          const matches = file.metadata.thumbnail.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            saveAndSend(Buffer.from(matches[2], 'base64'), matches[1]);
            return;
          }
        } else if (file.metadata.thumbnail.startsWith('http')) {
          try {
            const thumbRes = await fetch(file.metadata.thumbnail);
            if (thumbRes.ok) {
              const buffer = Buffer.from(await thumbRes.arrayBuffer());
              saveAndSend(buffer, thumbRes.headers.get('content-type') || 'image/jpeg');
              return;
            }
          } catch (_e) {
            // Stored Google URL expired, fall through to refresh via Google Drive API below
          }
        }
      }

      const latestVersion = file.versions?.[file.versions.length - 1];
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
        const actualFileId = await GoogleDriveService.resolveDriveFileId(account, latestVersion.providerFileId);
        if (actualFileId !== latestVersion.providerFileId) {
          File.updateOne(
            { _id: file._id, 'versions.versionNumber': latestVersion.versionNumber },
            { $set: { 'versions.$.providerFileId': actualFileId } }
          ).exec();
        }

        const meta = await drive.files.get({
          fileId: actualFileId,
          fields: 'thumbnailLink',
        });

        if (meta.data.thumbnailLink) {
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
            File.updateOne({ _id: file._id }, { $set: { 'metadata.thumbnail': meta.data.thumbnailLink } }).exec();
            const buffer = Buffer.from(await thumbRes.arrayBuffer());
            saveAndSend(buffer, thumbRes.headers.get('content-type') || 'image/jpeg');
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
        res.send(svg);
        return;
      }

      // Fallback: stream file with client-side cache headers
      res.setHeader('Content-Type', file.mimeType);
      const driveStream = await GoogleDriveService.getFileStream(account, latestVersion.providerFileId);
      driveStream.data.pipe(res);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Updates or saves a captured thumbnail for a file (e.g. video preview frame).
   */
  static async updateThumbnail(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const fileId = req.params.id;
      const { thumbnail } = req.body;

      if (!thumbnail || typeof thumbnail !== 'string') {
        res.status(400).json({ error: 'thumbnail data URI is required' });
        return;
      }

      const file = await File.findOne({ _id: fileId, userId });
      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      const updateFields: any = { 'metadata.thumbnail': thumbnail };
      if (file.mimeType === 'application/octet-stream') {
        const effMime = getEffectiveMimeType(file.filename, file.mimeType);
        if (effMime !== 'application/octet-stream') {
          updateFields.mimeType = effMime;
        }
      }

      await File.updateOne({ _id: fileId }, { $set: updateFields });
      memoryThumbnailCache.delete(fileId);
      await CacheService.invalidateUser(userId.toString());

      res.json({ success: true, message: 'Thumbnail updated successfully' });
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

      // Remove any tombstone if existed
      await Tombstone.deleteMany({
        userId,
        $or: [{ contentHash: file.contentHash }, { filename: file.filename, sizeBytes: file.sizeBytes }],
      }).catch(() => {});

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

      // Record tombstone so subsequent mobile or client syncs never re-upload this purged file
      await Tombstone.create({
        userId,
        contentHash: file.contentHash,
        filename: file.filename,
        sizeBytes: file.sizeBytes,
        deletedAt: new Date(),
      }).catch((err) => console.warn('Failed to record tombstone:', err));

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
   * Restores all files and folders from Trash.
   */
  static async restoreAllFromTrash(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;

      // When restoring all from trash, remove tombstones for these files
      const filesToRestore = await File.find({ userId, isTrash: true });
      const hashes = filesToRestore.map((f) => f.contentHash).filter(Boolean);
      if (hashes.length > 0) {
        await Tombstone.deleteMany({ userId, contentHash: { $in: hashes } }).catch(() => {});
      }

      const [fileResult, folderResult] = await Promise.all([
        File.updateMany(
          { userId, isTrash: true },
          { isTrash: false, trashedAt: null }
        ),
        Folder.updateMany(
          { userId, isTrash: true },
          { isTrash: false, trashedAt: null }
        ),
      ]);

      await CacheService.invalidateUser(userId.toString());
      res.json({
        success: true,
        restoredFiles: fileResult.modifiedCount,
        restoredFolders: folderResult.modifiedCount,
        message: `Restored ${fileResult.modifiedCount} files and ${folderResult.modifiedCount} folders from Trash`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Permanently empties the entire Trash: purges all trashed files from Google Drive and database.
   */
  static async emptyTrash(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;

      // Find all files in Trash for this user before deletion
      const trashedFiles = await File.find({ userId, isTrash: true });

      // Record tombstones so subsequent syncs never re-upload these files
      if (trashedFiles.length > 0) {
        const tombstones = trashedFiles.map((f) => ({
          userId,
          contentHash: f.contentHash,
          filename: f.filename,
          sizeBytes: f.sizeBytes,
          deletedAt: new Date(),
        }));
        await Tombstone.insertMany(tombstones, { ordered: false }).catch(() => {});
      }

      // 1. Delete records from database immediately so user sees empty trash instantly
      const [fileDeleteResult, folderDeleteResult] = await Promise.all([
        File.deleteMany({ userId, isTrash: true }),
        Folder.deleteMany({ userId, isTrash: true }),
      ]);

      // 2. Invalidate user cache immediately
      await CacheService.invalidateUser(userId.toString());

      // 3. Respond to client right away to avoid request timeouts
      res.json({
        success: true,
        purgedFiles: fileDeleteResult.deletedCount,
        purgedFolders: folderDeleteResult.deletedCount,
        message: 'Trash emptied permanently',
      });

      // 4. Clean up physical Google Drive files asynchronously in the background
      (async () => {
        for (const file of trashedFiles) {
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
              // Ignore already purged or missing files
            }
          }
        }
      })().catch((err) => console.warn('Background Google Drive purge warning:', err));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Scans and removes any redundant duplicate records in the user's cloud library.
   * Keeps the primary copy and deletes duplicate entries.
   */
  static async deduplicateFiles(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;

      const allFiles = await File.find({ userId, isTrash: false }).sort({ createdAt: 1 });

      const seenHashes = new Set<string>();
      const seenNameSizes = new Set<string>();
      const duplicateFileIds: Types.ObjectId[] = [];

      for (const file of allFiles) {
        const cleanHash = file.contentHash?.trim().toLowerCase();
        const nameSizeKey = `${file.filename?.trim()}_${file.sizeBytes}`;

        let isDuplicate = false;

        if (cleanHash && seenHashes.has(cleanHash)) {
          isDuplicate = true;
        } else if (cleanHash) {
          seenHashes.add(cleanHash);
        }

        if (nameSizeKey && seenNameSizes.has(nameSizeKey)) {
          isDuplicate = true;
        } else if (nameSizeKey) {
          seenNameSizes.add(nameSizeKey);
        }

        if (isDuplicate) {
          duplicateFileIds.push(file._id);
        }
      }

      let removedCount = 0;
      if (duplicateFileIds.length > 0) {
        const delResult = await File.deleteMany({
          _id: { $in: duplicateFileIds },
          userId,
        });
        removedCount = delResult.deletedCount;
        await CacheService.invalidateUser(userId.toString());
      }

      res.json({
        success: true,
        removedDuplicates: removedCount,
        message: `Removed ${removedCount} duplicate file(s) from your cloud library`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Clears encryption flags across user files to allow transparent direct streaming.
   */
  static async clearEncryptionFlags(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const result = await File.updateMany(
        { userId },
        { $set: { 'versions.$[].isEncrypted': false } }
      );
      await CacheService.invalidateUser(userId.toString());
      res.json({ success: true, modifiedCount: result.modifiedCount });
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
      const getAll = req.query.all === 'true';

      // Check Redis cache for folder tree
      const cacheKey = `cache:user:${userId}:folders:${getAll ? 'all' : (parentFolderId || 'root')}`;
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

      if (!getAll) {
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

      let deviceFilesQuery = File.find({
        userId,
        isTrash: false,
        $or: [{ sourceDeviceIds: deviceId }, { _id: { $in: stateFileIds } }],
      })
        .populate('folderId', 'name path')
        .sort({ createdAt: -1 });

      if (req.query.limit) {
        const parsedLimit = parseInt(req.query.limit as string, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          deviceFilesQuery = deviceFilesQuery.limit(parsedLimit);
        }
      }

      const files = await deviceFilesQuery;

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
      let candidateQuery = File.find({
        userId,
        isTrash: false,
      })
        .populate('folderId', 'name path')
        .sort({ createdAt: -1 });

      if (req.query.limit) {
        const parsedLimit = parseInt(req.query.limit as string, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          candidateQuery = candidateQuery.limit(parsedLimit);
        }
      }

      const candidateFiles = await candidateQuery;

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

      // Fetch registered devices to map friendly device labels
      const userDevices = await Device.find({ userId }).select('deviceId deviceName');
      const deviceNameMap = new Map<string, string>();
      userDevices.forEach((d) => deviceNameMap.set(d.deviceId, d.deviceName));

      const formatted = resultFiles.map((f: any) => {
        const fileObj = f.toObject();
        const fileIdStr = f._id.toString();
        fileObj.isDownloadedLocally = localStateMap.get(fileIdStr) || false;
        fileObj.isForceDownload = forceDownloadMap.get(fileIdStr) || false;
        const otherSources = (f.sourceDeviceIds || []).filter((id: string) => id !== deviceId);

        let autoDownload = false;
        let matchedSourceId: string | null = null;
        let matchedSourceName: string | null = null;

        if (pairedRules.length > 0 && f.sourceDeviceIds && f.sourceDeviceIds.length > 0) {
          const matchingRule = pairedRules.find((rule) =>
            f.sourceDeviceIds.includes(rule.sourceDeviceId)
          );
          if (matchingRule) {
            matchedSourceId = matchingRule.sourceDeviceId;
            matchedSourceName = matchingRule.sourceDeviceName || deviceNameMap.get(matchingRule.sourceDeviceId) || null;
            autoDownload = !!matchingRule.autoDownloadToGallery;
          }
        }

        // If no paired device rule specified, fallback to general device policy autoDownloadToGallery
        if (!matchedSourceId && policy?.autoDownloadToGallery) {
          autoDownload = true;
        }

        const sourceId = matchedSourceId || (otherSources.length > 0 ? otherSources[0] : null);
        const resolvedName = matchedSourceName || (sourceId ? deviceNameMap.get(sourceId) : null);

        fileObj.autoDownloadToGallery = autoDownload;
        fileObj.sourceDeviceId = sourceId;
        fileObj.sourceDeviceLabel = resolvedName || sourceId || 'Cloud Drive';
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

      // Also record inbound sync activity on Device
      try {
        const syncedFile = await File.findById(fileId).select('filename');
        const fname = syncedFile?.filename || 'paired file';
        await Device.findOneAndUpdate(
          { deviceId, userId },
          {
            $set: {
              lastSeenAt: new Date(),
              currentSyncActivity: `Saved ${fname} to device storage`,
            },
            $push: {
              syncLogs: {
                $each: [{ timestamp: new Date(), message: `Inbound sync: saved ${fname} to Gallery/local storage` }],
                $slice: -20,
              },
            },
          }
        );
      } catch (_: any) {}

      res.json({ success: true, state });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
