import { Router } from 'express';
import { z } from 'zod';
import { In } from 'typeorm';
import { AppDataSource } from '../data-source';
import { auth, AuthRequest, requireRole } from '../middlewares/auth';
import { HttpError } from '../middlewares/errorHandler';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { isPatronInside, getPatronAccessStatus, getPatronRawAccessStatus } from '../clients/AccessServiceClient';
import { lookupPatronById, lookupPatronByStudentCode, lookupPatronsByIds, PatronSummary } from '../clients/UserServiceClient';
import { serializeBook, serializeBookWithStats, serializeBorrowRecord, serializeBorrowSlip, serializeCopy } from '../services/serializers';
import { publishEvent } from '../utils/eventPublisher';
import { config } from '../config';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';

const router = Router();
router.use(auth);

function patronIdFrom(user: AuthRequest['user']) {
  if (!user?.id) throw new HttpError(401, 'Invalid or expired token');
  return user.id;
}

function patronSummary(patron: PatronSummary) {
  const id = patron.id;
  const studentCode = patron.student_code || patron.studentCode;
  if (!id || !studentCode) throw new HttpError(502, 'Du lieu doc gia khong hop le');
  if (!/^[0-9a-f]{32}$/i.test(id.replace(/-/g, ''))) {
    throw new HttpError(502, 'ID doc gia khong hop le');
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

function normalizeBookCode(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/\.0+$/, '');
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

async function getOrCreateBookAndCopy(repo: BorrowRepository, barcode: string, isbn?: string) {
  const existingCopy = await repo.getCopyByBarcode(barcode);
  if (existingCopy) return { book: existingCopy.book || await repo.getBookById(existingCopy.bookId), copy: existingCopy };
  return null;
}

// POST /staff/slip/lookup
router.post('/slip/lookup', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string().min(1),
      items: z.array(z.object({
        barcode: z.string().min(1),
        isbn: z.string().optional(),
      })).min(1),
    }).parse(req.body);

    const repo = new BorrowRepository();
    const patron = await lookupPatronById(body.patron_id);
    if (!patron) throw new HttpError(404, 'Khong tim thay doc gia');

    const isStaff = req.user?.role === 'admin' || req.user?.role === 'staff';
    const accessStatus = isStaff
      ? await getPatronRawAccessStatus(body.patron_id)
      : await getPatronAccessStatus(body.patron_id);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phien lam viec da het han (${config.maxEntryHours}h). Vui long vao lai qua cong.`);
      }
      throw new HttpError(403, 'Doc gia khong co mat trong thu vien.');
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

    for (const item of body.items) {
      const barcode = item.barcode.trim();
      const isbn = item.isbn?.trim();
      const { book, copy, reason, totalCopies, availableCopies } = await lookupBookAndCopy(repo, barcode, isbn);

      if (!book || !copy) {
        results.push({ barcode, isbn, can_borrow: false, reason: reason || 'Khong tim thay sach', book: book ? serializeBookWithStats(book, totalCopies!, availableCopies!) : null, copy: null });
        if (reason) errors.push(reason);
        continue;
      }

      const active = await repo.getActiveBorrow(body.patron_id, book.id);
      if (active) {
        results.push({ barcode, isbn, can_borrow: false, reason: `Sach "${book.title}" da duoc muon`, book: null, copy: null });
        errors.push(`Sach "${book.title}" da duoc doc gia nay muon`);
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

    const overdue = await repo.getOverdueBorrows(body.patron_id);
    if (overdue.length) errors.push(`Doc gia co ${overdue.length} sach qua han`);

    const activeCount = await repo.countActiveBorrows(body.patron_id);
    const validItems = results.filter((r) => r.can_borrow).length;
    if (activeCount + validItems > config.maxBorrowBooks) {
      errors.push(`Qua gioi han muon sach (toi da ${config.maxBorrowBooks} cuon)`);
    }
    if (validItems > config.maxBorrowBooksPerSlip) {
      errors.push(`Moi phieu muon toi da ${config.maxBorrowBooksPerSlip} cuon`);
    }

    res.json({
      can_create: errors.length === 0 && validItems > 0,
      patron: patronSummary(patron),
      items: results,
      errors,
      total_items: results.length,
      available_items: validItems,
    });
  } catch (error) {
    next(error);
  }
});

// POST /staff/slip/confirm
router.post('/slip/confirm', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string().min(1),
      items: z.array(z.object({
        barcode: z.string().min(1),
        isbn: z.string().optional(),
        book_id: z.string().uuid(),
        copy_id: z.string().uuid(),
      })).min(1),
      note: z.string().nullable().optional(),
    }).parse(req.body);

    const repo = new BorrowRepository();
    const patron = await lookupPatronById(body.patron_id);
    if (!patron) throw new HttpError(404, 'Khong tim thay doc gia');

    const isStaff = req.user?.role === 'admin' || req.user?.role === 'staff';
    const accessStatus = isStaff
      ? await getPatronRawAccessStatus(body.patron_id)
      : await getPatronAccessStatus(body.patron_id);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phien lam viec da het han (${config.maxEntryHours}h). Vui long vao lai qua cong.`);
      }
      throw new HttpError(403, 'Doc gia khong co mat trong thu vien.');
    }

    const bookIds: string[] = [];
    const copyIds: (string | null)[] = [];
    const shelfLocations: (string | null)[] = [];

    const copyIdsToLoad = body.items.map(item => item.copy_id);
    const bookIdsToLoad = body.items.map(item => item.book_id);

    const [allCopies, allBooks] = await Promise.all([
      repo.copies.find({ where: { id: In(copyIdsToLoad) } }),
      repo.books.find({ where: { id: In(bookIdsToLoad) } }),
    ]);

    const copiesMap = new Map(allCopies.map(c => [c.id, c]));
    const booksMap = new Map(allBooks.map(b => [b.id, b]));

    for (const item of body.items) {
      const copy = copiesMap.get(item.copy_id);
      if (!copy) throw new HttpError(400, `Ban sao ${item.copy_id} khong ton tai`);
      if (copy.bookId !== item.book_id) throw new HttpError(400, 'Du lieu khong hop le: copy_id khong khop voi book_id');

      const book = booksMap.get(item.book_id);
      if (!book) throw new HttpError(400, `Sach ${item.book_id} khong ton tai`);

      if (!copy.isAvailable) throw new HttpError(409, `Ban sao ${item.barcode} dang duoc muon`);
      if (copy.barcode !== item.barcode) throw new HttpError(400, 'Du lieu khong hop le: barcode khong khop');

      const active = await repo.getActiveBorrow(body.patron_id, book.id);
      if (active) throw new HttpError(409, `Sach "${book.title}" da duoc doc gia nay muon`);

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await repo.getOverdueBorrows(body.patron_id);
    if (overdue.length) throw new HttpError(409, 'Doc gia co sach qua han. Vui long tra sach truoc khi muon them.');

    const activeCount = await repo.countActiveBorrows(body.patron_id);
    if (activeCount + bookIds.length > config.maxBorrowBooks) throw new HttpError(409, `Qua gioi han muon sach (toi da ${config.maxBorrowBooks} cuon)`);
    if (bookIds.length > config.maxBorrowBooksPerSlip) throw new HttpError(409, `Moi phieu muon toi da ${config.maxBorrowBooksPerSlip} cuon`);

    const copiesToUpdate = copyIds.filter(id => id).map(id => copiesMap.get(id!)).filter(Boolean) as BookCopy[];
    for (const copy of copiesToUpdate) {
      copy.isAvailable = false;
      copy.updatedAt = new Date();
    }
    if (copiesToUpdate.length > 0) {
      await repo.copies.save(copiesToUpdate);
    }

    const { slip, records } = await repo.createSlip(body.patron_id, bookIds, copyIds, shelfLocations, req.user?.id, req.user?.email, body.note);

    const recordBookIds = records.map(r => r.bookId);
    const recordCopyIds = records.filter(r => r.copyId).map(r => r.copyId!);

    const [recordBooks, recordCopies] = await Promise.all([
      repo.books.find({ where: { id: In(recordBookIds) } }),
      recordCopyIds.length > 0 ? repo.copies.find({ where: { id: In(recordCopyIds) } }) : [],
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

    res.json({
      status: 'success',
      message: `Tao phieu muon thanh cong voi ${records.length} cuon. Han tra: ${slip.dueAt.toLocaleDateString('vi-VN')}.`,
      slip: { ...serializeBorrowSlip(slip), records: records.map(serializeBorrowRecord) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /staff/slip/create
router.post('/slip/create', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string().min(1),
      items: z.array(z.object({
        barcode: z.string().min(1),
        isbn: z.string().optional(),
      })).min(1),
      note: z.string().nullable().optional(),
    }).parse(req.body);

    const repo = new BorrowRepository();
    const bookIds: string[] = [];
    const copyIds: (string | null)[] = [];
    const shelfLocations: (string | null)[] = [];

    for (const item of body.items) {
      const barcode = item.barcode.trim();
      const isbn = item.isbn?.trim();
      let book: Book | null | undefined;
      let copy: BookCopy | null | undefined;

      if (isbn || (/^\d+$/.test(barcode) && [10, 13].includes(barcode.length))) {
        const lookupIsbn = isbn || barcode;
        book = await repo.getBookByIsbn(lookupIsbn);
        if (!book) {
          const existingCopy = await repo.getCopyByBarcode(barcode);
          if (existingCopy) {
            book = existingCopy.book || await repo.getBookById(existingCopy.bookId);
            copy = existingCopy;
            if (!copy.isAvailable) throw new HttpError(409, `Ban sao ${barcode} dang duoc muon`);
          }
        }
        if (!book) {
          const result = await getOrCreateBookAndCopy(repo, barcode, lookupIsbn);
          if (!result) throw new HttpError(404, `Khong tim thay sach voi ma vach ${barcode} hoac ISBN ${lookupIsbn}`);
          book = result.book;
          copy = result.copy;
        } else if (!copy) {
          copy = await repo.getAvailableCopy(book.id);
          if (!copy) throw new HttpError(409, `Sach ${book.title} da het ban co the muon`);
        }
      } else {
        copy = await repo.getCopyByBarcode(barcode);
        if (!copy) throw new HttpError(404, `Khong tim thay ban sao voi ma vach ${barcode}`);
        book = copy.book || await repo.getBookById(copy.bookId);
        if (!book) throw new HttpError(404, 'Khong tim thay sach');
        if (!copy.isAvailable) throw new HttpError(409, `Ban sao ${barcode} dang duoc muon`);
      }

      if (!book || !copy) throw new HttpError(404, 'Khong tim thay sach');

      const active = await repo.getActiveBorrow(body.patron_id, book.id);
      if (active) throw new HttpError(409, `Sach "${book.title}" da duoc doc gia nay muon`);

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await repo.getOverdueBorrows(body.patron_id);
    if (overdue.length) throw new HttpError(409, 'Doc gia co sach qua han. Vui long tra sach truoc khi muon them.');

    const activeCount = await repo.countActiveBorrows(body.patron_id);
    if (activeCount + bookIds.length > config.maxBorrowBooks) throw new HttpError(409, `Qua gioi han muon sach (toi da ${config.maxBorrowBooks} cuon)`);
    if (bookIds.length > config.maxBorrowBooksPerSlip) throw new HttpError(409, `Moi phieu muon toi da ${config.maxBorrowBooksPerSlip} cuon`);

    const validCopyIds = copyIds.filter((id): id is string => id !== null);
    const allCopies = validCopyIds.length > 0 ? await repo.copies.find({ where: { id: In(validCopyIds) } }) : [];
    const copiesMap = new Map(allCopies.map(c => [c.id, c]));
    const copiesToUpdate = validCopyIds.map(id => copiesMap.get(id)).filter(Boolean) as BookCopy[];
    for (const copy of copiesToUpdate) {
      copy.isAvailable = false;
      copy.updatedAt = new Date();
    }
    if (copiesToUpdate.length > 0) {
      await repo.copies.save(copiesToUpdate);
    }

    const { slip, records } = await repo.createSlip(body.patron_id, bookIds, copyIds, shelfLocations, req.user?.id, req.user?.email, body.note);

    const recordBookIds = records.map(r => r.bookId);
    const recordCopyIds = records.filter(r => r.copyId).map(r => r.copyId!);

    const [recordBooks, recordCopies] = await Promise.all([
      repo.books.find({ where: { id: In(recordBookIds) } }),
      recordCopyIds.length > 0 ? repo.copies.find({ where: { id: In(recordCopyIds) } }) : [],
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

    res.json({
      status: 'success',
      message: `Tao phieu muon thanh cong voi ${records.length} cuon. Han tra: ${slip.dueAt.toLocaleDateString('vi-VN')}.`,
      slip: { ...serializeBorrowSlip(slip), records: records.map(serializeBorrowRecord) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /staff-return
router.post('/return', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra sach'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ barcode: z.string().min(1), note: z.string().nullable().optional() }).parse(req.body);
    const repo = new BorrowRepository();
    const copy = await repo.getCopyByBarcode(body.barcode.trim());
    if (!copy) throw new HttpError(404, `Khong tim thay ban sao nao voi ma vach ${body.barcode}`);
    const record = await repo.getActiveBorrowByCopy(copy.id);
    if (!record) throw new HttpError(404, 'Khong co ban ghi muon dang hoat dong cho ban sao nay');
    await repo.returnBook(record, req.user?.id, req.user?.email, 'staff_web', body.note);
    await repo.setCopyAvailable(copy, true);

    publishEvent('book.returned', {
      bookId: record.bookId,
      title: record.book?.title,
      patronId: record.patronId,
      barcode: copy.barcode,
      fineAmount: record.fineAmount || 0,
    });

    res.json({ status: 'success', message: 'Tra sach thanh cong', record: serializeBorrowRecord(record) });
  } catch (error) {
    next(error);
  }
});

// POST /staff-return/by-patron
router.post('/return/by-patron', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra sach'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ student_code: z.string().min(1), barcode_or_isbn: z.string().min(1), note: z.string().nullable().optional() }).parse(req.body);
    const patron = patronSummary(await lookupPatronByStudentCode(body.student_code));
    const repo = new BorrowRepository();
    const rawScanned = body.barcode_or_isbn.trim();
    const scanned = normalizeBookCode(rawScanned);
    let book = await repo.getBookByNormalizedIsbn(scanned);
    const legacyCopy = !book ? await repo.getCopyByBarcode(rawScanned) : null;
    if (!book && legacyCopy) book = legacyCopy.book || await repo.getBookById(legacyCopy.bookId);
    if (!book) throw new HttpError(404, 'Khong tim thay sach voi ma vua quet');
    const records = await repo.getActiveBorrowsByPatronAndBook(patron.id, book.id);
    if (!records.length) throw new HttpError(404, 'Doc gia nay khong muon sach co ma nay');
    if (records.length > 1) throw new HttpError(409, 'Co nhieu ban ghi muon trung sach. Vui long chon ban ghi thu cong hoac dung barcode ban sao.');
    const record = records[0];
    const copy = legacyCopy || (record.copyId ? await repo.getCopyById(record.copyId) : null);
    await repo.returnBook(record, req.user?.id, req.user?.email, 'staff_mobile', body.note);
    if (copy) await repo.setCopyAvailable(copy, true);

    publishEvent('book.returned', {
      bookId: book.id,
      title: book.title,
      patronId: patron.id,
      barcode: copy?.barcode,
      fineAmount: record.fineAmount || 0,
    });

    res.json({ status: 'success', message: 'Tra sach thanh cong', record: serializeBorrowRecord(record) });
  } catch (error) {
    next(error);
  }
});

// POST /staff-return/batch
router.post('/return/batch', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra sach'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      student_code: z.string().min(1),
      items: z.array(z.object({
        barcode_or_isbn: z.string().min(1),
        note: z.string().nullable().optional(),
      })).min(1).max(50),
    }).parse(req.body);

    const patron = patronSummary(await lookupPatronByStudentCode(body.student_code));
    const repo = new BorrowRepository();
    const results: Array<{ barcode_or_isbn: string; status: string; message: string }> = [];
    let ok = 0;
    let fail = 0;

    for (const item of body.items) {
      const rawScanned = item.barcode_or_isbn.trim();
      const scanned = normalizeBookCode(rawScanned);
      try {
        let book = await repo.getBookByNormalizedIsbn(scanned);
        const legacyCopy = !book ? await repo.getCopyByBarcode(rawScanned) : null;
        if (!book && legacyCopy) book = legacyCopy.book || await repo.getBookById(legacyCopy.bookId);
        if (!book) {
          throw new HttpError(404, 'Khong tim thay sach voi ma vua quet');
        }
        const records = await repo.getActiveBorrowsByPatronAndBook(patron.id, book.id);
        if (!records.length) {
          throw new HttpError(404, 'Doc gia nay khong muon sach co ma nay');
        }
        if (records.length > 1) {
          throw new HttpError(409, 'Co nhieu ban ghi muon trung sach. Vui long chon ban ghi thu cong hoac dung barcode ban sao.');
        }
        const record = records[0];
        const copy = legacyCopy || (record.copyId ? await repo.getCopyById(record.copyId) : null);
        await repo.returnBook(record, req.user?.id, req.user?.email, 'staff_mobile', item.note || null);
        if (copy) await repo.setCopyAvailable(copy, true);

        publishEvent('book.returned', {
          bookId: book.id,
          title: book.title,
          patronId: patron.id,
          barcode: copy?.barcode,
          fineAmount: record.fineAmount || 0,
        });

        results.push({ barcode_or_isbn: item.barcode_or_isbn, status: 'success', message: 'Tra sach thanh cong' });
        ok += 1;
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : (err instanceof Error ? err.message : 'Loi khong xac dinh');
        results.push({ barcode_or_isbn: item.barcode_or_isbn, status: 'failed', message: msg });
        fail += 1;
      }
    }

    res.json({ results, ok, fail });
  } catch (error) {
    next(error);
  }
});

// POST /staff-return/record/:record_id
router.post('/return/record/:record_id', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra sach'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ note: z.string().nullable().optional() }).parse(req.body);
    const repo = new BorrowRepository();
    const record = await repo.getBorrowRecordById(req.params.record_id);
    if (!record) throw new HttpError(404, 'Khong tim thay phieu muon');
    if (record.status !== 'borrowed' || record.returnAt) throw new HttpError(409, 'Phieu muon nay da duoc tra hoac khong con hieu luc');
    const copy = record.copyId ? await repo.getCopyById(record.copyId) : null;
    await repo.returnBook(record, req.user?.id, req.user?.email, 'staff_web', body.note);
    if (copy) await repo.setCopyAvailable(copy, true);

    publishEvent('book.returned', {
      bookId: record.bookId,
      title: record.book?.title,
      patronId: record.patronId,
      barcode: copy?.barcode,
      fineAmount: record.fineAmount || 0,
    });

    res.json({ status: 'success', message: 'Tra sach thanh cong', record: serializeBorrowRecord(record) });
  } catch (error) {
    next(error);
  }
});

// GET /barcode/:barcode
router.get('/barcode/:barcode', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu tra sach'), async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const copy = await repo.getCopyByBarcode(req.params.barcode.trim());
    if (!copy) throw new HttpError(404, `Khong tim thay ban sao voi ma vach ${req.params.barcode}`);
    const record = await repo.getActiveBorrowByCopy(copy.id);
    if (!record) throw new HttpError(404, 'Ban sao nay hien khong duoc muon');
    res.json(serializeBorrowRecord(record));
  } catch (error) {
    next(error);
  }
});

// GET /active-borrowers
router.get('/active-borrowers', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem danh sach doc gia dang muon'), async (_req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const records = await repo.getAllActiveBorrows();
    const grouped = new Map<string, typeof records>();
    records.forEach((record) => grouped.set(record.patronId, [...(grouped.get(record.patronId) || []), record]));

    const patronIds = Array.from(grouped.keys());
    const patronMap = await lookupPatronsByIds(patronIds);

    const now = Date.now();
    const items = [];
    for (const [patronId, patronRecords] of grouped.entries()) {
      const patron = patronMap.get(patronId) || null;
      const summary = patron ? patronSummary(patron) : { id: patronId, full_name: null, student_code: patronId, email: null, card_number: null, current_status: null };
      items.push({
        patron: summary,
        total_borrowed: patronRecords.length,
        overdue_count: patronRecords.filter((record) => record.dueAt.getTime() < now).length,
        latest_borrow_at: new Date(Math.max(...patronRecords.map((record) => record.borrowAt.getTime()))),
        nearest_due_at: new Date(Math.min(...patronRecords.map((record) => record.dueAt.getTime()))),
      });
    }
    items.sort((a, b) => b.overdue_count - a.overdue_count || a.nearest_due_at.getTime() - b.nearest_due_at.getTime() || a.patron.student_code.localeCompare(b.patron.student_code));
    res.json({ items, total: items.length });
  } catch (error) {
    next(error);
  }
});

// GET /active
router.get('/active', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem danh sach muon'), async (req, res, next) => {
  try {
    const records = await new BorrowRepository().getAllActiveBorrows();
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

// GET /patrons/:student_code/active
router.get('/patrons/:student_code/active', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu sach dang muon'), async (req, res, next) => {
  try {
    const raw = await lookupPatronByStudentCode(req.params.student_code);
    const status = raw.current_status || raw.currentStatus;
    if (status && ['blocked', 'expelled', 'expired'].includes(status)) {
      throw new HttpError(403, 'The doc gia da bi khoa/het han. Vui long lien he thu vien.');
    }
    const patron = patronSummary(raw);
    const accessStatus = await getPatronRawAccessStatus(patron.id);
    if (!accessStatus.inside) {
      throw new HttpError(403, 'Doc gia chua vao thu vien.');
    }
    const repo = new BorrowRepository();
    const records = await repo.getActiveBorrowsByPatron(patron.id);
    const now = Date.now();
    res.json({ patron, records: records.map(serializeBorrowRecord), total: records.length, overdue_count: records.filter((record) => record.dueAt.getTime() < now).length });
  } catch (error) {
    next(error);
  }
});

// GET /patrons/:student_code/history
router.get('/patrons/:student_code/history', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu lich su muon sach'), async (req, res, next) => {
  try {
    const raw = await lookupPatronByStudentCode(req.params.student_code);
    const status = raw.current_status || raw.currentStatus;
    if (status && ['blocked', 'expelled', 'expired'].includes(status)) {
      throw new HttpError(403, 'The doc gia da bi khoa/het han. Vui long lien he thu vien.');
    }
    const patron = patronSummary(raw);
    const records = await new BorrowRepository().getBorrowsByPatron(patron.id, req.query.status_filter as string | undefined);
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

// GET /patrons/id/:patron_id/history
router.get('/patrons/id/:patron_id/history', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu lich su muon sach'), async (req, res, next) => {
  try {
    const records = await new BorrowRepository().getBorrowsByPatron(req.params.patron_id, req.query.status_filter as string | undefined);
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

// GET /stats
router.get('/stats', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem thong ke'), async (req, res, next) => {
  try {
    res.json(await new BorrowRepository().getStats());
  } catch (error) {
    next(error);
  }
});

export default router;
