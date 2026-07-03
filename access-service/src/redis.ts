import Redis from 'ioredis';
import { config } from './config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }
  return redisClient;
}

export async function storeFrame(frameId: string, imageData: Buffer, ttlSeconds: number = 5): Promise<void> {
  const client = getRedisClient();
  const key = `temp_frame:${frameId}`;
  await client.setex(key, ttlSeconds, imageData);
}

export async function getFrame(frameId: string): Promise<Buffer | null> {
  const client = getRedisClient();
  const key = `temp_frame:${frameId}`;
  const data = await client.get(key);
  return data ? Buffer.from(data) : null;
}

export async function deleteFrame(frameId: string): Promise<void> {
  const client = getRedisClient();
  const key = `temp_frame:${frameId}`;
  await client.del(key);
}
