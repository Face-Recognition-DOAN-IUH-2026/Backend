import { EntityManager, In, IsNull, Not } from 'typeorm';
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
import { WaitlistRepository } from './WaitlistRepository';
import { configService } from '../services/ConfigService';
import { CopyCondition, DEFAULT_CONDITION, DEFAULT_COPY_STATUS, markCopyAsBorrowed, recommendCopyAction } from '../constants/copy';
import { BookRepository } from './BookRepository';
import { BookCopyRepository } from './BookCopyRepository';
import { BorrowRecordRepository } from './BorrowRecordRepository';
import { BorrowSlipRepository } from './BorrowSlipRepository';

/**
 * BorrowRepository — facade over the split borrow domain repositories.
 *
 * Kept as a single entry point so existing routes/services/tests that do
 * `new BorrowRepository()` or `jest.mock('../../repositories/BorrowRepository')`
 * keep working unchanged. Every public method keeps its original name and
 * signature; most delegate to the owning sub-repository, while cross-entity
 * operations (returns, slips, disposal, stats) stay here.
 *
 * Sub-repositories receive their repositories explicitly via constructor.
 */
export class BorrowRepository {
  public books = AppDataSource.getRepository(Book);
  public copies = AppDataSource.getRepository(BookCopy);
  public records = AppDataSource.getRepository(BorrowRecord);
  public slips = AppDataSource.getRepository(BorrowSlip);
  public conditionHistory = AppDataSource.getRepository(BookCopyConditionHistory);

  private bookRepo = new BookRepository(this.books, this.copies);
  private copyRepo = new BookCopyRepository(this.copies, this.books);
  private recordRepo = new BorrowRecordRepository(this.records);
  private slipRepo = new BorrowSlipRepository(this.slips, this.records);

  // ==== Book delegation ====

  getBookByIsbn(isbn: string) {
    return this.bookRepo.getBookByIsbn(isbn);
  }

  getBookByNormalizedIsbn(isbn: string) {
    return this.bookRepo.getBookByNormalizedIsbn(isbn);
  }

  getBookById(id: string) {
    return this.bookRepo.getBookById(id);
  }

  async listBooks(skip = 0, limit = 20, search?: string) {
    return this.bookRepo.listBooks(skip, limit, search);
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
    },
  ) {
    return this.bookRepo.createBook(isbn, title, author, coverUrl, shelfLocation, extra);
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
    },
  ) {
    return this.bookRepo.upsertBook(isbn, title, author, coverUrl, extra);
  }

  async updateBook(bookId: string, fields: Partial<Pick<Book, 'title' | 'subtitle' | 'author' | 'coverUrl' | 'publisher' | 'publishedDate' | 'description' | 'pageCount' | 'categories' | 'averageRating' | 'language' | 'shelfLocation' | 'price'>>): Promise<Book | null> {
    return this.bookRepo.updateBook(bookId, fields);
  }

  async getBooksByIsbns(isbns: string[]) {
    return this.bookRepo.getBooksByIsbns(isbns);
  }

  async deleteBookAndCopies(bookId: string): Promise<void> {
    await this.recordRepo.deleteBookAndCopiesRecords(bookId);
    await this.bookRepo.deleteBookAndCopies(bookId);
  }

  async bulkDeleteBooks(bookIds: string[]): Promise<{ deleted: number; errors: string[] }> {
    // Preserve original behaviour: also delete borrow records for the books.
    await this.recordRepo.bulkDeleteBooksRecords(bookIds);
    return this.bookRepo.bulkDeleteBooks(bookIds);
  }

  async bulkUpdateBookPrices(bookIds: string[], price: number) {
    return this.bookRepo.bulkUpdateBookPrices(bookIds, price);
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

  // ==== Copy delegation ====

  getCopyByBarcode(barcode: string) {
    return this.copyRepo.getCopyByBarcode(barcode);
  }

  getCopyById(id: string) {
    return this.copyRepo.getCopyById(id);
  }

  async getCopiesByIds(ids: string[]): Promise<Map<string, BookCopy & { book: Book }>> {
    return this.copyRepo.getCopiesByIds(ids);
  }

  async getAvailableCopy(bookId: string) {
    return this.copyRepo.getAvailableCopy(bookId);
  }

  async createCopy(
    bookId: string,
    barcode: string,
    shelfLocation?: string | null,
    options?: { condition?: string; status?: string; importedAt?: Date },
  ) {
    return this.copyRepo.createCopy(bookId, barcode, shelfLocation, options);
  }

  listCopiesByBook(bookId: string) {
    return this.copyRepo.listCopiesByBook(bookId);
  }

  async updateCopy(id: string, fields: { condition?: string; status?: string; shelfLocation?: string | null; barcode?: string }) {
    return this.copyRepo.updateCopy(id, fields);
  }

  async createCopiesBatchWithSkip(bookId: string, barcodes: string[], shelfLocation?: string | null) {
    return this.copyRepo.createCopiesBatchWithSkip(bookId, barcodes, shelfLocation);
  }

  async setCopyAvailable(copy: BookCopy, isAvailable: boolean) {
    return this.copyRepo.setCopyAvailable(copy, isAvailable);
  }

  async countCopies(bookId: string, availableOnly = false) {
    return this.copyRepo.countCopies(bookId, availableOnly);
  }

  async getCopyBarcodesByBookId(bookId: string): Promise<string[]> {
    return this.copyRepo.getCopyBarcodesByBookId(bookId);
  }

  async getMaxBarcodeNumberForBook(book: Book) {
    return this.copyRepo.getMaxBarcodeNumberForBook(book);
  }

  async getAvailableCopiesByBarcodeDesc(bookId: string) {
    return this.copyRepo.getAvailableCopiesByBarcodeDesc(bookId);
  }

  deleteCopies(copies: BookCopy[]) {
    return this.copyRepo.deleteCopies(copies);
  }

  async getCopiesByBarcodes(barcodes: string[]): Promise<Map<string, BookCopy & { book: Book }>> {
    return this.copyRepo.getCopiesByBarcodes(barcodes);
  }

  async getCopyCountsByBookIds(bookIds: string[]): Promise<Map<string, { total: number; available: number }>> {
    return this.copyRepo.getCopyCountsByBookIds(bookIds);
  }

  // ==== BorrowRecord delegation ====

  async getActiveBorrow(patronId: string, bookId: string) {
    return this.recordRepo.getActiveBorrow(patronId, bookId);
  }

  async getActiveBorrowsByPatronAndBook(patronId: string, bookId: string) {
    return this.recordRepo.getActiveBorrowsByPatronAndBook(patronId, bookId);
  }

  async getActiveBorrowByCopy(copyId: string) {
    return this.recordRepo.getActiveBorrowByCopy(copyId);
  }

  getBorrowRecordById(id: string) {
    return this.recordRepo.getBorrowRecordById(id);
  }

  async findUnpaidFines(): Promise<BorrowRecord[]> {
    return this.recordRepo.findUnpaidFines();
  }

  async findUnpaidFinesByPatron(patronId: string): Promise<BorrowRecord[]> {
    return this.recordRepo.findUnpaidFinesByPatron(patronId);
  }

  async findFineRecordsByIds(ids: string[]): Promise<BorrowRecord[]> {
    return this.recordRepo.findFineRecordsByIds(ids);
  }

  async saveBorrowRecords(records: BorrowRecord[]): Promise<BorrowRecord[]> {
    return this.recordRepo.saveBorrowRecords(records);
  }

  async hasUnpaidFinesForPatron(patronId: string): Promise<boolean> {
    return this.recordRepo.hasUnpaidFinesForPatron(patronId);
  }

  getAllActiveBorrows() {
    return this.recordRepo.getAllActiveBorrows();
  }

  countActiveBorrows(patronId: string) {
    return this.recordRepo.countActiveBorrows(patronId);
  }

  getOverdueBorrows(patronId: string) {
    return this.recordRepo.getOverdueBorrows(patronId);
  }

  async getStats(): Promise<{ total: number; active: number; overdue: number }> {
    return this.recordRepo.getStats();
  }

  async getFinanceStats(months = 6): Promise<{
    collected_total: number;
    by_method: { cash: number; qr: number; qr_code: number };
    outstanding_total: number;
    paid_count: number;
    unpaid_count: number;
    monthly: Array<{ month: string; collected: number; outstanding_snapshot: number }>;
  }> {
    return this.recordRepo.getFinanceStats(months);
  }

  getBorrowsByPatron(patronId: string, status?: string, limit = 200) {
    return this.recordRepo.getBorrowsByPatron(patronId, status, limit);
  }

  getActiveBorrowsByPatron(patronId: string) {
    return this.recordRepo.getActiveBorrowsByPatron(patronId);
  }

  async findRecordsByCopyId(copyId: string): Promise<BorrowRecord[]> {
    return this.recordRepo.findRecordsByCopyId(copyId);
  }

  async hasActiveBorrows(bookId: string): Promise<boolean> {
    return this.recordRepo.hasActiveBorrows(bookId);
  }

  async hasActiveBorrowsForCopy(copyId: string): Promise<boolean> {
    return this.recordRepo.hasActiveBorrowsForCopy(copyId);
  }

  getRecordsBySlipId(slipId: string) {
    return this.recordRepo.getRecordsBySlipId(slipId);
  }

  // ==== Cross-entity: returns, copies disposal ====

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

  async getStatsForBooks(bookIds: string[]) {
    return this.bookRepo.getStatsForBooks(bookIds);
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

  // ==== BorrowSlip delegation ====

  getActiveSlip(slipId: string) {
    return this.slipRepo.getActiveSlip(slipId);
  }

  async closeSlipIfComplete(slipId: string) {
    return this.slipRepo.closeSlipIfComplete(slipId);
  }

  getSlipsByPatron(patronId: string, limit = 100) {
    return this.slipRepo.getSlipsByPatron(patronId, limit);
  }

  // ==== Cross-entity: borrow record / slip creation ====

  async createBorrowRecord(patronId: string, bookId: string, copyId?: string | null, shelfLocation?: string | null) {
    const limits = await configService.getBorrowLimits();
    const dueAt = new Date(Date.now() + limits.maxBorrowDays * 24 * 60 * 60 * 1000);
    const record = this.records.create({ patronId, bookId, copyId: copyId || null, borrowAt: new Date(), dueAt, shelfLocation: shelfLocation || null, status: 'borrowed' });
    const saved = await this.records.save(record);

    // BLF-WL-01 1b: a new borrow for this book re-arms its notified waiters so
    // they are re-notified when the book is returned again. Best-effort — a
    // waitlist reset failure never fails the borrow.
    try {
      await new WaitlistRepository().resetNotifiedToWaiting(bookId);
    } catch {
      // swallow: borrow success is independent of waitlist state
    }

    return saved;
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
}
