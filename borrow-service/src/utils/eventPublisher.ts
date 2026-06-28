import Redis from 'ioredis';
import { config } from '../config';
import { amqpClient } from '../clients/AmqpClient';

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
  
  // Publish to Redis Pub/Sub
  if (pub) {
    try {
      await pub.publish(CHANNEL, JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
    } catch (error) {
      console.error('Failed to publish event to Redis:', type, error);
    }
  }

  // Publish to RabbitMQ
  try {
    await amqpClient.publish(type, payload);
  } catch (error: any) {
    console.error('Failed to publish event to RabbitMQ:', type, error.message);
  }
}
