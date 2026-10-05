import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BorrowRecord } from '../entities/BorrowRecord';
import { BorrowSlip } from '../entities/BorrowSlip';
import {
  CONDITION_LABELS,
  COPY_STATUS_LABELS,
  DEFAULT_CONDITION,
  DEFAULT_COPY_STATUS,
} from '../constants/copy';

function conditionLabel(condition?: string | null) {
  const code = (condition || DEFAULT_CONDITION) as keyof typeof CONDITION_LABELS;
  return CONDITION_LABELS[code] ?? condition;
}

function statusLabel(status?: string | null) {
  const code = (status || DEFAULT_COPY_STATUS) as keyof typeof COPY_STATUS_LABELS;
  return COPY_STATUS_LABELS[code] ?? status;
}

export function serializeCopy(copy: BookCopy) {
  const condition = copy.condition || DEFAULT_CONDITION;
  const status = copy.status || DEFAULT_COPY_STATUS;
  return {
    id: copy.id,
    book_id: copy.bookId,
    barcode: copy.barcode,
    is_available: copy.isAvailable,
    shelf_location: copy.shelfLocation,
    condition,
    condition_label: conditionLabel(condition),
    status,
    status_label: statusLabel(status),
    imported_at: copy.importedAt ?? null,
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
    price: book.price ?? null,
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
    return_condition: record.returnCondition ?? null,
    note: record.note,
    fine_amount: record.fineAmount ?? 0,
    damage_fee: record.damageFee ?? 0,
    fine_paid: record.finePaid ?? false,
    payment_method: record.paymentMethod ?? null,
    payment_ref: record.paymentRef ?? null,
    paid_at: record.paidAt ?? null,
    total_due: (Number(record.fineAmount) || 0) + (Number(record.damageFee) || 0),
    renewal_count: record.renewalCount ?? 0,
    book: record.book ? serializeBook(record.book) : undefined,
    copy: record.copy ? serializeCopy(record.copy) : undefined,
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
    price: book.price ?? null,
    total_copies: total,
    available_copies: available,
    created_at: book.createdAt,
    updated_at: book.updatedAt,
    is_available: book.isAvailable,
  };
}
