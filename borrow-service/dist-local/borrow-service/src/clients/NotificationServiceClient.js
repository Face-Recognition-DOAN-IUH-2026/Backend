"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationServiceClient = void 0;
const config_1 = require("../config");
const AmqpClient_1 = require("./AmqpClient");
const shared_1 = require("../../../shared");
async function request(url, options = {}) {
    const { method = 'GET', body, timeout = 5000 } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(0, shared_1.getServiceToken)('borrow-service', config_1.config.jwtSecret)}`,
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        return res.json();
    }
    catch (error) {
        clearTimeout(timer);
        throw error;
    }
}
exports.notificationServiceClient = {
    async sendNotification(input) {
        try {
            const published = await AmqpClient_1.amqpClient.publish('notification.send', {
                emailType: 'push',
                userId: input.userId,
                type: input.type,
                title: input.title,
                body: input.message,
                data: input.data || {},
            });
            if (published) {
                console.log('[AMQP] Published push notification event to RabbitMQ');
                return { success: true, via: 'rabbitmq' };
            }
        }
        catch (err) {
            console.error('[AMQP] RabbitMQ publish failed, falling back to HTTP sync:', err.message);
        }
        return request(`${config_1.config.notificationServiceUrl}/internal/`, {
            method: 'POST',
            body: input,
        });
    },
};
