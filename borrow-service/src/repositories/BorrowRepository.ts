import { Brackets, In, IsNull } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BorrowRecord } from '../entities/BorrowRecord';
import { config } from '../config';

export class BorrowRepository {
  books = AppDataSource.getRepository(Book);
  copies = AppDataSource.getRepository(BookCopy);
  records = AppDataSource.getRepository(BorrowRecord);

  getBookByIsbn(isbn: string) {
    return this.books.findOne({ where: { isbn }, relations: { copies: true } });
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
    return this.copies.findOne({ where: { barcode }, relations: { book: true } });
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

  async createBook(isbn: string, title: string, author?: string | null, coverUrl?: string | null, shelfLocation?: string | null) {
    const book = this.books.create({ isbn, title, author: author || null, coverUrl: coverUrl || null, shelfLocation: shelfLocation || null });
    return this.books.save(book);
  }

  async upsertBook(isbn: string, title: string, author?: string | null, coverUrl?: string | null) {
    const existing = await this.getBookByIsbn(isbn);
    if (existing) {
      existing.title = title || existing.title;
      if (author !== undefined) existing.author = author;
      if (coverUrl !== undefined) existing.coverUrl = coverUrl;
      return { book: await this.books.save(existing), created: false };
    }
    return { book: await this.createBook(isbn, title, author, coverUrl), created: true };
  }

  async createCopy(bookId: string, barcode: string, shelfLocation?: string | null) {
    const copy = this.copies.create({ bookId, barcode, isAvailable: true, shelfLocation: shelfLocation || null });
    return this.copies.save(copy);
  }

  async createCopiesBatchWithSkip(bookId: string, barcodes: string[], shelfLocation?: string | null) {
    const inserted: BookCopy[] = [];
    for (const barcode of barcodes) {
      const existing = await this.getCopyByBarcode(barcode);
      if (!existing) {
        inserted.push(await this.createCopy(bookId, barcode, shelfLocation));
      }
    }
    return inserted;
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

  async returnBook(record: BorrowRecord, returnedByUserId?: string | null, returnedByEmail?: string | null, returnMethod?: string | null) {
    record.returnAt = new Date();
    record.status = 'returned';
    record.returnedByUserId = returnedByUserId || null;
    record.returnedByEmail = returnedByEmail || null;
    record.returnMethod = returnMethod || null;
    record.updatedAt = new Date();
    return this.records.save(record);
  }

  async getBooksByIsbns(isbns: string[]) {
    if (!isbns.length) return new Map<string, Book>();
    const books = await this.books.find({ where: { isbn: In(isbns) } });
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
}
