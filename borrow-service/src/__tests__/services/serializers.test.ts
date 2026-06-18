import { Book } from '../../entities/Book';
import { BookCopy } from '../../entities/BookCopy';
import { BorrowRecord } from '../../entities/BorrowRecord';
import { BorrowSlip } from '../../entities/BorrowSlip';
import {
  serializeBook,
  serializeBookWithStats,
  serializeBorrowRecord,
  serializeBorrowSlip,
  serializeCopy,
} from '../../services/serializers';

describe('Serializers', () => {
  describe('serializeCopy', () => {
    it('should serialize BookCopy correctly', () => {
      const copy: BookCopy = {
        id: 'copy-id-123',
        bookId: 'book-id-456',
        barcode: 'LIB-9780123456789-001',
        isAvailable: true,
        shelfLocation: 'A-1',
      } as BookCopy;

      const result = serializeCopy(copy);

      expect(result).toEqual({
        id: 'copy-id-123',
        book_id: 'book-id-456',
        barcode: 'LIB-9780123456789-001',
        is_available: true,
        shelf_location: 'A-1',
      });
    });

    it('should handle null shelf_location', () => {
      const copy: BookCopy = {
        id: 'copy-id',
        bookId: 'book-id',
        barcode: 'LIB-001',
        isAvailable: false,
        shelfLocation: null,
      } as BookCopy;

      const result = serializeCopy(copy);
      expect(result.shelf_location).toBeNull();
    });
  });

  describe('serializeBook', () => {
    it('should serialize Book with all fields', () => {
      const now = new Date();
      const book = {
        id: 'book-id-123',
        isbn: '9780123456789',
        title: 'Test Book Title',
        subtitle: 'Test Subtitle',
        author: 'Test Author',
        coverUrl: 'https://example.com/cover.jpg',
        publisher: 'Test Publisher',
        publishedDate: '2024-01-01',
        description: 'Test description',
        pageCount: 300,
        categories: 'Fiction',
        averageRating: 4.5,
        language: 'en',
        isbn10: '0123456789',
        isbn13: '9780123456789',
        shelfLocation: 'A-1',
        isAvailable: true,
        copies: [],
        createdAt: now,
        updatedAt: now,
      } as Book;

      const result = serializeBook(book);

      expect(result.id).toBe('book-id-123');
      expect(result.isbn).toBe('9780123456789');
      expect(result.title).toBe('Test Book Title');
      expect(result.subtitle).toBe('Test Subtitle');
      expect(result.author).toBe('Test Author');
      expect(result.cover_url).toBe('https://example.com/cover.jpg');
      expect(result.publisher).toBe('Test Publisher');
      expect(result.published_date).toBe('2024-01-01');
      expect(result.description).toBe('Test description');
      expect(result.page_count).toBe(300);
      expect(result.categories).toBe('Fiction');
      expect(result.average_rating).toBe(4.5);
      expect(result.language).toBe('en');
      expect(result.isbn10).toBe('0123456789');
      expect(result.isbn13).toBe('9780123456789');
      expect(result.shelf_location).toBe('A-1');
    });

    it('should handle null optional fields', () => {
      const now = new Date();
      const book = {
        id: 'book-id',
        isbn: '9780123456789',
        title: 'Minimal Book',
        subtitle: null,
        author: null,
        coverUrl: null,
        publisher: null,
        publishedDate: null,
        description: null,
        pageCount: null,
        categories: null,
        averageRating: null,
        language: null,
        isbn10: null,
        isbn13: null,
        shelfLocation: null,
        isAvailable: true,
        copies: [],
        createdAt: now,
        updatedAt: now,
      } as Book;

      const result = serializeBook(book);

      expect(result.subtitle).toBeNull();
      expect(result.author).toBeNull();
      expect(result.cover_url).toBeNull();
      expect(result.publisher).toBeNull();
    });

    it('should serialize copies array', () => {
      const copy: BookCopy = {
        id: 'copy-id',
        bookId: 'book-id',
        barcode: 'LIB-001',
        isAvailable: true,
        shelfLocation: 'A-1',
      } as BookCopy;

      const now = new Date();
      const book = {
        id: 'book-id',
        isbn: '9780123456789',
        title: 'Book with Copies',
        copies: [copy],
        createdAt: now,
        updatedAt: now,
      } as Book;

      const result = serializeBook(book);

      expect(result.copies).toHaveLength(1);
      expect(result.copies[0].id).toBe('copy-id');
    });

    it('should return empty copies array when copies is undefined', () => {
      const now = new Date();
      const book = {
        id: 'book-id',
        isbn: '9780123456789',
        title: 'Book without copies property',
        createdAt: now,
        updatedAt: now,
      } as unknown as Book;

      const result = serializeBook(book);

      expect(result.copies).toEqual([]);
    });
  });

  describe('serializeBookWithStats', () => {
    it('should serialize book with copy statistics', () => {
      const now = new Date();
      const book = {
        id: 'book-id',
        isbn: '9780123456789',
        title: 'Popular Book',
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      } as Book;

      const result = serializeBookWithStats(book as Book, 10, 7);

      expect(result.id).toBe('book-id');
      expect(result.isbn).toBe('9780123456789');
      expect(result.title).toBe('Popular Book');
      expect(result.total_copies).toBe(10);
      expect(result.available_copies).toBe(7);
      expect(result.is_available).toBe(true);
    });

    it('should include all book fields', () => {
      const now = new Date();
      const book = {
        id: 'book-id',
        isbn: '9780123456789',
        title: 'Complete Book',
        author: 'Author Name',
        coverUrl: 'https://example.com/cover.jpg',
        shelfLocation: 'B-2',
        isAvailable: false,
        createdAt: now,
        updatedAt: now,
      } as Book;

      const result = serializeBookWithStats(book, 5, 0);

      expect(result.author).toBe('Author Name');
      expect(result.cover_url).toBe('https://example.com/cover.jpg');
      expect(result.shelf_location).toBe('B-2');
      expect(result.is_available).toBe(false);
    });
  });

  describe('serializeBorrowRecord', () => {
    it('should serialize record with all fields', () => {
      const now = new Date();
      const dueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      const record = {
        id: 'record-id-123',
        patronId: 'patron-id-456',
        bookId: 'book-id-789',
        copyId: 'copy-id-abc',
        slipId: 'slip-id-def',
        borrowAt: now,
        dueAt: dueDate,
        returnAt: null,
        shelfLocation: 'A-1',
        status: 'borrowed',
        returnedByUserId: null,
        returnedByEmail: null,
        returnMethod: null,
        note: null,
        book: null,
        createdAt: now,
        updatedAt: now,
      } as unknown as BorrowRecord;

      const result = serializeBorrowRecord(record);

      expect(result.id).toBe('record-id-123');
      expect(result.patron_id).toBe('patron-id-456');
      expect(result.book_id).toBe('book-id-789');
      expect(result.copy_id).toBe('copy-id-abc');
      expect(result.slip_id).toBe('slip-id-def');
      expect(result.borrow_at).toBe(now);
      expect(result.due_at).toBe(dueDate);
      expect(result.return_at).toBeNull();
      expect(result.shelf_location).toBe('A-1');
      expect(result.status).toBe('borrowed');
      expect(result.returned_by_user_id).toBeNull();
      expect(result.returned_by_email).toBeNull();
      expect(result.return_method).toBeNull();
      expect(result.note).toBeNull();
    });

    it('should serialize returned record', () => {
      const now = new Date();
      const dueDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const record = {
        id: 'record-id',
        patronId: 'patron-id',
        bookId: 'book-id',
        status: 'returned',
        returnAt: now,
        returnMethod: 'staff_web',
        returnedByUserId: 'staff-id',
        returnedByEmail: 'staff@example.com',
        note: 'Returned on time',
        createdAt: now,
        updatedAt: now,
      } as unknown as BorrowRecord;

      const result = serializeBorrowRecord(record);

      expect(result.status).toBe('returned');
      expect(result.return_at).toBe(now);
      expect(result.return_method).toBe('staff_web');
      expect(result.returned_by_user_id).toBe('staff-id');
      expect(result.returned_by_email).toBe('staff@example.com');
      expect(result.note).toBe('Returned on time');
    });

    it('should include nested book if present', () => {
      const now = new Date();
      const book = {
        id: 'book-id',
        isbn: '9780123456789',
        title: 'Nested Book',
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      } as Book;

      const record = {
        id: 'record-id',
        patronId: 'patron-id',
        bookId: 'book-id',
        book,
        status: 'borrowed',
        createdAt: now,
        updatedAt: now,
      } as unknown as BorrowRecord;

      const result = serializeBorrowRecord(record);

      expect(result.book).toBeDefined();
      expect(result.book!.id).toBe('book-id');
    });

    it('should not include book field when book is null', () => {
      const now = new Date();
      const record = {
        id: 'record-id',
        patronId: 'patron-id',
        bookId: 'book-id',
        status: 'borrowed',
        book: null,
        createdAt: now,
        updatedAt: now,
      } as unknown as BorrowRecord;

      const result = serializeBorrowRecord(record);

      expect(result.book).toBeUndefined();
    });
  });

  describe('serializeBorrowSlip', () => {
    it('should serialize slip with all fields', () => {
      const now = new Date();
      const dueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      const slip = {
        id: 'slip-id-123',
        patronId: 'patron-id-456',
        borrowAt: now,
        dueAt: dueDate,
        status: 'active',
        createdByUserId: 'staff-id-789',
        createdByEmail: 'staff@example.com',
        totalItems: 3,
        createdAt: now,
        updatedAt: now,
      } as BorrowSlip;

      const result = serializeBorrowSlip(slip);

      expect(result.id).toBe('slip-id-123');
      expect(result.patron_id).toBe('patron-id-456');
      expect(result.borrow_at).toBe(now);
      expect(result.due_at).toBe(dueDate);
      expect(result.status).toBe('active');
      expect(result.created_by_user_id).toBe('staff-id-789');
      expect(result.created_by_email).toBe('staff@example.com');
      expect(result.total_items).toBe(3);
      expect(result.created_at).toBe(now);
      expect(result.updated_at).toBe(now);
    });

    it('should handle closed slip', () => {
      const now = new Date();
      const slip = {
        id: 'slip-id',
        patronId: 'patron-id',
        status: 'closed',
        totalItems: 2,
        createdAt: now,
        updatedAt: now,
      } as unknown as BorrowSlip;

      const result = serializeBorrowSlip(slip);

      expect(result.status).toBe('closed');
    });

    it('should handle null optional fields', () => {
      const now = new Date();
      const slip = {
        id: 'slip-id',
        patronId: 'patron-id',
        status: 'active',
        createdByUserId: null,
        createdByEmail: null,
        totalItems: 0,
        createdAt: now,
        updatedAt: now,
      } as unknown as BorrowSlip;

      const result = serializeBorrowSlip(slip);

      expect(result.created_by_user_id).toBeNull();
      expect(result.created_by_email).toBeNull();
    });
  });
});