import { AppDataSource } from '../data-source';
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
    return this.repo().save(entry);
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

  async cancelWaitlist(id: string, patronId: string): Promise<void> {
    const entry = await this.repo().findOne({ where: { id } });
    if (!entry) throw Object.assign(new Error('Waitlist entry not found'), { statusCode: 404 });
    if (entry.patronId !== patronId) throw Object.assign(new Error('Not your waitlist entry'), { statusCode: 403 });
    await this.repo().remove(entry);
  }

  async getWaitlistById(id: string): Promise<Waitlist | null> {
    return this.repo().findOne({ where: { id } });
  }
}
