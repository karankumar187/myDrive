import { redisConnection } from '../config/redis.js';

export class CacheService {
  private static isConnected = false;

  static {
    redisConnection.on('connect', () => {
      CacheService.isConnected = true;
    });
    redisConnection.on('ready', () => {
      CacheService.isConnected = true;
    });
    redisConnection.on('error', () => {
      CacheService.isConnected = false;
    });
    redisConnection.on('close', () => {
      CacheService.isConnected = false;
    });
  }

  /**
   * Get cached JSON object by key. Returns null on cache miss or connection failure.
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      if (!this.isConnected) return null;
      const data = await redisConnection.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set JSON object in Redis cache with TTL in seconds (default 120s).
   */
  static async set(key: string, value: any, ttlSeconds: number = 120): Promise<void> {
    try {
      if (!this.isConnected) return;
      await redisConnection.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // Non-blocking fail silent
    }
  }

  /**
   * Deletes specific keys or keys matching a pattern.
   */
  static async del(patternOrKey: string): Promise<void> {
    try {
      if (!this.isConnected) return;
      if (patternOrKey.includes('*')) {
        const keys = await redisConnection.keys(patternOrKey);
        if (keys.length > 0) {
          await redisConnection.del(...keys);
        }
      } else {
        await redisConnection.del(patternOrKey);
      }
    } catch {
      // Non-blocking
    }
  }

  /**
   * Invalidate all cached data for a specific user (summary, files, folders, gallery).
   */
  static async invalidateUser(userId: string): Promise<void> {
    await this.del(`cache:user:${userId}:*`);
  }
}
