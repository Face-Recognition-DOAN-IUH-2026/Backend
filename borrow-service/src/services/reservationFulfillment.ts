import { AppDataSource } from '../data-source';
import { BookReservation } from '../entities/BookReservation';
import { notificationServiceClient } from '../clients/NotificationServiceClient';

/**
 * Check if returned book has pending reservations and notify the first patron.
 * Called after a book is returned (return or batch-return).
 */
export async function checkReservationsOnReturn(bookId: string): Promise<void> {
  const reservationRepo = AppDataSource.getRepository(BookReservation);

  const pendingReservation = await reservationRepo.findOne({
    where: { bookId, status: 'pending' as any },
    order: { reservedAt: 'ASC' as any },
  });

  if (!pendingReservation) return;

  // Send notification to the patron
  try {
    await notificationServiceClient.sendNotification({
      userId: pendingReservation.patronId,
      type: 'RESERVATION_AVAILABLE',
      title: 'Sách đặt trước sẵn sàng',
      message: `Sách đã được trả và sẵn sàng mượn.`,
      data: { bookId, reservationId: pendingReservation.id },
    });
  } catch (err: any) {
    console.error('[ReservationFulfillment] Failed to send notification:', err.message);
    // Continue even if notification fails - the reservation is still marked as notified
  }

  pendingReservation.notifiedAt = new Date();
  await reservationRepo.save(pendingReservation);
}
