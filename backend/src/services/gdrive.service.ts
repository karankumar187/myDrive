import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { IStorageAccountDocument } from '../types/index.js';
import { CryptoService } from './crypto.service.js';

export class GoogleDriveService {
  /**
   * Initializes a Google OAuth2 client configured for a specific storage account.
   */
  static getOAuth2Client(account?: IStorageAccountDocument): OAuth2Client {
    const clientId = process.env.GDRIVE_CLIENT_ID || process.env.GOOGLE_AUTH_CLIENT_ID;
    const clientSecret = process.env.GDRIVE_CLIENT_SECRET || process.env.GOOGLE_AUTH_CLIENT_SECRET;
    const redirectUri = process.env.GDRIVE_REDIRECT_URI || 'http://localhost:5000/api/v1/storage/connect/callback';

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    if (account) {
      // Decrypt the stored refresh token
      const refreshToken = CryptoService.decrypt({
        ciphertext: account.encryptedRefreshToken,
        iv: account.refreshTokenIv,
        authTag: account.refreshTokenAuthTag,
      });

      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });
    }

    return oauth2Client;
  }

  /**
   * Generates the OAuth authorization URL for connecting a new Google Drive storage account.
   * Forces permanent offline access via prompt=consent and access_type=offline.
   */
  static generateAuthUrl(state: string): string {
    const oauth2Client = this.getOAuth2Client();

    return oauth2Client.generateAuthUrl({
      access_type: 'offline', // Demands a refresh token
      prompt: 'consent', // Forces Google to reissue refresh token so it is never null
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      state, // Contains encrypted userId to prevent CSRF
    });
  }

  /**
   * Exchanges an OAuth authorization code for permanent tokens.
   */
  static async exchangeCodeForTokens(code: string): Promise<{
    refreshToken: string;
    accessToken?: string | null;
    email: string;
    name: string;
    googleSubId: string;
  }> {
    const oauth2Client = this.getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error('No refresh token returned by Google. Account was previously authorized without prompt=consent.');
    }

    oauth2Client.setCredentials(tokens);

    // Get user identity details for this Drive account
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      email: userInfo.data.email || 'unknown@gmail.com',
      name: userInfo.data.name || 'Google Drive',
      googleSubId: userInfo.data.id || 'unknown_id',
    };
  }

  /**
   * Synchronizes storage quota information directly from Google Drive API.
   */
  static async syncAccountQuota(account: IStorageAccountDocument): Promise<{
    totalBytes: number;
    usedBytes: number;
  }> {
    const oauth2Client = this.getOAuth2Client(account);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const about = await drive.about.get({
      fields: 'storageQuota',
    });

    const quota = about.data.storageQuota;
    // Free tiers have limit ~15GB, unlimited accounts may have undefined limit
    const totalBytes = quota?.limit ? parseInt(quota.limit, 10) : 15 * 1024 * 1024 * 1024;
    const usedBytes = quota?.usage ? parseInt(quota.usage, 10) : 0;

    account.totalStorageBytes = totalBytes;
    account.usedStorageBytes = usedBytes;
    account.lastQuotaSyncAt = new Date();

    // Check if nearing 100% capacity
    if (usedBytes >= totalBytes - 500 * 1024 * 1024) {
      account.status = 'quota_full';
    } else if (account.status === 'quota_full') {
      account.status = 'healthy';
    }

    await account.save();

    return { totalBytes, usedBytes };
  }

  /**
   * Initiates a Google Drive Resumable Upload session.
   * Returns the direct session URL so mobile/web clients can upload large files directly.
   */
  static async createResumableUploadSession(
    account: IStorageAccountDocument,
    metadata: {
      name: string;
      mimeType: string;
      sizeBytes: number;
      origin?: string;
    }
  ): Promise<string> {
    const oauth2Client = this.getOAuth2Client(account);
    const tokenResponse = await oauth2Client.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      throw new Error('Failed to acquire valid access token for storage account');
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': metadata.mimeType,
      'X-Upload-Content-Length': metadata.sizeBytes.toString(),
    };

    if (metadata.origin) {
      headers['Origin'] = metadata.origin;
    }

    // Call Google Drive initiate resumable upload endpoint
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: metadata.name,
        mimeType: metadata.mimeType,
        description: 'Unified Personal Cloud encrypted asset',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Drive API error initiating upload: ${response.status} ${errorText}`);
    }

    const sessionUri = response.headers.get('location');
    if (!sessionUri) {
      throw new Error('No resumable upload session location header returned by Google Drive');
    }

    return sessionUri;
  }

  /**
   * Resolves an opaque file reference (e.g. file_..., blob_...) to an actual Google Drive file ID.
   */
  static async resolveDriveFileId(account: IStorageAccountDocument, providerFileId: string): Promise<string> {
    if (!providerFileId.startsWith('blob_') && !providerFileId.startsWith('file_') && !providerFileId.includes('.enc')) {
      return providerFileId;
    }

    try {
      const oauth2Client = this.getOAuth2Client(account);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const escapeQueryStr = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      // 1. First attempt: exact match on the full providerFileId (which was used as Google Drive file name)
      const exactQuery = `name = '${escapeQueryStr(providerFileId)}' and trashed = false`;
      const listRes = await drive.files.list({
        q: exactQuery,
        fields: 'files(id, name)',
        pageSize: 1,
      });

      if (listRes.data.files && listRes.data.files.length > 0 && listRes.data.files[0].id) {
        return listRes.data.files[0].id;
      }

      // 2. Second attempt: search by basename (part after last underscore)
      const lastUnderscore = providerFileId.lastIndexOf('_');
      if (lastUnderscore !== -1) {
        const baseName = providerFileId.substring(lastUnderscore + 1);
        if (baseName) {
          const baseNameQuery = `name = '${escapeQueryStr(baseName)}' and trashed = false`;
          const baseRes = await drive.files.list({
            q: baseNameQuery,
            fields: 'files(id, name)',
            pageSize: 1,
          });
          if (baseRes.data.files && baseRes.data.files.length > 0 && baseRes.data.files[0].id) {
            return baseRes.data.files[0].id;
          }
        }
      }
    } catch (err) {
      console.warn('Could not resolve file by name in Google Drive:', err);
    }

    return providerFileId;
  }

  /**
   * Streams a file from Google Drive for client download or browser decryption.
   */
  static async getFileStream(account: IStorageAccountDocument, providerFileId: string, rangeHeader?: string): Promise<any> {
    const oauth2Client = this.getOAuth2Client(account);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const actualFileId = await this.resolveDriveFileId(account, providerFileId);

    const requestOptions: any = { responseType: 'stream' };
    if (rangeHeader) {
      requestOptions.headers = { Range: rangeHeader };
    }

    const res = await drive.files.get(
      {
        fileId: actualFileId,
        alt: 'media',
      },
      requestOptions
    );

    (res as any).resolvedFileId = actualFileId;
    return res;
  }

  /**
   * Permanently deletes a file from the respective Google Drive account.
   */
  static async deleteFile(account: IStorageAccountDocument, providerFileId: string): Promise<void> {
    const oauth2Client = this.getOAuth2Client(account);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    await drive.files.delete({
      fileId: providerFileId,
    });
  }
}
