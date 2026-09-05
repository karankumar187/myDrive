import { Types } from 'mongoose';
import { StorageAccount } from '../models/StorageAccount.js';
import { File } from '../models/File.js';
import { DeviceFileState } from '../models/DeviceFileState.js';
import { SyncEvent } from '../models/SyncEvent.js';
import { Tombstone } from '../models/Tombstone.js';
import { IStorageAccountDocument, IFileDocument, IFileMetadata } from '../types/index.js';
import { GoogleDriveService } from './gdrive.service.js';

export interface StoragePoolSummary {
  totalCapacityBytes: number;
  usedCapacityBytes: number;
  availableCapacityBytes: number;
  percentUsed: number;
  totalAccounts: number;
  healthyAccounts: number;
  accounts: Array<{
    id: string;
    email: string;
    name: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    percentUsed: number;
    status: string;
    isPrimary: boolean;
  }>;
}

export class StorageEngineService {
  /**
   * Aggregates pooled capacity and per-account statistics for a user.
   */
  static async getPoolSummary(userId: Types.ObjectId): Promise<StoragePoolSummary> {
    const accounts = await StorageAccount.find({ userId });

    let totalCapacityBytes = 0;
    let usedCapacityBytes = 0;
    let healthyCount = 0;

    const accountBreakdowns = accounts.map((acc) => {
      totalCapacityBytes += acc.totalStorageBytes;
      usedCapacityBytes += acc.usedStorageBytes;
      if (acc.status === 'healthy') healthyCount++;

      const availableBytes = Math.max(0, acc.totalStorageBytes - acc.usedStorageBytes);
      const percentUsed =
        acc.totalStorageBytes > 0
          ? Math.min(100, Math.round((acc.usedStorageBytes / acc.totalStorageBytes) * 100))
          : 0;

      return {
        id: acc._id.toString(),
        email: acc.accountEmail,
        name: acc.accountName,
        totalBytes: acc.totalStorageBytes,
        usedBytes: acc.usedStorageBytes,
        availableBytes,
        percentUsed,
        status: acc.status,
        isPrimary: acc.isPrimary,
      };
    });

    const availableCapacityBytes = Math.max(0, totalCapacityBytes - usedCapacityBytes);
    const percentUsed =
      totalCapacityBytes > 0
        ? Math.min(100, Math.round((usedCapacityBytes / totalCapacityBytes) * 100))
        : 0;

    return {
      totalCapacityBytes,
      usedCapacityBytes,
      availableCapacityBytes,
      percentUsed,
      totalAccounts: accounts.length,
      healthyAccounts: healthyCount,
      accounts: accountBreakdowns,
    };
  }

  /**
   * Intelligently selects the best Google Drive account for an incoming file upload.
   * Enforces a 500 MB safety buffer so accounts never fill to 100% and break Gmail.
   */
  static async selectTargetAccount(
    userId: Types.ObjectId,
    fileSizeBytes: number
  ): Promise<IStorageAccountDocument> {
    const SAFETY_BUFFER_BYTES = 500 * 1024 * 1024; // 500 MB margin

    const eligibleAccounts = await StorageAccount.find({
      userId,
      status: 'healthy',
    });

    if (eligibleAccounts.length === 0) {
      throw new Error('No active or healthy storage accounts connected. Please link at least one Google Drive account.');
    }

    // Filter accounts with sufficient remaining room
    const capableAccounts = eligibleAccounts.filter((acc) => {
      const remainingBytes = acc.totalStorageBytes - acc.usedStorageBytes - SAFETY_BUFFER_BYTES;
      return remainingBytes >= fileSizeBytes;
    });

    if (capableAccounts.length === 0) {
      throw new Error(
        `Insufficient pooled storage. File size (${Math.round(
          fileSizeBytes / (1024 * 1024)
        )}MB) exceeds available capacity in any single connected account with 500MB safety margin.`
      );
    }

    // Sort by largest available space (Balanced allocation)
    capableAccounts.sort((a, b) => {
      const aAvailable = a.totalStorageBytes - a.usedStorageBytes;
      const bAvailable = b.totalStorageBytes - b.usedStorageBytes;
      return bAvailable - aAvailable;
    });

    return capableAccounts[0];
  }

  /**
   * Checks if an exact identical file already exists in the user's unified cloud.
   * Returns existing file document if found (Instant Deduplication!).
   * Checks contentHash (case-insensitive), trashed status, and filename + sizeBytes fallback.
   */
  static async findExistingDuplicate(
    userId: Types.ObjectId,
    contentHash: string,
    filename?: string,
    sizeBytes?: number
  ): Promise<IFileDocument | null> {
    const cleanHash = contentHash ? contentHash.trim().toLowerCase() : '';

    if (cleanHash) {
      // 1. By contentHash (case-insensitive) among active files
      const activeByHash = await File.findOne({
        userId,
        contentHash: { $regex: new RegExp(`^${cleanHash}$`, 'i') },
        isTrash: false,
      });
      if (activeByHash) return activeByHash;

      // 2. If it's already in Trash, treat as duplicate to avoid re-uploading trashed photos
      const trashedByHash = await File.findOne({
        userId,
        contentHash: { $regex: new RegExp(`^${cleanHash}$`, 'i') },
        isTrash: true,
      });
      if (trashedByHash) return trashedByHash;
    }

    // 3. Robust fallback: filename + sizeBytes matching!
    if (filename && typeof sizeBytes === 'number' && sizeBytes > 0) {
      const cleanName = filename.trim();
      const byNameAndSize = await File.findOne({
        userId,
        filename: cleanName,
        sizeBytes,
        isTrash: false,
      });
      if (byNameAndSize) return byNameAndSize;

      const trashedByNameAndSize = await File.findOne({
        userId,
        filename: cleanName,
        sizeBytes,
        isTrash: true,
      });
      if (trashedByNameAndSize) return trashedByNameAndSize;
    }

    // 4. Check Tombstone records (permanently deleted files) so they are NEVER re-uploaded on sync
    if (cleanHash) {
      const tombstoneByHash = await Tombstone.findOne({
        userId,
        contentHash: { $regex: new RegExp(`^${cleanHash}$`, 'i') },
      });
      if (tombstoneByHash) {
        return {
          _id: tombstoneByHash._id,
          filename: tombstoneByHash.filename,
          isTrash: true,
          isTombstone: true,
        } as any;
      }
    }

    if (filename && typeof sizeBytes === 'number' && sizeBytes > 0) {
      const cleanName = filename.trim();
      const tombstoneByNameAndSize = await Tombstone.findOne({
        userId,
        filename: cleanName,
        sizeBytes,
      });
      if (tombstoneByNameAndSize) {
        return {
          _id: tombstoneByNameAndSize._id,
          filename: tombstoneByNameAndSize.filename,
          isTrash: true,
          isTombstone: true,
        } as any;
      }
    }

    return null;
  }

  /**
   * Finalizes an upload after client finishes streaming bytes to Google Drive.
   * Handles deduplication links, version updates, and sync checkpoints.
   */
  static async finalizeUpload(params: {
    userId: Types.ObjectId;
    folderId?: Types.ObjectId | null;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
    storageAccountId: Types.ObjectId;
    providerFileId: string;
    deviceId?: string;
    deviceAssetId?: string;
    isEncrypted?: boolean;
    iv?: string;
    metadata?: IFileMetadata;
  }): Promise<{ file: IFileDocument; isDuplicate: boolean }> {
    const {
      userId,
      folderId,
      filename,
      mimeType,
      sizeBytes,
      contentHash,
      storageAccountId,
      providerFileId,
      deviceId,
      deviceAssetId,
      isEncrypted = false,
      iv,
      metadata = {},
    } = params;

    // Check for exact content duplicate
    const existingFile = await this.findExistingDuplicate(userId, contentHash, filename, sizeBytes);

    if (existingFile) {
      // Content already exists! Link this device as a source without duplicate Drive storage
      if (deviceId && !existingFile.sourceDeviceIds.includes(deviceId)) {
        existingFile.sourceDeviceIds.push(deviceId);
        await existingFile.save();
      }

      // Record device local presence
      if (deviceId) {
        await DeviceFileState.findOneAndUpdate(
          { userId, deviceId, fileId: existingFile._id },
          {
            deviceAssetId,
            isLocallyPresent: true,
            lastSeenLocalAt: new Date(),
          },
          { upsert: true, new: true }
        );
      }

      return { file: existingFile, isDuplicate: true };
    }

    // Check if updating an existing file name/asset in the same folder
    let existingByName = await File.findOne({
      userId,
      folderId: folderId || null,
      filename,
      isTrash: false,
    });

    let savedFile: IFileDocument;

    if (existingByName) {
      // Create new version
      const nextVersionNumber = existingByName.currentVersion + 1;
      existingByName.currentVersion = nextVersionNumber;
      existingByName.sizeBytes = sizeBytes;
      existingByName.contentHash = contentHash;
      existingByName.metadata = { ...existingByName.metadata, ...metadata };

      existingByName.versions.push({
        versionNumber: nextVersionNumber,
        storageAccountId,
        providerFileId,
        sizeBytes,
        contentHash,
        isEncrypted,
        iv,
        createdAt: new Date(),
      });

      if (deviceId && !existingByName.sourceDeviceIds.includes(deviceId)) {
        existingByName.sourceDeviceIds.push(deviceId);
      }

      savedFile = await existingByName.save();
    } else {
      // Brand new file
      savedFile = await File.create({
        userId,
        folderId: folderId || null,
        filename,
        mimeType,
        sizeBytes,
        contentHash,
        currentVersion: 1,
        versions: [
          {
            versionNumber: 1,
            storageAccountId,
            providerFileId,
            sizeBytes,
            contentHash,
            isEncrypted,
            iv,
            createdAt: new Date(),
          },
        ],
        metadata,
        isTrash: false,
        sourceDeviceIds: deviceId ? [deviceId] : [],
      });
    }

    // Increment storage account usage in database
    await StorageAccount.findByIdAndUpdate(storageAccountId, {
      $inc: { usedStorageBytes: sizeBytes },
    });

    // Record device presence
    if (deviceId) {
      await DeviceFileState.findOneAndUpdate(
        { userId, deviceId, fileId: savedFile._id },
        {
          deviceAssetId,
          isLocallyPresent: true,
          lastSeenLocalAt: new Date(),
        },
        { upsert: true, new: true }
      );
    }

    // Emit sync event for change feed
    const lastEvent = await SyncEvent.findOne({ userId }).sort({ checkpoint: -1 });
    const nextCheckpoint = (lastEvent?.checkpoint || 0) + 1;

    await SyncEvent.create({
      userId,
      checkpoint: nextCheckpoint,
      action: existingByName ? 'FILE_UPDATED' : 'FILE_UPLOADED',
      targetId: savedFile._id,
      targetType: 'file',
      originDeviceId: deviceId,
      payload: {
        filename: savedFile.filename,
        sizeBytes: savedFile.sizeBytes,
        folderId: savedFile.folderId,
      },
    });

    return { file: savedFile, isDuplicate: false };
  }
}
