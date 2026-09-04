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
}

export const mediaCache = new MediaBlobCache();
