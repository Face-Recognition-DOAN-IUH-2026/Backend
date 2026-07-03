"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishEvent = publishEvent;
const AmqpClient_1 = require("../clients/AmqpClient");
async function publishEvent(type, payload) {
    try {
        await AmqpClient_1.amqpClient.publish(type, payload);
    }
    catch (error) {
        console.error('Failed to publish event to RabbitMQ:', type, error.message);
    }
}
