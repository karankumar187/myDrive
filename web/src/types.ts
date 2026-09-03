export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  hasEncryptedVault: boolean;
  masterKeySalt?: string;
}

export interface StorageAccount {
  id: string;
  email: string;
  name: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  percentUsed: number;
  status: 'healthy' | 'reauth_required' | 'quota_full' | 'disabled';
  isPrimary: boolean;
}

export interface StorageSummary {
  totalCapacityBytes: number;
  usedCapacityBytes: number;
  availableCapacityBytes: number;
  percentUsed: number;
  totalAccounts: number;
  healthyAccounts: number;
  accounts: StorageAccount[];
}

export interface FileItem {
  _id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  currentVersion: number;
  folderId?: string | null;
  isTrash: boolean;
  trashedAt?: string;
  sourceDeviceIds: string[];
  versions?: Array<{
    versionNumber: number;
    sizeBytes: number;
    contentHash: string;
    isEncrypted: boolean;
    iv?: string;
  }>;
  metadata?: {
    takenAt?: string;
    width?: number;
    height?: number;
    duration?: number;
    cameraMake?: string;
    cameraModel?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface FolderItem {
  _id: string;
  name: string;
  path: string;
  parentFolderId?: string | null;
  color?: string;
  createdAt: string;
}

export interface DeviceItem {
  _id: string;
  deviceId: string;
  deviceName: string;
  deviceType: 'android' | 'iphone' | 'web' | 'desktop';
  status: 'online' | 'offline';
  lastSeenAt: string;
  policy: {
    uploadFolders: string[];
    wifiOnly: boolean;
    chargingOnly: boolean;
    autoDeleteLocalAfterBackup: boolean;
    downloadMode: 'cloud_only' | 'auto_download';
    deletionMode: 'keep_in_cloud' | 'mirror_deletion';
  };
}
