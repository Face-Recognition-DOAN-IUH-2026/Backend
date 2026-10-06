import { In } from 'typeorm';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { HttpError } from '../middlewares/errorHandler';
import { serializeBookWithStats, serializeBorrowRecord, serializeBorrowSlip, serializeCopy } from './serializers';
import { publishEvent } from '../utils/eventPublisher';
import { getPatronAccessStatus, getPatronRawAccessStatus } from '../clients/AccessServiceClient';
import { lookupPatronById } from '../clients/UserServiceClient';
import { config } from '../config';
import { BookCopy } from '../entities/BookCopy';
import { configService } from './ConfigService';
import { assessCopyBorrowability, markCopyAsBorrowed } from '../constants/copy';
import { findCopyByBarcode, nearestCopyBarcodes, sanitizeBarcode } from '../utils/barcode';
import { convertIsbnFormat } from '../utils/isbn';

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

// Label printers may pad the copy sequence differently than the DB (e.g. LIB-<isbn>-0001 vs LIB-<isbn>-001).
// findCopyByBarcode (utils/barcode) retries with the canonical 3-digit sequence.

// A book cover label carries the ISBN-13 while the DB may store the ISBN-10 (or vice versa).
async function findBookByIsbn(repo: BorrowRepository, isbn: string) {
  let book = await repo.getBookByIsbn(isbn);
  if (!book) {
    const alt = convertIsbnFormat(isbn);
    if (alt) book = await repo.getBookByIsbn(alt);
  }
  return book;
}

async function lookupBookAndCopy(repo: BorrowRepository, barcode: string, isbn?: string) {
  const scan = sanitizeBarcode(barcode || '');
  const isbnClean = sanitizeBarcode(isbn || '');
  const isCopyCode = /^LIB/i.test(scan.replace(/[\s-]/g, '')) || /^LIB/i.test(isbnClean.replace(/[\s-]/g, ''));

  let book: any = null;
  let copy: any = null;

  // Scanning a copy barcode (LIB-<isbn>-<seq>) must pin the exact physical copy.
  if (isCopyCode) {
    const copyBarcode = /^LIB/i.test(scan.replace(/[\s-]/g, '')) ? scan : isbnClean;
    copy = await findCopyByBarcode(repo, copyBarcode);
    if (copy) {
      book = copy.book || (await repo.getBookById(copy.bookId));
    } else {
      // Copy not found — check if the parent book exists to provide a clear, accurate explanation
      const cleanScan = copyBarcode.replace(/[\s-]/g, '');
      const match = cleanScan.match(/^LIB(\d{10,13})(\d+)?$/i);
      if (match) {
        book = await findBookByIsbn(repo, match[1]);
        if (book) {
          const totalCopies = await repo.countCopies(book.id, false);
          const availableCopies = await repo.countCopies(book.id, true);
          const existingBarcodes = await repo.getCopyBarcodesByBookId(book.id);
          const neighbors = nearestCopyBarcodes(copyBarcode, existingBarcodes, 3);
          const neighborHint = neighbors.length > 0
            ? ` Các bản gần nhất: ${neighbors.map((b) => `"${b}"`).join(', ')}.`
            : '';
          return {
            book,
            copy: null,
            reason: `Sách "${book.title}" hiện có ${totalCopies} bản. Không tìm thấy bản sao "${copyBarcode}".${neighborHint}`,
            totalCopies,
            availableCopies,
          };
        }
      }
      return { book: null, copy: null, reason: `Không tìm thấy bản sao nào với mã vạch "${copyBarcode}"` };
    }
  }

  // Not a copy code or copy resolved - find book by pure ISBN
  if (!book) {
    let pureIsbn = !/^LIB/i.test(isbnClean.replace(/[\s-]/g, '')) ? isbnClean : '';
    if (!pureIsbn && !/^LIB/i.test(scan.replace(/[\s-]/g, ''))) {
      pureIsbn = scan;
    }
    if (pureIsbn) {
      book = await findBookByIsbn(repo, pureIsbn);
    }
  }

  // Glued <isbn><seq> without the LIB prefix — try resolving the exact copy before giving up.
  if (!book && !copy) {
    copy = await findCopyByBarcode(repo, scan);
    if (copy) book = copy.book || (await repo.getBookById(copy.bookId));
  }

  if (!book) return { book: null, copy: null, reason: `Khong co sach nay trong thu vien (ma quet: "${scan}")` };

  const totalCopies = await repo.countCopies(book.id, false);
  const availableCopies = await repo.countCopies(book.id, true);

  if (!copy) copy = await repo.getAvailableCopy(book.id);
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
    const seenBookIds = new Set<string>();
    const seenCopyIds = new Set<string>();

    for (const item of items) {
      const barcode = sanitizeBarcode(item.barcode);
      const isbn = item.isbn ? sanitizeBarcode(item.isbn) : undefined;
      const { book, copy, reason, totalCopies, availableCopies } = await lookupBookAndCopy(this.repo, barcode, isbn);

      if (!book || !copy) {
        results.push({ barcode, isbn, can_borrow: false, reason: reason || 'Khong tim thay sach', book: book ? serializeBookWithStats(book, totalCopies!, availableCopies!) : null, copy: null });
        if (reason) errors.push(reason);
        continue;
      }

      if (seenCopyIds.has(copy.id)) {
        const dupMsg = `Bản sao "${copy.barcode}" bị trùng trong danh sách mượn`;
        results.push({
          barcode,
          isbn,
          can_borrow: false,
          reason: dupMsg,
          book: serializeBookWithStats(book, totalCopies!, availableCopies!),
          copy: null,
        });
        errors.push(dupMsg);
        continue;
      }

      if (seenBookIds.has(book.id)) {
        const dupMsg = `Sách "${book.title}" đã có trong danh sách mượn này`;
        results.push({
          barcode,
          isbn,
          can_borrow: false,
          reason: dupMsg,
          book: serializeBookWithStats(book, totalCopies!, availableCopies!),
          copy: null,
        });
        errors.push(dupMsg);
        continue;
      }

      const assessment = assessCopyBorrowability(copy);
      if (assessment.blocked) {
        results.push({
          barcode,
          isbn,
          can_borrow: false,
          reason: assessment.reason,
          book: serializeBookWithStats(book, totalCopies!, availableCopies!),
          copy: null,
        });
        if (assessment.reason) errors.push(assessment.reason);
        continue;
      }

      const active = await this.repo.getActiveBorrow(patronId, book.id);
      if (active) {
        results.push({ barcode, isbn, can_borrow: false, reason: `Sach "${book.title}" da duoc muon`, book: null, copy: null });
        errors.push(`Sach "${book.title}" đã được độc giả này mượn`);
        continue;
      }

      seenCopyIds.add(copy.id);
      seenBookIds.add(book.id);

      results.push({
        barcode,
        isbn,
        can_borrow: true,
        reason: assessment.warning,
        book: serializeBookWithStats(book, totalCopies!, availableCopies!),
        copy: serializeCopy(copy),
      });
    }

    const overdue = await this.repo.getOverdueBorrows(patronId);
    if (overdue.length) errors.push(`Độc giả có ${overdue.length} sách quá hạn`);

    const activeCount = await this.repo.countActiveBorrows(patronId);
    const validItems = results.filter((r) => r.can_borrow).length;
    const limits = await configService.getBorrowLimits();
    if (activeCount + validItems > limits.maxBorrowBooks) {
      errors.push(`Qua gioi han muon sach (toi da ${limits.maxBorrowBooks} cuon)`);
    }
    if (validItems > limits.maxBorrowBooksPerSlip) {
      errors.push(`Moi phieu muon toi da ${limits.maxBorrowBooksPerSlip} cuon`);
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

    const seenCopyIds = new Set<string>();
    const seenBookIds = new Set<string>();

    for (const item of items) {
      if (seenCopyIds.has(item.copy_id)) {
        throw new HttpError(409, `Bản sao ${item.barcode || item.copy_id} bị trùng lặp trong phiếu mượn`);
      }
      if (seenBookIds.has(item.book_id)) {
        throw new HttpError(409, `Không thể mượn nhiều bản sao của cùng một đầu sách trong một phiếu mượn`);
      }
      seenCopyIds.add(item.copy_id);
      seenBookIds.add(item.book_id);

      const copy = copiesMap.get(item.copy_id);
      if (!copy) throw new HttpError(400, `Bản sao ${item.copy_id} không tồn tại`);
      if (copy.bookId !== item.book_id) throw new HttpError(400, 'Dữ liệu không hợp lệ: copy_id không khớp với book_id');

      const book = booksMap.get(item.book_id);
      if (!book) throw new HttpError(400, `Sach ${item.book_id} không tồn tại`);

      if (!copy.isAvailable) throw new HttpError(409, `Bản sao ${item.barcode} dang duoc muon`);
      const normCopyBarcode = (copy.barcode || '').replace(/[\s-]+/g, '').toLowerCase();
      const normItemBarcode = (item.barcode || '').replace(/[\s-]+/g, '').toLowerCase();
      if (normCopyBarcode !== normItemBarcode) throw new HttpError(400, 'Dữ liệu không hợp lệ: barcode không khớp');

      const copyAssessment = assessCopyBorrowability(copy);
      if (copyAssessment.blocked) throw new HttpError(409, copyAssessment.reason!);

      const active = await this.repo.getActiveBorrow(patronId, book.id);
      if (active) throw new HttpError(409, `Sach "${book.title}" đã được độc giả này mượn`);

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await this.repo.getOverdueBorrows(patronId);
    if (overdue.length) throw new HttpError(409, 'Độc giả có sách quá hạn. Vui long tra sach truoc khi muon them.');

    const activeCount = await this.repo.countActiveBorrows(patronId);
    const limits = await configService.getBorrowLimits();
    if (activeCount + bookIds.length > limits.maxBorrowBooks) throw new HttpError(409, `Qua gioi han muon sach (toi da ${limits.maxBorrowBooks} cuon)`);
    if (bookIds.length > limits.maxBorrowBooksPerSlip) throw new HttpError(409, `Moi phieu muon toi da ${limits.maxBorrowBooksPerSlip} cuon`);

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

    const seenCopyIds = new Set<string>();
    const seenBookIds = new Set<string>();

    for (const item of items) {
      const barcode = sanitizeBarcode(item.barcode);
      const isbn = item.isbn ? sanitizeBarcode(item.isbn) : undefined;
      const isCopy = /^LIB/i.test(barcode.replace(/[\s-]/g, ''));
      let book: any = null;
      let copy: BookCopy | null | undefined;

      if (isCopy) {
        copy = await findCopyByBarcode(this.repo, barcode);
        if (copy) {
          book = copy.book || (await this.repo.getBookById(copy.bookId));
          if (!copy.isAvailable) throw new HttpError(409, `Bản sao ${barcode} dang duoc muon`);
        }
      }

      if (!book) {
        const lookupIsbn = isbn && !/^LIB/i.test(isbn.replace(/[\s-]/g, '')) ? isbn : barcode;
        book = await findBookByIsbn(this.repo, lookupIsbn);
      }

      if (!book && !copy) {
        const existingCopy = await findCopyByBarcode(this.repo, barcode);
        if (existingCopy) {
          book = existingCopy.book || await this.repo.getBookById(existingCopy.bookId);
          copy = existingCopy;
          if (!copy.isAvailable) throw new HttpError(409, `Bản sao ${barcode} dang duoc muon`);
        }
      }

      if (!book) throw new HttpError(404, `Không tìm thấy sách với mã "${barcode}"`);
      if (!copy) {
        copy = await this.repo.getAvailableCopy(book.id);
        if (!copy) throw new HttpError(409, `Sach "${book.title}" da het ban co the muon`);
      }

      if (seenCopyIds.has(copy.id)) {
        throw new HttpError(409, `Bản sao ${barcode} bị trùng lặp trong phiếu mượn`);
      }
      if (seenBookIds.has(book.id)) {
        throw new HttpError(409, `Không thể mượn nhiều bản sao của cùng đầu sách "${book.title}" trong một phiếu mượn`);
      }
      seenCopyIds.add(copy.id);
      seenBookIds.add(book.id);

      const copyAssessment = assessCopyBorrowability(copy);
      if (copyAssessment.blocked) throw new HttpError(409, copyAssessment.reason!);

      const active = await this.repo.getActiveBorrow(patronId, book.id);
      if (active) throw new HttpError(409, `Sach "${book.title}" đã được độc giả này mượn`);

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await this.repo.getOverdueBorrows(patronId);
    if (overdue.length) throw new HttpError(409, 'Độc giả có sách quá hạn. Vui long tra sach truoc khi muon them.');

    const activeCount = await this.repo.countActiveBorrows(patronId);
    const limits = await configService.getBorrowLimits();
    if (activeCount + bookIds.length > limits.maxBorrowBooks) throw new HttpError(409, `Qua gioi han muon sach (toi da ${limits.maxBorrowBooks} cuon)`);
    if (bookIds.length > limits.maxBorrowBooksPerSlip) throw new HttpError(409, `Moi phieu muon toi da ${limits.maxBorrowBooksPerSlip} cuon`);

    const validCopyIds = copyIds.filter((id): id is string => id !== null);
    const allCopies = validCopyIds.length > 0 ? await this.repo.copies.find({ where: { id: In(validCopyIds) } }) : [];
    const copiesMap = new Map(allCopies.map(c => [c.id, c]));
    const copiesToUpdate = validCopyIds.map(id => copiesMap.get(id)).filter(Boolean) as BookCopy[];
    for (const copy of copiesToUpdate) {
      markCopyAsBorrowed(copy);
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
