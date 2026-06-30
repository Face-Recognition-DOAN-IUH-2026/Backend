"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipExpiryCheck = membershipExpiryCheck;
const serviceClients_1 = require("../clients/serviceClients");
const config_1 = require("../config");
const shared_1 = require("../../../shared");
async function membershipExpiryCheck(taskConfig) {
    const daysBefore = taskConfig.days_before || 7;
    try {
        const response = await fetch(`${config_1.config.services.userService}/internal/users/expiring-membership?days=${daysBefore}`, {
            headers: {
                'Authorization': `Bearer ${(0, shared_1.getServiceToken)('automation-service', config_1.config.jwtSecret)}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            return { checked: 0, notified: 0, message: 'Failed to query expiring memberships' };
        }
        const users = await response.json();
        if (!Array.isArray(users) || users.length === 0) {
            return { checked: 0, notified: 0, message: 'No expiring memberships' };
        }
        const notifications = users.map((user) => ({
            userId: user.id,
            type: 'membership_expiry',
            title: 'Thẻ thư viện sắp hết hạn',
            body: `Thẻ thư viện của bạn sẽ hết hạn vào ngày ${new Date(user.membershipExpiry).toLocaleDateString('vi-VN')}. Vui lòng gia hạn tại quầy thủ thư.`,
            data: { expiryDate: user.membershipExpiry, daysLeft: daysBefore },
        }));
        await serviceClients_1.notificationClient.createBulkNotifications(notifications);
        // Send membership expiry emails
        for (const user of users) {
            if (user.email) {
                try {
                    await serviceClients_1.emailClient.sendMembershipExpiryEmail(user.email, user.membershipExpiry);
                }
                catch (err) {
                    console.error(`[membershipExpiryCheck] Failed to send expiry email to ${user.email}:`, err);
                }
            }
        }
        return { checked: users.length, notified: notifications.length };
    }
    catch {
        return { checked: 0, notified: 0, message: 'Error checking membership expiry' };
    }
}
