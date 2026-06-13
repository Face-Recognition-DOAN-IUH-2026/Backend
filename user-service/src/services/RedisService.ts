import Redis from 'ioredis';
import { config } from '../config';

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
      await this.client.publish(
        'user.events',
        JSON.stringify({
          event: 'USER_DELETED',
          user_id: userId,
          email,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (e) {
      console.warn('Redis publish failed, face cleanup may be delayed:', e);
    }
  }
}
