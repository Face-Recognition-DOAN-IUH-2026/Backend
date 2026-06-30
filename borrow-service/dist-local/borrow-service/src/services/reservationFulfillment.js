"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkReservationsOnReturn = checkReservationsOnReturn;
const data_source_1 = require("../data-source");
const BookReservation_1 = require("../entities/BookReservation");
const NotificationServiceClient_1 = require("../clients/NotificationServiceClient");
/**
 * Check if returned book has pending reservations and notify the first patron.
 * Called after a book is returned (return or batch-return).
 */
async function checkReservationsOnReturn(bookId) {
    const reservationRepo = data_source_1.AppDataSource.getRepository(BookReservation_1.BookReservation);
    const pendingReservation = await reservationRepo.findOne({
        where: { bookId, status: 'pending' },
        order: { reservedAt: 'ASC' },
    });
    if (!pendingReservation)
        return;
    // Send notification to the patron
    try {
        await NotificationServiceClient_1.notificationServiceClient.sendNotification({
            userId: pendingReservation.patronId,
            type: 'RESERVATION_AVAILABLE',
            title: 'Sách đặt trước sẵn sàng',
            message: `Sách đã được trả và sẵn sàng mượn.`,
            data: { bookId, reservationId: pendingReservation.id },
        });
    }
    catch (err) {
        console.error('[ReservationFulfillment] Failed to send notification:', err.message);
        // Continue even if notification fails - the reservation is still marked as notified
    }
    pendingReservation.notifiedAt = new Date();
    await reservationRepo.save(pendingReservation);
}
