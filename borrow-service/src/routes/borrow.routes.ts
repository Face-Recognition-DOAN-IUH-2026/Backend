import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { AppDataSource } from '../data-source';
import { auth, AuthRequest, requireRole } from '../middlewares/auth';
import { HttpError } from '../middlewares/errorHandler';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { isPatronInside } from '../clients/AccessServiceClient';
import { fetchOpenLibrary } from '../clients/OpenLibraryClient';
import { lookupPatronById, lookupPatronByStudentCode, PatronSummary } from '../clients/UserServiceClient';
import { serializeBook, serializeBookWithStats, serializeBorrowRecord, serializeBorrowSlip, serializeCopy } from '../services/serializers';
import { config } from '../config';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
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
    const meta = await fetchOpenLibrary(isbn);
    if (meta) book = await repo.createBook(isbn, meta.title, meta.author, meta.cover_url);
  }
  if (!book) book = await repo.createBook(isbn || barcode, `Barcode ${barcode}`);
  const copy = await repo.createCopy(book.id, barcode, book.shelfLocation);
  return { book, copy };
}

router.post('/', requireRole(['patron'], 'Chi doc gia moi co the tu muon sach tren ung dung'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ barcode: z.string().min(1), isbn: z.string().optional() }).parse(req.body);
    const userId = patronIdFrom(req.user);
    if (!await isPatronInside(userId)) {
      throw new HttpError(403, 'Ban phai co mat trong thu vien de muon sach. Vui long quet the tai cua vao.');
    }
    const repo = new BorrowRepository();
    const barcode = body.barcode.trim();
    let book: Book | null | undefined;
    let copy: BookCopy | null | undefined;
    if (body.isbn || (/^\d+$/.test(barcode) && [10, 13].includes(barcode.length))) {
      const isbn = body.isbn || barcode;
      book = await repo.getBookByIsbn(isbn);
      if (!book) {
        ({ book, copy } = await getOrCreateBookAndCopy(repo, barcode, isbn));
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
    await repo.setCopyAvailable(copy, false);
    const record = await repo.createBorrowRecord(userId, book.id, copy.id, copy.shelfLocation || book.shelfLocation);
    record.book = book;
    record.copy = copy;
    res.json({ status: 'success', message: `Muon sach thanh cong. Vui long tra truoc ngay ${record.dueAt.toLocaleDateString('vi-VN')}.`, record: serializeBorrowRecord(record), book: serializeBook(book) });
  } catch (error) {
    next(error);
  }
});

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

router.get('/staff/active-borrowers', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem danh sach doc gia dang muon'), async (_req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const records = await repo.getAllActiveBorrows();
    const grouped = new Map<string, typeof records>();
    records.forEach((record) => grouped.set(record.patronId, [...(grouped.get(record.patronId) || []), record]));
    const now = Date.now();
    const items = [];
    for (const [patronId, patronRecords] of grouped.entries()) {
      const patron = await lookupPatronById(patronId);
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

router.get('/staff/patrons/:student_code/active', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu sach dang muon'), async (req, res, next) => {
  try {
    const raw = await lookupPatronByStudentCode(req.params.student_code);
    const status = raw.current_status || raw.currentStatus;
    if (status && ['blocked', 'expelled', 'expired'].includes(status)) {
      throw new HttpError(403, 'The doc gia da bi khoa/het han. Vui long lien he thu vien.');
    }
    const patron = patronSummary(raw);
    const repo = new BorrowRepository();
    const records = await repo.getActiveBorrowsByPatron(patron.id);
    const now = Date.now();
    res.json({ patron, records: records.map(serializeBorrowRecord), total: records.length, overdue_count: records.filter((record) => record.dueAt.getTime() < now).length });
  } catch (error) {
    next(error);
  }
});

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

router.get('/staff/patrons/id/:patron_id/history', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu lich su muon sach'), async (req, res, next) => {
  try {
    const records = await new BorrowRepository().getBorrowsByPatron(req.params.patron_id, req.query.status_filter as string | undefined);
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

router.get('/staff/stats', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem thong ke'), async (req, res, next) => {
  try {
    res.json(await new BorrowRepository().getStats());
  } catch (error) {
    next(error);
  }
});

router.get('/staff/active', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the xem danh sach muon'), async (req, res, next) => {
  try {
    const records = await new BorrowRepository().getAllActiveBorrows();
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

router.post('/staff/slip/create', requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string().min(1),
      items: z.array(z.object({
        barcode: z.string().min(1),
        isbn: z.string().optional(),
      })).min(1),
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

    const { slip, records } = await repo.createSlip(body.patron_id, bookIds, copyIds, shelfLocations, req.user?.id, req.user?.email);

    for (let i = 0; i < records.length; i += 1) {
      records[i].book = (await repo.getBookById(bookIds[i]))!;
      records[i].copy = copyIds[i] ? await repo.getCopyById(copyIds[i]!) : null;
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
    res.json({ status: 'success', message: 'Tra sach thanh cong', record: serializeBorrowRecord(record) });
  } catch (error) {
    next(error);
  }
});

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
    res.json({ status: 'success', message: 'Tra sach thanh cong', record: serializeBorrowRecord(record) });
  } catch (error) {
    next(error);
  }
});

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
    res.json({ status: 'success', message: 'Tra sach thanh cong', record: serializeBorrowRecord(record) });
  } catch (error) {
    next(error);
  }
});

router.get('/history', async (req: AuthRequest, res, next) => {
  try {
    const records = await new BorrowRepository().getBorrowsByPatron(patronIdFrom(req.user), req.query.status_filter as string | undefined);
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

router.get('/book/:isbn', async (req, res, next) => {
  try {
    const repo = new BorrowRepository();
    let book = await repo.getBookByIsbn(req.params.isbn.trim());
    if (!book) {
      const meta = await fetchOpenLibrary(req.params.isbn);
      if (!meta) throw new HttpError(404, 'Khong tim thay sach');
      book = await repo.createBook(req.params.isbn, meta.title, meta.author, meta.cover_url);
    }
    const total = await repo.countCopies(book.id);
    const available = await repo.countCopies(book.id, true);
    res.json(serializeBookWithStats(book, total, available));
  } catch (error) {
    next(error);
  }
});

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

router.get('/books/export', async (_req, res, next) => {
  try {
    const repo = new BorrowRepository();
    const { items } = await repo.listBooks(0, 10000);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Books');
    ws.addRow(['ISBN', 'Title', 'Author', 'Total Copies', 'Available Copies', 'Shelf Location', 'Created At']);
    for (const book of items) {
      ws.addRow([book.isbn, book.title, book.author || '', await repo.countCopies(book.id), await repo.countCopies(book.id, true), book.shelfLocation || '', book.createdAt?.toISOString?.() || '']);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=books_export.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

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
      const meta = book ? null : await fetchOpenLibrary(row.isbn);
      const offset = offsets.get(row.isbn) || 0;
      preview.push({
        isbn: row.isbn,
        quantity: row.quantity,
        title: book?.title || meta?.title || `ISBN: ${row.isbn}`,
        author: book?.author || meta?.author || null,
        cover_url: book?.coverUrl || meta?.cover_url || null,
        barcodes: Array.from({ length: row.quantity }, (_, i) => `LIB-${row.isbn}-${String(offset + i + 1).padStart(3, '0')}`),
        status: book ? 'exists' : meta ? 'new' : 'warning',
        message: !book && !meta ? 'Khong co metadata tu OpenLibrary' : null,
      });
    }
    res.json({ rows: preview, total_rows: preview.length, valid_rows: preview.length, invalid_rows: 0 });
  } catch (error) {
    next(error);
  }
});

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
          const meta = await fetchOpenLibrary(row.isbn);
          noMeta = !meta;
          const upserted = await repo.upsertBook(row.isbn, meta?.title || `ISBN: ${row.isbn}`, meta?.author, meta?.cover_url);
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
          const meta = await fetchOpenLibrary(item.isbn);
          noMeta = !meta;
          const upserted = await repo.upsertBook(item.isbn, meta?.title || `ISBN: ${item.isbn}`, meta?.author, meta?.cover_url);
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

export default router;
