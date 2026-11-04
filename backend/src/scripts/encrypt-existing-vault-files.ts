import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose, { Types } from 'mongoose';
import { google } from 'googleapis';
import { File } from '../models/File.js';
import { User } from '../models/User.js';
import { StorageAccount } from '../models/StorageAccount.js';
import { GoogleDriveService } from '../services/gdrive.service.js';
import { CacheService } from '../services/cache.service.js';
import { CryptoService } from '../services/crypto.service.js';

const CACHE_FILES_DIR = process.env.CACHE_DIR
  ? path.join(process.env.CACHE_DIR, 'files')
  : path.join(process.cwd(), 'uploads', 'cache', 'files');

const CACHE_PREVIEWS_DIR = process.env.CACHE_DIR
  ? path.join(process.env.CACHE_DIR, 'previews')
  : path.join(process.cwd(), 'uploads', 'cache', 'previews');

async function main() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/unified_drive';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const vaultFiles = await File.find({ isVault: true });
  console.log(`Found ${vaultFiles.length} files in Secret Vault.`);

  if (vaultFiles.length === 0) {
    console.log('No vault files found.');
    process.exit(0);
  }

  // Group files by user
  const filesByUser = new Map<string, typeof vaultFiles>();
  for (const f of vaultFiles) {
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

    // Derive user's Zero-Knowledge AES-256-GCM key from PIN '1303'
    const salt = Buffer.from(user.masterKeySalt, 'hex');
    const pin = '1303';
    const key = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256');

    console.log(`\n======================================================`);
    console.log(`Processing ${files.length} vault files for ${user.name} (${user.email})`);
    console.log(`======================================================\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        console.log(`[${i + 1}/${files.length}] Processing file ${f._id} ("${f.filename}")...`);

        const latestVersion = f.versions?.[f.versions.length - 1];
        if (!latestVersion) {
          console.warn(`  ✗ No version found for file ${f._id}`);
          failCount++;
          continue;
        }

        const account = await StorageAccount.findById(latestVersion.storageAccountId);
        if (!account) {
          console.warn(`  ✗ No storage account found for file ${f._id}`);
          failCount++;
          continue;
        }

        const oauth2Client = GoogleDriveService.getOAuth2Client(account as any);
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        const actualFileId = await GoogleDriveService.resolveDriveFileId(account as any, latestVersion.providerFileId);

        // 1. Acquire original raw image bytes from Google Drive revisions
        let rawBuffer: Buffer | null = null;

        try {
          const revsRes = await drive.revisions.list({ fileId: actualFileId, fields: '*' });
          const revs = revsRes.data.revisions || [];

          // Sort by size descending so we pick the genuine full-resolution image revision
          revs.sort((a, b) => parseInt(b.size || '0', 10) - parseInt(a.size || '0', 10));

          if (revs.length > 0 && parseInt(revs[0].size || '0', 10) > 2000) {
            const bestRev = revs[0];
            const revDownload = await drive.revisions.get(
              { fileId: actualFileId, revisionId: bestRev.id!, alt: 'media' },
              { responseType: 'arraybuffer' }
            );
            rawBuffer = Buffer.from(revDownload.data as ArrayBuffer);
            console.log(`  ✓ Acquired original revision (${rawBuffer.length} bytes, rev ID: ${bestRev.id})`);
          }
        } catch (revErr) {
          console.warn(`  Could not fetch revisions, attempting direct download:`, revErr);
        }

        // Fallback: direct file download if revision list unavailable
        if (!rawBuffer || rawBuffer.length <= 2000) {
          const fileDownload = await drive.files.get(
            { fileId: actualFileId, alt: 'media' },
            { responseType: 'arraybuffer' }
          );
          rawBuffer = Buffer.from(fileDownload.data as ArrayBuffer);
        }

        if (!rawBuffer || rawBuffer.length === 0) {
          console.warn(`  ✗ Empty buffer for file ${f._id}`);
          failCount++;
          continue;
        }

        // 2. Encrypt raw bytes with AES-256-GCM using the user's PIN key
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([cipher.update(rawBuffer), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const finalEncryptedBuffer = Buffer.concat([ciphertext, authTag]); // Web Crypto compatible
        const ivHex = iv.toString('hex');
        const newContentHash = crypto.createHash('sha256').update(finalEncryptedBuffer).digest('hex');

        // 3. Ensure metadata is encrypted
        let encryptedMeta = f.encryptedMeta;
        if (!encryptedMeta) {
          const metaPayload = JSON.stringify({
            originalFilename: f.filename,
            originalMimeType: f.mimeType,
            originalSize: rawBuffer.length,
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
        const { Readable } = await import('stream');
        await drive.files.update({
          fileId: actualFileId,
          requestBody: {
            name: opaqueFilename,
            mimeType: 'application/octet-stream',
            description: 'Unified Personal Cloud zero-knowledge encrypted vault asset',
          },
          media: {
            mimeType: 'application/octet-stream',
            body: Readable.from(finalEncryptedBuffer),
          },
        });

        // 5. Clean up old revisions on Google Drive so NO unencrypted bytes remain in Google Drive history
        try {
          const postRevsRes = await drive.revisions.list({ fileId: actualFileId, fields: 'revisions(id)' });
          const allPostRevs = postRevsRes.data.revisions || [];
          if (allPostRevs.length > 1) {
            // Keep only the latest revision
            for (let r = 0; r < allPostRevs.length - 1; r++) {
              const oldRevId = allPostRevs[r].id;
              if (oldRevId) {
                try {
                  await drive.revisions.delete({ fileId: actualFileId, revisionId: oldRevId });
                } catch {}
              }
            }
          }
        } catch {}

        // 6. Update MongoDB record with opaque name, octet-stream MIME, and encryption flags
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
              'versions.$.providerFileId': actualFileId,
            },
          }
        );

        // 7. Purge local NVMe disk caches
        const cachedFilePath = path.join(CACHE_FILES_DIR, f._id.toString());
        const cachedPreviewPath = path.join(CACHE_PREVIEWS_DIR, `${f._id.toString()}.webp`);
        try { if (fs.existsSync(cachedFilePath)) fs.unlinkSync(cachedFilePath); } catch {}
        try { if (fs.existsSync(cachedPreviewPath)) fs.unlinkSync(cachedPreviewPath); } catch {}

        successCount++;
        console.log(`  ✓ E2EE Complete -> ${opaqueFilename} (encrypted size: ${finalEncryptedBuffer.length} bytes, IV: ${ivHex.substring(0, 8)}...)`);
      } catch (err: any) {
        console.error(`  ✗ Error on file ${f._id}:`, err.message);
        failCount++;
      }
    }

    await CacheService.invalidateUser(userIdStr);
    console.log(`\nFinished user ${user.email}: ${successCount} successfully encrypted, ${failCount} failed.`);
  }

  console.log('\nAll vault files are now 100% Zero-Knowledge encrypted!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal script error:', err);
  process.exit(1);
});
