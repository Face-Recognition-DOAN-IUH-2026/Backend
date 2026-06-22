import crypto from 'crypto';
import Redis from 'ioredis';
import { config } from '../config';

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

      await this.client.publish('user.events', JSON.stringify(message));
    } catch (e) {
      console.warn('Redis publish failed, face cleanup may be delayed:', e);
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

      await this.client.publish('user.events', JSON.stringify(message));
    } catch (e) {
      console.warn('Redis publish failed, user update notification may be delayed:', e);
    }
  }

  async setPasswordResetCode(email: string, code: string): Promise<void> {
    const key = `reset_code:${email.toLowerCase()}`;
    await this.client.setex(key, 900, code);
  }

  async getPasswordResetCode(email: string): Promise<string | null> {
    const key = `reset_code:${email.toLowerCase()}`;
    return this.client.get(key);
  }

  async deletePasswordResetCode(email: string): Promise<void> {
    const key = `reset_code:${email.toLowerCase()}`;
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
