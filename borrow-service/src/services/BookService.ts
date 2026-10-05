import ExcelJS from 'exceljs';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { HttpError } from '../middlewares/errorHandler';
import { serializeBookWithStats, serializeCopy } from './serializers';
import { fetchGoogleBooks } from '../clients/GoogleBooksClient';

export class BookService {
  private repo: BorrowRepository;

  constructor() {
    this.repo = new BorrowRepository();
  }

  async getOrCreateByIsbn(isbn: string) {
    let book = await this.repo.getBookByIsbn(isbn.trim());
    if (!book) {
      const meta = await fetchGoogleBooks(isbn);
      if (!meta) throw new HttpError(404, 'Khong tim thay sach');
      book = await this.repo.createBook(isbn, meta.title, meta.author, meta.coverUrl, undefined, {
        subtitle: meta.subtitle,
        publisher: meta.publisher,
        publishedDate: meta.publishedDate,
        description: meta.description,
        pageCount: meta.pageCount,
        categories: meta.categories,
        averageRating: meta.averageRating,
        language: meta.language,
        isbn10: meta.isbn10,
        isbn13: meta.isbn13,
      });
    }
    const total = await this.repo.countCopies(book.id);
    const available = await this.repo.countCopies(book.id, true);
    return serializeBookWithStats(book, total, available);
  }

  async listBooks(skip: number = 0, limit: number = 20, search?: string) {
    const { items, total, stats } = await this.repo.listBooks(skip, limit, search);
    const aggregateStats = await this.repo.getAggregateStats();
    return {
      items: items.map((book) => {
        const stat = stats.get(book.id) || { total: 0, available: 0 };
        return serializeBookWithStats(book, stat.total, stat.available);
      }),
      total,
      skip,
      limit,
      aggregateStats,
    };
  }

  async searchBooks(query: string) {
    const { items, stats } = await this.repo.listBooks(0, 20, query);
    return items.map((book) => {
      const stat = stats.get(book.id) || { total: 0, available: 0 };
      return serializeBookWithStats(book, stat.total, stat.available);
    });
  }

  async getBookById(bookId: string) {
    const book = await this.repo.getBookById(bookId);
    if (!book) throw new HttpError(404, 'Sách không tồn tại');
    const total = await this.repo.countCopies(book.id);
    const available = await this.repo.countCopies(book.id, true);
    return serializeBookWithStats(book, total, available);
  }

  async updateBook(bookId: string, fields: Record<string, any>) {
    const book = await this.repo.getBookById(bookId);
    if (!book) throw new HttpError(404, 'Khong tim thay sach');
    
    const updateFields: Record<string, any> = {};
    if (fields.title !== undefined) updateFields.title = fields.title;
    if (fields.subtitle !== undefined) updateFields.subtitle = fields.subtitle;
    if (fields.author !== undefined) updateFields.author = fields.author;
    if (fields.publisher !== undefined) updateFields.publisher = fields.publisher;
    if (fields.published_date !== undefined) updateFields.publishedDate = fields.published_date;
    if (fields.description !== undefined) updateFields.description = fields.description;
    if (fields.page_count !== undefined) updateFields.pageCount = fields.page_count;
    if (fields.categories !== undefined) updateFields.categories = fields.categories;
    if (fields.average_rating !== undefined) updateFields.averageRating = fields.average_rating;
    if (fields.language !== undefined) updateFields.language = fields.language;
    if (fields.shelf_location !== undefined) updateFields.shelfLocation = fields.shelf_location;
    if (fields.cover_url !== undefined) updateFields.coverUrl = fields.cover_url;
    if (fields.price !== undefined) updateFields.price = fields.price;
    
    const updated = await this.repo.updateBook(book.id, updateFields);
    if (!updated) throw new HttpError(500, 'Cập nhật sách thất bại');
    
    const total = await this.repo.countCopies(book.id);
    const available = await this.repo.countCopies(book.id, true);
    return serializeBookWithStats(updated, total, available);
  }

  async adjustQuantity(bookId: string, quantity: number) {
    const book = await this.repo.getBookById(bookId);
    if (!book) throw new HttpError(404, 'Khong tim thay sach');
    
    const total = await this.repo.countCopies(book.id);
    const available = await this.repo.countCopies(book.id, true);
    const borrowed = total - available;
    
    if (quantity < 1) throw new HttpError(400, 'So luong phai lon hon 0');
    if (quantity < borrowed) throw new HttpError(400, `Chi co the giam xuong toi thieu ${borrowed} ban (${borrowed} ban dang duoc muon)`);
    
    if (quantity > total) {
      const offset = await this.repo.getMaxBarcodeNumberForBook(book);
      const barcodes = Array.from({ length: quantity - total }, (_, i) => `LIB-${book.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
      await this.repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
    } else if (quantity < total) {
      const copies = await this.repo.getAvailableCopiesByBarcodeDesc(book.id);
      await this.repo.deleteCopies(copies.slice(0, total - quantity));
    }
    
    const nextTotal = await this.repo.countCopies(book.id);
    const nextAvailable = await this.repo.countCopies(book.id, true);
    return serializeBookWithStats(book, nextTotal, nextAvailable);
  }

  async bulkDeleteBooks(bookIds: string[]) {
    if (bookIds.length > 50) throw new HttpError(400, 'Toi da 50 sach mot lan');
    const result = await this.repo.bulkDeleteBooks(bookIds);
    return { ...result, success: result.deleted > 0 && result.errors.length === 0 };
  }

  async listBarcodes(bookId?: string, availableOnly: boolean = false) {
    const qb = this.repo.copies.createQueryBuilder('copy').orderBy('copy.createdAt', 'DESC').limit(200);
    if (bookId) qb.andWhere('copy.bookId = :bookId', { bookId });
    if (availableOnly) qb.andWhere('copy.isAvailable = true');
    const copies = await qb.getMany();
    return copies.map(serializeCopy);
  }

  async exportBooks() {
    const MAX_EXPORT = 10000;
    const { items } = await this.repo.listBooks(0, MAX_EXPORT);
    
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Books');
    ws.addRow(['ISBN', 'Title', 'Author', 'Total Copies', 'Available Copies', 'Shelf Location', 'Created At']);

    const bookIds = items.map(b => b.id);
    const copyCounts = await this.repo.getCopyCountsByBookIds(bookIds);

    for (const book of items) {
      const counts = copyCounts.get(book.id) || { total: 0, available: 0 };
      ws.addRow([book.isbn, book.title, book.author || '', counts.total, counts.available, book.shelfLocation || '', book.createdAt?.toISOString?.() || '']);
    }
    
    return { workbook: wb, filename: 'books_export.xlsx' };
  }

  async getTemplate() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Books Import');
    ws.addRow(['ISBN', 'Quantity']);
    ws.addRow(['9780544003415', 2]);
    ws.addRow(['9780439708180', 3]);
    return { workbook: wb, filename: 'book_import_template.xlsx' };
  }
}