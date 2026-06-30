"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
exports.verifyUserDeletedEvent = verifyUserDeletedEvent;
const crypto_1 = __importDefault(require("crypto"));
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("../config");
const AmqpClient_1 = require("../clients/AmqpClient");
function signPayload(payload, secret) {
    const body = JSON.stringify(payload);
    return crypto_1.default.createHmac('sha256', secret).update(body).digest('hex');
}
const EXCHANGE = 'user.events.fanout';
class RedisService {
    constructor() {
        this.client = new ioredis_1.default(config_1.config.redisUrl, {
            retryStrategy: (times) => Math.min(times * 50, 2000),
            maxRetriesPerRequest: 3,
        });
        this.client.on('error', (err) => {
            console.error('Redis connection error:', err);
        });
        this.client.on('connect', () => {
            console.log('Redis connected');
        });
    }
    async publishUserDeleted(userId, email) {
        try {
            const body = {
                event: 'USER_DELETED',
                user_id: userId,
                email,
                timestamp: new Date().toISOString(),
            };
            const signature = signPayload(body, config_1.config.serviceJwtSecret);
            const message = { ...body, signature };
            await AmqpClient_1.amqpClient.publishFanout(EXCHANGE, message);
        }
        catch (e) {
            console.warn('RabbitMQ publish failed, face cleanup may be delayed:', e);
        }
    }
    async publishUserUpdated(userId, email) {
        try {
            const body = {
                event: 'USER_UPDATED',
                user_id: userId,
                email,
                timestamp: new Date().toISOString(),
            };
            const signature = signPayload(body, config_1.config.serviceJwtSecret);
            const message = { ...body, signature };
            await AmqpClient_1.amqpClient.publishFanout(EXCHANGE, message);
        }
        catch (e) {
            console.warn('RabbitMQ publish failed, user update notification may be delayed:', e);
        }
    }
    async setPasswordResetCode(email, code) {
        const key = `reset_code:${email.toLowerCase()}`;
        await this.client.set(key, code, 'EX', 15 * 60); // 15 mins
    }
    async getPasswordResetCode(email) {
        const key = `reset_code:${email.toLowerCase()}`;
        return await this.client.get(key);
    }
    async deletePasswordResetCode(email) {
        const key = `reset_code:${email.toLowerCase()}`;
        await this.client.del(key);
    }
    async setEmailVerificationCode(email, code) {
        const key = `verify_code:${email.toLowerCase()}`;
        await this.client.set(key, code, 'EX', 5 * 60); // 5 minutes
    }
    async getEmailVerificationCode(email) {
        const key = `verify_code:${email.toLowerCase()}`;
        return await this.client.get(key);
    }
    async deleteEmailVerificationCode(email) {
        const key = `verify_code:${email.toLowerCase()}`;
        await this.client.del(key);
    }
    async cacheFaceStatus(userId, enrolled) {
        const key = `face_status:${userId}`;
        await this.client.setex(key, 3600, JSON.stringify(enrolled));
    }
    async getFaceStatus(userId) {
        const key = `face_status:${userId}`;
        const val = await this.client.get(key);
        if (val === null)
            return null;
        return JSON.parse(val);
    }
    async invalidateFaceStatus(userId) {
        const key = `face_status:${userId}`;
        await this.client.del(key);
    }
    async setPreRegisterOtp(email, code) {
        const key = `pre_register_otp:${email.toLowerCase()}`;
        await this.client.set(key, code, 'EX', 5 * 60);
    }
    async getPreRegisterOtp(email) {
        const key = `pre_register_otp:${email.toLowerCase()}`;
        return await this.client.get(key);
    }
    async deletePreRegisterOtp(email) {
        const key = `pre_register_otp:${email.toLowerCase()}`;
        await this.client.del(key);
    }
    async setPreRegisterToken(email, token) {
        const key = `pre_register_token:${email.toLowerCase()}`;
        await this.client.set(key, token, 'EX', 10 * 60);
    }
    async getPreRegisterToken(email) {
        const key = `pre_register_token:${email.toLowerCase()}`;
        return await this.client.get(key);
    }
    async deletePreRegisterToken(email) {
        const key = `pre_register_token:${email.toLowerCase()}`;
        await this.client.del(key);
    }
}
exports.RedisService = RedisService;
function verifyUserDeletedEvent(message, secret) {
    const { signature, ...rest } = message;
    const expected = signPayload(rest, secret);
    try {
        return crypto_1.default.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    }
    catch {
        return false;
    }
}
