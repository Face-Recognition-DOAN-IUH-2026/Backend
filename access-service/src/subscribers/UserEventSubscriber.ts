import crypto from 'crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { AppDataSource } from '../data-source';

interface UserDeletedMessage {
  event: 'USER_DELETED';
  user_id: string;
  email: string;
  timestamp: string;
  signature: string;
}

function signPayload(payload: object, secret: string): string {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

function verifySignature(msg: UserDeletedMessage): boolean {
  const { signature, ...rest } = msg;
  const expected = signPayload(rest, config.internalApiKey);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function startUserEventSubscriber(): Promise<void> {
  const redis = new Redis(config.redisUrl, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });

  redis.on('error', (err) => {
    console.error('[UserEventSubscriber] Redis error:', err.message);
  });

  await redis.subscribe('user.events', (err) => {
    if (err) {
      console.error('[UserEventSubscriber] Subscribe error:', err.message);
      return;
    }
    console.log('[UserEventSubscriber] Subscribed to user.events');
  });

  redis.on('message', async (_channel, raw) => {
    try {
      const msg: UserDeletedMessage = JSON.parse(raw);
      if (msg.event !== 'USER_DELETED') return;

      if (!verifySignature(msg)) {
        console.warn('[UserEventSubscriber] Invalid signature, ignoring event');
        return;
      }

      console.log(`[UserEventSubscriber] Processing USER_DELETED for ${msg.user_id}`);

      const queryRunner = AppDataSource.createQueryRunner();
      await queryRunner.connect();
      try {
        const result1 = await queryRunner.query(
          `DELETE FROM patron_access_states WHERE patron_id = $1`,
          [msg.user_id],
        );
        console.log(`[UserEventSubscriber] Deleted ${result1.rowCount ?? 0} access states for user ${msg.user_id}`);
        console.log(`[UserEventSubscriber] Kept access_logs for audit trail (user ${msg.user_id})`);
      } finally {
        await queryRunner.release();
      }
    } catch (e) {
      console.error('[UserEventSubscriber] Error processing event:', e);
    }
  });
}
