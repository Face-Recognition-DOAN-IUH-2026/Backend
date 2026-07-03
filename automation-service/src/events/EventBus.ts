import { config } from '../config';
import { amqpClient } from '../clients/AmqpClient';

const EXCHANGE = 'user.events.fanout';

export type AutomationEvent = {
  type: string;
  payload: Record<string, any>;
  timestamp: string;
};

type EventHandler = (event: AutomationEvent) => Promise<void>;

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  async connect() {
    // RabbitMQ fanout for user events
    try {
      await amqpClient.connect();
      await amqpClient.subscribeFanout(EXCHANGE, async (payload: any) => {
        const event: AutomationEvent = {
          type: payload.event || payload.type,
          payload: payload,
          timestamp: payload.timestamp || new Date().toISOString(),
        };
        await this.dispatch(event);
      });
      console.log('[EventBus] Subscribed to user.events.fanout');
    } catch (err: any) {
      console.error('[EventBus] RabbitMQ fanout init failed:', err.message);
    }

    // RabbitMQ topic for book events
    try {
      await amqpClient.connect();
      await amqpClient.consume(
        'automation_service_queue',
        ['book.borrowed', 'book.returned', 'schedule.changed', 'fine.incurred'],
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
      console.log('[EventBus] Connected to RabbitMQ topic exchange');
    } catch (err: any) {
      console.error('[EventBus] RabbitMQ topic init failed:', err.message);
    }
  }

  on(eventType: string, handler: EventHandler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  async publish(event: AutomationEvent) {
    await this.dispatch(event);
    try {
      await amqpClient.publish(event.type, event.payload);
    } catch (err: any) {
      console.error('[EventBus] Failed to publish to RabbitMQ:', err.message);
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
        console.error(`[EventBus] handler error for ${event.type}:`, error);
      }
    }
  }
}

export const eventBus = new EventBus();
