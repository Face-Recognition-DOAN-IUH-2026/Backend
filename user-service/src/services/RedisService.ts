import crypto from 'crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { amqpClient } from '../../shared/AmqpClient';

function signPayload(payload: object, secret: string): string {
  const body = JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export interface UserDeletedEvent {
  event: 'USER_DELETED';
  user_id: string;
  email: string;
  timestamp: string;
  signature: string;
}

export interface UserUpdatedEvent {
  event: 'USER_UPDATED';
  user_id: string;
  email: string;
  timestamp: string;
  signature: string;
}

const EXCHANGE = 'user.events.fanout';

export class RedisService {
  private client: Redis;

  constructor() {
    this.client = new Redis(config.redisUrl, {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });

    this.client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis connected');
    });
  }

  async publishUserDeleted(userId: string, email: string): Promise<void> {
    try {
      const body = {
        event: 'USER_DELETED' as const,
        user_id: userId,
        email,
        timestamp: new Date().toISOString(),
      };
      const signature = signPayload(body, config.internalApiKey);
      const message: UserDeletedEvent = { ...body, signature };

      await amqpClient.publishFanout(EXCHANGE, message);
    } catch (e) {
      console.warn('RabbitMQ publish failed, face cleanup may be delayed:', e);
    }
  }

  async publishUserUpdated(userId: string, email: string): Promise<void> {
    try {
      const body = {
        event: 'USER_UPDATED' as const,
        user_id: userId,
        email,
        timestamp: new Date().toISOString(),
      };
      const signature = signPayload(body, config.internalApiKey);
      const message: UserUpdatedEvent = { ...body, signature };

      await amqpClient.publishFanout(EXCHANGE, message);
    } catch (e) {
      console.warn('RabbitMQ publish failed, user update notification may be delayed:', e);
    }
  }

  async setPasswordResetCode(email: string, code: string): Promise<void> {
    const key = `reset_code:${email.toLowerCase()}`;
    await this.client.set(key, code, 'EX', 15 * 60); // 15 mins
  }

  async getPasswordResetCode(email: string): Promise<string | null> {
    const key = `reset_code:${email.toLowerCase()}`;
    return await this.client.get(key);
  }

  async deletePasswordResetCode(email: string): Promise<void> {
    const key = `reset_code:${email.toLowerCase()}`;
    await this.client.del(key);
  }

  async setEmailVerificationCode(email: string, code: string): Promise<void> {
    const key = `verify_code:${email.toLowerCase()}`;
    await this.client.set(key, code, 'EX', 24 * 60 * 60); // 24 hours
  }

  async getEmailVerificationCode(email: string): Promise<string | null> {
    const key = `verify_code:${email.toLowerCase()}`;
    return await this.client.get(key);
  }

  async deleteEmailVerificationCode(email: string): Promise<void> {
    const key = `verify_code:${email.toLowerCase()}`;
    await this.client.del(key);
  }

  async cacheFaceStatus(userId: string, enrolled: boolean): Promise<void> {
    const key = `face_status:${userId}`;
    await this.client.setex(key, 3600, JSON.stringify(enrolled));
  }

  async getFaceStatus(userId: string): Promise<boolean | null> {
    const key = `face_status:${userId}`;
    const val = await this.client.get(key);
    if (val === null) return null;
    return JSON.parse(val);
  }

  async invalidateFaceStatus(userId: string): Promise<void> {
    const key = `face_status:${userId}`;
    await this.client.del(key);
  }
}

export function verifyUserDeletedEvent(
  message: UserDeletedEvent,
  secret: string,
): boolean {
  const { signature, ...rest } = message;
  const expected = signPayload(rest, secret);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}
