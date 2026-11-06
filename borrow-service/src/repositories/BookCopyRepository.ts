import { Repository, In, Not } from 'typeorm';
import { AppDataSource } from '../data-source';
import { BookCopy } from '../entities/BookCopy';
import { Book } from '../entities/Book';
import { CopyCondition, DEFAULT_CONDITION, DEFAULT_COPY_STATUS } from '../constants/copy';

/**
 * BookCopyRepository — persistence for BookCopy entities only.
 * Single responsibility: copy CRUD, availability, barcode scanning, batch
 * import, and book-level availability rollup.
 * Repositories are injected via constructor (defaults to AppDataSource).
 * Methods that also touch BorrowRecord (disposal) live in BorrowRepository.
 */
export class BookCopyRepository {
  private copies: Repository<BookCopy>;
  private books: Repository<Book>;

  constructor(
    copies: Repository<BookCopy> = AppDataSource.getRepository(BookCopy),
    books: Repository<Book> = AppDataSource.getRepository(Book),
  ) {
    this.copies = copies;
    this.books = books;
  }

  private normalizeCode(code: string) {
    return code.replace(/[\s-]+/g, '').trim();
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

  async getAvailableCopiesByBarcodeDesc(bookId: string) {
    return this.copies.find({ where: { bookId, isAvailable: true }, order: { barcode: 'DESC' } });
  }

  deleteCopies(copies: BookCopy[]) {
    return this.copies.remove(copies);
  }

  /**
   * Fuzzy search used by Quick Search (barcode / ISBN / title / author).
   *
   * The lookup is split into two UNION branches so PostgreSQL can use the pg_trgm
   * GIN indexes (idx_*_trgm) created by migration 1770800000000. A single
   * `a ILIKE :q OR b.col ILIKE :q` predicate spanning a JOIN cannot use them.
   * Matching ids are then loaded as entities to keep the return type with `book`.
   */
  async quickSearchCopies(query: string, limit = 10): Promise<BookCopy[]> {
    const pattern = `%${query.trim()}%`;
    const matches: Array<{ id: string }> = await this.copies.query(
      `SELECT m.id AS id
         FROM (
           SELECT c.id, c.is_available, b.title
             FROM books b
             JOIN book_copies c ON c.book_id = b.id
            WHERE b.title ILIKE $1 OR b.author ILIKE $1 OR b.isbn ILIKE $1
           UNION
           SELECT c.id, c.is_available, b.title
             FROM book_copies c
             JOIN books b ON b.id = c.book_id
            WHERE c.barcode ILIKE $1
         ) m
        ORDER BY m.is_available DESC, m.title ASC
        LIMIT $2`,
      [pattern, limit],
    );

    if (matches.length === 0) return [];

    const ids = matches.map((match) => match.id);
    const copies = await this.copies.find({
      where: { id: In(ids) },
      relations: { book: true },
    });

    // The UNION already applied availability/title ordering; keep it.
    const byId = new Map(copies.map((copy) => [copy.id, copy]));
    return ids
      .map((id) => byId.get(id))
      .filter((copy): copy is BookCopy => copy !== undefined);
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
