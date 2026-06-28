import Redis from 'ioredis';
import { config } from '../config';

const CHANNEL = 'automation.events';

export type AutomationEvent = {
  type: string;
  payload: Record<string, any>;
  timestamp: string;
};

type EventHandler = (event: AutomationEvent) => Promise<void>;

export class EventBus {
  private publisher?: Redis;
  private subscriber?: Redis;
  private handlers = new Map<string, EventHandler[]>();

  async connect() {
    if (!config.redisUrl) return;
    this.publisher = new Redis(config.redisUrl);
    this.subscriber = new Redis(config.redisUrl);
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', async (_channel, raw) => {
      try {
        const event: AutomationEvent = JSON.parse(raw);
        await this.dispatch(event);
      } catch {
        // Ignore malformed messages
      }
    });
    console.log('EventBus connected to Redis');

    // Connect to RabbitMQ
    try {
      const { amqpClient } = require('../clients/AmqpClient');
      await amqpClient.connect();
      await amqpClient.consume(
        'automation_service_queue',
        ['book.borrowed', 'book.returned'],
        async (envelope: any) => {
          console.log(`[AMQP] Automation EventBus received: ${envelope.eventType}`);
          const event: AutomationEvent = {
            type: envelope.eventType,
            payload: envelope.payload,
            timestamp: envelope.occurredAt,
          };
          await this.dispatch(event);
        }
      );
      console.log('EventBus connected to RabbitMQ');
    } catch (err: any) {
      console.error('EventBus RabbitMQ init failed:', err.message);
    }
  }

  on(eventType: string, handler: EventHandler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  async publish(event: AutomationEvent) {
    // Local dispatch
    await this.dispatch(event);
    // Redis fan-out
    if (this.publisher) {
      await this.publisher.publish(CHANNEL, JSON.stringify(event));
    }
    // RabbitMQ publish
    try {
      const { amqpClient } = require('../clients/AmqpClient');
      await amqpClient.publish(event.type, event.payload);
    } catch (err: any) {
      console.error('Failed to publish event to RabbitMQ:', err.message);
    }
  }

  private async dispatch(event: AutomationEvent) {
    const handlers = this.handlers.get(event.type) || [];
    const wildcardHandlers = this.handlers.get('*') || [];
    const allHandlers = [...handlers, ...wildcardHandlers];

    for (const handler of allHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`EventBus handler error for ${event.type}:`, error);
      }
    }
  }
}

export const eventBus = new EventBus();
