import Redis from 'ioredis';
import { config } from './config';

export const redis = new Redis(config.redisUrl, {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

const DEFAULT_TTL = 3600; // 1 hour

export class RedisCacheService {
  static async get<T>(key: string): Promise<T | null> {
    try {
      const val = await redis.get(key);
      if (val === null) return null;
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }

  static async set(key: string, value: unknown, ttl: number = DEFAULT_TTL): Promise<void> {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      console.warn('Redis set failed:', err);
    }
  }

  static async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (err) {
      console.warn('Redis del failed:', err);
    }
  }

  static async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      console.warn('Redis invalidatePattern failed:', err);
    }
  }
}
