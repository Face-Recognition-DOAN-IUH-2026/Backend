import { In } from 'typeorm';
import { AppDataSource } from '../data-source';
import { WaitlistRepository } from '../repositories/WaitlistRepository';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { Waitlist } from '../entities/Waitlist';
import { serializeBook, serializeBookWithStats } from './serializers';

export class WaitlistService {
  private repo = new WaitlistRepository();

  async joinWaitlist(bookId: string, userId: string) {
    const entry = await this.repo.joinWaitlist(bookId, userId);
    return {
      id: entry.id,
      book_id: entry.bookId,
      patron_id: entry.patronId,
      status: entry.status,
      created_at: entry.createdAt,
    };
  }

  async cancelWaitlist(entryId: string, userId: string) {
    await this.repo.cancelWaitlist(entryId, userId);
  }

  async listWaitlist(userId: string) {
    const waitlistRepo = AppDataSource.getRepository(Waitlist);
    const entries = await waitlistRepo.find({
      where: { patronId: userId, status: In(['waiting', 'notified']) },
      relations: { book: true },
      order: { createdAt: 'ASC' },
    });
    const bookIds = entries.map((e: any) => e.bookId).filter(Boolean);
    const borrowRepo = new BorrowRepository();
    const stats = bookIds.length > 0 ? await borrowRepo.getStatsForBooks(bookIds) : new Map();

    return {
      items: entries.map((e: any) => {
        const bookStat = e.bookId ? stats.get(e.bookId) : null;
        return {
          id: e.id,
          book_id: e.bookId,
          status: e.status,
          created_at: e.createdAt,
          book: e.book
            ? serializeBookWithStats(
                e.book,
                bookStat?.totalCopies ?? 0,
                bookStat?.availableCopies ?? 0
              )
            : null,
        };
      }),
      total: entries.length,
    };
  }
}
