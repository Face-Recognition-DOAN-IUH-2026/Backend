"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmqpClient = void 0;
const amqplib_1 = __importDefault(require("amqplib"));
const crypto_1 = __importDefault(require("crypto"));
class AmqpClient {
    constructor(serviceName) {
        this.connection = null;
        this.channel = null;
        this.exchangeName = 'library.exchange';
        this.isConnecting = false;
        this.rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
        this.serviceName = serviceName;
        if (this.rabbitmqUrl.includes('guest:guest')) {
            console.warn(`[AMQP] WARNING: ${serviceName} using default guest:guest credentials. Change RABBITMQ_URL in production!`);
        }
    }
    async connect(retries = 10, delay = 5000) {
        if (this.connection)
            return;
        if (this.isConnecting) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return this.connect(retries, delay);
        }
        this.isConnecting = true;
        for (let i = 0; i < retries; i++) {
            try {
                console.log(`[AMQP] Connecting to RabbitMQ at ${this.rabbitmqUrl} (Attempt ${i + 1}/${retries})...`);
                const conn = await amqplib_1.default.connect(this.rabbitmqUrl);
                const ch = await conn.createChannel();
                // Ensure topic exchange exists
                await ch.assertExchange(this.exchangeName, 'topic', { durable: true });
                conn.on('error', (err) => {
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
            }
            catch (err) {
                console.error(`[AMQP] Connection failed: ${err.message}. Retrying in ${delay}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
        this.isConnecting = false;
        throw new Error('[AMQP] Could not connect to RabbitMQ');
    }
    handleDisconnect() {
        this.connection = null;
        this.channel = null;
        console.log('[AMQP] Reconnecting in 5 seconds...');
        setTimeout(() => this.connect().catch(() => { }), 5000);
    }
    async publish(routingKey, payload, correlationId) {
        try {
            if (!this.channel) {
                await this.connect();
            }
            if (!this.channel)
                throw new Error('No AMQP channel available');
            const envelope = {
                eventId: crypto_1.default.randomUUID(),
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
        }
        catch (err) {
            console.error(`[AMQP] Publish error for routingKey=${routingKey}:`, err.message);
            return false;
        }
    }
    async publishFanout(exchangeName, payload) {
        try {
            if (!this.channel)
                await this.connect();
            if (!this.channel)
                throw new Error('No AMQP channel available');
            await this.channel.assertExchange(exchangeName, 'fanout', { durable: false });
            const buffer = Buffer.from(JSON.stringify(payload));
            return this.channel.publish(exchangeName, '', buffer);
        }
        catch (error) {
            console.error('[AMQP] Fanout Publish error:', error.message);
            return false;
        }
    }
    async subscribeFanout(exchangeName, onMessage) {
        if (!this.channel)
            await this.connect();
        if (!this.channel)
            throw new Error('No AMQP channel available');
        await this.channel.assertExchange(exchangeName, 'fanout', { durable: false });
        const q = await this.channel.assertQueue('', { exclusive: true, autoDelete: true });
        await this.channel.bindQueue(q.queue, exchangeName, '');
        await this.channel.consume(q.queue, (msg) => {
            if (msg) {
                try {
                    const payload = JSON.parse(msg.content.toString());
                    onMessage(payload);
                }
                catch (e) {
                    console.error('[AMQP] Fanout parse message error', e);
                }
            }
        }, { noAck: true });
        console.log(`[AMQP] Subscribed to fanout exchange: ${exchangeName} (noAck=true, realtime)`);
    }
    async subscribeFanoutReliable(exchangeName, onMessage) {
        if (!this.channel)
            await this.connect();
        if (!this.channel)
            throw new Error('No AMQP channel available');
        await this.channel.assertExchange(exchangeName, 'fanout', { durable: false });
        const dlq = `${exchangeName}.dlq`;
        await this.channel.assertQueue(dlq, { durable: true });
        await this.channel.assertQueue(`${exchangeName}.retry`, { durable: true, messageTtl: 5000 });
        const q = await this.channel.assertQueue('', { exclusive: true, autoDelete: true });
        await this.channel.bindQueue(q.queue, exchangeName, '');
        await this.channel.consume(q.queue, async (msg) => {
            if (!msg)
                return;
            try {
                const payload = JSON.parse(msg.content.toString());
                await onMessage(payload);
                this.channel?.ack(msg);
            }
            catch (e) {
                console.error(`[AMQP] Reliable fanout error on ${exchangeName}:`, e.message);
                const retries = msg.properties.headers?.['x-retry-count'] || 0;
                if (retries < 3) {
                    const retryQueue = `${exchangeName}.retry`;
                    this.channel?.publish(exchangeName, '', msg.content, {
                        persistent: true,
                        headers: { 'x-retry-count': retries + 1 },
                    });
                    this.channel?.ack(msg);
                }
                else {
                    this.channel?.publish(dlq, '', msg.content, { persistent: true });
                    this.channel?.ack(msg);
                }
            }
        }, { noAck: false });
        console.log(`[AMQP] Subscribed to fanout exchange: ${exchangeName} (manual ack, reliable)`);
    }
    async consume(queueName, routingKeys, onMessage) {
        if (!this.channel) {
            await this.connect();
        }
        if (!this.channel)
            throw new Error('No AMQP channel available');
        const ch = this.channel;
        // Declare queue
        await ch.assertQueue(queueName, { durable: true });
        // Bind queue to exchange with each routing key
        for (const key of routingKeys) {
            await ch.bindQueue(queueName, this.exchangeName, key);
            console.log(`[AMQP] Bound queue ${queueName} to routingKey=${key}`);
        }
        // Start consuming
        await ch.consume(queueName, async (msg) => {
            if (!msg)
                return;
            try {
                const content = msg.content.toString();
                const envelope = JSON.parse(content);
                await onMessage(envelope);
                ch.ack(msg);
            }
            catch (err) {
                console.error(`[AMQP] Error processing message on queue ${queueName}:`, err.message);
                // nack and requeue = false for invalid messages to prevent infinite loops, but we can retry on connection/DB errors
                // To be simple and clean: ack if it's a JSON parse error, otherwise nack without requeue to not clog the queue.
                ch.nack(msg, false, false);
            }
        }, { noAck: false });
    }
}
exports.AmqpClient = AmqpClient;
