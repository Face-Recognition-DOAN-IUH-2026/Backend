import { AppDataSource } from '../data-source';
import { BookReservation } from '../entities/BookReservation';

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

  pendingReservation.notifiedAt = new Date();
  await reservationRepo.save(pendingReservation);
}
