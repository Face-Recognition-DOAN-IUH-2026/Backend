"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookAvailabilityNotify = bookAvailabilityNotify;
const serviceClients_1 = require("../clients/serviceClients");
const config_1 = require("../config");
const shared_1 = require("../../../shared");
async function bookAvailabilityNotify(_cfg, event) {
    if (!event || event.type !== 'book.returned') {
        return { notified: 0, message: 'Not a book.returned event' };
    }
    const { bookId, title: bookTitle } = event.payload;
    if (!bookId) {
        return { notified: 0, message: 'No bookId in event payload' };
    }
    // Check if there are patrons waiting for this book
    // Waitlist feature not yet implemented — return gracefully
    try {
        const response = await fetch(`${config_1.config.services.borrowService}/borrow/internal/book/${bookId}/waitlist`, {
            headers: {
                'Authorization': `Bearer ${(0, shared_1.getServiceToken)('automation-service', config_1.config.jwtSecret)}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            return { notified: 0, message: 'No waitlist available for this book' };
        }
        const waitlist = await response.json();
        if (!Array.isArray(waitlist) || waitlist.length === 0) {
            return { notified: 0, message: 'No patrons waiting for this book' };
        }
        const notifications = waitlist.map((entry) => ({
            userId: entry.patron_id || entry.patronId,
            type: 'book_available',
            title: 'Sách đã có sẵn',
            body: `Cuốn "${bookTitle || 'Sách'}" đã được trả. Bạn có thể mượn ngay bây giờ!`,
            data: { bookId, title: bookTitle },
        }));
        await serviceClients_1.notificationClient.createBulkNotifications(notifications);
        const entryIds = waitlist.map((entry) => entry.id).filter(Boolean);
        if (entryIds.length > 0) {
            try {
                await fetch(`${config_1.config.services.borrowService}/borrow/internal/waitlist/batch-notify`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${(0, shared_1.getServiceToken)('automation-service', config_1.config.jwtSecret)}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ids: entryIds }),
                });
            }
            catch { }
        }
        return { notified: notifications.length };
    }
    catch {
        return { notified: 0, message: 'Waitlist feature not available' };
    }
}
