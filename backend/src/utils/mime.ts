// Helper to resolve accurate MIME types for common media extensions (mov, mkv, webm, etc.)
export function getEffectiveMimeType(filename: string, mimeType?: string): string {
  if (mimeType && mimeType.length > 0 && mimeType !== 'application/octet-stream') {
    return mimeType;
  }
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'mov': return 'video/quicktime';
    case 'mp4': return 'video/mp4';
    case 'mkv': return 'video/x-matroska';
    case 'webm': return 'video/webm';
    case 'avi': return 'video/x-msvideo';
    case '3gp': return 'video/3gpp';
    case 'wmv': return 'video/x-ms-wmv';
    case 'flv': return 'video/x-flv';
    case 'ts':
    case 'mts':
    case 'm2ts': return 'video/mp2t';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'heic': return 'image/heic';
    case 'pdf': return 'application/pdf';
    default: return mimeType || 'application/octet-stream';
  }
}
