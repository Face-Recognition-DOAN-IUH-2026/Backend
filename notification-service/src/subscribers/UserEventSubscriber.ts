import crypto from 'crypto';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { Notification } from '../entities/Notification';
import { amqpClient } from '../clients/AmqpClient';

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
  const expected = signPayload(rest, config.serviceJwtSecret);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function startUserEventSubscriber(): Promise<void> {
  try {
    await amqpClient.connect();
    await amqpClient.subscribeFanoutReliable('user.events.fanout', async (payload: any) => {
      try {
        const msg: UserDeletedMessage = payload;
        if (msg.event !== 'USER_DELETED') return;

        if (!verifySignature(msg)) {
          console.warn('[UserEventSubscriber] Invalid signature, ignoring event');
          return;
        }

        console.log(`[UserEventSubscriber] Processing USER_DELETED for ${msg.user_id}`);

        const repo = AppDataSource.getRepository(Notification);
        const result = await repo.delete({ userId: msg.user_id });
        console.log(`[UserEventSubscriber] Deleted ${result.affected ?? 0} notifications for user ${msg.user_id}`);
      } catch (e) {
        console.error('[UserEventSubscriber] Error processing event:', e);
      }
    });
    console.log('[UserEventSubscriber] Subscribed to user.events.fanout');
  } catch (err: any) {
    console.error('[UserEventSubscriber] RabbitMQ connection failed:', err.message);
  }
}
