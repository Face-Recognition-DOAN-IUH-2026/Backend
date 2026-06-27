import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BorrowRecord } from '../entities/BorrowRecord';
import { BorrowSlip } from '../entities/BorrowSlip';

export function serializeReservation(reservation: any) {
  return {
    id: reservation.id,
    book_id: reservation.bookId,
    patron_id: reservation.patronId,
    reserved_at: reservation.reservedAt,
    expires_at: reservation.expiresAt,
    status: reservation.status,
    notified_at: reservation.notifiedAt,
    created_at: reservation.createdAt,
    book: reservation.book ? serializeBook(reservation.book) : undefined,
  };
}

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
    subtitle: book.subtitle,
    author: book.author,
    cover_url: book.coverUrl,
    publisher: book.publisher,
    published_date: book.publishedDate,
    description: book.description,
    page_count: book.pageCount,
    categories: book.categories,
    average_rating: book.averageRating,
    language: book.language,
    isbn10: book.isbn10,
    isbn13: book.isbn13,
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
    slip_id: record.slipId,
    borrow_at: record.borrowAt,
    due_at: record.dueAt,
    return_at: record.returnAt,
    shelf_location: record.shelfLocation,
    status: record.status,
    returned_by_user_id: record.returnedByUserId,
    returned_by_email: record.returnedByEmail,
    return_method: record.returnMethod,
    note: record.note,
    fine_amount: record.fineAmount ?? 0,
    fine_paid: record.finePaid ?? false,
    renewal_count: record.renewalCount ?? 0,
    book: record.book ? serializeBook(record.book) : undefined,
  };
}

export function serializeBorrowSlip(slip: BorrowSlip) {
  return {
    id: slip.id,
    patron_id: slip.patronId,
    borrow_at: slip.borrowAt,
    due_at: slip.dueAt,
    status: slip.status,
    created_by_user_id: slip.createdByUserId,
    created_by_email: slip.createdByEmail,
    total_items: slip.totalItems,
    note: slip.note,
    created_at: slip.createdAt,
    updated_at: slip.updatedAt,
  };
}

export function serializeBookWithStats(book: Book, total: number, available: number) {
  return {
    id: book.id,
    isbn: book.isbn,
    title: book.title,
    subtitle: book.subtitle,
    author: book.author,
    cover_url: book.coverUrl,
    publisher: book.publisher,
    published_date: book.publishedDate,
    description: book.description,
    page_count: book.pageCount,
    categories: book.categories,
    average_rating: book.averageRating,
    language: book.language,
    isbn10: book.isbn10,
    isbn13: book.isbn13,
    shelf_location: book.shelfLocation,
    total_copies: total,
    available_copies: available,
    created_at: book.createdAt,
    updated_at: book.updatedAt,
    is_available: book.isAvailable,
  };
}
