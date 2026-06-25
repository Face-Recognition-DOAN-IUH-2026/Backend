import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { In } from 'typeorm';
import { AppDataSource } from '../data-source';
import { auth, AuthRequest, requireRole } from '../middlewares/auth';
import { HttpError } from '../middlewares/errorHandler';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { isPatronInside, getPatronAccessStatus, getPatronRawAccessStatus } from '../clients/AccessServiceClient';
import { fetchGoogleBooks } from '../clients/GoogleBooksClient';
import { lookupPatronById, lookupPatronByStudentCode, lookupPatronsByIds, PatronSummary } from '../clients/UserServiceClient';
import { serializeBook, serializeBookWithStats, serializeBorrowRecord, serializeBorrowSlip, serializeCopy } from '../services/serializers';
import { publishEvent } from '../utils/eventPublisher';
import { config } from '../config';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BorrowRecord } from '../entities/BorrowRecord';
import { BorrowSlip } from '../entities/BorrowSlip';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

function normalizeRowValue(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeIsbnCell(cell: ExcelJS.Cell) {
  const raw = cell.text || normalizeRowValue(cell.value);
  return raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.0+$/, '');
}

function normalizeBookCode(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/\.0+$/, '');
}

function parseExcelRows(buffer: Buffer) {
  return new Promise<Array<{ isbn: string; quantity: number; line: number }>>(async (resolve, reject) => {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];
      if (!ws || ws.rowCount < 2) throw new HttpError(400, 'File Excel trong hoac khong co du lieu');
      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell((cell, col) => { headers[col] = normalizeRowValue(cell.value).toUpperCase(); });
      const isbnCol = headers.findIndex((h) => !!h && h.includes('ISBN'));
      const qtyCol = headers.findIndex((h) => !!h && (h.includes('QUANTITY') || h.includes('QTY') || h.includes('SO LUONG') || h.includes('SỐ LƯỢNG')));
      if (isbnCol < 1 || qtyCol < 1) throw new HttpError(400, "File phai co cot 'ISBN' va 'Quantity'");
      const rows: Array<{ isbn: string; quantity: number; line: number }> = [];
      for (let line = 2; line <= ws.rowCount; line += 1) {
        const row = ws.getRow(line);
        const isbn = normalizeIsbnCell(row.getCell(isbnCol));
        if (!isbn || isbn === 'None') continue;
        const rawQty = normalizeRowValue(row.getCell(qtyCol).value);
        const quantity = Math.max(1, Number.isFinite(Number(rawQty)) ? Math.trunc(Number(rawQty)) : 1);
        rows.push({ isbn, quantity, line });
      }
      if (!rows.length) throw new HttpError(400, 'Khong co du lieu hop le');
      resolve(rows);
    } catch (error) {
      reject(error);
    }
  });
}

async function getOrCreateBookAndCopy(repo: BorrowRepository, barcode: string, isbn?: string) {
  const existingCopy = await repo.getCopyByBarcode(barcode);
  if (existingCopy) return { book: existingCopy.book || await repo.getBookById(existingCopy.bookId), copy: existingCopy };
  let book = isbn ? await repo.getBookByIsbn(isbn) : null;
  if (!book && isbn) {
    const meta = await fetchGoogleBooks(isbn);
    if (meta) book = await repo.createBook(isbn, meta.title, meta.author, meta.coverUrl);
  }
  if (!book) book = await repo.createBook(isbn || barcode, `Barcode ${barcode}`);
  const copy = await repo.createCopy(book.id, barcode, book.shelfLocation);
  return { book, copy };
}

const patronStatusMiddleware = requireRole(['patron', 'admin', 'staff'], 'Chi xem trang thai trong thu vien');
/**
 * @swagger
 * /borrow/patron/inside-status:
 *   get:
 *     summary: Get patron inside library status
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Patron access status
 */
router.get('/patron/inside-status', patronStatusMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const userId = patronIdFrom(req.user);
    const status = await getPatronAccessStatus(userId);
    res.json({
      inside: status.inside,
      last_entry_at: status.lastEntryAt,
      lastEntryAt: status.lastEntryAt,
      expires_at: status.expiresAt,
      expiresAt: status.expiresAt,
      is_expired: status.isExpired,
      isExpired: status.isExpired,
      source: status.source,
      max_entry_hours: config.maxEntryHours,
      maxEntryHours: config.maxEntryHours,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/:
 *   post:
 *     summary: Create a single borrow (barcode scan)
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode]
 *             properties:
 *               barcode:
 *                 type: string
 *               isbn:
 *                 type: string
 *     responses:
 *       200:
 *         description: Borrow successful
 */
router.post('/', requireRole(['admin', 'staff'], 'Chi nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ barcode: z.string().min(1), isbn: z.string().optional() }).parse(req.body);
    const userId = patronIdFrom(req.user);
    const accessStatus = await getPatronAccessStatus(userId);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phien lam viec da het han (${config.maxEntryHours}h). Vui long vao lai qua cong de muon sach.`);
      }
      throw new HttpError(403, 'Ban phai co mat trong thu vien de muon sach. Vui long quet the tai cua vao.');
    }
    const repo = new BorrowRepository();
    const barcode = body.barcode.trim();

    const { record, book } = await AppDataSource.transaction(async (manager) => {
      let book: Book | null | undefined;
      let copy: BookCopy | null | undefined;
      if (body.isbn || (/^\d+$/.test(barcode) && [10, 13].includes(barcode.length))) {
        const isbn = body.isbn || barcode;
        book = await repo.getBookByIsbn(isbn);
        if (!book) {
          throw new HttpError(404, 'Khong co sach nay trong thu vien');
        } else {
          copy = await repo.getAvailableCopy(book.id);
          if (!copy) throw new HttpError(409, 'Sach nay hien da het ban co the muon');
        }
      } else {
        copy = await repo.getCopyByBarcode(barcode);
        if (!copy) throw new HttpError(404, `Khong tim thay ban sao nao voi ma vach ${barcode}`);
        book = copy.book || await repo.getBookById(copy.bookId);
        if (!book) throw new HttpError(404, 'Khong tim thay sach');
        if (!copy.isAvailable) throw new HttpError(409, 'Ban sao nay hien dang duoc muon');
      }
      if (!book || !copy) throw new HttpError(404, 'Khong tim thay sach');
      if (await repo.getActiveBorrow(userId, book.id)) throw new HttpError(409, 'Sach nay ban dang muon');
      if ((await repo.getOverdueBorrows(userId)).length) throw new HttpError(409, 'Ban co sach qua han. Vui long tra sach truoc khi muon them.');
      if (await repo.countActiveBorrows(userId) >= config.maxBorrowBooks) throw new HttpError(409, `Da qua gioi han muon sach (toi da ${config.maxBorrowBooks} cuon)`);

      copy!.isAvailable = false;
      await manager.save(copy!);

      const record = await repo.createBorrowRecord(userId, book!.id, copy!.id, copy!.shelfLocation || book!.shelfLocation);
      record.book = book!;
      record.copy = copy!;
      return { record, book: book! };
    });

    publishEvent('book.borrowed', {
      bookId: book.id,
      title: book.title,
      patronId: userId,
      borrowRecordId: record.id,
      dueAt: record.dueAt,
    });

    res.json({ status: 'success', message: `Muon sach thanh cong. Vui long tra truoc ngay ${record.dueAt.toLocaleDateString('vi-VN')}.`, record: serializeBorrowRecord(record), book: serializeBook(book) });
  } catch (error) {
    next(error);
  }
});

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

/**
 * @swagger
 * /borrow/staff/slip/lookup:
 *   post:
 *     summary: Lookup items for slip creation
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [patron_id, items]
 *             properties:
 *               patron_id:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     barcode:
 *                       type: string
 *                     isbn:
 *                       type: string
 *     responses:
 *       200:
 *         description: Lookup results
 */
router.post('/staff/slip/lookup', requireRole(['admin', 'staff', 'patron'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
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

/**
 * @swagger
 * /borrow/staff/slip/confirm:
 *   post:
 *     summary: Confirm and create borrow slip
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [patron_id, items]
 *             properties:
 *               patron_id:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     barcode:
 *                       type: string
 *                     isbn:
 *                       type: string
 *                     book_id:
 *                       type: string
 *                       format: uuid
 *                     copy_id:
 *                       type: string
 *                       format: uuid
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Slip created successfully
 */
router.post('/staff/slip/confirm', requireRole(['admin', 'staff', 'patron'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
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

    // Batch load all copies and books at once instead of per item
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

    // Batch update copy availability
    const copiesToUpdate = copyIds.filter(id => id).map(id => copiesMap.get(id!)).filter(Boolean) as BookCopy[];
    for (const copy of copiesToUpdate) {
      copy.isAvailable = false;
      copy.updatedAt = new Date();
    }
    if (copiesToUpdate.length > 0) {
      await repo.copies.save(copiesToUpdate);
    }

    const { slip, records } = await repo.createSlip(body.patron_id, bookIds, copyIds, shelfLocations, req.user?.id, req.user?.email);

    // Batch load books and copies for records
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
      message: `Tao phieu muon thanh cong ${records.length} cuon sach`,
      slip: serializeBorrowSlip(slip),
      records: records.map(serializeBorrowRecord),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/barcode/{barcode}:
 *   get:
 *     summary: Get active borrow by barcode
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Borrow record
 */
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

/**
 * @swagger
 * /borrow/staff/active-borrowers:
 *   get:
 *     summary: List active borrowers grouped by patron
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active borrowers
 */
router.get('/staff/active-borrowers', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem danh sach doc gia dang muon'), async (_req, res, next) => {
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

/**
 * @swagger
 * /borrow/staff/patrons/{student_code}/active:
 *   get:
 *     summary: Get active borrows by student code
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: student_code
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Active borrows
 */
router.get('/staff/patrons/:student_code/active', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu sach dang muon'), async (req, res, next) => {
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

/**
 * @swagger
 * /borrow/staff/patrons/{student_code}/history:
 *   get:
 *     summary: Get borrow history by student code
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: student_code
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status_filter
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Borrow history
 */
router.get('/staff/patrons/:student_code/history', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu lich su muon sach'), async (req, res, next) => {
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

/**
 * @swagger
 * /borrow/staff/patrons/id/{patron_id}/history:
 *   get:
 *     summary: Get borrow history by patron ID
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: patron_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status_filter
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Borrow history
 */
router.get('/staff/patrons/id/:patron_id/history', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu lich su muon sach'), async (req, res, next) => {
  try {
    const records = await new BorrowRepository().getBorrowsByPatron(req.params.patron_id, req.query.status_filter as string | undefined);
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/staff/stats:
 *   get:
 *     summary: Get borrow statistics
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Borrow stats
 */
router.get('/staff/stats', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem thong ke'), async (req, res, next) => {
  try {
    res.json(await new BorrowRepository().getStats());
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/staff/active:
 *   get:
 *     summary: List all active borrows (flat list)
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active borrows
 */
router.get('/staff/active', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem danh sach muon'), async (req, res, next) => {
  try {
    const records = await new BorrowRepository().getAllActiveBorrows();
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/staff/slip/create:
 *   post:
 *     summary: Create borrow slip (staff web)
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [patron_id, items]
 *             properties:
 *               patron_id:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     barcode:
 *                       type: string
 *                     isbn:
 *                       type: string
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Slip created
 */
router.post('/staff/slip/create', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
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
          const { book: newBook, copy: newCopy } = await getOrCreateBookAndCopy(repo, barcode, lookupIsbn);
          book = newBook;
          copy = newCopy;
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

    for (const copyId of copyIds) {
      if (copyId) {
        const copy = await repo.getCopyById(copyId);
        if (copy) await repo.setCopyAvailable(copy, false);
      }
    }

    const { slip, records } = await repo.createSlip(body.patron_id, bookIds, copyIds, shelfLocations, req.user?.id, req.user?.email, body.note);

    for (let i = 0; i < records.length; i += 1) {
      records[i].book = (await repo.getBookById(bookIds[i]))!;
      records[i].copy = copyIds[i] ? await repo.getCopyById(copyIds[i]!) : null;
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

/**
 * @swagger
 * /borrow/staff-return/by-patron:
 *   post:
 *     summary: Return book by student code
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [student_code, barcode_or_isbn]
 *             properties:
 *               student_code:
 *                 type: string
 *               barcode_or_isbn:
 *                 type: string
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Return successful
 */
router.post('/staff-return/by-patron', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra sach'), async (req: AuthRequest, res, next) => {
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

/**
 * @swagger
 * /borrow/staff-return/batch:
 *   post:
 *     summary: Batch return books
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [student_code, items]
 *             properties:
 *               student_code:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     barcode_or_isbn:
 *                       type: string
 *                     note:
 *                       type: string
 *                       nullable: true
 *     responses:
 *       200:
 *         description: Batch return results
 */
router.post('/staff-return/batch', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra sach'), async (req: AuthRequest, res, next) => {
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

/**
 * @swagger
 * /borrow/staff-return/record/{record_id}:
 *   post:
 *     summary: Return specific borrow record
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: record_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Return successful
 */
router.post('/staff-return/record/:record_id', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra sach'), async (req: AuthRequest, res, next) => {
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

/**
 * @swagger
 * /borrow/staff-return:
 *   post:
 *     summary: Return book by barcode
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode]
 *             properties:
 *               barcode:
 *                 type: string
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Return successful
 */
router.post('/staff-return', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra sach'), async (req: AuthRequest, res, next) => {
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

/**
 * @swagger
 * /borrow/history:
 *   get:
 *     summary: Get patron borrow history
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status_filter
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Borrow history
 */
router.get('/history', async (req: AuthRequest, res, next) => {
  try {
    const records = await new BorrowRepository().getBorrowsByPatron(patronIdFrom(req.user), req.query.status_filter as string | undefined);
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/patron/active:
 *   get:
 *     summary: Get patron active borrows
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active borrows with patron info
 */
router.get('/patron/active', async (req: AuthRequest, res, next) => {
  try {
    const patronId = patronIdFrom(req.user);
    const raw = await lookupPatronById(patronId);
    const patron = patronSummary(raw!);
    const repo = new BorrowRepository();
    const records = await repo.getActiveBorrowsByPatron(patronId);
    const now = Date.now();
    res.json({
      patron,
      records: records.map(serializeBorrowRecord),
      total: records.length,
      overdue_count: records.filter(r => r.dueAt.getTime() < now).length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/book/{isbn}:
 *   get:
 *     summary: Get book by ISBN
 *     tags: [Borrow]
 *     parameters:
 *       - in: path
 *         name: isbn
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Book with stats
 */
router.get('/book/:isbn', async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    let book = await repo.getBookByIsbn(req.params.isbn.trim());
    if (!book) {
      const meta = await fetchGoogleBooks(req.params.isbn);
      if (!meta) throw new HttpError(404, 'Khong tim thay sach');
      book = await repo.createBook(req.params.isbn, meta.title, meta.author, meta.coverUrl);
    }
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    res.json(serializeBookWithStats(book, total, available));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books:
 *   get:
 *     summary: List books with pagination
 *     tags: [Borrow]
 *     parameters:
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated book list
 */
router.get('/books', async (req, res, next) => {
  try {
    const skip = Number(req.query.skip || 0);
    const limit = Number(req.query.limit || 20);
    const search = req.query.search as string | undefined;
    const { items, total, stats } = await new BorrowRepository().listBooks(skip, limit, search);
    res.json({ items: items.map((book) => { const stat = stats.get(book.id) || { total: 0, available: 0 }; return serializeBookWithStats(book, stat.total, stat.available); }), total, skip, limit });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books/search:
 *   get:
 *     summary: Search books by query
 *     tags: [Borrow]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/books/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    if (!q) throw new HttpError(400, 'q is required');
    const { items, stats } = await new BorrowRepository().listBooks(0, 20, q);
    res.json(items.map((book) => { const stat = stats.get(book.id) || { total: 0, available: 0 }; return serializeBookWithStats(book, stat.total, stat.available); }));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books/template:
 *   get:
 *     summary: Download book import Excel template
 *     tags: [Borrow]
 *     responses:
 *       200:
 *         description: Excel file
 */
router.get('/books/template', async (_req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Books Import');
    ws.addRow(['ISBN', 'Quantity']);
    ws.addRow(['9780544003415', 2]);
    ws.addRow(['9780439708180', 3]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=book_import_template.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books/export:
 *   get:
 *     summary: Export all books to Excel
 *     tags: [Borrow]
 *     responses:
 *       200:
 *         description: Excel file
 */
router.get('/books/export', async (_req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const { items } = await repo.listBooks(0, 10000);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Books');
    ws.addRow(['ISBN', 'Title', 'Author', 'Total Copies', 'Available Copies', 'Shelf Location', 'Created At']);

    // Batch load all copy counts at once
    const bookIds = items.map(b => b.id);
    const copyCounts = await repo.getCopyCountsByBookIds(bookIds);

    for (const book of items) {
      const counts = copyCounts.get(book.id) || { total: 0, available: 0 };
      ws.addRow([book.isbn, book.title, book.author || '', counts.total, counts.available, book.shelfLocation || '', book.createdAt?.toISOString?.() || '']);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=books_export.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books/import/preview:
 *   post:
 *     summary: Preview book import from Excel
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Import preview
 */
router.post('/books/import/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'Chi ho tro file Excel (.xlsx, .xls)');
    const rows = (await parseExcelRows(req.file.buffer)).slice(0, 100);
    const repo = new BorrowRepository();
    const existing = await repo.getBooksByIsbns(rows.map((row) => row.isbn));
    const offsets = await repo.getBarcodeOffsetsByBooks([...existing.keys()]);
    const preview = [];
    for (const row of rows) {
      const book = existing.get(row.isbn);
      const meta = book ? null : await fetchGoogleBooks(row.isbn);
      const offset = offsets.get(row.isbn) || 0;
      preview.push({
        isbn: row.isbn,
        quantity: row.quantity,
        title: book?.title || meta?.title || `ISBN: ${row.isbn}`,
        subtitle: book?.subtitle || meta?.subtitle || null,
        author: book?.author || meta?.author || null,
        publisher: book?.publisher || meta?.publisher || null,
        published_date: book?.publishedDate || meta?.publishedDate || null,
        page_count: book?.pageCount || meta?.pageCount || null,
        categories: book?.categories || meta?.categories || null,
        cover_url: book?.coverUrl || meta?.coverUrl || null,
        description: book?.description || meta?.description || null,
        average_rating: book?.averageRating ?? meta?.averageRating ?? null,
        language: book?.language || meta?.language || null,
        isbn10: book?.isbn10 || meta?.isbn10 || null,
        isbn13: book?.isbn13 || meta?.isbn13 || null,
        barcodes: Array.from({ length: row.quantity }, (_, i) => `LIB-${row.isbn}-${String(offset + i + 1).padStart(3, '0')}`),
        status: book ? 'exists' : meta ? 'new' : 'warning',
        message: !book && !meta ? 'Khong co metadata tu Google Books' : null,
      });
    }
    res.json({ rows: preview, total_rows: preview.length, valid_rows: preview.length, invalid_rows: 0 });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books/import:
 *   post:
 *     summary: Import books from Excel
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Import results
 */
router.post('/books/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'Chi ho tro file Excel (.xlsx, .xls)');
    const rows = await parseExcelRows(req.file.buffer);
    const repo = new BorrowRepository();
    const existing = await repo.getBooksByIsbns(rows.map((row) => row.isbn));
    const offsets = await repo.getBarcodeOffsetsByBooks([...existing.keys()]);
    const results = [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        let book = existing.get(row.isbn);
        let created = false;
        let noMeta = false;
        if (!book) {
          const meta = await fetchGoogleBooks(row.isbn);
          noMeta = !meta;
          const upserted = await repo.upsertBook(row.isbn, meta?.title || `ISBN: ${row.isbn}`, meta?.author, meta?.coverUrl, meta ? {
            subtitle: meta.subtitle ?? null,
            publisher: meta.publisher ?? null,
            publishedDate: meta.publishedDate ?? null,
            description: meta.description ?? null,
            pageCount: meta.pageCount ?? null,
            categories: meta.categories ?? null,
            averageRating: meta.averageRating ?? null,
            language: meta.language ?? null,
            isbn10: meta.isbn10 ?? null,
            isbn13: meta.isbn13 ?? null,
          } : undefined);
          book = upserted.book;
          created = upserted.created;
          existing.set(row.isbn, book);
          offsets.set(row.isbn, 0);
        }
        const offset = offsets.get(row.isbn) || 0;
        const barcodes = Array.from({ length: row.quantity }, (_, i) => `LIB-${row.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
        offsets.set(row.isbn, offset + row.quantity);
        const copies = await repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
        const status = created ? (noMeta ? 'warning' : 'imported') : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: row.isbn, title: book.title, quantity: row.quantity, barcodes, status, message: `Them ${copies.length} ban sao${noMeta ? ' (khong co metadata tu OpenLibrary)' : ''}` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: row.isbn, title: '', quantity: row.quantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    res.json({ success: errors === 0, total_rows: rows.length, imported, skipped, errors, results });
  } catch (error) {
    next(error);
  }
});

const ImportFilteredRowSchema = z.object({
  isbn: z.string(),
  quantity: z.number().int().positive(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  published_date: z.string().nullable().optional(),
  page_count: z.number().int().nullable().optional(),
  categories: z.string().nullable().optional(),
  cover_url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  average_rating: z.number().nullable().optional(),
  language: z.string().nullable().optional(),
  isbn10: z.string().nullable().optional(),
  isbn13: z.string().nullable().optional(),
});

/**
 * @swagger
 * /borrow/books/import/filtered:
 *   post:
 *     summary: Import books with metadata (filtered)
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rows]
 *             properties:
 *               rows:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     isbn:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *                     title:
 *                       type: string
 *                     author:
 *                       type: string
 *     responses:
 *       200:
 *         description: Import results
 */
router.post('/books/import/filtered', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the nhap sach'), async (req: AuthRequest, res, next) => {
  try {
    const { rows } = z.object({ rows: z.array(ImportFilteredRowSchema) }).parse(req.body);
    if (!rows.length) throw new HttpError(400, 'Khong co du lieu de import');
    const repo = new BorrowRepository();
    const isbns = rows.map((r) => r.isbn);
    const existing = await repo.getBooksByIsbns(isbns);
    const offsets = await repo.getBarcodeOffsetsByBooks(isbns);
    const results = [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        let book = existing.get(row.isbn);
        let created = false;
        if (!book) {
          const title = row.title || `ISBN: ${row.isbn}`;
          const author = row.author || null;
          const coverUrl = row.cover_url || null;
          const upserted = await repo.upsertBook(row.isbn, title, author, coverUrl, {
            subtitle: row.subtitle ?? null,
            publisher: row.publisher ?? null,
            publishedDate: row.published_date ?? null,
            description: row.description ?? null,
            pageCount: row.page_count ?? null,
            categories: row.categories ?? null,
            averageRating: row.average_rating ?? null,
            language: row.language ?? null,
            isbn10: row.isbn10 ?? null,
            isbn13: row.isbn13 ?? null,
          });
          book = upserted.book;
          created = upserted.created;
          existing.set(row.isbn, book);
          offsets.set(row.isbn, 0);
        }
        const offset = offsets.get(row.isbn) || 0;
        const barcodes = Array.from({ length: row.quantity }, (_, i) => `LIB-${row.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
        offsets.set(row.isbn, offset + row.quantity);
        const copies = await repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
        const status = created ? 'imported' : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: row.isbn, title: book.title, quantity: row.quantity, barcodes, status, message: `Them ${copies.length} ban sao` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: row.isbn, title: '', quantity: row.quantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    res.json({ success: errors === 0, total_rows: rows.length, imported, skipped, errors, results });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/isbn-import/batch:
 *   post:
 *     summary: Batch import books by ISBN
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     isbn:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Import results
 */
router.post('/isbn-import/batch', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the nhap sach qua ISBN'), async (req: AuthRequest, res, next) => {
  try {
    const { items } = z.object({
      items: z.array(z.object({ isbn: z.string().min(1), quantity: z.number().int().min(1) })).min(1).max(50),
    }).parse(req.body);

    const repo = new BorrowRepository();
    const isbns = items.map((item) => item.isbn);
    const existing = await repo.getBooksByIsbns(isbns);
    const offsets = await repo.getBarcodeOffsetsByBooks([...existing.keys()]);
    const results = [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of items) {
      try {
        let book = existing.get(item.isbn);
        let created = false;
        let noMeta = false;
        if (!book) {
          const meta = await fetchGoogleBooks(item.isbn);
          noMeta = !meta;
          const upserted = await repo.upsertBook(item.isbn, meta?.title || `ISBN: ${item.isbn}`, meta?.author, meta?.coverUrl, meta ? {
            subtitle: meta.subtitle ?? null,
            publisher: meta.publisher ?? null,
            publishedDate: meta.publishedDate ?? null,
            description: meta.description ?? null,
            pageCount: meta.pageCount ?? null,
            categories: meta.categories ?? null,
            averageRating: meta.averageRating ?? null,
            language: meta.language ?? null,
            isbn10: meta.isbn10 ?? null,
            isbn13: meta.isbn13 ?? null,
          } : undefined);
          book = upserted.book;
          created = upserted.created;
          existing.set(item.isbn, book);
          offsets.set(item.isbn, 0);
        }
        const offset = offsets.get(item.isbn) || 0;
        const barcodes = Array.from({ length: item.quantity }, (_, i) => `LIB-${item.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
        offsets.set(item.isbn, offset + item.quantity);
        const copies = await repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
        const status = created ? (noMeta ? 'warning' : 'imported') : copies.length ? 'updated' : 'skipped';
        if (status === 'skipped') skipped += 1; else imported += 1;
        results.push({ isbn: item.isbn, title: book.title, quantity: item.quantity, barcodes, status, message: `Them ${copies.length} ban sao${noMeta ? ' (khong co metadata tu OpenLibrary)' : ''}` });
      } catch (error) {
        errors += 1;
        results.push({ isbn: item.isbn, title: '', quantity: item.quantity, barcodes: [], status: 'error', message: error instanceof Error ? error.message : 'Loi import' });
      }
    }
    res.json({ success: errors === 0, total_rows: items.length, imported, skipped, errors, results });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/barcodes:
 *   get:
 *     summary: List recent barcodes
 *     tags: [Borrow]
 *     parameters:
 *       - in: query
 *         name: book_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: available_only
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *     responses:
 *       200:
 *         description: List of barcodes
 */
router.get('/barcodes', async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const qb = repo.copies.createQueryBuilder('copy').orderBy('copy.createdAt', 'DESC').limit(200);
    if (req.query.book_id) qb.andWhere('copy.bookId = :bookId', { bookId: req.query.book_id });
    if (String(req.query.available_only || 'false') === 'true') qb.andWhere('copy.isAvailable = true');
    const copies = await qb.getMany();
    res.json(copies.map(serializeCopy));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books/delete:
 *   post:
 *     summary: Bulk delete books
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [book_ids]
 *             properties:
 *               book_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Delete results
 */
router.post('/books/delete', requireRole(['admin'], 'Chi quan tri vien moi co the xoa sach'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ book_ids: z.array(z.string().uuid()) }).parse(req.body);
    if (body.book_ids.length > 50) throw new HttpError(400, 'Toi da 50 sach mot lan');
    const repo = new BorrowRepository();
    const result = await repo.bulkDeleteBooks(body.book_ids);
    res.json({ ...result, success: result.deleted > 0 && result.errors.length === 0 });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books/{book_id}:
 *   get:
 *     summary: Get book by ID
 *     tags: [Borrow]
 *     parameters:
 *       - in: path
 *         name: book_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Book with stats
 */
router.get('/books/:book_id', async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const book = await repo.getBookById(req.params.book_id);
    if (!book) throw new HttpError(404, 'Sach khong ton tai');
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    res.json(serializeBookWithStats(book, total, available));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/books/{book_id}/quantity:
 *   put:
 *     summary: Update book copy quantity
 *     tags: [Borrow]
 *     parameters:
 *       - in: path
 *         name: book_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Updated book with stats
 */
router.put('/books/:book_id/quantity', async (req, res, next) => {
  try {
    const { quantity } = z.object({ quantity: z.number().int() }).parse(req.body);
    const repo = new BorrowRepository();
    const book = await repo.getBookById(req.params.book_id);
    if (!book) throw new HttpError(404, 'Khong tim thay sach');
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    const borrowed = total - available;
    if (quantity < 1) throw new HttpError(400, 'So luong phai lon hon 0');
    if (quantity < borrowed) throw new HttpError(400, `Chi co the giam xuong toi thieu ${borrowed} ban (${borrowed} ban dang duoc muon)`);
    if (quantity > total) {
      const offset = await repo.getMaxBarcodeNumberForBook(book);
      const barcodes = Array.from({ length: quantity - total }, (_, i) => `LIB-${book.isbn}-${String(offset + i + 1).padStart(3, '0')}`);
      await repo.createCopiesBatchWithSkip(book.id, barcodes, book.shelfLocation);
    } else if (quantity < total) {
      const copies = await repo.getAvailableCopiesByBarcodeDesc(book.id);
      await repo.deleteCopies(copies.slice(0, total - quantity));
    }
    const nextTotal = await repo.countCopies(book.id);
    const nextAvailable = await repo.countCopies(book.id, true);
    res.json(serializeBookWithStats(book, nextTotal, nextAvailable));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/reserve:
 *   post:
 *     summary: Reserve a book
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [book_id]
 *             properties:
 *               book_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Reservation created
 */
router.post('/reserve', auth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ book_id: z.string().uuid() }).parse(req.body);
    const userId = patronIdFrom(req.user);
    const repo = new BorrowRepository();
    const book = await repo.getBookById(body.book_id);
    if (!book) throw new HttpError(404, 'Khong tim thay sach');

    const availableCopies = await repo.countCopies(book.id, true);
    if (availableCopies > 0) {
      throw new HttpError(409, 'Sach nay con ban, ban co the muon truc tiep');
    }

    const reservationRepo = AppDataSource.getRepository('BookReservation');
    const existing = await reservationRepo.findOne({
      where: { patronId: userId, bookId: book.id, status: 'pending' },
    });
    if (existing) throw new HttpError(409, 'Ban da dat sach nay roi');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + config.reservationExpiryHours);

    const reservation = reservationRepo.create({
      patronId: userId,
      bookId: book.id,
      expiresAt,
      status: 'pending',
    });
    await reservationRepo.save(reservation);

    const queuePosition = await reservationRepo.count({ where: { bookId: book.id, status: 'pending' as any } });
    res.json({
      status: 'success',
      message: `Dat sach thanh cong. Hang doi: #${queuePosition}. Sach se duoc giu ${config.reservationExpiryHours} gio.`,
      reservation,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/reservations:
 *   get:
 *     summary: Get patron reservations
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of reservations
 */
router.get('/reservations', auth, async (req: AuthRequest, res, next) => {
  try {
    const userId = patronIdFrom(req.user);
    const reservationRepo = AppDataSource.getRepository('BookReservation');
    const reservations = await reservationRepo.find({
      where: { patronId: userId, status: 'pending' as any },
      relations: { book: true },
      order: { reservedAt: 'ASC' },
    });
    res.json({ items: reservations, total: reservations.length });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/reservations/{id}:
 *   delete:
 *     summary: Cancel a reservation
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Reservation cancelled
 */
router.delete('/reservations/:id', auth, async (req: AuthRequest, res, next) => {
  try {
    const userId = patronIdFrom(req.user);
    const reservationRepo = AppDataSource.getRepository('BookReservation');
    const reservation = await reservationRepo.findOne({
      where: { id: req.params.id, patronId: userId },
    });
    if (!reservation) throw new HttpError(404, 'Khong tim thay dat hang');
    await reservationRepo.remove(reservation);
    res.json({ status: 'success', message: 'Huy dat hang thanh cong' });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /borrow/renew:
 *   post:
 *     summary: Renew a borrow
 *     tags: [Borrow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [record_id]
 *             properties:
 *               record_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Renewal successful
 */
router.post('/renew', auth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ record_id: z.string().uuid() }).parse(req.body);
    const userId = patronIdFrom(req.user);

    const record = await AppDataSource.getRepository(BorrowRecord).findOne({
      where: { id: body.record_id, patronId: userId, status: 'borrowed' as any },
      relations: { book: true, copy: true },
    });
    if (!record) throw new HttpError(404, 'Khong tim thay phieu muon');
    if (record.status !== 'borrowed') throw new HttpError(409, 'Phieu muon nay da het hieu luc');
    if (record.renewalCount >= config.maxRenewals) {
      throw new HttpError(409, `Da dat gioi han gia han toi da ${config.maxRenewals} lan`);
    }

    const now = new Date();
    if (now > new Date(record.dueAt)) {
      throw new HttpError(409, 'Khong the gia han sach qua han. Vui long tra sach va muon lai.');
    }

    const newDueAt = new Date(record.dueAt);
    newDueAt.setDate(newDueAt.getDate() + config.maxBorrowDays);
    record.dueAt = newDueAt;
    record.renewalCount += 1;
    await AppDataSource.getRepository(BorrowRecord).save(record);

    res.json({
      status: 'success',
      message: `Gia han thanh cong. Han tra moi: ${newDueAt.toLocaleDateString('vi-VN')}`,
      record: serializeBorrowRecord(record),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
