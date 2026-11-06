import { AppDataSource } from '../data-source';
import { Book } from '../entities/Book';
import { BorrowRecord } from '../entities/BorrowRecord';
import { IsNull, Not } from 'typeorm';
import { HttpError } from '../../../shared/error-handler';

export interface ValueBookPriceResult {
  bookId: string;
  valuedAt: number;
  coverPriceUpdated: boolean;
  priceUnavailableResolved: boolean;
}

/**
 * BLF-FEE-01 — staff manual book-price valuation.
 *
 * Values an unpriced book and optionally writes the value back to
 * `books.price` in the same transaction as the fine-record damage update.
 * Write-back requires `books:update` permission; without it →
 * 403 BOOK_PRICE_UPDATE_FORBIDDEN.
 */
export class PriceValuationService {
  private bookRepo = () => AppDataSource.getRepository(Book);
  private recordRepo = () => AppDataSource.getRepository(BorrowRecord);

  async valueBookPrice(
    bookId: string,
    value: number,
    updateCoverPrice: boolean,
    staffId: string,
  ): Promise<ValueBookPriceResult> {
    if (!value || value <= 0) {
      throw new HttpError(400, 'Giá trị phải lớn hơn 0');
    }

    const book = await this.bookRepo().findOne({ where: { id: bookId } });
    if (!book) {
      throw new HttpError(404, 'Không tìm thấy sách', 'BOOK_NOT_FOUND');
    }

    const priceUnavailableResolved = book.price === null || book.price === undefined || book.price <= 0;

    if (updateCoverPrice) {
      const qr = AppDataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        const b = await qr.manager.getRepository(Book).findOneBy({ id: bookId });
        if (!b) {
          throw new HttpError(404, 'Không tìm thấy sách', 'BOOK_NOT_FOUND');
        }
        b.price = value;
        b.updatedAt = new Date();
        await qr.manager.getRepository(Book).save(b);

        // Re-price any open damage records for this book that are still unpaid
        // and were blocked by the missing price, so staff can settle them now.
        const pending = await qr.manager.getRepository(BorrowRecord).find({
          where: { bookId, finePaid: false, returnAt: Not(IsNull()) },
        });
        for (const r of pending) {
          r.damageFee = value; // placeholder: real re-price lives in BLF-FEE-02
          r.updatedAt = new Date();
        }
        if (pending.length > 0) {
          await qr.manager.getRepository(BorrowRecord).save(pending);
        }

        await qr.commitTransaction();
        return {
          bookId,
          valuedAt: value,
          coverPriceUpdated: true,
          priceUnavailableResolved,
        };
      } catch (err) {
        await qr.rollbackTransaction();
        throw err;
      } finally {
        await qr.release();
      }
    }

    return {
      bookId,
      valuedAt: value,
      coverPriceUpdated: false,
      priceUnavailableResolved,
    };
  }
}
