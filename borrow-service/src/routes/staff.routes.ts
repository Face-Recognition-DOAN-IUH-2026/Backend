import { Router } from 'express';
import { z } from 'zod';
import { In } from 'typeorm';
import { auth, AuthRequest, requireRole, requireDynamicPermission } from '../middlewares/auth';
import { HttpError } from '../middlewares/errorHandler';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { isPatronInside, getPatronAccessStatus, getPatronRawAccessStatus } from '../clients/AccessServiceClient';
import { lookupPatronById, lookupPatronByStudentCode, lookupPatronsByIds, PatronSummary } from '../clients/UserServiceClient';
import { serializeBook, serializeBookWithStats, serializeBorrowRecord, serializeBorrowSlip, serializeCopy } from '../services/serializers';
import { publishEvent } from '../utils/eventPublisher';
import { config } from '../config';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { configService } from '../services/ConfigService';
import { ReturnService } from '../services/ReturnService';
import { SlipService } from '../services/SlipService';
import { CONDITION_CODES, markCopyAsBorrowed } from '../constants/copy';

const router = Router();
router.use(auth);

function patronIdFrom(user: AuthRequest['user']) {
  if (!user?.id) throw new HttpError(401, 'Invalid or expired token');
  return user.id;
}

function patronSummary(patron: PatronSummary) {
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

async function getOrCreateBookAndCopy(repo: BorrowRepository, barcode: string, isbn?: string) {
  const existingCopy = await repo.getCopyByBarcode(barcode);
  if (existingCopy) return { book: existingCopy.book || await repo.getBookById(existingCopy.bookId), copy: existingCopy };
  return null;
}

// POST /staff/slip/lookup
router.post(['/slip/lookup', '/staff/slip/lookup'], requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string().min(1),
      items: z.array(z.object({
        barcode: z.string().min(1),
        isbn: z.string().optional(),
      })).min(1),
    }).parse(req.body);

    const isStaff = req.user?.role === 'admin' || req.user?.role === 'staff';
    const slipService = new SlipService();
    const result = await slipService.lookup(body.patron_id, body.items, isStaff);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /staff/slip/confirm
router.post(['/slip/confirm', '/staff/slip/confirm'], requireDynamicPermission('borrows', 'create'), async (req: AuthRequest, res, next) => {
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
    if (!patron) throw new HttpError(404, 'Không tìm thấy độc giả');

    const isStaff = req.user?.role === 'admin' || req.user?.role === 'staff';
    const accessStatus = isStaff
      ? await getPatronRawAccessStatus(body.patron_id)
      : await getPatronAccessStatus(body.patron_id);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phiên làm việc đã hết hạn (${config.maxEntryHours}h). Vui lòng vào lại qua cổng.`);
      }
      throw new HttpError(403, 'Độc giả không có mặt trong thư viện.');
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
      if (!copy) throw new HttpError(400, `Bản sao ${item.copy_id} không tồn tại`);
      if (copy.bookId !== item.book_id) throw new HttpError(400, 'Dữ liệu không hợp lệ: copy_id không khớp với book_id');

      const book = booksMap.get(item.book_id);
      if (!book) throw new HttpError(400, `Sach ${item.book_id} không tồn tại`);

      if (!copy.isAvailable) throw new HttpError(409, `Bản sao ${item.barcode} dang duoc muon`);
      const normCopyBarcode = (copy.barcode || '').replace(/[\s-]+/g, '').toLowerCase();
      const normItemBarcode = (item.barcode || '').replace(/[\s-]+/g, '').toLowerCase();
      if (normCopyBarcode !== normItemBarcode) throw new HttpError(400, 'Dữ liệu không hợp lệ: barcode không khớp');

      const active = await repo.getActiveBorrow(body.patron_id, book.id);
      if (active) throw new HttpError(409, `Sach "${book.title}" đã được độc giả này mượn`);

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await repo.getOverdueBorrows(body.patron_id);
    if (overdue.length) throw new HttpError(409, 'Độc giả có sách quá hạn. Vui long tra sach truoc khi muon them.');

    const activeCount = await repo.countActiveBorrows(body.patron_id);
    const limits = await configService.getBorrowLimits();
    if (activeCount + bookIds.length > limits.maxBorrowBooks) throw new HttpError(409, `Qua gioi han muon sach (toi da ${limits.maxBorrowBooks} cuon)`);
    if (bookIds.length > limits.maxBorrowBooksPerSlip) throw new HttpError(409, `Moi phieu muon toi da ${limits.maxBorrowBooksPerSlip} cuon`);

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
router.post(['/slip/create', '/staff/slip/create'], requireDynamicPermission('borrows', 'create'), async (req: AuthRequest, res, next) => {
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
            if (!copy.isAvailable) throw new HttpError(409, `Bản sao ${barcode} dang duoc muon`);
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
        if (!copy.isAvailable) throw new HttpError(409, `Bản sao ${barcode} dang duoc muon`);
      }

      if (!book || !copy) throw new HttpError(404, 'Khong tim thay sach');

      const active = await repo.getActiveBorrow(body.patron_id, book.id);
      if (active) throw new HttpError(409, `Sach "${book.title}" đã được độc giả này mượn`);

      bookIds.push(book.id);
      copyIds.push(copy.id);
      shelfLocations.push(copy.shelfLocation || book.shelfLocation);
    }

    const overdue = await repo.getOverdueBorrows(body.patron_id);
    if (overdue.length) throw new HttpError(409, 'Độc giả có sách quá hạn. Vui long tra sach truoc khi muon them.');

    const activeCount = await repo.countActiveBorrows(body.patron_id);
    const limits = await configService.getBorrowLimits();
    if (activeCount + bookIds.length > limits.maxBorrowBooks) throw new HttpError(409, `Qua gioi han muon sach (toi da ${limits.maxBorrowBooks} cuon)`);
    if (bookIds.length > limits.maxBorrowBooksPerSlip) throw new HttpError(409, `Moi phieu muon toi da ${limits.maxBorrowBooksPerSlip} cuon`);

    const validCopyIds = copyIds.filter((id): id is string => id !== null);
    const allCopies = validCopyIds.length > 0 ? await repo.copies.find({ where: { id: In(validCopyIds) } }) : [];
    const copiesMap = new Map(allCopies.map(c => [c.id, c]));
    const copiesToUpdate = validCopyIds.map(id => copiesMap.get(id)).filter(Boolean) as BookCopy[];
    for (const copy of copiesToUpdate) {
      markCopyAsBorrowed(copy);
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
router.post(['/return', '/staff-return'], requireDynamicPermission('borrows', 'update'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      barcode: z.string().min(1),
      note: z.string().nullable().optional(),
      condition: z.enum(CONDITION_CODES).optional(),
      is_paid_immediately: z.boolean().optional(),
      payment_method: z.enum(['cash', 'qr_code']).optional(),
    }).parse(req.body);
    const record = await new ReturnService().returnByBarcode(body.barcode, req.user?.id, req.user?.email, body.note, body.condition, {
      isPaidImmediately: body.is_paid_immediately,
      paymentMethod: body.payment_method,
    });
    res.json({ status: 'success', message: 'Trả sách thành công', record });
  } catch (error) {
    next(error);
  }
});

// POST /staff-return/by-patron
router.post(['/return/by-patron', '/staff-return/by-patron'], requireDynamicPermission('borrows', 'update'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      student_code: z.string().min(1),
      barcode_or_isbn: z.string().min(1),
      note: z.string().nullable().optional(),
      condition: z.enum(CONDITION_CODES).optional(),
      is_paid_immediately: z.boolean().optional(),
      payment_method: z.enum(['cash', 'qr_code']).optional(),
    }).parse(req.body);
    const record = await new ReturnService().returnByPatron(
      body.student_code,
      body.barcode_or_isbn,
      req.user?.id,
      req.user?.email,
      body.note,
      body.condition,
      { isPaidImmediately: body.is_paid_immediately, paymentMethod: body.payment_method },
    );
    res.json({ status: 'success', message: 'Trả sách thành công', record });
  } catch (error) {
    next(error);
  }
});

// POST /staff-return/batch
router.post(['/return/batch', '/staff-return/batch'], requireDynamicPermission('borrows', 'update'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      student_code: z.string().min(1),
      items: z.array(z.object({
        barcode_or_isbn: z.string().min(1),
        note: z.string().nullable().optional(),
        condition: z.enum(CONDITION_CODES).optional(),
        is_paid_immediately: z.boolean().optional(),
        payment_method: z.enum(['cash', 'qr_code']).optional(),
      })).min(1).max(50),
    }).parse(req.body);

    res.json(await new ReturnService().batchReturn(body.student_code, body.items, req.user?.id, req.user?.email));
  } catch (error) {
    next(error);
  }
});

// POST /staff-return/record/:record_id
router.post(['/return/record/:record_id', '/staff-return/record/:record_id'], requireDynamicPermission('borrows', 'update'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      note: z.string().nullable().optional(),
      condition: z.enum(CONDITION_CODES).optional(),
      is_paid_immediately: z.boolean().optional(),
      payment_method: z.enum(['cash', 'qr_code']).optional(),
    }).parse(req.body);
    const record = await new ReturnService().returnById(req.params.record_id, req.user?.id, req.user?.email, body.note, body.condition, {
      isPaidImmediately: body.is_paid_immediately,
      paymentMethod: body.payment_method,
    });
    res.json({ status: 'success', message: 'Trả sách thành công', record });
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
    if (!record) throw new HttpError(404, 'Bản sao nay hien khong duoc muon');
    res.json(serializeBorrowRecord(record));
  } catch (error) {
    next(error);
  }
});

// GET /active-borrowers
router.get(['/active-borrowers', '/staff/active-borrowers'], requireRole(['admin', 'staff'], 'Chỉ quản trị viên hoặc nhân viên thư viện mới có thể xem danh sách độc giả đang mượn'), async (_req, res, next) => {
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
router.get(['/patrons/:student_code/active', '/staff/patrons/:student_code/active'], requireRole(['admin', 'staff'], 'Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu sach dang muon'), async (req, res, next) => {
  try {
    const raw = await lookupPatronByStudentCode(req.params.student_code);
    const status = raw.current_status || raw.currentStatus;
    if (status && ['blocked', 'expelled', 'expired'].includes(status)) {
      throw new HttpError(403, 'Thẻ độc giả đã bị khóa/hết hạn. Vui lòng liên hệ thư viện.');
    }
    const patron = patronSummary(raw);
    const accessStatus = await getPatronRawAccessStatus(patron.id);
    if (!accessStatus.inside) {
      throw new HttpError(403, 'Độc giả chưa vào thư viện.');
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
      throw new HttpError(403, 'Thẻ độc giả đã bị khóa/hết hạn. Vui lòng liên hệ thư viện.');
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
