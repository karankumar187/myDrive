/**
 * Global In-Memory Media Blob Cache.
 * Caches decrypted ArrayBuffers and Blobs as object URLs.
 * Prevents re-fetching and re-decrypting the same media multiple times per session.
 */
class MediaBlobCache {
  private cache = new Map<string, string>();

  get(id: string): string | undefined {
    return this.cache.get(id);
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  set(id: string, url: string): void {
    // Keep up to 200 items in memory to prevent memory leaks
    if (this.cache.size > 200) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        const oldUrl = this.cache.get(firstKey);
        if (oldUrl && oldUrl.startsWith('blob:')) {
          URL.revokeObjectURL(oldUrl);
        }
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(id, url);
  }

  clear(): void {
    for (const url of this.cache.values()) {
      if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
    this.cache.clear();
  }

  getThumbnail(fileId: string): string | null {
    const memory = this.cache.get(`thumb_${fileId}`);
    if (memory) return memory;
    try {
      const stored = localStorage.getItem(`drive_thumb_${fileId}`);
      if (stored) {
        if (stored.startsWith('data:image')) {
          try {
            const arr = stored.split(',');
            const mimeMatch = arr[0].match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
              u8arr[n] = bstr.charCodeAt(n);
            }
            const blobUrl = URL.createObjectURL(new Blob([u8arr], { type: mime }));
            this.cache.set(`thumb_${fileId}`, blobUrl);
            return blobUrl;
          } catch {
            this.cache.set(`thumb_${fileId}`, stored);
            return stored;
          }
        }
        this.cache.set(`thumb_${fileId}`, stored);
        return stored;
      }
    } catch {
      // ignore
    }
    return null;
  }

  saveThumbnail(fileId: string, dataUrl: string): void {
    try {
      if (dataUrl.startsWith('data:image')) {
        const arr = dataUrl.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blobUrl = URL.createObjectURL(new Blob([u8arr], { type: mime }));
        this.set(`thumb_${fileId}`, blobUrl);
      } else {
        this.set(`thumb_${fileId}`, dataUrl);
      }
    } catch {
      this.set(`thumb_${fileId}`, dataUrl);
    }

    try {
      localStorage.setItem(`drive_thumb_${fileId}`, dataUrl);
    } catch {
      // If quota exceeded, clear older thumbnails
      try {
        const keysToPrune = Object.keys(localStorage).filter(k => k.startsWith('drive_thumb_'));
        for (let i = 0; i < Math.min(keysToPrune.length, 10); i++) {
          localStorage.removeItem(keysToPrune[i]);
        }
        localStorage.setItem(`drive_thumb_${fileId}`, dataUrl);
      } catch {
        // storage truly full, keep in memory only
      }
    }
  }
}

export const mediaCache = new MediaBlobCache();

/**
 * Controlled Concurrency Task Queue.
 * Limits heavy parallel video downloads/decryptions (default: max 2 simultaneous tasks).
 * Prevents HTTP connection saturation and browser memory exhaustion.
 */
class MediaTaskQueue {
  private queue: (() => Promise<void>)[] = [];
  private activeCount = 0;
  private maxConcurrent = 2;

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const res = await task();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      });
      this.processNext();
    });
  }

  private processNext() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) return;
    const task = this.queue.shift();
    if (!task) return;
    this.activeCount++;
    task().finally(() => {
      this.activeCount--;
      this.processNext();
    });
  }
}

export const mediaQueue = new MediaTaskQueue();

/**
 * Helper to determine if a filename or MIME type represents a video.
 */
export function isVideoFile(filenameOrMime: string): boolean {
  if (filenameOrMime.startsWith('video/')) return true;
  return /\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|3gp|ts|mts|m2ts|ogv|vob)$/i.test(filenameOrMime);
}

/**
 * Returns accurate MIME type for a given filename and optional browser file type.
 */
export function getEffectiveMimeType(filename: string, fileType?: string): string {
  if (fileType && fileType.length > 0 && fileType !== 'application/octet-stream') {
    return fileType;
  }
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'mov': return 'video/quicktime';
    case 'mp4': return 'video/mp4';
    case 'm4v': return 'video/x-m4v';
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
    default: return fileType || 'application/octet-stream';
  }
}

/**
 * Generates a lightweight JPEG thumbnail (max 480px, ~15-25KB) from a raw video File object.
 * Handles MOV, MP4, WebM, and other HTML5-compatible video containers.
 */
export async function generateThumbnailFromVideoFile(file: File): Promise<string | null> {
  const tryWithBlob = (blob: Blob): Promise<string | null> => {
    return new Promise((resolve) => {
      try {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        const url = URL.createObjectURL(blob);
        video.src = url;

        let isDone = false;
        const cleanup = () => {
          if (isDone) return;
          isDone = true;
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          video.pause();
          video.removeAttribute('src');
          video.load();
          video.remove();
        };

        const timer = setTimeout(() => {
          cleanup();
          resolve(null);
        }, 6000);

        const capture = () => {
          try {
            if (!video.videoWidth || !video.videoHeight) return false;
            const canvas = document.createElement('canvas');
            const maxDim = 480;
            let w = video.videoWidth;
            let h = video.videoHeight;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, w, h);
              const thumbData = canvas.toDataURL('image/jpeg', 0.8);
              cleanup();
              resolve(thumbData);
              return true;
            }
          } catch {}
          return false;
        };

        video.onloadeddata = () => {
          try {
            video.currentTime = Math.min(0.5, (video.duration && video.duration > 2) ? 0.5 : 0.1);
          } catch {
            if (!capture()) {
              cleanup();
              resolve(null);
            }
          }
        };

        video.onseeked = () => {
          if (!capture()) {
            cleanup();
            resolve(null);
          }
        };

        video.onerror = () => {
          cleanup();
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  };

  const isMov = file.name.toLowerCase().endsWith('.mov') || file.type === 'video/quicktime';

  // Strategy 1: If MOV, try aliasing as video/mp4 (allows Chromium to decode ISOBMFF QuickTime container)
  if (isMov) {
    try {
      const mp4Blob = new Blob([file], { type: 'video/mp4' });
      const res = await tryWithBlob(mp4Blob);
      if (res) return res;
    } catch {}
  }

  // Strategy 2: Direct file object
  return await tryWithBlob(file);
}

/**
 * Captures a video frame from an active stream URL (used for existing video items without thumbnail).
 */
export async function extractVideoThumbnailFromUrl(streamUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timer);
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 7000);

      const capture = () => {
        try {
          if (!video.videoWidth || !video.videoHeight) return false;
          const canvas = document.createElement('canvas');
          const maxDim = 480;
          let w = video.videoWidth;
          let h = video.videoHeight;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            const thumb = canvas.toDataURL('image/jpeg', 0.8);
            cleanup();
            resolve(thumb);
            return true;
          }
        } catch {}
        return false;
      };

      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(0.5, (video.duration && video.duration > 2) ? 0.5 : 0.1);
        } catch {
          if (!capture()) {
            cleanup();
            resolve(null);
          }
        }
      };

      video.onseeked = () => {
        if (!capture()) {
          cleanup();
          resolve(null);
        }
      };

      video.onerror = () => {
        cleanup();
        resolve(null);
      };

      video.src = streamUrl;
    } catch {
      resolve(null);
    }
  });
}
