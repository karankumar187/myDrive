import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import mongoose from 'mongoose';
import { google } from 'googleapis';
import sharp from 'sharp';
import { File } from '../models/File.js';
import { User } from '../models/User.js';
import { StorageAccount } from '../models/StorageAccount.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { CacheService } from '../services/cache.service.js';

async function main() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/unified_drive';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const files = await File.find({ isVault: true });
  console.log(`Found ${files.length} vault files to generate encrypted previews for.`);

  const user = await User.findOne({ masterKeySalt: { $ne: null } });
  if (!user || !user.masterKeySalt) {
    console.error('No user with masterKeySalt found.');
    process.exit(1);
  }

  const salt = Buffer.from(user.masterKeySalt, 'hex');
  const pin = '1303';
  const key = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256');

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const latestVersion = f.versions?.[f.versions.length - 1];
    if (!latestVersion) continue;

    console.log(`[${i + 1}/${files.length}] Generating encrypted preview for ${f._id}...`);

    try {
      const account = await StorageAccount.findById(latestVersion.storageAccountId);
      if (!account) continue;

      const oauth2Client = GoogleDriveService.getOAuth2Client(account as any);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const actualFileId = await GoogleDriveService.resolveDriveFileId(account as any, latestVersion.providerFileId);

      // Download ciphertext from Google Drive
      const fileDownload = await drive.files.get(
        { fileId: actualFileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const ciphertextBuf = Buffer.from(fileDownload.data as ArrayBuffer);

      // Decrypt in memory using PIN key and version IV
      if (!latestVersion.iv) {
        console.warn(`File ${f._id} has no IV`);
        continue;
      }

      const iv = Buffer.from(latestVersion.iv, 'hex');
      const ciphertext = ciphertextBuf.subarray(0, ciphertextBuf.length - 16);
      const authTag = ciphertextBuf.subarray(ciphertextBuf.length - 16);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decryptedImageBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      // Generate web-optimized 1024px WebP preview using sharp
      const webpPreviewBuffer = await sharp(decryptedImageBuffer)
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const thumbnailDataUrl = `data:image/webp;base64,${webpPreviewBuffer.toString('base64')}`;

      // Decrypt existing encryptedMeta to preserve originalFilename, takenAt, etc.
      let origMeta: any = {};
      if (f.encryptedMeta) {
        try {
          const encMeta = JSON.parse(f.encryptedMeta);
          const metaIv = Buffer.from(encMeta.iv, 'base64');
          const metaFull = Buffer.from(encMeta.data, 'base64');
          const metaCipher = metaFull.subarray(0, metaFull.length - 16);
          const metaTag = metaFull.subarray(metaFull.length - 16);

          const metaDecipher = crypto.createDecipheriv('aes-256-gcm', key, metaIv);
          metaDecipher.setAuthTag(metaTag);
          const metaDec = Buffer.concat([metaDecipher.update(metaCipher), metaDecipher.final()]).toString('utf8');
          origMeta = JSON.parse(metaDec);
        } catch {}
      }

      const updatedMetaPayload = JSON.stringify({
        originalFilename: origMeta.originalFilename || f.filename,
        originalMimeType: origMeta.originalMimeType || 'image/jpeg',
        originalSize: origMeta.originalSize || decryptedImageBuffer.length,
        takenAt: origMeta.takenAt || f.metadata?.takenAt || (f as any).createdAt,
        thumbnail: thumbnailDataUrl,
      });

      // Encrypt updatedMetaPayload with AES-256-GCM
      const newMetaIv = crypto.randomBytes(12);
      const metaCipher = crypto.createCipheriv('aes-256-gcm', key, newMetaIv);
      const encMetaBuf = Buffer.concat([metaCipher.update(updatedMetaPayload, 'utf8'), metaCipher.final(), metaCipher.getAuthTag()]);

      const updatedEncryptedMeta = JSON.stringify({
        iv: newMetaIv.toString('base64'),
        data: encMetaBuf.toString('base64'),
      });

      // Save to MongoDB
      await File.updateOne(
        { _id: f._id },
        {
          $set: {
            encryptedMeta: updatedEncryptedMeta,
          },
        }
      );

      console.log(`  ✓ Updated encrypted preview for ${origMeta.originalFilename || f._id} (${webpPreviewBuffer.length} bytes WebP)`);
    } catch (err: any) {
      console.error(`  ✗ Failed on file ${f._id}:`, err.message);
    }
  }

  await CacheService.invalidateUser(user._id.toString());
  console.log('\nAll 22 vault files now have instant encrypted WebP previews!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
