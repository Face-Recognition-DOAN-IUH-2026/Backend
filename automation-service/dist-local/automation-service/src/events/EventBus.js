"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventBus = exports.EventBus = void 0;
const AmqpClient_1 = require("../clients/AmqpClient");
const EXCHANGE = 'user.events.fanout';
class EventBus {
    constructor() {
        this.handlers = new Map();
    }
    async connect() {
        // RabbitMQ fanout for user events
        try {
            await AmqpClient_1.amqpClient.connect();
            await AmqpClient_1.amqpClient.subscribeFanout(EXCHANGE, async (payload) => {
                const event = {
                    type: payload.event || payload.type,
                    payload: payload,
                    timestamp: payload.timestamp || new Date().toISOString(),
                };
                await this.dispatch(event);
            });
            console.log('[EventBus] Subscribed to user.events.fanout');
        }
        catch (err) {
            console.error('[EventBus] RabbitMQ fanout init failed:', err.message);
        }
        // RabbitMQ topic for book events
        try {
            await AmqpClient_1.amqpClient.connect();
            await AmqpClient_1.amqpClient.consume('automation_service_queue', ['book.borrowed', 'book.returned', 'schedule.changed', 'fine.incurred'], async (envelope) => {
                console.log(`[AMQP] Automation EventBus received: ${envelope.eventType}`);
                const event = {
                    type: envelope.eventType,
                    payload: envelope.payload,
                    timestamp: envelope.occurredAt,
                };
                await this.dispatch(event);
            });
            console.log('[EventBus] Connected to RabbitMQ topic exchange');
        }
        catch (err) {
            console.error('[EventBus] RabbitMQ topic init failed:', err.message);
        }
    }
    on(eventType, handler) {
        if (!this.handlers.has(eventType)) {
            this.handlers.set(eventType, []);
        }
        this.handlers.get(eventType).push(handler);
    }
    async publish(event) {
        await this.dispatch(event);
        try {
            await AmqpClient_1.amqpClient.publish(event.type, event.payload);
        }
        catch (err) {
            console.error('[EventBus] Failed to publish to RabbitMQ:', err.message);
        }
    }
    async dispatch(event) {
        const handlers = this.handlers.get(event.type) || [];
        const wildcardHandlers = this.handlers.get('*') || [];
        const allHandlers = [...handlers, ...wildcardHandlers];
        for (const handler of allHandlers) {
            try {
                await handler(event);
            }
            catch (error) {
                console.error(`[EventBus] handler error for ${event.type}:`, error);
            }
        }
    }
}
exports.EventBus = EventBus;
exports.eventBus = new EventBus();
