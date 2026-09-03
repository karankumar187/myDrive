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

  async devLogin(email: string, name: string): Promise<{ token: string; user: User }> {
    const res = await fetch(`${API_BASE}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    localStorage.setItem('drive_token', data.token);
    return data;
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

  async devAddAccount(email?: string): Promise<any> {
    const res = await fetch(`${API_BASE}/storage/dev-add-account`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error('Failed to add dev mock account');
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

  async getGallery(): Promise<{ media: FileItem[] }> {
    const res = await fetch(`${API_BASE}/files/gallery`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch media gallery');
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
};
