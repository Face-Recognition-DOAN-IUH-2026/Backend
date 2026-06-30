"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startUserEventSubscriber = startUserEventSubscriber;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const data_source_1 = require("../data-source");
const AmqpClient_1 = require("../clients/AmqpClient");
function signPayload(payload, secret) {
    return crypto_1.default.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}
function verifySignature(msg) {
    const { signature, ...rest } = msg;
    const expected = signPayload(rest, config_1.config.serviceJwtSecret);
    try {
        return crypto_1.default.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    }
    catch {
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
async function startUserEventSubscriber() {
    try {
        await AmqpClient_1.amqpClient.connect();
        await AmqpClient_1.amqpClient.subscribeFanoutReliable('user.events.fanout', async (payload) => {
            try {
                const msg = payload;
                if (msg.event !== 'USER_DELETED')
                    return;
                if (!verifySignature(msg)) {
                    console.warn('[UserEventSubscriber] Invalid signature, ignoring event');
                    return;
                }
                console.log(`[UserEventSubscriber] Processing USER_DELETED for ${msg.user_id}`);
                const queryRunner = data_source_1.AppDataSource.createQueryRunner();
                await queryRunner.connect();
                try {
                    let totalDeleted = 0;
                    for (const sql of CLEANUP_QUERIES) {
                        const result = await queryRunner.query(sql, [msg.user_id]);
                        totalDeleted += result.rowCount ?? 0;
                    }
                    console.log(`[UserEventSubscriber] Cleaned ${totalDeleted} schedule records for user ${msg.user_id}`);
                }
                finally {
                    await queryRunner.release();
                }
            }
            catch (e) {
                console.error('[UserEventSubscriber] Error processing event:', e);
            }
        });
        console.log('[UserEventSubscriber] Subscribed to user.events.fanout');
    }
    catch (err) {
        console.error('[UserEventSubscriber] RabbitMQ connection failed:', err.message);
    }
}
