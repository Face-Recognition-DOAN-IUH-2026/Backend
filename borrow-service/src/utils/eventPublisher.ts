import Redis from 'ioredis';
import { config } from '../config';

const CHANNEL = 'automation.events';

let publisher: Redis | null = null;

function getPublisher(): Redis | null {
  if (publisher) return publisher;
  const redisUrl = process.env.REDIS_URL || 'redis://redis:6379/0';
  if (!redisUrl) return null;
  try {
    publisher = new Redis(redisUrl);
    return publisher;
  } catch {
    return null;
  }
}

export async function publishEvent(type: string, payload: Record<string, any>) {
  const pub = getPublisher();
  if (!pub) return;
  try {
    await pub.publish(CHANNEL, JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
  } catch (error) {
    console.error('Failed to publish event:', type, error);
  }
}
