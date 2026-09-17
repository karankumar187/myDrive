import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { File } from '../models/File.js';
import { StorageAccount } from '../models/StorageAccount.js';
import { StorageEngineService } from '../services/storage-engine.service.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { MediaTransformService } from '../services/media-transform.service.js';
import { getEffectiveMimeType } from './file.controller.js';

const ORIGINALS_DIR = path.resolve(process.cwd(), 'uploads', 'media_originals');
if (!fs.existsSync(ORIGINALS_DIR)) {
  fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
}

export class MediaController {
  /**
   * Cloudinary-compatible programmatic media upload endpoint.
   * Handles multipart file, base64 data URI, or remote URL.
   */
  static async uploadMedia(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user!;
      const userId = user._id;

      let fileBuffer: Buffer | null = null;
      let originalFilename = 'media_asset';
      let mimeType = 'application/octet-stream';

      // 1. Check multipart file from Multer
      if (req.file) {
        fileBuffer = req.file.buffer;
        originalFilename = req.file.originalname;
        mimeType = req.file.mimetype;
      } else if (req.body.file) {
        const fileData = req.body.file;
        if (typeof fileData === 'string' && fileData.startsWith('data:')) {
          // Base64 Data URI
          const matches = fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            mimeType = matches[1];
            fileBuffer = Buffer.from(matches[2], 'base64');
            const ext = mimeType.split('/')[1] || 'bin';
            originalFilename = `upload_${Date.now()}.${ext}`;
          }
        } else if (typeof fileData === 'string' && (fileData.startsWith('http://') || fileData.startsWith('https://'))) {
          // Remote URL download
          const fetchRes = await fetch(fileData);
          if (!fetchRes.ok) {
            res.status(400).json({ error: `Failed to fetch remote media from URL: ${fetchRes.statusText}` });
            return;
          }
          const arrayBuffer = await fetchRes.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuffer);
          mimeType = fetchRes.headers.get('content-type') || 'image/jpeg';
          originalFilename = path.basename(new URL(fileData).pathname) || `remote_${Date.now()}`;
        }
      } else if (req.body.url) {
        // Direct URL parameter
        const fetchRes = await fetch(req.body.url);
        if (!fetchRes.ok) {
          res.status(400).json({ error: `Failed to fetch remote media: ${fetchRes.statusText}` });
          return;
        }
        const arrayBuffer = await fetchRes.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
        mimeType = fetchRes.headers.get('content-type') || 'image/jpeg';
        originalFilename = path.basename(new URL(req.body.url).pathname) || `remote_${Date.now()}`;
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        res.status(400).json({
          error: 'No file provided. Send multipart form data with "file", or JSON with base64/remote URL "file".',
        });
        return;
      }

      mimeType = getEffectiveMimeType(originalFilename, mimeType);
      const sizeBytes = fileBuffer.length;
      const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // 2. Resource type classification
      let resourceType: 'image' | 'video' | 'raw' = 'raw';
      if (mimeType.startsWith('image/')) {
        resourceType = 'image';
      } else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
        resourceType = 'video';
      }

      // 3. Extract dimensions & metadata if image
      let width: number | undefined;
      let height: number | undefined;
      let detectedFormat: string | undefined;

      if (resourceType === 'image') {
        const meta = await MediaTransformService.extractImageMetadata(fileBuffer);
        width = meta.width;
        height = meta.height;
        detectedFormat = meta.format;
      }

      // 4. Folder & Public ID generation
      const rawFolder = (req.body.folder as string) || '';
      const cleanFolder = rawFolder
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^a-zA-Z0-9_\-\/]/g, '_');

      const customPublicId = (req.body.public_id as string) || '';
      const sanitizedId = customPublicId
        ? customPublicId.replace(/[^a-zA-Z0-9_\-]/g, '_')
        : `${path.parse(originalFilename).name.replace(/[^a-zA-Z0-9_\-]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`;

      const fullPublicId = cleanFolder ? `${cleanFolder}/${sanitizedId}` : sanitizedId;

      // 5. Parse Tags
      let tags: string[] = [];
      if (req.body.tags) {
        if (Array.isArray(req.body.tags)) {
          tags = req.body.tags.map((t: string) => String(t).trim()).filter(Boolean);
        } else if (typeof req.body.tags === 'string') {
          tags = req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
        }
      }

      // 6. Check for existing file with same publicId for this user (upsert/update)
      let fileDoc = await File.findOne({ userId, publicId: fullPublicId, isTrash: false });

      // 7. Store original buffer in local high-speed cache
      const tempId = fileDoc?._id ? fileDoc._id.toString() : new Types.ObjectId().toString();
      const localOriginalPath = path.join(ORIGINALS_DIR, `${tempId}.bin`);
      fs.writeFileSync(localOriginalPath, fileBuffer);

      // 8. Pool to Google Drive if healthy accounts are linked
      let storageAccountId: Types.ObjectId | null = null;
      let providerFileId = `media_${Date.now()}_${sanitizedId}`;

      try {
        const targetAccount = await StorageEngineService.selectTargetAccount(userId, sizeBytes);
        if (targetAccount) {
          const driveUpload = await GoogleDriveService.uploadBufferOrStream(targetAccount, fileBuffer, {
            name: `cld_${sanitizedId}`,
            mimeType,
            description: `myDrive Media Asset [${fullPublicId}]`,
          });
          storageAccountId = targetAccount._id as Types.ObjectId;
          providerFileId = driveUpload.id;

          // Update storage account usage
          targetAccount.usedStorageBytes += sizeBytes;
          await targetAccount.save();
        }
      } catch (poolErr) {
        // If no Google Drive account connected, continues with local storage fallback
        console.log('Pooled Drive upload skipped, storing in local media storage:', (poolErr as any)?.message);
      }

      // 9. Save or update database record
      if (!fileDoc) {
        fileDoc = new File({
          _id: new Types.ObjectId(tempId),
          userId,
          filename: originalFilename,
          mimeType,
          sizeBytes,
          contentHash,
          publicId: fullPublicId,
          tags,
          isMediaApi: true,
          resourceType,
          currentVersion: 1,
          versions: storageAccountId
            ? [
                {
                  versionNumber: 1,
                  storageAccountId,
                  providerFileId,
                  sizeBytes,
                  contentHash,
                  isEncrypted: false,
                  createdAt: new Date(),
                },
              ]
            : [],
          metadata: {
            width,
            height,
            takenAt: new Date(),
            cameraModel: 'API Upload',
          },
        });
      } else {
        fileDoc.filename = originalFilename;
        fileDoc.mimeType = mimeType;
        fileDoc.sizeBytes = sizeBytes;
        fileDoc.contentHash = contentHash;
        fileDoc.tags = Array.from(new Set([...(fileDoc.tags || []), ...tags]));
        fileDoc.metadata = {
          ...fileDoc.metadata,
          width,
          height,
        };
        if (storageAccountId) {
          fileDoc.versions.push({
            versionNumber: (fileDoc.currentVersion || 1) + 1,
            storageAccountId,
            providerFileId,
            sizeBytes,
            contentHash,
            isEncrypted: false,
            createdAt: new Date(),
          } as any);
          fileDoc.currentVersion = (fileDoc.currentVersion || 1) + 1;
        }
      }

      await fileDoc.save();

      // Rename local original file if id changed
      const realOriginalPath = path.join(ORIGINALS_DIR, `${fileDoc._id}.bin`);
      if (localOriginalPath !== realOriginalPath && fs.existsSync(localOriginalPath)) {
        fs.renameSync(localOriginalPath, realOriginalPath);
      }

      // 10. Generate Cloudinary-compatible URLs
      const host = req.get('host') || 'localhost:5001';
      const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const baseUrl = `${protocol}://${host}`;

      const ext = detectedFormat || mimeType.split('/')[1] || 'bin';
      const url = `${baseUrl}/api/v1/media/${fullPublicId}.${ext}`;
      const secureUrl = `${baseUrl.replace('http://', 'https://')}/api/v1/media/${fullPublicId}.${ext}`;
      const thumbnailUrl = `${baseUrl}/api/v1/media/image/upload/w_250,h_250,c_thumb/${fullPublicId}.${ext}`;

      res.status(201).json({
        asset_id: fileDoc._id.toString(),
        public_id: fullPublicId,
        version: fileDoc.currentVersion,
        format: ext,
        resource_type: resourceType,
        created_at: fileDoc.createdAt.toISOString(),
        bytes: sizeBytes,
        width,
        height,
        url,
        secure_url: secureUrl,
        thumbnail_url: resourceType === 'image' ? thumbnailUrl : undefined,
        folder: cleanFolder || undefined,
        tags: fileDoc.tags,
      });
    } catch (error: any) {
      console.error('Media upload error:', error);
      res.status(500).json({ error: error.message || 'Media upload failed' });
    }
  }

  /**
   * Retrieves and serves a media asset with on-the-fly dynamic transformations.
   * Handles both path format (/media/image/upload/...) and direct format (/media/:publicId).
   */
  static async deliverMedia(req: Request, res: Response): Promise<void> {
    try {
      let rawPublicId = req.params.publicId || req.params[0] || '';
      const transformationsParam = req.params.transformations || req.params[1] || '';

      // Strip file extension if client requested e.g. "avatar.webp"
      const parsed = path.parse(rawPublicId);
      const requestedExtension = parsed.ext.replace(/^\./, '').toLowerCase();
      const cleanPublicId = path.join(parsed.dir, parsed.name).replace(/\\/g, '/');

      // Find file by publicId (or fallback by _id or filename)
      let file: any = await File.findOne({
        $or: [
          { publicId: cleanPublicId },
          { publicId: rawPublicId },
          ...(Types.ObjectId.isValid(cleanPublicId) ? [{ _id: new Types.ObjectId(cleanPublicId) }] : []),
          { filename: rawPublicId },
        ],
        isTrash: false,
      }).lean();

      if (!file) {
        res.status(404).json({ error: 'Media asset not found: ' + rawPublicId });
        return;
      }

      // Parse transformations
      const transformOptions = MediaTransformService.parseTransformation(transformationsParam, req.query);

      // If client explicitly requested an extension like .webp or .png, use it
      if (requestedExtension && ['webp', 'png', 'jpg', 'jpeg', 'avif'].includes(requestedExtension)) {
        transformOptions.format = requestedExtension === 'jpg' ? 'jpeg' : (requestedExtension as any);
      }

      const isImage = file.mimeType?.startsWith('image/') || file.resourceType === 'image';

      // If it's an image and has transformations (or format optimization)
      if (isImage) {
        // Check disk transformation cache
        const cached = MediaTransformService.getCachedTransformedImage(file._id.toString(), transformOptions);
        if (cached) {
          res.setHeader('Content-Type', cached.contentType);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('ETag', `"${file._id}_${MediaTransformService.getTransformationCacheKey(file._id.toString(), transformOptions)}"`);
          res.send(cached.buffer);
          return;
        }

        // Fetch original image buffer
        let sourceBuffer: Buffer | null = null;
        const localOriginal = path.join(ORIGINALS_DIR, `${file._id}.bin`);

        if (fs.existsSync(localOriginal)) {
          sourceBuffer = fs.readFileSync(localOriginal);
        } else {
          // Stream from Google Drive if stored there
          const latestVersion = file.versions?.[file.versions.length - 1];
          if (latestVersion) {
            const account = await StorageAccount.findById(latestVersion.storageAccountId);
            if (account) {
              const driveStream = await GoogleDriveService.getFileStream(account, latestVersion.providerFileId);
              const chunks: Buffer[] = [];
              await new Promise((resolve, reject) => {
                driveStream.data.on('data', (chunk: Buffer) => chunks.push(chunk));
                driveStream.data.on('end', resolve);
                driveStream.data.on('error', reject);
              });
              sourceBuffer = Buffer.concat(chunks);
              // Save to local cache for subsequent transformations
              fs.writeFileSync(localOriginal, sourceBuffer);
            }
          }
        }

        if (!sourceBuffer || sourceBuffer.length === 0) {
          res.status(404).json({ error: 'Source media content not available' });
          return;
        }

        // Apply transformations via Sharp
        const clientAccept = req.headers.accept || '';
        const transformed = await MediaTransformService.transformImage(sourceBuffer, transformOptions, clientAccept);

        // Cache result on disk
        MediaTransformService.cacheTransformedImage(
          file._id.toString(),
          transformOptions,
          transformed.buffer,
          transformed.format
        );

        res.setHeader('Content-Type', transformed.contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('ETag', `"${file._id}_${MediaTransformService.getTransformationCacheKey(file._id.toString(), transformOptions)}"`);
        res.send(transformed.buffer);
        return;
      }

      // Non-image (Video / Audio / Raw): stream directly
      const localOriginal = path.join(ORIGINALS_DIR, `${file._id}.bin`);
      if (fs.existsSync(localOriginal)) {
        res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(localOriginal).pipe(res);
        return;
      }

      // Stream from Google Drive
      const latestVersion = file.versions?.[file.versions.length - 1];
      if (latestVersion) {
        const account = await StorageAccount.findById(latestVersion.storageAccountId);
        if (account) {
          const driveStream = await GoogleDriveService.getFileStream(account, latestVersion.providerFileId, req.headers.range);
          res.setHeader('Content-Type', file.mimeType || 'video/mp4');
          res.setHeader('Accept-Ranges', 'bytes');
          if (driveStream.status === 206) {
            res.status(206);
            if (driveStream.headers['content-range']) res.setHeader('Content-Range', driveStream.headers['content-range']);
          }
          driveStream.data.pipe(res);
          return;
        }
      }

      res.status(404).json({ error: 'Media stream not found' });
    } catch (error: any) {
      console.error('Deliver media error:', error);
      res.status(500).json({ error: 'Media delivery error: ' + error.message });
    }
  }

  /**
   * Lists media assets with search, tags, and folder filters.
   */
  static async listMedia(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const folder = req.query.folder as string;
      const tag = req.query.tag as string;
      const resourceType = req.query.resource_type as string;
      const search = req.query.search as string;
      const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));

      const filter: any = {
        userId,
        isTrash: false,
        $or: [{ isMediaApi: true }, { publicId: { $exists: true, $ne: null } }],
      };

      if (folder) {
        filter.publicId = { $regex: new RegExp(`^${folder}/`, 'i') };
      }

      if (tag) {
        filter.tags = tag;
      }

      if (resourceType && ['image', 'video', 'raw'].includes(resourceType)) {
        filter.resourceType = resourceType;
      }

      if (search) {
        filter.$or = [
          { publicId: { $regex: search, $options: 'i' } },
          { filename: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } },
        ];
      }

      const files = await File.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      const host = req.get('host') || 'localhost:5001';
      const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const baseUrl = `${protocol}://${host}`;

      const resources = files.map((f: any) => {
        const publicId = f.publicId || f.filename;
        const ext = f.mimeType?.split('/')[1] || 'webp';
        return {
          asset_id: f._id.toString(),
          public_id: publicId,
          version: f.currentVersion || 1,
          format: ext,
          resource_type: f.resourceType || (f.mimeType?.startsWith('image/') ? 'image' : 'raw'),
          created_at: f.createdAt,
          bytes: f.sizeBytes,
          width: f.metadata?.width,
          height: f.metadata?.height,
          url: `${baseUrl}/api/v1/media/${publicId}`,
          secure_url: `${baseUrl.replace('http://', 'https://')}/api/v1/media/${publicId}`,
          thumbnail_url: `${baseUrl}/api/v1/media/image/upload/w_250,h_250,c_thumb/${publicId}`,
          tags: f.tags || [],
        };
      });

      res.json({
        resources,
        total: resources.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Deletes a media asset by publicId.
   */
  static async deleteMedia(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const rawPublicId = req.params.publicId || req.params[0] || '';

      const file = await File.findOne({
        userId,
        $or: [{ publicId: rawPublicId }, { _id: Types.ObjectId.isValid(rawPublicId) ? new Types.ObjectId(rawPublicId) : null }],
      });

      if (!file) {
        res.status(404).json({ error: 'Media asset not found: ' + rawPublicId });
        return;
      }

      // Delete from Google Drive if stored there
      for (const version of file.versions) {
        try {
          const account = await StorageAccount.findById(version.storageAccountId);
          if (account) {
            await GoogleDriveService.deleteFile(account, version.providerFileId);
            account.usedStorageBytes = Math.max(0, account.usedStorageBytes - version.sizeBytes);
            await account.save();
          }
        } catch (err) {
          console.warn('Could not delete file from Google Drive:', err);
        }
      }

      // Clean local original file
      const localOriginal = path.join(ORIGINALS_DIR, `${file._id}.bin`);
      if (fs.existsSync(localOriginal)) {
        try {
          fs.unlinkSync(localOriginal);
        } catch {}
      }

      // Delete from database
      await File.deleteOne({ _id: file._id });

      res.json({ result: 'ok', public_id: rawPublicId, deleted: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Updates tags on a media asset.
   */
  static async updateTags(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const rawPublicId = req.params.publicId || req.params[0] || '';
      const { tags, action = 'set' } = req.body; // action: 'set' | 'add' | 'remove'

      const file = await File.findOne({
        userId,
        $or: [{ publicId: rawPublicId }, { _id: Types.ObjectId.isValid(rawPublicId) ? new Types.ObjectId(rawPublicId) : null }],
      });

      if (!file) {
        res.status(404).json({ error: 'Media asset not found: ' + rawPublicId });
        return;
      }

      const inputTags = Array.isArray(tags)
        ? tags.map((t) => String(t).trim()).filter(Boolean)
        : typeof tags === 'string'
        ? tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [];

      if (action === 'add') {
        file.tags = Array.from(new Set([...(file.tags || []), ...inputTags]));
      } else if (action === 'remove') {
        file.tags = (file.tags || []).filter((t) => !inputTags.includes(t));
      } else {
        file.tags = inputTags;
      }

      await file.save();

      res.json({ result: 'ok', public_id: file.publicId, tags: file.tags });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
