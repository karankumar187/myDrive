import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose, { Types } from 'mongoose';
import { File } from '../models/File.js';
import { User } from '../models/User.js';
import { StorageAccount } from '../models/StorageAccount.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { CacheService } from '../services/cache.service.js';

const CACHE_FILES_DIR = process.env.CACHE_DIR
  ? path.join(process.env.CACHE_DIR, 'files')
  : path.join(process.cwd(), 'uploads', 'cache', 'files');

const CACHE_PREVIEWS_DIR = process.env.CACHE_DIR
  ? path.join(process.env.CACHE_DIR, 'previews')
  : path.join(process.cwd(), 'uploads', 'cache', 'previews');

async function main() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/unified_drive';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  const unencryptedVaultFiles = await File.find({
    isVault: true,
    $or: [
      { 'versions.isEncrypted': { $ne: true } },
      { 'versions.iv': null },
    ],
  });

  console.log(`Found ${unencryptedVaultFiles.length} vault files requiring Zero-Knowledge encryption.`);

  if (unencryptedVaultFiles.length === 0) {
    console.log('All vault files are already fully encrypted!');
    process.exit(0);
  }

  // Group files by user
  const filesByUser = new Map<string, typeof unencryptedVaultFiles>();
  for (const f of unencryptedVaultFiles) {
    const uId = f.userId.toString();
    if (!filesByUser.has(uId)) filesByUser.set(uId, []);
    filesByUser.get(uId)!.push(f);
  }

  for (const [userIdStr, files] of filesByUser.entries()) {
    const user = await User.findById(userIdStr);
    if (!user || !user.masterKeySalt) {
      console.warn(`User ${userIdStr} does not have masterKeySalt setup. Skipping.`);
      continue;
    }

    // Derive user's Zero-Knowledge AES-256-GCM key from PIN
    const salt = Buffer.from(user.masterKeySalt, 'hex');
    const pin = '1303'; // Verified user PIN
    const key = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256');

    console.log(`\nProcessing ${files.length} vault files for user: ${user.name} (${user.email})...`);

    let successCount = 0;
    let failCount = 0;

    for (const f of files) {
      try {
        console.log(`[${successCount + failCount + 1}/${files.length}] Encrypting "${f.filename}" (${f._id})...`);

        const latestVersion = f.versions?.[f.versions.length - 1];
        if (!latestVersion) {
          console.warn(`No version for file ${f._id}`);
          failCount++;
          continue;
        }

        const account = await StorageAccount.findById(latestVersion.storageAccountId);
        if (!account) {
          console.warn(`No storage account for file ${f._id}`);
          failCount++;
          continue;
        }

        // 1. Download raw file from Google Drive (or local cache)
        const cachedFilePath = path.join(CACHE_FILES_DIR, f._id.toString());
        let rawBuffer: Buffer;

        if (fs.existsSync(cachedFilePath)) {
          rawBuffer = fs.readFileSync(cachedFilePath);
        } else {
          const streamRes = await GoogleDriveService.getFileStream(account, latestVersion.providerFileId);
          const chunks: Buffer[] = [];
          for await (const chunk of streamRes.data) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          rawBuffer = Buffer.concat(chunks);
        }

        if (!rawBuffer || rawBuffer.length === 0) {
          console.warn(`Empty buffer for file ${f._id}`);
          failCount++;
          continue;
        }

        // 2. Encrypt bytes using AES-256-GCM with PIN-derived key
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([cipher.update(rawBuffer), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const finalEncryptedBuffer = Buffer.concat([ciphertext, authTag]);
        const ivHex = iv.toString('hex');
        const newContentHash = crypto.createHash('sha256').update(finalEncryptedBuffer).digest('hex');

        // 3. Encrypt metadata if not yet encrypted
        let encryptedMeta = f.encryptedMeta;
        if (!encryptedMeta) {
          const metaPayload = JSON.stringify({
            originalFilename: f.filename,
            originalMimeType: f.mimeType,
            originalSize: f.sizeBytes,
            takenAt: f.metadata?.takenAt || (f as any).createdAt,
            thumbnail: f.metadata?.thumbnail,
          });
          const metaIv = crypto.randomBytes(12);
          const metaCipher = crypto.createCipheriv('aes-256-gcm', key, metaIv);
          const encMetaBuf = Buffer.concat([metaCipher.update(metaPayload, 'utf8'), metaCipher.final(), metaCipher.getAuthTag()]);
          encryptedMeta = JSON.stringify({
            iv: metaIv.toString('base64'),
            data: encMetaBuf.toString('base64'),
          });
        }

        // 4. Overwrite physical file content on Google Drive with ciphertext
        const opaqueFilename = `vault_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.enc`;
        const actualFileId = await GoogleDriveService.updateFileContent(
          account,
          latestVersion.providerFileId,
          finalEncryptedBuffer,
          {
            name: opaqueFilename,
            mimeType: 'application/octet-stream',
          }
        );

        // 5. Update MongoDB record
        await File.updateOne(
          { _id: f._id, 'versions.versionNumber': latestVersion.versionNumber },
          {
            $set: {
              filename: opaqueFilename,
              mimeType: 'application/octet-stream',
              sizeBytes: finalEncryptedBuffer.length,
              contentHash: newContentHash,
              encryptedMeta,
              'metadata.thumbnail': null,
              'metadata.exif': {},
              'versions.$.isEncrypted': true,
              'versions.$.iv': ivHex,
              'versions.$.sizeBytes': finalEncryptedBuffer.length,
              'versions.$.contentHash': newContentHash,
              'versions.$.providerFileId': actualFileId || latestVersion.providerFileId,
            },
          }
        );

        // 6. Purge local NVMe disk caches
        try { if (fs.existsSync(cachedFilePath)) fs.unlinkSync(cachedFilePath); } catch {}
        const cachedPreviewPath = path.join(CACHE_PREVIEWS_DIR, `${f._id.toString()}.webp`);
        try { if (fs.existsSync(cachedPreviewPath)) fs.unlinkSync(cachedPreviewPath); } catch {}

        successCount++;
        console.log(`  ✓ Successfully encrypted ${f._id} -> ${opaqueFilename} (${finalEncryptedBuffer.length} bytes)`);
      } catch (err: any) {
        console.error(`  ✗ Failed to encrypt file ${f._id}:`, err.message);
        failCount++;
      }
    }

    await CacheService.invalidateUser(userIdStr);
    console.log(`\nUser ${user.email} finished: ${successCount} encrypted, ${failCount} failed.`);
  }

  console.log('\nAll done!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal script error:', err);
  process.exit(1);
});
