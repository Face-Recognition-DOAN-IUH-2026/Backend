"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fineNotification = fineNotification;
const serviceClients_1 = require("../clients/serviceClients");
async function fineNotification(_config, event) {
    if (!event || event.type !== 'fine.incurred') {
        return { skipped: true, message: 'Not a fine.incurred event' };
    }
    const { patronId, bookTitle, fineAmount, daysOverdue, borrowRecordId } = event.payload;
    if (!patronId || !fineAmount) {
        return { skipped: true, message: 'Missing patronId or fineAmount' };
    }
    let patronName = 'Bạn';
    let patronEmail = '';
    try {
        const patron = await serviceClients_1.userClient.getUser(patronId);
        if (patron?.fullName)
            patronName = patron.fullName;
        if (patron?.email)
            patronEmail = patron.email;
    }
    catch { }
    await serviceClients_1.notificationClient.createNotification({
        userId: patronId,
        type: 'fine_notice',
        title: 'Phí phạt trễ hạn',
        body: `${patronName}, bạn bị phạt ${fineAmount.toLocaleString('vi-VN')}đ vì trả "${bookTitle || 'sách'}" trễ ${daysOverdue || 0} ngày.`,
        data: {
            bookTitle,
            fineAmount,
            daysOverdue,
            borrowRecordId,
        },
    });
    // Send fine email
    if (patronEmail) {
        try {
            await serviceClients_1.emailClient.sendFineEmail(patronEmail, bookTitle || 'Sách', fineAmount, daysOverdue || 0);
        }
        catch (err) {
            console.error(`[fineNotification] Failed to send fine email to ${patronEmail}:`, err);
        }
    }
    return { notified: 1, patronId, fineAmount };
}
