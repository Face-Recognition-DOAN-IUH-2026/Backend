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

const CLEANUP_QUERIES = [
  `DELETE FROM shift_swaps WHERE requester_staff_id = :uid OR target_staff_id = :uid OR reviewed_by = :uid`,
  `DELETE FROM shift_bids WHERE staff_id = :uid OR reviewed_by = :uid`,
  `DELETE FROM staff_availability_requests WHERE staff_id = :uid OR reviewed_by = :uid`,
  `DELETE FROM staff_attendance WHERE staff_id = :uid`,
  `DELETE FROM staff_schedules WHERE staff_id = :uid OR assigned_by = :uid`,
  `DELETE FROM staff_schedule_templates WHERE staff_id = :uid`,
  `DELETE FROM schedule_audit_logs WHERE actor_id = :uid`,
];

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
        let totalDeleted = 0;
        for (const sql of CLEANUP_QUERIES) {
          const result = await queryRunner.query(sql, [msg.user_id]);
          totalDeleted += result.rowCount ?? 0;
        }
        console.log(`[UserEventSubscriber] Cleaned ${totalDeleted} schedule records for user ${msg.user_id}`);
      } finally {
        await queryRunner.release();
      }
    } catch (e) {
      console.error('[UserEventSubscriber] Error processing event:', e);
    }
  });
}
