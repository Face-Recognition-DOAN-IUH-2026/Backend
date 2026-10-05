import amqp, { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import crypto from 'crypto';

export interface EventEnvelope<T = any> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  correlationId?: string;
  producer: string;
  payload: T;
}

export class AmqpClient {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private exchangeName = 'library.exchange';
  private rabbitmqUrl: string;
  private serviceName: string;
  private isConnecting = false;

  constructor(serviceName: string) {
    this.rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
    this.serviceName = serviceName;
    if (this.rabbitmqUrl.includes('guest:guest')) {
      console.warn(`[AMQP] WARNING: ${serviceName} using default guest:guest credentials. Change RABBITMQ_URL in production!`);
    }
  }

  async connect(retries = 10, delay = 5000): Promise<void> {
    if (this.connection) return;
    if (this.isConnecting) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return this.connect(retries, delay);
    }
    this.isConnecting = true;

    for (let i = 0; i < retries; i++) {
      try {
        console.log(`[AMQP] Connecting to RabbitMQ at ${this.rabbitmqUrl} (Attempt ${i + 1}/${retries})...`);
        const conn = await amqp.connect(this.rabbitmqUrl);
        const ch = await conn.createChannel();

        // Ensure topic exchange exists
        await ch.assertExchange(this.exchangeName, 'topic', { durable: true });

        conn.on('error', (err: any) => {
          console.error('[AMQP] Connection error:', err.message);
          this.handleDisconnect();
        });

        conn.on('close', () => {
          console.warn('[AMQP] Connection closed.');
          this.handleDisconnect();
        });

        this.connection = conn;
        this.channel = ch;

        console.log('[AMQP] Connected to RabbitMQ successfully.');
        this.isConnecting = false;
        return;
      } catch (err: any) {
        console.error(`[AMQP] Connection failed: ${err.message}. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    this.isConnecting = false;
    throw new Error('[AMQP] Could not connect to RabbitMQ');
  }

  private handleDisconnect() {
    this.connection = null;
    this.channel = null;
    console.log('[AMQP] Reconnecting in 5 seconds...');
    setTimeout(() => this.connect().catch(() => {}), 5000);
  }

  async publish(routingKey: string, payload: any, correlationId?: string): Promise<boolean> {
    try {
      if (!this.channel) {
        await this.connect();
      }
      if (!this.channel) throw new Error('No AMQP channel available');

      const envelope: EventEnvelope = {
        eventId: crypto.randomUUID(),
        eventType: routingKey,
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        correlationId,
        producer: this.serviceName,
        payload,
      };

      const content = Buffer.from(JSON.stringify(envelope));
      return this.channel.publish(this.exchangeName, routingKey, content, {
        persistent: true,
      });
    } catch (err: any) {
      console.error(`[AMQP] Publish error for routingKey=${routingKey}:`, err.message);
      return false;
    }
  }

  async publishFanout(exchangeName: string, payload: any): Promise<boolean> {
    try {
      if (!this.channel) await this.connect();
      if (!this.channel) throw new Error('No AMQP channel available');
      await this.channel.assertExchange(exchangeName, 'fanout', { durable: false });
      const buffer = Buffer.from(JSON.stringify(payload));
      return this.channel.publish(exchangeName, '', buffer);
    } catch (error: any) {
      console.error('[AMQP] Fanout Publish error:', error.message);
      return false;
    }
  }

  async subscribeFanout(
    exchangeName: string,
    onMessage: (payload: any) => void | Promise<void>
  ): Promise<void> {
    if (!this.channel) await this.connect();
    if (!this.channel) throw new Error('No AMQP channel available');
    await this.channel.assertExchange(exchangeName, 'fanout', { durable: false });
    const q = await this.channel.assertQueue('', { exclusive: true, autoDelete: true });
    await this.channel.bindQueue(q.queue, exchangeName, '');
    await this.channel.consume(
      q.queue,
      async (msg) => {
        if (!msg) return;
        try {
          const payload = JSON.parse(msg.content.toString());
          await onMessage(payload);
          this.channel?.ack(msg);
        } catch (e) {
          console.error('[AMQP] Fanout error on', exchangeName, e);
          this.channel?.nack(msg, false, false);
        }
      },
      { noAck: false }
    );
    console.log(`[AMQP] Subscribed to fanout exchange: ${exchangeName} (manual ack)`);
  }

  async subscribeFanoutReliable(
    exchangeName: string,
    onMessage: (payload: any) => Promise<void>
  ): Promise<void> {
    if (!this.channel) await this.connect();
    if (!this.channel) throw new Error('No AMQP channel available');
    await this.channel.assertExchange(exchangeName, 'fanout', { durable: false });
    const dlq = `${exchangeName}.dlq`;
    await this.channel.assertQueue(dlq, { durable: true });
    await this.channel.assertQueue(`${exchangeName}.retry`, { durable: true, messageTtl: 5000 });
    const q = await this.channel.assertQueue('', { exclusive: true, autoDelete: true });
    await this.channel.bindQueue(q.queue, exchangeName, '');
    await this.channel.consume(
      q.queue,
      async (msg) => {
        if (!msg) return;
        try {
          const payload = JSON.parse(msg.content.toString());
          await onMessage(payload);
          this.channel?.ack(msg);
        } catch (e: any) {
          console.error(`[AMQP] Reliable fanout error on ${exchangeName}:`, e.message);
          const retries = (msg.properties.headers?.['x-retry-count'] as number) || 0;
          if (retries < 3) {
            const retryQueue = `${exchangeName}.retry`;
            this.channel?.publish(exchangeName, '', msg.content, {
              persistent: true,
              headers: { 'x-retry-count': retries + 1 },
            });
            this.channel?.ack(msg);
          } else {
            this.channel?.publish('', dlq, msg.content, { persistent: true });
            this.channel?.ack(msg);
          }
        }
      },
      { noAck: false }
    );
    console.log(`[AMQP] Subscribed to fanout exchange: ${exchangeName} (manual ack, reliable)`);
  }

  async consume(
    queueName: string,
    routingKeys: string[],
    onMessage: (envelope: EventEnvelope) => Promise<void> | void
  ): Promise<void> {
    if (!this.channel) {
      await this.connect();
    }
    if (!this.channel) throw new Error('No AMQP channel available');

    const ch = this.channel;

    // Declare queue
    await ch.assertQueue(queueName, { durable: true });

    // Declare DLQ for this queue
    const dlq = `${queueName}.dlq`;
    await ch.assertQueue(dlq, { durable: true });

    // Bind queue to exchange with each routing key
    for (const key of routingKeys) {
      await ch.bindQueue(queueName, this.exchangeName, key);
      console.log(`[AMQP] Bound queue ${queueName} to routingKey=${key}`);
    }

    // Start consuming
    await ch.consume(
      queueName,
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;
        try {
          const content = msg.content.toString();
          const envelope = JSON.parse(content) as EventEnvelope;
          await onMessage(envelope);
          ch.ack(msg);
        } catch (err: any) {
          const isParseError = err instanceof SyntaxError;
          if (isParseError) {
            console.error(`[AMQP] Invalid message on ${queueName}:`, err.message);
            ch.nack(msg, false, false);
            return;
          }
          const retries = (msg.properties.headers?.['x-retry-count'] as number) || 0;
          if (retries < 3) {
            console.warn(`[AMQP] Retry ${retries + 1}/3 on ${queueName}: ${err.message}`);
            ch.publish(this.exchangeName, msg.fields.routingKey, msg.content, {
              persistent: true,
              headers: { ...msg.properties.headers, 'x-retry-count': retries + 1 },
            });
            ch.ack(msg);
          } else {
            console.error(`[AMQP] DLQ after 3 retries on ${queueName}: ${err.message}`);
            ch.publish('', dlq, msg.content, { persistent: true });
            ch.ack(msg);
          }
        }
      },
      { noAck: false }
    );
  }

  async subscribeTopic(
    exchangeName: string,
    routingKey: string,
    queueName: string,
    onMessage: (payload: any, routingKey: string) => Promise<void> | void
  ): Promise<void> {
    if (!this.channel) await this.connect();
    if (!this.channel) throw new Error('No AMQP channel available');

    const ch = this.channel;
    await ch.assertExchange(exchangeName, 'topic', { durable: true });
    await ch.assertQueue(queueName, { durable: true });
    await ch.bindQueue(queueName, exchangeName, routingKey);

    await ch.consume(
      queueName,
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;
        try {
          const content = msg.content.toString();
          let parsed: any;
          try {
            parsed = JSON.parse(content);
          } catch {
            parsed = { raw: content };
          }
          await onMessage(parsed, msg.fields.routingKey);
          ch.ack(msg);
        } catch (err: any) {
          console.error(`[AMQP] Error processing topic message on ${queueName}:`, err.message);
          ch.nack(msg, false, false);
        }
      },
      { noAck: false }
    );
    console.log(`[AMQP] Subscribed to topic exchange ${exchangeName} (key: ${routingKey}, queue: ${queueName})`);
  }
}

