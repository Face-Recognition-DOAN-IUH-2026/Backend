import { Brackets, In, IsNull } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BorrowRecord } from '../entities/BorrowRecord';
import { BorrowSlip } from '../entities/BorrowSlip';
import { config } from '../config';
import { calculateOverdueFine } from '../utils/fineCalculator';

export class BorrowRepository {
  books = AppDataSource.getRepository(Book);
  copies = AppDataSource.getRepository(BookCopy);
  records = AppDataSource.getRepository(BorrowRecord);
  slips = AppDataSource.getRepository(BorrowSlip);

  private normalizeCode(code: string) {
    return code.replace(/[\s-]+/g, '').trim();
  }

  getBookByIsbn(isbn: string) {
    const cleaned = this.normalizeCode(isbn);
    return this.books.createQueryBuilder('book')
      .leftJoinAndSelect('book.copies', 'copy')
      .where("REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') = :isbn", { isbn: cleaned })
      .getOne();
  }

  getBookByNormalizedIsbn(isbn: string) {
    return this.books.createQueryBuilder('book')
      .leftJoinAndSelect('book.copies', 'copy')
      .where("REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') = :isbn", { isbn })
      .getOne();
  }

  getBookById(id: string) {
    return this.books.findOne({ where: { id }, relations: { copies: true } });
  }

  getCopyByBarcode(barcode: string) {
    const cleaned = this.normalizeCode(barcode);
    return this.copies.createQueryBuilder('copy')
      .leftJoinAndSelect('copy.book', 'book')
      .where("REPLACE(REPLACE(copy.barcode, '-', ''), ' ', '') = :barcode", { barcode: cleaned })
      .getOne();
  }

  getCopyById(id: string) {
    return this.copies.findOne({ where: { id }, relations: { book: true } });
  }

  async getAvailableCopy(bookId: string) {
    return this.copies.findOne({ where: { bookId, isAvailable: true }, order: { createdAt: 'ASC' } });
  }

  async listBooks(skip = 0, limit = 20, search?: string) {
    const qb = this.books.createQueryBuilder('book');
    if (search) {
      qb.where(new Brackets((where) => {
        where.where('book.isbn ILIKE :q', { q: `%${search}%` })
          .orWhere('book.title ILIKE :q', { q: `%${search}%` })
          .orWhere('book.author ILIKE :q', { q: `%${search}%` });
      }));
    }
    const [items, total] = await qb.orderBy('book.createdAt', 'DESC').skip(skip).take(limit).getManyAndCount();
    const stats = await this.getStatsForBooks(items.map((book) => book.id));
    return { items, total, stats };
  }

  async getStatsForBooks(bookIds: string[]) {
    if (!bookIds.length) return new Map<string, { total: number; available: number }>();
    const rows = await this.copies.createQueryBuilder('copy')
      .select('copy.bookId', 'book_id')
      .addSelect('COUNT(copy.id)', 'total')
      .addSelect(`SUM(CASE WHEN copy.isAvailable = true THEN 1 ELSE 0 END)`, 'available')
      .where('copy.bookId IN (:...bookIds)', { bookIds })
      .groupBy('copy.bookId')
      .getRawMany();
    const map = new Map<string, { total: number; available: number }>();
    rows.forEach((row) => map.set(row.book_id, { total: Number(row.total), available: Number(row.available || 0) }));
    return map;
  }

  async createBook(
    isbn: string,
    title: string,
    author?: string | null,
    coverUrl?: string | null,
    shelfLocation?: string | null,
    extra?: {
      subtitle?: string | null;
      publisher?: string | null;
      publishedDate?: string | null;
      description?: string | null;
      pageCount?: number | null;
      categories?: string | null;
      averageRating?: number | null;
      language?: string | null;
      isbn10?: string | null;
      isbn13?: string | null;
    }
  ) {
    const book = this.books.create({
      isbn: this.normalizeCode(isbn),
      title,
      author: author || null,
      coverUrl: coverUrl || null,
      shelfLocation: shelfLocation || null,
      subtitle: extra?.subtitle || null,
      publisher: extra?.publisher || null,
      publishedDate: extra?.publishedDate || null,
      description: extra?.description || null,
      pageCount: extra?.pageCount || null,
      categories: extra?.categories || null,
      averageRating: extra?.averageRating || null,
      language: extra?.language || null,
      isbn10: extra?.isbn10 || null,
      isbn13: extra?.isbn13 || null,
    });
    return this.books.save(book);
  }

  async upsertBook(
    isbn: string,
    title: string,
    author?: string | null,
    coverUrl?: string | null,
    extra?: {
      subtitle?: string | null;
      publisher?: string | null;
      publishedDate?: string | null;
      description?: string | null;
      pageCount?: number | null;
      categories?: string | null;
      averageRating?: number | null;
      language?: string | null;
      isbn10?: string | null;
      isbn13?: string | null;
    }
  ) {
    const existing = await this.getBookByIsbn(isbn);
    if (existing) {
      existing.title = title || existing.title;
      if (author !== undefined) existing.author = author;
      if (coverUrl !== undefined) existing.coverUrl = coverUrl;
      if (extra) {
        if (extra.subtitle !== undefined) existing.subtitle = extra.subtitle;
        if (extra.publisher !== undefined) existing.publisher = extra.publisher;
        if (extra.publishedDate !== undefined) existing.publishedDate = extra.publishedDate;
        if (extra.description !== undefined) existing.description = extra.description;
        if (extra.pageCount !== undefined) existing.pageCount = extra.pageCount;
        if (extra.categories !== undefined) existing.categories = extra.categories;
        if (extra.averageRating !== undefined) existing.averageRating = extra.averageRating;
        if (extra.language !== undefined) existing.language = extra.language;
        if (extra.isbn10 !== undefined) existing.isbn10 = extra.isbn10;
        if (extra.isbn13 !== undefined) existing.isbn13 = extra.isbn13;
      }
      return { book: await this.books.save(existing), created: false };
    }
    return { book: await this.createBook(this.normalizeCode(isbn), title, author, coverUrl, undefined, extra), created: true };
  }

  async createCopy(bookId: string, barcode: string, shelfLocation?: string | null) {
    const copy = this.copies.create({ bookId, barcode: this.normalizeCode(barcode), isAvailable: true, shelfLocation: shelfLocation || null });
    return this.copies.save(copy);
  }

  async createCopiesBatchWithSkip(bookId: string, barcodes: string[], shelfLocation?: string | null) {
    const normalized = barcodes.map(b => this.normalizeCode(b));

    // Batch check which barcodes already exist
    const existingCopies = await this.copies.find({
      where: { barcode: In(normalized) }
    });
    const existingBarcodes = new Set(existingCopies.map(c => c.barcode));

    // Filter out existing barcodes
    const newBarcodes = normalized.filter(b => !existingBarcodes.has(b));
    if (newBarcodes.length === 0) return [];

    // Batch insert new copies
    const newCopies = this.copies.create(
      newBarcodes.map(barcode => ({
        bookId,
        barcode,
        isAvailable: true,
        shelfLocation: shelfLocation || null,
      }))
    );
    return this.copies.save(newCopies);
  }

  async setCopyAvailable(copy: BookCopy, isAvailable: boolean) {
    copy.isAvailable = isAvailable;
    copy.updatedAt = new Date();
    return this.copies.save(copy);
  }

  async getActiveBorrow(patronId: string, bookId: string) {
    return this.records.findOne({ where: { patronId, bookId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true } });
  }

  async getActiveBorrowsByPatronAndBook(patronId: string, bookId: string) {
    return this.records.find({ where: { patronId, bookId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
  }

  async getActiveBorrowByCopy(copyId: string) {
    return this.records.findOne({ where: { copyId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true } });
  }

  getBorrowRecordById(id: string) {
    return this.records.findOne({ where: { id }, relations: { book: true, copy: true } });
  }

  getAllActiveBorrows() {
    return this.records.find({ where: { status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true }, order: { dueAt: 'ASC', borrowAt: 'DESC' } });
  }

  countActiveBorrows(patronId: string) {
    return this.records.count({ where: { patronId, status: 'borrowed', returnAt: IsNull() } });
  }

  getOverdueBorrows(patronId: string) {
    return this.records.createQueryBuilder('record')
      .where('record.patronId = :patronId', { patronId })
      .andWhere('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .andWhere('record.dueAt < :now', { now: new Date() })
      .getMany();
  }

  async getStats(): Promise<{ total: number; active: number; overdue: number }> {
    const total = await this.records.count();
    const active = await this.records.count({ where: { status: 'borrowed', returnAt: IsNull() } });
    const overdue = await this.records.createQueryBuilder('record')
      .where('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .andWhere('record.dueAt < :now', { now: new Date() })
      .getCount();
    return { total, active, overdue };
  }

  getBorrowsByPatron(patronId: string, status?: string) {
    const where: any = { patronId };
    if (status) where.status = status;
    return this.records.find({ where, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
  }

  getActiveBorrowsByPatron(patronId: string) {
    return this.records.find({ where: { patronId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true }, order: { dueAt: 'ASC', borrowAt: 'DESC' } });
  }

  async createBorrowRecord(patronId: string, bookId: string, copyId?: string | null, shelfLocation?: string | null) {
    const dueAt = new Date(Date.now() + config.maxBorrowDays * 24 * 60 * 60 * 1000);
    const record = this.records.create({ patronId, bookId, copyId: copyId || null, borrowAt: new Date(), dueAt, shelfLocation: shelfLocation || null, status: 'borrowed' });
    return this.records.save(record);
  }

  async returnBook(record: BorrowRecord, returnedByUserId?: string | null, returnedByEmail?: string | null, returnMethod?: string | null, note?: string | null) {
    record.returnAt = new Date();
    record.status = 'returned';
    record.returnedByUserId = returnedByUserId || null;
    record.returnedByEmail = returnedByEmail || null;
    record.returnMethod = returnMethod || null;
    record.note = note || null;
    record.updatedAt = new Date();

    const now = new Date();
    if (record.dueAt && now > new Date(record.dueAt)) {
      const overdueMs = now.getTime() - new Date(record.dueAt).getTime();
      const overdueDays = Math.ceil(overdueMs / (1000 * 60 * 60 * 24));
      record.fineAmount = calculateOverdueFine(overdueDays);
    }

    const saved = await this.records.save(record);
    if (record.slipId) {
      await this.closeSlipIfComplete(record.slipId);
    }
    return saved;
  }

  async getBooksByIsbns(isbns: string[]) {
    if (!isbns.length) return new Map<string, Book>();
    const cleaned = isbns.map((isbn) => this.normalizeCode(isbn));
    const books = await this.books.createQueryBuilder('book')
      .where("REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') IN (:...isbns)", { isbns: cleaned })
      .getMany();
    return new Map(books.map((book) => [book.isbn, book]));
  }

  async getBarcodeOffsetsByBooks(isbns: string[]) {
    if (!isbns.length) return new Map<string, number>();
    const rows = await this.copies.createQueryBuilder('copy')
      .innerJoin(Book, 'book', 'book.id = copy.bookId')
      .select('book.isbn', 'isbn')
      .addSelect('MAX(copy.barcode)', 'max_barcode')
      .where('book.isbn IN (:...isbns)', { isbns })
      .andWhere('copy.barcode LIKE :prefix', { prefix: 'LIB-%' })
      .groupBy('book.isbn')
      .getRawMany();
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const match = String(row.max_barcode || '').match(/-(\d+)$/);
      if (match) map.set(row.isbn, Number(match[1]));
    });
    return map;
  }

  async countCopies(bookId: string, availableOnly = false) {
    const where: any = { bookId };
    if (availableOnly) where.isAvailable = true;
    return this.copies.count({ where });
  }

  async getMaxBarcodeNumberForBook(book: Book) {
    const row = await this.copies.createQueryBuilder('copy')
      .select('MAX(copy.barcode)', 'max_barcode')
      .where('copy.bookId = :bookId', { bookId: book.id })
      .andWhere('copy.barcode LIKE :prefix', { prefix: 'LIB-%' })
      .getRawOne();
    const match = String(row?.max_barcode || '').match(/-(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  async getAvailableCopiesByBarcodeDesc(bookId: string) {
    return this.copies.find({ where: { bookId, isAvailable: true }, order: { barcode: 'DESC' } });
  }

  deleteCopies(copies: BookCopy[]) {
    return this.copies.remove(copies);
  }

  async hasActiveBorrows(bookId: string): Promise<boolean> {
    const count = await this.records.createQueryBuilder('record')
      .innerJoin('record.copy', 'copy')
      .where('copy.bookId = :bookId', { bookId })
      .andWhere('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .getCount();
    return count > 0;
  }

  async deleteBookAndCopies(bookId: string): Promise<void> {
    await this.records.createQueryBuilder()
      .delete()
      .from(BorrowRecord)
      .where('copyId IN (SELECT id FROM book_copies WHERE bookId = :bookId)', { bookId })
      .execute();
    await this.copies.delete({ bookId });
    await this.books.delete(bookId);
  }

  async bulkDeleteBooks(bookIds: string[]): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    let deleted = 0;
    for (const bookId of bookIds) {
      const hasActive = await this.hasActiveBorrows(bookId);
      if (hasActive) {
        const book = await this.books.findOne({ where: { id: bookId } });
        errors.push(book ? `${book.title} (${book.isbn}) - đang có bản được mượn` : `ID ${bookId} - đang có bản được mượn`);
        continue;
      }
      await this.deleteBookAndCopies(bookId);
      deleted++;
    }
    return { deleted, errors };
  }

  // === Borrow Slip ===

  async createSlip(patronId: string, bookIds: string[], copyIds: (string | null)[], shelfLocations: (string | null)[], createdByUserId?: string | null, createdByEmail?: string | null, note?: string | null) {
    const dueAt = new Date(Date.now() + config.maxBorrowDays * 24 * 60 * 60 * 1000);
    const slip = this.slips.create({ patronId, dueAt, status: 'active', createdByUserId: createdByUserId || null, createdByEmail: createdByEmail || null, totalItems: bookIds.length, note: note || null });
    await this.slips.save(slip);

    const records: BorrowRecord[] = [];
    for (let i = 0; i < bookIds.length; i += 1) {
      const record = this.records.create({
        patronId, bookId: bookIds[i], copyId: copyIds[i] || null, slipId: slip.id,
        borrowAt: new Date(), dueAt, shelfLocation: shelfLocations[i] || null, status: 'borrowed',
      });
      records.push(record);
    }
    await this.records.save(records);

    slip.totalItems = records.length;
    await this.slips.save(slip);

    return { slip, records };
  }

  getActiveSlip(slipId: string) {
    return this.slips.findOne({ where: { id: slipId, status: 'active' } });
  }

  async closeSlipIfComplete(slipId: string) {
    const remaining = await this.records.count({ where: { slipId, status: 'borrowed', returnAt: IsNull() } });
    if (remaining === 0) {
      await this.slips.update(slipId, { status: 'closed', updatedAt: new Date() });
      return true;
    }
    return false;
  }

  getRecordsBySlipId(slipId: string) {
    return this.records.find({ where: { slipId }, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
  }

  getSlipsByPatron(patronId: string) {
    return this.slips.find({ where: { patronId }, order: { createdAt: 'DESC' } });
  }

  async getCopiesByBarcodes(barcodes: string[]): Promise<Map<string, BookCopy & { book: Book }>> {
    const copies = await this.copies.find({
      where: { barcode: In(barcodes) },
      relations: { book: true },
    });
    return new Map(copies.map(c => [c.barcode, c]));
  }

  async getCopyCountsByBookIds(bookIds: string[]): Promise<Map<string, { total: number; available: number }>> {
    const result = new Map<string, { total: number; available: number }>();

    const counts = await this.copies
      .createQueryBuilder('copy')
      .select('copy.book_id', 'bookId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN copy.is_available = true THEN 1 ELSE 0 END)', 'available')
      .where('copy.book_id IN (:...bookIds)', { bookIds })
      .groupBy('copy.book_id')
      .getRawMany();

    for (const count of counts) {
      result.set(count.bookId, {
        total: parseInt(count.total),
        available: parseInt(count.available),
      });
    }

    return result;
  }
}
