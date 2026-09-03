import { Document, Types } from 'mongoose';

export type UserRole = 'owner' | 'member';

export interface IUser {
  googleProfileId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: UserRole;
  masterKeySalt?: string; // Salt used for client-side PBKDF2 passphrase key derivation
  encryptedVaultKey?: string; // Encrypted master key wrapped for multi-device sync
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {}

export type StorageAccountStatus = 'healthy' | 'reauth_required' | 'quota_full' | 'disabled';

export interface IStorageAccount {
  userId: Types.ObjectId;
  accountEmail: string;
  accountName: string;
  googleDriveAccountId: string; // Google 'sub' claim for the Drive account
  encryptedRefreshToken: string; // AES-256-GCM encrypted
  refreshTokenIv: string;
  refreshTokenAuthTag: string;
  totalStorageBytes: number;
  usedStorageBytes: number;
  status: StorageAccountStatus;
  isPrimary: boolean;
  lastQuotaSyncAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStorageAccountDocument extends IStorageAccount, Document {}

export interface IFileVersion {
  versionNumber: number;
  storageAccountId: Types.ObjectId;
  providerFileId: string; // Google Drive internal file ID
  sizeBytes: number;
  contentHash: string; // SHA-256
  isEncrypted: boolean;
  iv?: string; // If encrypted client-side
  createdAt: Date;
}

export interface IFileMetadata {
  width?: number;
  height?: number;
  duration?: number;
  takenAt?: Date;
  cameraMake?: string;
  cameraModel?: string;
  orientation?: number;
  latitude?: number;
  longitude?: number;
  exif?: Record<string, any>;
}

export interface IFile {
  userId: Types.ObjectId;
  folderId?: Types.ObjectId | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string; // SHA-256 of raw contents for deduplication
  currentVersion: number;
  versions: IFileVersion[];
  metadata?: IFileMetadata;
  isTrash: boolean;
  trashedAt?: Date | null;
  trashedByDeviceId?: string | null;
  sourceDeviceIds: string[]; // Devices that hold or uploaded this file
  createdAt: Date;
  updatedAt: Date;
}

export interface IFileDocument extends IFile, Document {}

export interface IFolder {
  userId: Types.ObjectId;
  parentFolderId?: Types.ObjectId | null;
  name: string;
  path: string; // Materialized path (e.g. "/Photos/Vacation/")
  color?: string;
  isTrash: boolean;
  trashedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFolderDocument extends IFolder, Document {}

export type DeviceType = 'android' | 'iphone' | 'web' | 'desktop';

export interface IDevicePolicy {
  uploadFolders: string[]; // e.g. ["Camera", "WhatsApp", "Screenshots"]
  wifiOnly: boolean;
  chargingOnly: boolean;
  autoDeleteLocalAfterBackup: boolean;
  downloadMode: 'cloud_only' | 'auto_download';
  autoDownloadFolders: string[];
  deletionMode: 'keep_in_cloud' | 'mirror_deletion';
}

export interface IDevice {
  userId: Types.ObjectId;
  deviceId: string; // Unique client hardware UUID
  apiKeyHash: string; // SHA-256 hash of device API key (shown once to user)
  apiKeyPrefix: string; // First 8 chars for identification (e.g. "dkey_iph...")
  deviceName: string;
  deviceType: DeviceType;
  osVersion?: string;
  appVersion?: string;
  status: 'online' | 'offline';
  lastSeenAt: Date;
  lastCheckpoint: number;
  policy: IDevicePolicy;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeviceDocument extends IDevice, Document {}

export interface IDeviceFileState {
  userId: Types.ObjectId;
  deviceId: string;
  fileId: Types.ObjectId;
  deviceAssetId?: string; // Platform asset ID (e.g. iOS PHAsset localIdentifier or Android MediaStore ID)
  isLocallyPresent: boolean;
  lastSeenLocalAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeviceFileStateDocument extends IDeviceFileState, Document {}

export type SyncAction =
  | 'FILE_UPLOADED'
  | 'FILE_UPDATED'
  | 'FILE_RENAMED'
  | 'FILE_MOVED'
  | 'FILE_TRASHED'
  | 'FILE_RESTORED'
  | 'FILE_DELETED_PERMANENT'
  | 'FOLDER_CREATED'
  | 'FOLDER_RENAMED'
  | 'FOLDER_DELETED'
  | 'POLICY_UPDATED';

export interface ISyncEvent {
  userId: Types.ObjectId;
  checkpoint: number; // Monotonically increasing sequence number
  action: SyncAction;
  targetId: Types.ObjectId; // File ID or Folder ID
  targetType: 'file' | 'folder' | 'device';
  originDeviceId?: string;
  payload: Record<string, any>;
  createdAt: Date;
}

export interface ISyncEventDocument extends ISyncEvent, Document {}
