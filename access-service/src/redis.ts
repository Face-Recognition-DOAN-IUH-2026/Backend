import Redis from 'ioredis';
import { config } from './config';
import { ACTIVE_CAMERA_IDS } from './contracts';

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

export const ACCESS_COUNTER_TTL_SECONDS = 48 * 3600;

export function accessCounterDateBucket(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function accessCounterKey(dateBucket: string, cameraId: string, status: string): string {
  return `access:counters:${dateBucket}:${cameraId}:${status}`;
}

export async function incrementAccessCounter(input: {
  dateBucket?: string;
  cameraId: string;
  status: string;
}): Promise<number> {
  const client = getRedisClient();
  const key = accessCounterKey(input.dateBucket || accessCounterDateBucket(), input.cameraId, input.status);
  const count = await client.incr(key);
  await client.expire(key, ACCESS_COUNTER_TTL_SECONDS);
  return count;
}

export async function getAccessCounters(dateBucket?: string): Promise<{ spoof: number; no_match: number }> {
  const client = getRedisClient();
  const day = dateBucket || accessCounterDateBucket();
  let spoof = 0;
  let noMatch = 0;
  for (const cameraId of ACTIVE_CAMERA_IDS) {
    const [spoofRaw, noMatchRaw] = await client.mget(
      accessCounterKey(day, cameraId, 'spoof'),
      accessCounterKey(day, cameraId, 'no_match'),
    );
    spoof += Number(spoofRaw || 0);
    noMatch += Number(noMatchRaw || 0);
  }
  return { spoof, no_match: noMatch };
}
