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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const { filename, mimeType, sizeBytes, contentHash, folderId, isEncrypted } = req.body;

      if (!filename || !mimeType || !sizeBytes || !contentHash) {
        res.status(400).json({ error: 'Missing required fields: filename, mimeType, sizeBytes, contentHash' });
        return;
      }

      // Check for exact content duplicate (Zero-Knowledge Deduplication)
      const existingDuplicate = await StorageEngineService.findExistingDuplicate(req.user._id, contentHash);
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
      const targetAccount = await StorageEngineService.selectTargetAccount(req.user._id, sizeBytes);

      // Unique opaque filename for Google Drive (opaque for Zero-Knowledge privacy)
      const driveOpaqueName = isEncrypted
        ? `blob_${Date.now()}_${new Types.ObjectId().toString()}.enc`
        : `file_${Date.now()}_${filename}`;

      let resumableSessionUri = '';

      // Check if this account is a dev mock account or if Google API credentials are mock
      const isMockAccount =
        targetAccount.googleDriveAccountId.startsWith('sub_mock_') ||
        targetAccount.accountEmail.includes('mock.drive') ||
        targetAccount.encryptedRefreshToken === 'mock_refresh_token_dev' ||
        process.env.GDRIVE_CLIENT_ID === 'mock_gdrive_client_id';

      if (isMockAccount) {
        resumableSessionUri = `/api/v1/files/mock-upload/${encodeURIComponent(driveOpaqueName)}`;
      } else {
        const clientOrigin = (req.headers.origin as string) || (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
        resumableSessionUri = await GoogleDriveService.createResumableUploadSession(targetAccount, {
          name: driveOpaqueName,
          mimeType: isEncrypted ? 'application/octet-stream' : mimeType,
          sizeBytes,
          origin: clientOrigin,
        });
      }

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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

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
        userId: req.user._id,
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
        io.to(`user:${req.user._id}`).emit('file:uploaded', {
          fileId: file._id,
          filename: file.filename,
          sizeBytes: file.sizeBytes,
          isDuplicate,
        });
      }

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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const folderId = req.query.folderId as string;
      const search = req.query.search as string;
      const isTrash = req.query.isTrash === 'true';

      const filter: any = {
        userId: req.user._id, // Strict IDOR protection
        isTrash,
      };

      if (folderId && folderId !== 'root') {
        filter.folderId = new Types.ObjectId(folderId);
      } else if (!search && !isTrash) {
        filter.folderId = null; // Root folder
      }

      if (search) {
        filter.filename = { $regex: search, $options: 'i' };
      }

      const files = await File.find(filter).sort({ createdAt: -1 }).limit(200);

      let recentFiles: any[] = [];
      if ((!folderId || folderId === 'root') && !search && !isTrash) {
        recentFiles = await File.find({ userId: req.user._id, isTrash: false })
          .sort({ createdAt: -1 })
          .limit(20);
      }

      res.json({ files, recentFiles });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Returns media files (photos & videos) grouped by date for the Gallery timeline.
   */
  static async getGallery(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const mediaFilter = {
        userId: req.user._id,
        isTrash: false,
        $or: [{ mimeType: { $regex: '^image/' } }, { mimeType: { $regex: '^video/' } }],
      };

      const mediaFiles = await File.find(mediaFilter).sort({
        'metadata.takenAt': -1,
        createdAt: -1,
      }).limit(500);

      res.json({ media: mediaFiles });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Streams a file from Google Drive for client download or browser decryption.
   */
  static async streamFile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const file = await File.findOne({
        _id: req.params.id,
        userId: req.user._id, // Strict IDOR check
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
        userId: req.user._id,
      });

      if (!account) {
        res.status(404).json({ error: 'Associated storage account not found' });
        return;
      }

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);

      // Check if dev mock account
      const isMock =
        account.googleDriveAccountId.startsWith('sub_mock_') ||
        account.accountEmail.includes('mock.drive') ||
        account.encryptedRefreshToken === 'mock_refresh_token_dev' ||
        process.env.GDRIVE_CLIENT_ID === 'mock_gdrive_client_id';

      if (isMock) {
        const localPath = path.join(UPLOAD_DIR, latestVersion.providerFileId);
        if (fs.existsSync(localPath)) {
          res.sendFile(localPath);
          return;
        }
        res.send(`Mock file content for: ${file.filename}`);
        return;
      }

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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const file = await File.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id },
        { isTrash: true, trashedAt: new Date(), trashedByDeviceId: req.device?.deviceId || 'web' },
        { new: true }
      );

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const file = await File.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id },
        { isTrash: false, trashedAt: null },
        { new: true }
      );

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const file = await File.findOne({
        _id: req.params.id,
        userId: req.user._id,
      });

      if (!file) {
        res.status(404).json({ error: 'File not found or access denied' });
        return;
      }

      // Delete each physical version from Google Drive
      for (const version of file.versions) {
        try {
          const account = await StorageAccount.findById(version.storageAccountId);
          const isMock =
            account?.googleDriveAccountId.startsWith('sub_mock_') ||
            account?.accountEmail.includes('mock.drive') ||
            account?.encryptedRefreshToken === 'mock_refresh_token_dev' ||
            process.env.GDRIVE_CLIENT_ID === 'mock_gdrive_client_id';

          if (isMock) {
            const localPath = path.join(UPLOAD_DIR, version.providerFileId);
            if (fs.existsSync(localPath)) {
              fs.unlinkSync(localPath);
            }
          } else if (account) {
            await GoogleDriveService.deleteFile(account, version.providerFileId);
          }

          if (account) {
            await StorageAccount.findByIdAndUpdate(account._id, {
              $inc: { usedStorageBytes: -version.sizeBytes },
            });
          }
        } catch (delError) {
          console.warn(`Failed to delete physical file ${version.providerFileId}:`, delError);
        }
      }

      await File.findByIdAndDelete(file._id);

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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const { name, parentFolderId } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Folder name is required' });
        return;
      }

      let path = `/${name}/`;
      if (parentFolderId) {
        const parent = await Folder.findOne({ _id: parentFolderId, userId: req.user._id });
        if (parent) {
          path = `${parent.path}${name}/`;
        }
      }

      const folder = await Folder.create({
        userId: req.user._id,
        parentFolderId: parentFolderId ? new Types.ObjectId(parentFolderId) : null,
        name,
        path,
      });

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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const userId = req.user._id;
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
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const parentFolderId = req.query.parentFolderId as string;
      const filter: any = {
        userId: req.user._id,
        isTrash: false,
      };

      let currentFolder = null;
      let breadcrumbs: Array<{ id: string | null; name: string }> = [
        { id: null, name: 'My Drive' },
      ];

      if (parentFolderId && parentFolderId !== 'root' && Types.ObjectId.isValid(parentFolderId)) {
        filter.parentFolderId = new Types.ObjectId(parentFolderId);
        currentFolder = await Folder.findOne({ _id: parentFolderId, userId: req.user._id });

        // Trace breadcrumbs upwards
        const trail: Array<{ id: string; name: string }> = [];
        let curr = currentFolder;
        while (curr) {
          trail.unshift({ id: curr._id.toString(), name: curr.name });
          if (curr.parentFolderId) {
            curr = await Folder.findOne({ _id: curr.parentFolderId, userId: req.user._id });
          } else {
            break;
          }
        }
        breadcrumbs = [{ id: null, name: 'My Drive' }, ...trail];
      } else {
        filter.parentFolderId = null;
      }

      const folders = await Folder.find(filter).sort({ name: 1 });
      res.json({ folders, currentFolder, breadcrumbs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Receives binary file stream for local dev mock accounts and writes to uploads directory.
   */
  static async handleMockUpload(req: Request, res: Response): Promise<void> {
    try {
      const fileId = req.params.fileId;
      const filePath = path.join(UPLOAD_DIR, fileId);
      const writeStream = fs.createWriteStream(filePath);

      req.pipe(writeStream);

      writeStream.on('finish', () => {
        res.status(200).send('OK');
      });

      writeStream.on('error', (err) => {
        res.status(500).json({ error: err.message });
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
