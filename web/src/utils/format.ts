export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getStreamUrl(fileId: string): string {
  const token = localStorage.getItem('drive_token') || '';
  const rawApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  return `${rawApiUrl}/api/v1/files/${fileId}/stream?token=${encodeURIComponent(token)}`;
}
