"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAmqpSubscriber = startAmqpSubscriber;
const AmqpClient_1 = require("../clients/AmqpClient");
const data_source_1 = require("../data-source");
const entities_1 = require("../entities");
async function startAmqpSubscriber() {
    try {
        await AmqpClient_1.amqpClient.connect();
        // Consume user.access.status_changed
        await AmqpClient_1.amqpClient.consume('user_service_access_queue', ['user.access.status_changed'], async (envelope) => {
            const { patronId, currentStatus, lastEntryAt, lastEntryCamera } = envelope.payload;
            if (!patronId || !currentStatus) {
                console.warn('[AMQP] Invalid payload in status changed event:', envelope);
                return;
            }
            console.log(`[AMQP] Syncing access status for user ${patronId} -> ${currentStatus}`);
            const repo = data_source_1.AppDataSource.getRepository(entities_1.User);
            const user = await repo.findOne({ where: { id: patronId } });
            if (!user) {
                console.warn(`[AMQP] User not found for status sync: ${patronId}`);
                return;
            }
            user.currentStatus = currentStatus;
            if (currentStatus === 'inside') {
                user.lastEntryAt = lastEntryAt ? new Date(lastEntryAt) : new Date();
                user.lastEntryCamera = lastEntryCamera || 'manual';
            }
            await repo.save(user);
            console.log(`[AMQP] Status synced successfully for ${user.email}`);
        });
        console.log('[AMQP] User-service subscribers initialized');
    }
    catch (err) {
        console.error('[AMQP] Failed to start user-service subscribers:', err.message);
    }
}
