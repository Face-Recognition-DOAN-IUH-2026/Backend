import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BorrowRecord } from '../entities/BorrowRecord';

export function serializeCopy(copy: BookCopy) {
  return {
    id: copy.id,
    book_id: copy.bookId,
    barcode: copy.barcode,
    is_available: copy.isAvailable,
    shelf_location: copy.shelfLocation,
  };
}

export function serializeBook(book: Book) {
  return {
    id: book.id,
    isbn: book.isbn,
    title: book.title,
    author: book.author,
    cover_url: book.coverUrl,
    shelf_location: book.shelfLocation,
    copies: book.copies?.map(serializeCopy) || [],
  };
}

export function serializeBorrowRecord(record: BorrowRecord) {
  return {
    id: record.id,
    patron_id: record.patronId,
    book_id: record.bookId,
    copy_id: record.copyId,
    borrow_at: record.borrowAt,
    due_at: record.dueAt,
    return_at: record.returnAt,
    shelf_location: record.shelfLocation,
    status: record.status,
    returned_by_user_id: record.returnedByUserId,
    returned_by_email: record.returnedByEmail,
    return_method: record.returnMethod,
    book: record.book ? serializeBook(record.book) : undefined,
  };
}

export function serializeBookWithStats(book: Book, total: number, available: number) {
  return {
    id: book.id,
    isbn: book.isbn,
    title: book.title,
    author: book.author,
    cover_url: book.coverUrl,
    shelf_location: book.shelfLocation,
    total_copies: total,
    available_copies: available,
    created_at: book.createdAt,
  };
}
