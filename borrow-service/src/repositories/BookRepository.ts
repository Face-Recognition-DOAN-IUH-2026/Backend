import { Repository, Brackets, In, Not } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';

/**
 * BookRepository — persistence for Book entities only.
 * Single responsibility: Book CRUD, ISBN lookup, batch price/count helpers.
 * Repositories are injected via constructor (defaults to AppDataSource) so the
 * class can be constructed with real repos or test doubles.
 */
export class BookRepository {
  private books: Repository<Book>;
  private copies: Repository<BookCopy>;

  constructor(
    books: Repository<Book> = AppDataSource.getRepository(Book),
    copies: Repository<BookCopy> = AppDataSource.getRepository(BookCopy),
  ) {
    this.books = books;
    this.copies = copies;
  }

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
      price?: number | null;
    },
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
    },
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

  async updateBook(bookId: string, fields: Partial<Pick<Book, 'title' | 'subtitle' | 'author' | 'coverUrl' | 'publisher' | 'publishedDate' | 'description' | 'pageCount' | 'categories' | 'averageRating' | 'language' | 'shelfLocation' | 'price'>>): Promise<Book | null> {
    const book = await this.books.findOne({ where: { id: bookId } });
    if (!book) return null;
    Object.assign(book, fields, { updatedAt: new Date() });
    return this.books.save(book);
  }

  async getBooksByIsbns(isbns: string[]) {
    if (!isbns.length) return new Map<string, Book>();
    const cleaned = isbns.map((isbn) => this.normalizeCode(isbn));
    const books = await this.books.createQueryBuilder('book')
      .where("REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') IN (:...isbns)", { isbns: cleaned })
      .getMany();
    return new Map(books.map((book) => [book.isbn, book]));
  }

  async deleteBookAndCopies(bookId: string): Promise<void> {
    await this.books.createQueryBuilder()
      .delete()
      .from(Book)
      .where({ id: bookId })
      .execute();
    await this.copies.delete({ bookId });
  }

  async bulkDeleteBooks(bookIds: string[]): Promise<{ deleted: number; errors: string[] }> {
    if (!bookIds.length) return { deleted: 0, errors: [] };

    // Batch-check active borrows with a single GROUP BY query (was N individual queries)
    // Note: borrow records live in BorrowRecordRepository; kept here to preserve
    // the original single-repository behavior.
    const errors: string[] = [];
    const deletableIds: string[] = bookIds;
    if (deletableIds.length > 0) {
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
}
