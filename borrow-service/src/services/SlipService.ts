import { In } from 'typeorm';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { HttpError } from '../middlewares/errorHandler';
import { serializeBookWithStats, serializeBorrowRecord, serializeBorrowSlip, serializeCopy } from './serializers';
import { publishEvent } from '../utils/eventPublisher';
import { getPatronAccessStatus, getPatronRawAccessStatus } from '../clients/AccessServiceClient';
import { lookupPatronById } from '../clients/UserServiceClient';
import { config } from '../config';
import { BookCopy } from '../entities/BookCopy';

function patronSummary(patron: any) {
  const id = patron.id;
  const studentCode = patron.student_code || patron.studentCode;
  if (!id || !studentCode) throw new HttpError(502, 'Dữ liệu độc giả không hợp lệ');
  if (!/^[0-9a-f]{32}$/i.test(id.replace(/-/g, ''))) {
    throw new HttpError(502, 'ID độc giả không hợp lệ');
  }
  return {
    id,
    full_name: patron.full_name || patron.fullName || null,
    student_code: studentCode,
    email: patron.email || null,
    card_number: patron.card_number || patron.cardNumber || null,
    current_status: patron.current_status || patron.currentStatus || null,
  };
}

async function lookupBookAndCopy(repo: BorrowRepository, barcode: string, isbn?: string) {
  const lookupIsbn = isbn || barcode;
  const book = lookupIsbn ? await repo.getBookByIsbn(lookupIsbn) : null;
  if (!book) return { book: null, copy: null, reason: 'Khong co sach nay trong thu vien' };

  const totalCopies = await repo.countCopies(book.id, false);
  const availableCopies = await repo.countCopies(book.id, true);

  const copy = await repo.getAvailableCopy(book.id);
  if (!copy) return { book, copy: null, reason: `Sach "${book.title}" da het ban co the muon`, totalCopies, availableCopies };

  return { book, copy, reason: null, totalCopies, availableCopies };
}

export class SlipService {
  private repo: BorrowRepository;

  constructor() {
    this.repo = new BorrowRepository();
  }

  async lookup(patronId: string, items: Array<{ barcode: string; isbn?: string }>, isStaff: boolean = false) {
    const patron = await lookupPatronById(patronId);
    if (!patron) throw new HttpError(404, 'Không tìm thấy độc giả');

    const accessStatus = isStaff
      ? await getPatronRawAccessStatus(patronId)
      : await getPatronAccessStatus(patronId);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phiên làm việc đã hết hạn (${config.maxEntryHours}h). Vui lòng vào lại qua cổng.`);
      }
      throw new HttpError(403, 'Độc giả không có mặt trong thư viện.');
    }

    const results: {
      barcode: string;
      isbn: string | undefined;
      can_borrow: boolean;
      reason: string | null;
      book: ReturnType<typeof serializeBookWithStats> | null;
      copy: ReturnType<typeof serializeCopy> | null;
    }[] = [];
    const errors: string[] = [];

    for (const item of items) {
      const barcode = item.barcode.trim();
      const isbn = item.isbn?.trim();
      const { book, copy, reason, totalCopies, availableCopies } = await lookupBookAndCopy(this.repo, barcode, isbn);

      if (!book || !copy) {
        results.push({ barcode, isbn, can_borrow: false, reason: reason || 'Khong tim thay sach', book: book ? serializeBookWithStats(book, totalCopies!, availableCopies!) : null, copy: null });
        if (reason) errors.push(reason);
        continue;
      }

      const active = await this.repo.getActiveBorrow(patronId, book.id);
      if (active) {
        results.push({ barcode, isbn, can_borrow: false, reason: `Sach "${book.title}" da duoc muon`, book: null, copy: null });
        errors.push(`Sach "${book.title}" đã được độc giả này mượn`);
        continue;
      }

      results.push({
        barcode,
        isbn,
        can_borrow: true,
        reason: null,
        book: serializeBookWithStats(book, totalCopies!, availableCopies!),
        copy: serializeCopy(copy),
      });
    }

    const overdue = await this.repo.getOverdueBorrows(patronId);
    if (overdue.length) errors.push(`Độc giả có ${overdue.length} sách quá hạn`);

    const activeCount = await this.repo.countActiveBorrows(patronId);
    const validItems = results.filter((r) => r.can_borrow).length;
    if (activeCount + validItems > config.maxBorrowBooks) {
      errors.push(`Qua gioi han muon sach (toi da ${config.maxBorrowBooks} cuon)`);
    }
    if (validItems > config.maxBorrowBooksPerSlip) {
      errors.push(`Moi phieu muon toi da ${config.maxBorrowBooksPerSlip} cuon`);
    }

    return {
      can_create: errors.length === 0 && validItems > 0,
      patron: patronSummary(patron),
      items: results,
      errors,
      total_items: results.length,
      available_items: validItems,
    };
  }

  async confirm(patronId: string, items: Array<{ barcode: string; isbn?: string; book_id: string; copy_id: string }>, userId?: string | null, userEmail?: string | null, note?: string | null) {
    const patron = await lookupPatronById(patronId);
    if (!patron) throw new HttpError(404, 'Không tìm thấy độc giả');

    const accessStatus = await getPatronRawAccessStatus(patronId);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phiên làm việc đã hết hạn (${config.maxEntryHours}h). Vui lòng vào lại qua cổng.`);
      }
      throw new HttpError(403, 'Độc giả không có mặt trong thư viện.');
    }

    const bookIds: string[] = [];
    const copyIds: (string | null)[] = [];
    const shelfLocations: (string | null)[] = [];

    const copyIdsToLoad = items.map(item => item.copy_id);
    const bookIdsToLoad = items.map(item => item.book_id);

    const [allCopies, allBooks] = await Promise.all([
      this.repo.copies.find({ where: { id: In(copyIdsToLoad) } }),
      this.repo.books.find({ where: { id: In(bookIdsToLoad) } }),
    ]);

    const copiesMap = new Map(allCopies.map(c => [c.id, c]));
    const booksMap = new Map(allBooks.map(b => [b.id, b]));

    for (const item of items) {
      const copy = copiesMap.get(item.copy_id);
      if (!copy) throw new HttpError(400, `Bản sao ${item.copy_id} không tồn tại`);
      if (copy.bookId !== item.book_id) throw new HttpError(400, 'Dữ liệu không hợp lệ: copy_id không khớp với book_id');

      const book = booksMap.get(item.book_id);
      if (!book) throw new HttpError(400, `Sach ${item.book_id} không tồn tại`);

      if (!copy.isAvailable) throw new HttpError(409, `Bản sao ${item.barcode} dang duoc muon`);
      if (copy.barcode !== item.barcode) throw new HttpError(400, 'Dữ liệu không hợp lệ: barcode không khớp');

      const active = await this.repo.getActiveBorrow(patronId, book.id);
      if (active) throw new HttpError(409, `Sach "${book.title}" đã được độc giả này mượn`);

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await this.repo.getOverdueBorrows(patronId);
    if (overdue.length) throw new HttpError(409, 'Độc giả có sách quá hạn. Vui long tra sach truoc khi muon them.');

    const activeCount = await this.repo.countActiveBorrows(patronId);
    if (activeCount + bookIds.length > config.maxBorrowBooks) throw new HttpError(409, `Qua gioi han muon sach (toi da ${config.maxBorrowBooks} cuon)`);
    if (bookIds.length > config.maxBorrowBooksPerSlip) throw new HttpError(409, `Moi phieu muon toi da ${config.maxBorrowBooksPerSlip} cuon`);

    const copiesToUpdate = copyIds.filter(id => id).map(id => copiesMap.get(id!)).filter(Boolean) as BookCopy[];
    for (const copy of copiesToUpdate) {
      copy.isAvailable = false;
      copy.updatedAt = new Date();
    }
    if (copiesToUpdate.length > 0) {
      await this.repo.copies.save(copiesToUpdate);
    }

    const { slip, records } = await this.repo.createSlip(patronId, bookIds, copyIds, shelfLocations, userId, userEmail, note);

    const recordBookIds = records.map(r => r.bookId);
    const recordCopyIds = records.filter(r => r.copyId).map(r => r.copyId!);

    const [recordBooks, recordCopies] = await Promise.all([
      this.repo.books.find({ where: { id: In(recordBookIds) } }),
      recordCopyIds.length > 0 ? this.repo.copies.find({ where: { id: In(recordCopyIds) } }) : [],
    ]);

    const recordBooksMap = new Map(recordBooks.map(b => [b.id, b]));
    const recordCopiesMap = new Map(recordCopies.map(c => [c.id, c]));

    for (const record of records) {
      record.book = recordBooksMap.get(record.bookId)!;
      record.copy = record.copyId ? recordCopiesMap.get(record.copyId) || null : null;
    }

    for (const record of records) {
      publishEvent('book.borrowed', {
        bookId: record.bookId,
        title: record.book?.title,
        patronId: record.patronId,
        borrowRecordId: record.id,
        dueAt: record.dueAt,
      });
    }

    return {
      slip: serializeBorrowSlip(slip),
      records: records.map(serializeBorrowRecord),
    };
  }

  async create(patronId: string, items: Array<{ barcode: string; isbn?: string }>, userId?: string | null, userEmail?: string | null, note?: string | null, isStaff: boolean = false) {
    const patron = await lookupPatronById(patronId);
    if (!patron) throw new HttpError(404, 'Không tìm thấy độc giả');

    const accessStatus = isStaff
      ? await getPatronRawAccessStatus(patronId)
      : await getPatronAccessStatus(patronId);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phiên làm việc đã hết hạn (${config.maxEntryHours}h). Vui lòng vào lại qua cổng.`);
      }
      throw new HttpError(403, 'Độc giả không có mặt trong thư viện.');
    }

    const bookIds: string[] = [];
    const copyIds: (string | null)[] = [];
    const shelfLocations: (string | null)[] = [];

    for (const item of items) {
      const barcode = item.barcode.trim();
      const isbn = item.isbn?.trim();
      let book = await this.repo.getBookByIsbn(isbn || barcode);
      let copy: BookCopy | null | undefined;

      if (!book) {
        const existingCopy = await this.repo.getCopyByBarcode(barcode);
        if (existingCopy) {
          book = existingCopy.book || await this.repo.getBookById(existingCopy.bookId);
          copy = existingCopy;
          if (!copy.isAvailable) throw new HttpError(409, `Bản sao ${barcode} dang duoc muon`);
        }
      }
      if (!book && copy) {
        // already resolved above
      } else if (book && !copy) {
        copy = await this.repo.getAvailableCopy(book.id);
        if (!copy) throw new HttpError(409, `Sach ${book.title} da het ban co the muon`);
      }

      if (!book || !copy) throw new HttpError(404, 'Khong tim thay sach');

      const active = await this.repo.getActiveBorrow(patronId, book.id);
      if (active) throw new HttpError(409, `Sach "${book.title}" đã được độc giả này mượn`);

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await this.repo.getOverdueBorrows(patronId);
    if (overdue.length) throw new HttpError(409, 'Độc giả có sách quá hạn. Vui long tra sach truoc khi muon them.');

    const activeCount = await this.repo.countActiveBorrows(patronId);
    if (activeCount + bookIds.length > config.maxBorrowBooks) throw new HttpError(409, `Qua gioi han muon sach (toi da ${config.maxBorrowBooks} cuon)`);
    if (bookIds.length > config.maxBorrowBooksPerSlip) throw new HttpError(409, `Moi phieu muon toi da ${config.maxBorrowBooksPerSlip} cuon`);

    const validCopyIds = copyIds.filter((id): id is string => id !== null);
    const allCopies = validCopyIds.length > 0 ? await this.repo.copies.find({ where: { id: In(validCopyIds) } }) : [];
    const copiesMap = new Map(allCopies.map(c => [c.id, c]));
    const copiesToUpdate = validCopyIds.map(id => copiesMap.get(id)).filter(Boolean) as BookCopy[];
    for (const copy of copiesToUpdate) {
      copy.isAvailable = false;
      copy.updatedAt = new Date();
    }
    if (copiesToUpdate.length > 0) {
      await this.repo.copies.save(copiesToUpdate);
    }

    const { slip, records } = await this.repo.createSlip(patronId, bookIds, copyIds, shelfLocations, userId, userEmail, note);

    const recordBookIds = records.map(r => r.bookId);
    const recordCopyIds = records.filter(r => r.copyId).map(r => r.copyId!);

    const [recordBooks, recordCopies] = await Promise.all([
      this.repo.books.find({ where: { id: In(recordBookIds) } }),
      recordCopyIds.length > 0 ? this.repo.copies.find({ where: { id: In(recordCopyIds) } }) : [],
    ]);

    const recordBooksMap = new Map(recordBooks.map(b => [b.id, b]));
    const recordCopiesMap = new Map(recordCopies.map(c => [c.id, c]));

    for (const record of records) {
      record.book = recordBooksMap.get(record.bookId)!;
      record.copy = record.copyId ? recordCopiesMap.get(record.copyId) || null : null;
    }

    for (const record of records) {
      publishEvent('book.borrowed', {
        bookId: record.bookId,
        title: record.book?.title,
        patronId: record.patronId,
        borrowRecordId: record.id,
        dueAt: record.dueAt,
      });
    }

    return {
      slip: { ...serializeBorrowSlip(slip), records: records.map(serializeBorrowRecord) },
    };
  }
}
