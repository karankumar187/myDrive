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
 * Generates a lightweight JPEG thumbnail (max 320px, ~10-15KB) from a raw video File object.
 */
export async function generateThumbnailFromVideoFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      const cleanUp = () => {
        URL.revokeObjectURL(url);
        video.remove();
      };

      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(0.2, (video.duration || 1) / 2);
        } catch {
          cleanUp();
          resolve(null);
        }
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 320;
          let w = video.videoWidth || 320;
          let h = video.videoHeight || 240;
          if (w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            const thumbData = canvas.toDataURL('image/jpeg', 0.7);
            cleanUp();
            resolve(thumbData);
            return;
          }
        } catch {}
        cleanUp();
        resolve(null);
      };

      video.onerror = () => {
        cleanUp();
        resolve(null);
      };

      setTimeout(() => {
        cleanUp();
        resolve(null);
      }, 4000);
    } catch {
      resolve(null);
    }
  });
}

