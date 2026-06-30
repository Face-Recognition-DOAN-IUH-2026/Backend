"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailClient = exports.userClient = exports.accessClient = exports.scheduleClient = exports.borrowClient = exports.notificationClient = void 0;
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
                'Authorization': `Bearer ${(0, shared_1.getServiceToken)('automation-service', config_1.config.jwtSecret)}`,
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
exports.notificationClient = {
    async createNotification(input) {
        try {
            const published = await AmqpClient_1.amqpClient.publish('notification.send', {
                emailType: 'push',
                userId: input.userId,
                type: input.type,
                title: input.title,
                body: input.body,
                data: input.data || {},
            });
            if (published) {
                return { success: true, via: 'rabbitmq' };
            }
        }
        catch (err) {
            console.error('[AMQP] RabbitMQ publish failed, falling back to HTTP sync:', err.message);
        }
        return request(`${config_1.config.services.notificationService}/internal/`, {
            method: 'POST',
            body: input,
        });
    },
    async createBulkNotifications(notifications) {
        try {
            let allSuccess = true;
            for (const input of notifications) {
                const published = await AmqpClient_1.amqpClient.publish('notification.send', {
                    emailType: 'push',
                    userId: input.userId,
                    type: input.type,
                    title: input.title,
                    body: input.body,
                    data: input.data || {},
                });
                if (!published)
                    allSuccess = false;
            }
            if (allSuccess) {
                return { success: true, via: 'rabbitmq', count: notifications.length };
            }
        }
        catch (err) {
            console.error('[AMQP] RabbitMQ bulk publish failed, falling back to HTTP sync:', err.message);
        }
        return request(`${config_1.config.services.notificationService}/internal/bulk`, {
            method: 'POST',
            body: { notifications },
        });
    },
};
exports.borrowClient = {
    async getOverdueBorrows() {
        return request(`${config_1.config.services.borrowService}/borrow/internal/overdue`);
    },
    async getDueSoonBorrows(daysBefore = 3) {
        return request(`${config_1.config.services.borrowService}/borrow/internal/due-soon?days_before=${daysBefore}`);
    },
    async getActiveBorrowers() {
        return request(`${config_1.config.services.borrowService}/borrow/internal/active-borrowers`);
    },
    async getBooks(skip = 0, limit = 100) {
        return request(`${config_1.config.services.borrowService}/borrow/books?skip=${skip}&limit=${limit}`);
    },
};
exports.scheduleClient = {
    async getTodayAssignments() {
        return request(`${config_1.config.services.scheduleService}/internal/today`);
    },
    async getUpcomingAssignments(from, to) {
        return request(`${config_1.config.services.scheduleService}/internal/upcoming?from=${from}&to=${to}`);
    },
    async getAttendance(scheduleId) {
        return request(`${config_1.config.services.scheduleService}/schedules/assignments/${scheduleId}/attendance`);
    },
};
exports.accessClient = {
    async getStats() {
        return request(`${config_1.config.services.accessService}/internal/access/stats`);
    },
    async getActivePatrons() {
        return request(`${config_1.config.services.accessService}/internal/access/active`);
    },
    async getAccessLogs(dateFrom, limit = 200) {
        return request(`${config_1.config.services.accessService}/access/logs?dateFrom=${dateFrom}&limit=${limit}`);
    },
    async forceExitPatron(patronId) {
        return request(`${config_1.config.services.accessService}/internal/access/force-exit`, {
            method: 'POST',
            body: { patron_id: patronId },
        });
    },
};
exports.userClient = {
    async getUser(id) {
        return request(`${config_1.config.services.userService}/internal/users/${id}`);
    },
    async getUsers(ids) {
        const results = await Promise.allSettled(ids.map((id) => request(`${config_1.config.services.userService}/internal/users/${id}`)));
        return results
            .filter((r) => r.status === 'fulfilled')
            .map((r) => r.value);
    },
    async getUsersByRole(role) {
        return request(`${config_1.config.services.userService}/internal/users?role=${role}`);
    },
};
exports.emailClient = {
    async sendOverdueEmail(toEmail, bookTitle, daysOverdue) {
        try {
            const published = await AmqpClient_1.amqpClient.publish('notification.send', {
                emailType: 'overdue',
                toEmail,
                bookTitle,
                daysOverdue,
            });
            if (published)
                return { success: true, via: 'rabbitmq' };
        }
        catch (err) {
            console.error('[AMQP] RabbitMQ publish failed for overdue email:', err.message);
        }
        return request(`${config_1.config.services.notificationService}/internal/send-overdue-email`, {
            method: 'POST',
            body: { toEmail, bookTitle, daysOverdue },
        });
    },
    async sendFineEmail(toEmail, bookTitle, fineAmount, daysOverdue) {
        try {
            const published = await AmqpClient_1.amqpClient.publish('notification.send', {
                emailType: 'fine',
                toEmail,
                bookTitle,
                fineAmount,
                daysOverdue,
            });
            if (published)
                return { success: true, via: 'rabbitmq' };
        }
        catch (err) {
            console.error('[AMQP] RabbitMQ publish failed for fine email:', err.message);
        }
        return request(`${config_1.config.services.notificationService}/internal/send-fine-email`, {
            method: 'POST',
            body: { toEmail, bookTitle, fineAmount, daysOverdue },
        });
    },
    async sendMembershipExpiryEmail(toEmail, expiryDate) {
        try {
            const published = await AmqpClient_1.amqpClient.publish('notification.send', {
                emailType: 'membership_expiry',
                toEmail,
                expiryDate,
            });
            if (published)
                return { success: true, via: 'rabbitmq' };
        }
        catch (err) {
            console.error('[AMQP] RabbitMQ publish failed for membership expiry email:', err.message);
        }
        return request(`${config_1.config.services.notificationService}/internal/send-membership-expiry-email`, {
            method: 'POST',
            body: { toEmail, expiryDate },
        });
    },
};
