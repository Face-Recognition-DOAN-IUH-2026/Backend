import { AppDataSource } from '../data-source';
import { QueryFailedError } from 'typeorm';
import { Waitlist } from '../entities/Waitlist';
import { Book } from '../entities/Book';

export class WaitlistRepository {
  private repo = () => AppDataSource.getRepository(Waitlist);
  private bookRepo = () => AppDataSource.getRepository(Book);

  async joinWaitlist(bookId: string, patronId: string): Promise<Waitlist> {
    const book = await this.bookRepo().findOne({ where: { id: bookId } });
    if (!book) throw Object.assign(new Error('Book not found'), { statusCode: 404 });

    const existing = await this.repo().findOne({ where: { bookId, patronId, status: 'waiting' } });
    if (existing) throw Object.assign(new Error('Already on waitlist for this book'), { statusCode: 409 });

    const entry = this.repo().create({ bookId, patronId, status: 'waiting' });
    try {
      return await this.repo().save(entry);
    } catch (err) {
      // 1a: two concurrent subscriptions for the same (book, patron) can both
      // pass the pre-check above. The unique index is the correctness mechanism;
      // a 23505 violation means another request won the race, so return the
      // existing row instead of throwing a spurious 409.
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        const winner = await this.repo().findOne({ where: { bookId, patronId, status: 'waiting' } });
        if (winner) return winner;
      }
      throw err;
    }
  }

  async getWaitlistByBook(bookId: string): Promise<Waitlist[]> {
    return this.repo().find({
      where: { bookId, status: 'waiting' },
      order: { createdAt: 'ASC' },
    });
  }

  async markNotified(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.repo()
      .createQueryBuilder()
      .update(Waitlist)
      .set({ status: 'notified', notifiedAt: new Date() })
      .whereInIds(ids)
      .execute();
  }

  /**
   * 1b: reset this book's notified waitlist rows back to waiting so they are
   * re-notified on the next return. Called after a borrow is created for the
   * book (BorrowRepository.createBorrowRecord).
   */
  async resetNotifiedToWaiting(bookId: string): Promise<void> {
    await this.repo()
      .createQueryBuilder()
      .update(Waitlist)
      .set({ status: 'waiting', notifiedAt: null })
      .where({ bookId, status: 'notified' })
      .execute();
  }

  async cancelWaitlist(id: string, patronId: string): Promise<void> {
    const entry = await this.repo().findOne({ where: { id } });
    if (!entry) throw Object.assign(new Error('Waitlist entry not found'), { statusCode: 404 });
    if (entry.patronId !== patronId) throw Object.assign(new Error('Not your waitlist entry'), { statusCode: 403 });
    await this.repo().remove(entry);
  }

  async getWaitlistById(id: string): Promise<Waitlist | null> {
    return this.repo().findOne({ where: { id } });
  }

  async getNextInQueue(bookId: string): Promise<Waitlist | null> {
    const entries = await this.repo().find({
      where: { bookId, status: 'waiting' },
      order: { createdAt: 'ASC' },
      take: 1,
    });
    return entries[0] || null;
  }

  async markExpired(id: string): Promise<void> {
    await this.repo()
      .createQueryBuilder()
      .update(Waitlist)
      .set({ status: 'expired' })
      .where('id = :id', { id })
      .execute();
  }

  async markFulfilled(id: string): Promise<void> {
    await this.repo()
      .createQueryBuilder()
      .update(Waitlist)
      .set({ status: 'fulfilled' })
      .where('id = :id', { id })
      .execute();
  }

  async getExpiredNotifications(hours: number): Promise<Waitlist[]> {
    const threshold = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.repo().find({
      where: { status: 'notified' },
      order: { notifiedAt: 'ASC' },
    }).then(entries => entries.filter(e => e.notifiedAt && e.notifiedAt < threshold));
  }
}
