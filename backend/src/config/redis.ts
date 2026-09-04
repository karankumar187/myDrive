import { Redis, RedisOptions } from 'ioredis';

const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const options: RedisOptions = {
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
  lazyConnect: false,
  retryStrategy(times) {
    if (times > 5) return null;
    return Math.min(times * 100, 2000);
  },
};

export const redisConnection = redisUrl
  ? new Redis(redisUrl, options)
  : new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      ...options,
    });

redisConnection.on('connect', () => {
  console.log('✅ Connected to Upstash Redis');
});

redisConnection.on('error', (err) => {
  console.warn('⚠️ Redis notice (safe fallback active):', err.message);
});
