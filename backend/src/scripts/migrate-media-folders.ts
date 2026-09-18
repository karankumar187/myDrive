import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { File } from '../models/File.js';
import { Folder } from '../models/Folder.js';
import { MediaController } from '../controllers/media.controller.js';
import { CacheService } from '../services/cache.service.js';

async function runMigration() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI is not set in environment.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB successfully.');

  try {
    // Find all media API files currently sitting in root (folderId: null)
    const mediaFiles = await File.find({
      isMediaApi: true,
      folderId: null,
      publicId: { $regex: '/' },
    });

    console.log(`Found ${mediaFiles.length} media files with folderId = null.`);

    let updatedCount = 0;
    const affectedUserIds = new Set<string>();

    for (const file of mediaFiles) {
      if (!file.publicId) continue;
      const lastSlashIdx = file.publicId.lastIndexOf('/');
      if (lastSlashIdx <= 0) continue;

      const folderPath = file.publicId.substring(0, lastSlashIdx);
      const folderId = await MediaController.getOrCreateFolderByPath(file.userId, folderPath);

      if (folderId) {
        file.folderId = folderId;
        await file.save();
        updatedCount++;
        affectedUserIds.add(file.userId.toString());
      }
    }

    console.log(`Successfully migrated ${updatedCount} files into their designated folders.`);

    // Invalidate caches
    for (const userId of affectedUserIds) {
      try {
        await CacheService.invalidateUser(userId);
        console.log(`Invalidated cache for user: ${userId}`);
      } catch (err) {
        console.warn(`Could not invalidate cache for user ${userId}:`, err);
      }
    }

    // Verify
    const remainingNull = await File.countDocuments({
      isMediaApi: true,
      folderId: null,
      publicId: { $regex: '/' },
    });
    console.log(`Remaining files in root with folder in publicId: ${remainingNull}`);

    const folders = await Folder.find({ isTrash: false }).select('name path userId');
    console.log('Current active folders:', folders.map(f => ({ id: f._id, name: f.name, path: f.path })));

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB. Migration completed.');
    process.exit(0);
  }
}

runMigration();
