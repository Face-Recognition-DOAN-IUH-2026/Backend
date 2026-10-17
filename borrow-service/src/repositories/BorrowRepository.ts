import { Brackets, EntityManager, In, IsNull, Not } from 'typeorm';
import { HttpError } from '../../../shared/error-handler';
import { AppDataSource } from '../data-source';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BookCopyConditionHistory } from '../entities/BookCopyConditionHistory';
import { BorrowRecord } from '../entities/BorrowRecord';
import { BorrowSlip } from '../entities/BorrowSlip';
import { config } from '../config';
import { finalizeReturnFees } from '../services/returnFinalizer';
import { PaymentFinalization } from '../utils/fineCalculator';

import { configService } from '../services/ConfigService';
import { CopyCondition, DEFAULT_CONDITION, DEFAULT_COPY_STATUS, markCopyAsBorrowed, recommendCopyAction } from '../constants/copy';

export class BorrowRepository {
  books = AppDataSource.getRepository(Book);
  copies = AppDataSource.getRepository(BookCopy);
  records = AppDataSource.getRepository(BorrowRecord);
  slips = AppDataSource.getRepository(BorrowSlip);
  conditionHistory = AppDataSource.getRepository(BookCopyConditionHistory);

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
    const cleaned = this.normalizeCode(barcode).toLowerCase();
    return this.copies.createQueryBuilder('copy')
      .leftJoinAndSelect('copy.book', 'book')
      .where("LOWER(REPLACE(REPLACE(copy.barcode, '-', ''), ' ', '')) = :barcode", { barcode: cleaned })
      .getOne();
  }

  getCopyById(id: string) {
    return this.copies.findOne({ where: { id }, relations: { book: true } });
  }

  async getCopiesByIds(ids: string[]): Promise<Map<string, BookCopy & { book: Book }>> {
    if (!ids.length) return new Map();
    const copies = await this.copies.find({ where: { id: In(ids) }, relations: { book: true } });
    return new Map(copies.map(c => [c.id, c as BookCopy & { book: Book }]));
  }

  async getAvailableCopy(bookId: string) {
    return this.copies.findOne({
      where: { bookId, isAvailable: true, status: DEFAULT_COPY_STATUS, condition: Not('lost' as CopyCondition) },
      order: { createdAt: 'ASC' },
    });
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

  async getAggregateStats() {
    const row = await this.copies.createQueryBuilder('copy')
      .select('COUNT(copy.id)', 'total')
      .addSelect(`SUM(CASE WHEN copy.isAvailable = true THEN 1 ELSE 0 END)`, 'available')
      .getRawOne();
    const totalCopies = Number(row?.total || 0);
    const availableCopies = Number(row?.available || 0);
    const outOfStockRow = await this.books.createQueryBuilder('book')
      .select('COUNT(book.id)', 'out_of_stock')
      .where('NOT EXISTS (SELECT 1 FROM book_copies c WHERE c.book_id = book.id AND c.is_available = true)')
      .getRawOne();
    const outOfStockBooks = Number(outOfStockRow?.out_of_stock || 0);
    return { totalCopies, availableCopies, borrowedCopies: totalCopies - availableCopies, outOfStockBooks };
  }

  async getConditionDistribution(): Promise<{
    conditions: Record<string, number>;
    statuses: Record<string, number>;
    total_copies: number;
  }> {
    const condRows: Array<{ condition: string | null; count: string }> = await this.copies.createQueryBuilder('copy')
      .select('copy.condition', 'condition')
      .addSelect('COUNT(copy.id)', 'count')
      .groupBy('copy.condition')
      .getRawMany();
    const statusRows: Array<{ status: string | null; count: string }> = await this.copies.createQueryBuilder('copy')
      .select('copy.status', 'status')
      .addSelect('COUNT(copy.id)', 'count')
      .groupBy('copy.status')
      .getRawMany();
    const conditions: Record<string, number> = {};
    const statuses: Record<string, number> = {};
    let total = 0;
    for (const row of condRows) {
      const key = row.condition || 'unknown';
      const count = Number(row.count);
      conditions[key] = (conditions[key] || 0) + count;
      total += count;
    }
    for (const row of statusRows) {
      const key = row.status || 'unknown';
      statuses[key] = (statuses[key] || 0) + Number(row.count);
    }
    return { conditions, statuses, total_copies: total };
  }

  async getConditionAttention(limit = 200): Promise<{
    summary: { minor_damage: number; major_damage: number; lost: number; maintenance: number; disposed: number; total: number };
    items: Array<{ copy: BookCopy; book: Book | null; recommendation: { action: string; label: string; reason: string } }>;
  }> {
    const tracked = ['minor_damage', 'major_damage', 'lost', 'maintenance', 'disposed'];
    const summaryRows: Array<{ condition: string; count: string }> = await this.copies.createQueryBuilder('copy')
      .select('copy.condition', 'condition')
      .addSelect('COUNT(copy.id)', 'count')
      .where('copy.condition IN (:...tracked)', { tracked })
      .groupBy('copy.condition')
      .getRawMany();
    const summary = { minor_damage: 0, major_damage: 0, lost: 0, maintenance: 0, disposed: 0, total: 0 };
    for (const row of summaryRows) {
      if (row.condition in summary) {
        (summary as any)[row.condition] = Number(row.count);
        summary.total += Number(row.count);
      }
    }

    const actionable = await this.copies.createQueryBuilder('copy')
      .leftJoinAndSelect('copy.book', 'book')
      .where('copy.condition IN (:...conds)', { conds: ['minor_damage', 'major_damage', 'lost'] })
      .orderBy(`CASE copy.condition WHEN 'lost' THEN 0 WHEN 'major_damage' THEN 1 ELSE 2 END`)
      .addOrderBy('copy.updatedAt', 'DESC')
      .limit(limit)
      .getMany();

    const items = actionable
      .map((copy) => {
        const recommendation = recommendCopyAction(copy.condition);
        if (!recommendation) return null;
        return { copy, book: (copy as any).book ?? null, recommendation };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return { summary, items };
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
      price?: number | null;
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
      price: extra?.price ?? null,
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
      price?: number | null;
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
        if (extra.price !== undefined) existing.price = extra.price;
      }
      return { book: await this.books.save(existing), created: false };
    }
    return { book: await this.createBook(this.normalizeCode(isbn), title, author, coverUrl, undefined, extra), created: true };
  }

  async createCopy(
    bookId: string,
    barcode: string,
    shelfLocation?: string | null,
    options?: { condition?: string; status?: string; importedAt?: Date },
  ) {
    const status = options?.status || DEFAULT_COPY_STATUS;
    const copy = this.copies.create({
      bookId,
      barcode: this.normalizeCode(barcode),
      isAvailable: status === 'available',
      shelfLocation: shelfLocation || null,
      condition: options?.condition || DEFAULT_CONDITION,
      status,
      ...(options?.importedAt ? { importedAt: options.importedAt } : {}),
    });
    return this.copies.save(copy);
  }

  listCopiesByBook(bookId: string) {
    return this.copies.find({ where: { bookId }, order: { barcode: 'ASC' } });
  }

  async updateCopy(id: string, fields: { condition?: string; status?: string; shelfLocation?: string | null; barcode?: string }) {
    const copy = await this.copies.findOne({ where: { id } });
    if (!copy) return null;

    if (fields.condition !== undefined) copy.condition = fields.condition;
    if (fields.barcode !== undefined) copy.barcode = this.normalizeCode(fields.barcode);
    if (fields.shelfLocation !== undefined) copy.shelfLocation = fields.shelfLocation;

    if (fields.status !== undefined) {
      copy.status = fields.status;
    } else if (fields.condition === 'lost') {
      copy.status = 'disposed';
    } else if (fields.condition !== undefined) {
      copy.status = 'available';
    }
    copy.isAvailable = copy.status === 'available';
    copy.updatedAt = new Date();
    return this.copies.save(copy);
  }

  async insertConditionHistory(copyId: string, condition: string, changedBy?: string | null, note?: string | null) {
    const existing = await this.copies.findOne({ where: { id: copyId } });
    const row = this.conditionHistory.create({
      copyId,
      previousCondition: existing?.condition ?? null,
      condition,
      changedBy: changedBy || null,
      note: note || null,
    });
    return this.conditionHistory.save(row);
  }

  /**
   * Single write-back point for a returned copy: condition, status,
   * is_available (plus the book-level rollup) and the condition audit row.
   */
  async applyReturnToCopy(
    copy: BookCopy,
    condition: string,
    record?: BorrowRecord | null,
    changedBy?: string | null,
    manager?: EntityManager,
  ) {
    const copyRepo = manager ? manager.getRepository(BookCopy) : this.copies;
    const bookRepo = manager ? manager.getRepository(Book) : this.books;
    const historyRepo = manager ? manager.getRepository(BookCopyConditionHistory) : this.conditionHistory;

    const previousCondition = copy.condition ?? null;
    copy.condition = condition;
    copy.status = condition === 'lost' ? 'disposed' : 'available';
    copy.isAvailable = copy.status === 'available';
    copy.updatedAt = new Date();
    await copyRepo.save(copy);

    const availableCount = await copyRepo.count({ where: { bookId: copy.bookId, isAvailable: true } });
    const book = await bookRepo.findOne({ where: { id: copy.bookId } });
    if (book) {
      book.isAvailable = availableCount > 0;
      await bookRepo.save(book);
    }

    await historyRepo.save(
      historyRepo.create({
        copyId: copy.id,
        previousCondition,
        condition,
        changedBy: changedBy || null,
        note: record ? `Trả sách (phiếu ${record.id})` : 'Trả sách',
      }),
    );

    return copy;
  }

  async createCopiesBatchWithSkip(bookId: string, barcodes: string[], shelfLocation?: string | null) {
    const normalized = [...new Set(barcodes.map(b => this.normalizeCode(b)))];

    // Batch check which barcodes already exist
    const existingCopies = await this.copies.find({
      where: { barcode: In(normalized) }
    });
    const existingBarcodes = new Set(existingCopies.map(c => c.barcode));

    // Filter out existing barcodes
    const newBarcodes = normalized.filter(b => !existingBarcodes.has(b));
    if (newBarcodes.length === 0) return [];

    // Batch insert new copies
    const now = new Date();
    const newCopies = this.copies.create(
      newBarcodes.map(barcode => ({
        bookId,
        barcode,
        isAvailable: true,
        shelfLocation: shelfLocation || null,
        condition: DEFAULT_CONDITION,
        status: DEFAULT_COPY_STATUS,
        importedAt: now,
      }))
    );
    return this.copies.save(newCopies);
  }

  async setCopyAvailable(copy: BookCopy, isAvailable: boolean) {
    copy.isAvailable = isAvailable;
    copy.updatedAt = new Date();
    await this.copies.save(copy);

    const availableCount = await this.copies.count({ where: { bookId: copy.bookId, isAvailable: true } });
    const book = await this.books.findOne({ where: { id: copy.bookId } });
    if (book) {
      book.isAvailable = availableCount > 0;
      await this.books.save(book);
    }
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

  async findUnpaidFines(): Promise<BorrowRecord[]> {
    const records = await this.records.find({
      where: { finePaid: false },
      relations: { book: true, copy: true },
      order: { returnAt: 'DESC' },
    });
    return records.filter((r) => (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0) > 0);
  }

  async findUnpaidFinesByPatron(patronId: string): Promise<BorrowRecord[]> {
    const records = await this.records.find({
      where: { patronId, finePaid: false },
      relations: { book: true, copy: true },
      order: { returnAt: 'DESC' },
    });
    return records.filter((r) => (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0) > 0);
  }

  async findFineRecordsByIds(ids: string[]): Promise<BorrowRecord[]> {
    if (ids.length === 0) return [];
    return this.records.find({ where: { id: In(ids) }, relations: { book: true, copy: true } });
  }

  async saveBorrowRecords(records: BorrowRecord[]): Promise<BorrowRecord[]> {
    return this.records.save(records);
  }

  async hasUnpaidFinesForPatron(patronId: string): Promise<boolean> {
    const recs = await this.records.find({ where: { patronId, finePaid: false } });
    return recs.some((r) => (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0) > 0);
  }

  getAllActiveBorrows() {
    // NOTE: No hard limit here — used by scheduled batch jobs that process all records.
    // Callers should use pagination or stream if the dataset grows large.
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

  async getFinanceStats(months = 6): Promise<{
    collected_total: number;
    by_method: { cash: number; qr: number; qr_code: number };
    outstanding_total: number;
    paid_count: number;
    unpaid_count: number;
    monthly: Array<{ month: string; collected: number; outstanding_snapshot: number }>;
  }> {
    const clampedMonths = Math.min(Math.max(Number(months) || 6, 1), 24);

    const paidRows: Array<{
      payment_method: string | null;
      fine_amount: string | number | null;
      damage_fee: string | number | null;
      paid_at: Date | string | null;
      return_at: Date | string | null;
      borrow_at: Date | string | null;
    }> = await this.records.createQueryBuilder('record')
      .select('record.payment_method', 'payment_method')
      .addSelect('record.fine_amount', 'fine_amount')
      .addSelect('record.damage_fee', 'damage_fee')
      .addSelect('record.paid_at', 'paid_at')
      .addSelect('record.return_at', 'return_at')
      .addSelect('record.borrow_at', 'borrow_at')
      .where('record.fine_paid = true')
      .getRawMany();

    let collectedTotal = 0;
    let cashTotal = 0;
    let qrTotal = 0;
    let paidCount = 0;
    const paidByMonth: Record<string, number> = {};

    for (const r of paidRows) {
      const fee = (Number(r.fine_amount) || 0) + (Number(r.damage_fee) || 0);
      if (fee > 0) {
        paidCount++;
        collectedTotal += fee;
        const method = (r.payment_method || '').toLowerCase().trim();
        if (method === 'cash') {
          cashTotal += fee;
        } else if (method === 'qr' || method === 'qr_code') {
          qrTotal += fee;
        }

        const dateVal = r.paid_at || r.return_at || r.borrow_at;
        if (dateVal) {
          const d = new Date(dateVal);
          if (!isNaN(d.getTime())) {
            const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            paidByMonth[mKey] = (paidByMonth[mKey] || 0) + fee;
          }
        }
      }
    }

    const unpaidRows: Array<{
      fine_amount: string | number | null;
      damage_fee: string | number | null;
      due_at: Date | string | null;
      borrow_at: Date | string | null;
    }> = await this.records.createQueryBuilder('record')
      .select('record.fine_amount', 'fine_amount')
      .addSelect('record.damage_fee', 'damage_fee')
      .addSelect('record.due_at', 'due_at')
      .addSelect('record.borrow_at', 'borrow_at')
      .where('record.fine_paid = false')
      .andWhere('(record.fine_amount > 0 OR record.damage_fee > 0)')
      .getRawMany();

    let outstandingTotal = 0;
    let unpaidCount = 0;
    const unpaidByMonth: Record<string, number> = {};

    for (const r of unpaidRows) {
      const fee = (Number(r.fine_amount) || 0) + (Number(r.damage_fee) || 0);
      if (fee > 0) {
        unpaidCount++;
        outstandingTotal += fee;
        const dateVal = r.due_at || r.borrow_at;
        if (dateVal) {
          const d = new Date(dateVal);
          if (!isNaN(d.getTime())) {
            const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            unpaidByMonth[mKey] = (unpaidByMonth[mKey] || 0) + fee;
          }
        }
      }
    }

    const monthly: Array<{ month: string; collected: number; outstanding_snapshot: number }> = [];
    const now = new Date();
    for (let i = clampedMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthly.push({
        month: mKey,
        collected: paidByMonth[mKey] || 0,
        outstanding_snapshot: unpaidByMonth[mKey] || 0,
      });
    }

    return {
      collected_total: collectedTotal,
      by_method: {
        cash: cashTotal,
        qr: qrTotal,
        qr_code: qrTotal,
      },
      outstanding_total: outstandingTotal,
      paid_count: paidCount,
      unpaid_count: unpaidCount,
      monthly,
    };
  }

  async getInventoryStats(): Promise<{
    books_total: number;
    copies_total: number;
    copies_by_status: Record<string, number>;
    copies_by_condition: Record<string, number>;
    categories: Array<{ name: string; count: number }>;
    price_coverage: { priced: number; unpriced: number };
    imports_last_30d: number;
  }> {
    const [booksTotal, copiesTotal] = await Promise.all([
      this.books.count(),
      this.copies.count(),
    ]);

    const statusRows: Array<{ status: string | null; count: string | number }> = await this.copies
      .createQueryBuilder('copy')
      .select('copy.status', 'status')
      .addSelect('COUNT(copy.id)', 'count')
      .groupBy('copy.status')
      .getRawMany();

    const copiesByStatus: Record<string, number> = {
      available: 0,
      borrowed: 0,
      maintenance: 0,
      disposed: 0,
      reserved: 0,
    };
    for (const row of statusRows) {
      const key = row.status || 'available';
      copiesByStatus[key] = (copiesByStatus[key] || 0) + Number(row.count);
    }

    const condRows: Array<{ condition: string | null; count: string | number }> = await this.copies
      .createQueryBuilder('copy')
      .select('copy.condition', 'condition')
      .addSelect('COUNT(copy.id)', 'count')
      .groupBy('copy.condition')
      .getRawMany();

    const copiesByCondition: Record<string, number> = {
      new: 0,
      good: 0,
      minor_damage: 0,
      major_damage: 0,
      lost: 0,
    };
    for (const row of condRows) {
      const key = row.condition || 'good';
      copiesByCondition[key] = (copiesByCondition[key] || 0) + Number(row.count);
    }

    // Explode categories from books
    const bookCategoryRows: Array<{ categories: string | null }> = await this.books
      .createQueryBuilder('book')
      .select('book.categories', 'categories')
      .getRawMany();

    const categoryMap: Record<string, number> = {};
    for (const row of bookCategoryRows) {
      if (!row.categories || !row.categories.trim()) {
        categoryMap['Chưa phân loại'] = (categoryMap['Chưa phân loại'] || 0) + 1;
        continue;
      }
      const parts = row.categories.split(',').map((c) => c.trim()).filter(Boolean);
      if (parts.length === 0) {
        categoryMap['Chưa phân loại'] = (categoryMap['Chưa phân loại'] || 0) + 1;
      } else {
        for (const p of parts) {
          categoryMap[p] = (categoryMap[p] || 0) + 1;
        }
      }
    }

    const categories = Object.entries(categoryMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Price coverage
    const pricedCount = await this.books
      .createQueryBuilder('book')
      .where('book.price IS NOT NULL AND book.price > 0')
      .getCount();
    const unpricedCount = Math.max(0, booksTotal - pricedCount);

    // Imports in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const importsLast30d = await this.copies
      .createQueryBuilder('copy')
      .where('copy.imported_at >= :thirtyDaysAgo', { thirtyDaysAgo })
      .getCount();

    return {
      books_total: booksTotal,
      copies_total: copiesTotal,
      copies_by_status: copiesByStatus,
      copies_by_condition: copiesByCondition,
      categories,
      price_coverage: { priced: pricedCount, unpriced: unpricedCount },
      imports_last_30d: importsLast30d,
    };
  }

  getBorrowsByPatron(patronId: string, status?: string, limit = 200) {
    const where: any = { patronId };
    if (status) where.status = status;
    return this.records.find({ where, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' }, take: limit });
  }

  getActiveBorrowsByPatron(patronId: string) {
    return this.records.find({ where: { patronId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true }, order: { dueAt: 'ASC', borrowAt: 'DESC' }, take: 50 });
  }

  async createBorrowRecord(patronId: string, bookId: string, copyId?: string | null, shelfLocation?: string | null) {
    const limits = await configService.getBorrowLimits();
    const dueAt = new Date(Date.now() + limits.maxBorrowDays * 24 * 60 * 60 * 1000);
    const record = this.records.create({ patronId, bookId, copyId: copyId || null, borrowAt: new Date(), dueAt, shelfLocation: shelfLocation || null, status: 'borrowed' });
    return this.records.save(record);
  }

  async returnBook(record: BorrowRecord, returnedByUserId?: string | null, returnedByEmail?: string | null, returnMethod?: string | null, note?: string | null, payment?: PaymentFinalization) {
    record.returnAt = new Date();
    record.status = 'returned';
    record.returnedByUserId = returnedByUserId || null;
    record.returnedByEmail = returnedByEmail || null;
    record.returnMethod = returnMethod || null;
    record.note = note || null;
    record.updatedAt = new Date();

    const fineConfig = await configService.getFineConfig();
    finalizeReturnFees(record, payment ?? {}, fineConfig);

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
      .andWhere('copy.barcode LIKE :prefix', { prefix: 'LIB%' })
      .groupBy('book.isbn')
      .getRawMany();
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const barcode = String(row.max_barcode || '');
      const normalized = barcode.replace(/[\s-]+/g, '');
      const match = normalized.match(/(\d{3})$/);
      if (match) map.set(row.isbn, Number(match[1]));
    });
    return map;
  }

  async countCopies(bookId: string, availableOnly = false) {
    const where: any = { bookId };
    if (availableOnly) where.isAvailable = true;
    return this.copies.count({ where });
  }

  async getCopyBarcodesByBookId(bookId: string): Promise<string[]> {
    const copies = await this.copies.find({ where: { bookId }, order: { barcode: 'ASC' } });
    return copies.map((c) => c.barcode);
  }

  async getMaxBarcodeNumberForBook(book: Book) {
    const row = await this.copies.createQueryBuilder('copy')
      .select('MAX(copy.barcode)', 'max_barcode')
      .where('copy.bookId = :bookId', { bookId: book.id })
      .andWhere('copy.barcode LIKE :prefix', { prefix: 'LIB%' })
      .getRawOne();
    const barcode = String(row?.max_barcode || '');
    const normalized = barcode.replace(/[\s-]+/g, '');
    const match = normalized.match(/(\d{3})$/);
    return match ? Number(match[1]) : 0;
  }

  async updateBook(bookId: string, fields: Partial<Pick<Book, 'title' | 'subtitle' | 'author' | 'coverUrl' | 'publisher' | 'publishedDate' | 'description' | 'pageCount' | 'categories' | 'averageRating' | 'language' | 'shelfLocation' | 'price'>>): Promise<Book | null> {
    const book = await this.books.findOne({ where: { id: bookId } });
    if (!book) return null;
    Object.assign(book, fields, { updatedAt: new Date() });
    return this.books.save(book);
  }

  async getAvailableCopiesByBarcodeDesc(bookId: string) {
    return this.copies.find({ where: { bookId, isAvailable: true }, order: { barcode: 'DESC' } });
  }

  deleteCopies(copies: BookCopy[]) {
    return this.copies.remove(copies);
  }

  async findRecordsByCopyId(copyId: string): Promise<BorrowRecord[]> {
    return this.records.find({ where: { copyId } });
  }

  /**
   * Permanently removes a copy (thanh lý): detaches its borrow history
   * (copy_id → NULL, history kept for audit/debt) before deleting so the
   * borrow_records FK never blocks disposal of lost/damaged copies.
   */
  async disposeCopy(copyId: string): Promise<{ detached: number }> {
    const copy = await this.copies.findOne({ where: { id: copyId } });
    if (!copy) throw new HttpError(404, 'Bản sao không tồn tại');
    if (await this.hasActiveBorrowsForCopy(copyId)) {
      throw new HttpError(409, 'Bản sao đang được mượn nên không thể xóa');
    }
    const history = await this.findRecordsByCopyId(copyId);
    for (const record of history) {
      record.copyId = null;
    }
    if (history.length > 0) await this.records.save(history);
    await this.copies.remove(copy);
    return { detached: history.length };
  }

  async disposeCopies(copyIds: string[]): Promise<{ deleted: string[]; skipped: Array<{ copy_id: string; reason: string }> }> {
    const deleted: string[] = [];
    const skipped: Array<{ copy_id: string; reason: string }> = [];
    for (const copyId of [...new Set(copyIds)]) {
      try {
        await this.disposeCopy(copyId);
        deleted.push(copyId);
      } catch (err: any) {
        skipped.push({ copy_id: copyId, reason: err instanceof HttpError ? err.message : 'Lỗi không xác định' });
      }
    }
    return { deleted, skipped };
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

  async hasActiveBorrowsForCopy(copyId: string): Promise<boolean> {
    const count = await this.records.count({ where: { copyId, status: 'borrowed', returnAt: IsNull() } });
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
    if (!bookIds.length) return { deleted: 0, errors: [] };

    // Batch-check active borrows with a single GROUP BY query (was N individual queries)
    const activeCounts = await this.records.createQueryBuilder('record')
      .innerJoin('record.copy', 'copy')
      .select('copy.bookId', 'bookId')
      .addSelect('COUNT(*)', 'cnt')
      .where('copy.bookId IN (:...bookIds)', { bookIds })
      .andWhere('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .groupBy('copy.bookId')
      .getRawMany();

    const activeMap = new Map(activeCounts.map((r: any) => [r.bookId, +r.cnt]));
    const booksWithActive = bookIds.filter(id => (activeMap.get(id) ?? 0) > 0);

    // Fetch book details for error messages in one query (was N individual queries)
    let bookInfoMap = new Map<string, { title: string; isbn: string }>();
    if (booksWithActive.length > 0) {
      const books = await this.books.find({ where: { id: In(booksWithActive) }, select: ['id', 'title', 'isbn'] });
      bookInfoMap = new Map(books.map(b => [b.id, { title: b.title, isbn: b.isbn }]));
    }

    const errors: string[] = [];
    const deletableIds: string[] = [];

    for (const bookId of bookIds) {
      if ((activeMap.get(bookId) ?? 0) > 0) {
        const info = bookInfoMap.get(bookId);
        errors.push(info ? `${info.title} (${info.isbn}) - đang có bản được mượn` : `ID ${bookId} - đang có bản được mượn`);
      } else {
        deletableIds.push(bookId);
      }
    }

    // Batch-delete in order: records, copies, books
    if (deletableIds.length > 0) {
      await this.records.createQueryBuilder()
        .delete()
        .from(BorrowRecord)
        .where('copyId IN (SELECT id FROM book_copies WHERE bookId IN (:...bookIds))', { bookIds: deletableIds })
        .execute();
      await this.copies.delete({ bookId: In(deletableIds) });
      await this.books.delete(deletableIds);
    }

    return { deleted: deletableIds.length, errors };
  }

  async bulkUpdateBookPrices(bookIds: string[], price: number) {
    if (!bookIds.length) return { updated: 0 };
    const res = await this.books.createQueryBuilder()
      .update(Book)
      .set({ price })
      .whereInIds(bookIds)
      .execute();
    return { updated: res.affected || 0 };
  }

  // === Borrow Slip ===

  async createSlip(
    patronId: string,
    bookIds: string[],
    copyIds: (string | null)[],
    shelfLocations: (string | null)[],
    createdByUserId?: string | null,
    createdByEmail?: string | null,
    note?: string | null,
  ) {
    const limits = await configService.getBorrowLimits();
    const dueAt = new Date(Date.now() + limits.maxBorrowDays * 24 * 60 * 60 * 1000);

    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // ── Pessimistic lock: SELECT FOR UPDATE on every copy being borrowed ──
      // This prevents two concurrent requests from borrowing the same copy.
      const validCopyIds = copyIds.filter((id): id is string => !!id);
      if (validCopyIds.length > 0) {
        const lockedCopies = await qr.manager
          .getRepository(BookCopy)
          .createQueryBuilder('copy')
          .setLock('pessimistic_write')
          .whereInIds(validCopyIds)
          .getMany();

        for (const copy of lockedCopies) {
          if (!copy.isAvailable) {
            throw new Error(`Bản sao ${copy.barcode} vừa được mượn bởi người khác. Vui lòng thử lại.`);
          }
          markCopyAsBorrowed(copy);
          copy.updatedAt = new Date();
        }
        await qr.manager.getRepository(BookCopy).save(lockedCopies);
      }

      const slip = qr.manager.getRepository(BorrowSlip).create({
        patronId,
        dueAt,
        status: 'active',
        createdByUserId: createdByUserId || null,
        createdByEmail: createdByEmail || null,
        totalItems: bookIds.length,
        note: note || null,
      });
      await qr.manager.getRepository(BorrowSlip).save(slip);

      const records: BorrowRecord[] = [];
      for (let i = 0; i < bookIds.length; i += 1) {
        const record = qr.manager.getRepository(BorrowRecord).create({
          patronId,
          bookId: bookIds[i],
          copyId: copyIds[i] || null,
          slipId: slip.id,
          borrowAt: new Date(),
          dueAt,
          shelfLocation: shelfLocations[i] || null,
          status: 'borrowed',
        });
        records.push(record);
      }
      await qr.manager.getRepository(BorrowRecord).save(records);

      slip.totalItems = records.length;
      await qr.manager.getRepository(BorrowSlip).save(slip);

      await qr.commitTransaction();
      return { slip, records };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
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

  getSlipsByPatron(patronId: string, limit = 100) {
    return this.slips.find({ where: { patronId }, order: { createdAt: 'DESC' }, take: limit });
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
