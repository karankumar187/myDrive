import { StorageSummary, FileItem, FolderItem, DeviceItem, User, BreadcrumbItem } from '../types.js';

const rawApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const API_BASE = rawApiUrl ? `${rawApiUrl}/api/v1` : '/api/v1';

function getHeaders(): HeadersInit {
  const token = localStorage.getItem('drive_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const api = {
  // Auth
  async getCurrentUser(): Promise<{ user: User }> {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: getHeaders() });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Auth failed (${res.status}): ${errText || res.statusText}`);
    }
    return res.json();
  },

  logout(): void {
    localStorage.removeItem('drive_token');
    window.location.reload();
  },

  // Storage Pooling
  async getStorageSummary(): Promise<StorageSummary> {
    const res = await fetch(`${API_BASE}/storage/summary`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch storage summary');
    return res.json();
  },

  async getConnectUrl(): Promise<{ url: string }> {
    const res = await fetch(`${API_BASE}/storage/connect/url`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to get Google Drive connection URL');
    return res.json();
  },

  async syncAccountQuota(id: string): Promise<any> {
    const res = await fetch(`${API_BASE}/storage/accounts/${id}/sync`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to sync account quota');
    return res.json();
  },

  async removeAccount(id: string): Promise<any> {
    const res = await fetch(`${API_BASE}/storage/accounts/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to remove storage account');
    return res.json();
  },

  // Files & Folders
  async listFiles(
    folderId?: string | null,
    search?: string,
    isTrash: boolean = false
  ): Promise<{ files: FileItem[]; recentFiles?: FileItem[] }> {
    const params = new URLSearchParams();
    if (folderId) params.append('folderId', folderId);
    if (search) params.append('search', search);
    if (isTrash) params.append('isTrash', 'true');

    const res = await fetch(`${API_BASE}/files?${params.toString()}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to list files');
    return res.json();
  },

  async getGallery(params?: { filter?: string; search?: string }): Promise<{ media: FileItem[] }> {
    const query = new URLSearchParams();
    if (params?.filter) query.append('filter', params.filter);
    if (params?.search) query.append('search', params.search);
    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${API_BASE}/files/gallery${qs}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch media gallery');
    return res.json();
  },

  getThumbnailUrl(fileId: string): string {
    const token = localStorage.getItem('drive_token');
    return `${API_BASE}/files/${fileId}/thumbnail${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  async toggleFavorite(fileId: string, isFavorite?: boolean): Promise<{ success: boolean; isFavorite: boolean }> {
    const res = await fetch(`${API_BASE}/files/${fileId}/favorite`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ isFavorite }),
    });
    if (!res.ok) throw new Error('Failed to toggle favorite');
    return res.json();
  },

  async renameFile(fileId: string, filename: string): Promise<any> {
    const res = await fetch(`${API_BASE}/files/${fileId}/rename`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ filename }),
    });
    if (!res.ok) throw new Error('Failed to rename file');
    return res.json();
  },

  async moveFile(fileId: string, folderId: string | null): Promise<any> {
    const res = await fetch(`${API_BASE}/files/${fileId}/move`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ folderId }),
    });
    if (!res.ok) throw new Error('Failed to move file');
    return res.json();
  },

  async bulkAction(action: 'trash' | 'favorite' | 'unfavorite' | 'move', fileIds: string[], folderId?: string | null): Promise<any> {
    const res = await fetch(`${API_BASE}/files/bulk`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ action, fileIds, folderId }),
    });
    if (!res.ok) throw new Error(`Failed to perform bulk ${action}`);
    return res.json();
  },

  async initiateUpload(payload: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
    folderId?: string | null;
    isEncrypted?: boolean;
  }) {
    const res = await fetch(`${API_BASE}/files/upload/initiate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to initiate upload');
    }
    return res.json();
  },

  async completeUpload(payload: any) {
    const res = await fetch(`${API_BASE}/files/upload/complete`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to complete upload');
    return res.json();
  },

  async moveToTrash(fileId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/files/${fileId}/trash`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to move file to trash');
    return res.json();
  },

  async restoreFromTrash(fileId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/files/${fileId}/restore`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to restore file');
    return res.json();
  },

  async permanentDelete(fileId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/files/${fileId}/permanent`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete file');
    return res.json();
  },

  async listFolders(parentFolderId?: string | null): Promise<{
    folders: FolderItem[];
    currentFolder?: FolderItem | null;
    breadcrumbs?: BreadcrumbItem[];
  }> {
    const params = new URLSearchParams();
    if (parentFolderId) params.append('parentFolderId', parentFolderId);

    const res = await fetch(`${API_BASE}/files/folders/list?${params.toString()}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to list folders');
    return res.json();
  },

  async createFolder(name: string, parentFolderId?: string | null): Promise<{ folder: FolderItem }> {
    const res = await fetch(`${API_BASE}/files/folders/create`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, parentFolderId }),
    });
    if (!res.ok) throw new Error('Failed to create folder');
    return res.json();
  },

  async deleteFolder(folderId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/files/folders/${folderId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete folder');
    return res.json();
  },

  // Devices
  async listDevices(): Promise<{ devices: DeviceItem[] }> {
    const res = await fetch(`${API_BASE}/devices`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to list devices');
    return res.json();
  },

  async registerDevice(payload: { deviceName: string; deviceType: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/devices/register`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to register device');
    return res.json();
  },

  async updateDevicePolicy(id: string, policy: any): Promise<any> {
    const res = await fetch(`${API_BASE}/devices/${id}/policy`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ policy }),
    });
    if (!res.ok) throw new Error('Failed to update device policy');
    return res.json();
  },

  async revokeDevice(id: string): Promise<any> {
    const res = await fetch(`${API_BASE}/devices/${id}/revoke`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to revoke device');
    return res.json();
  },

  async getDeviceUploads(deviceId: string): Promise<{ files: FileItem[] }> {
    const res = await fetch(`${API_BASE}/files/device/${deviceId}/uploads`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch device uploads');
    return res.json();
  },

  async forceDownloadToDevice(targetDeviceId: string, fileIds: string[]): Promise<any> {
    const res = await fetch(`${API_BASE}/devices/force-download`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ targetDeviceId, fileIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to dispatch force download command' }));
      throw new Error(err.error || 'Failed to dispatch force download command');
    }
    return res.json();
  },
};
