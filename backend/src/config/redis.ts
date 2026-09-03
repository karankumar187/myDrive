import { Redis } from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redisConnection = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableReadyCheck: false,
});

redisConnection.on('connect', () => {
  console.log('✅ Connected to Redis');
});

redisConnection.on('error', (err) => {
  // Silent warning in dev so app can boot even if local redis container is starting
  console.warn('⚠️ Redis connection notice:', err.message);
});
