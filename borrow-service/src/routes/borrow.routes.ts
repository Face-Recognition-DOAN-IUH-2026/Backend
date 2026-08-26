import { Router } from 'express';
import { z } from 'zod';
import { AppDataSource } from '../data-source';
import { auth, AuthRequest, requireRole } from '../middlewares/auth';
import { HttpError } from '../middlewares/errorHandler';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { isPatronInside, getPatronAccessStatus } from '../clients/AccessServiceClient';
import { lookupPatronById, PatronSummary } from '../clients/UserServiceClient';
import { serializeBook, serializeBorrowRecord } from '../services/serializers';
import { publishEvent } from '../utils/eventPublisher';
import { config } from '../config';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BorrowRecord } from '../entities/BorrowRecord';

const router = Router();

// GET /config — Public, returns borrow configuration for frontend
router.get('/config', (_req, res) => {
  res.json({
    max_borrow_books: config.maxBorrowBooks,
    max_borrow_books_per_slip: config.maxBorrowBooksPerSlip,
    max_borrow_days: config.maxBorrowDays,
  });
});

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

const patronStatusMiddleware = requireRole(['patron', 'admin', 'staff'], 'Chi xem trang thai trong thu vien');

// GET /patron/inside-status — Get patron inside library status
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

// POST / — Single borrow by barcode scan
router.post('/', requireRole(['patron', 'admin', 'staff'], 'Chi nguoi dung hop le moi co the muon sach'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ barcode: z.string().min(1), isbn: z.string().optional() }).parse(req.body);
    const userId = patronIdFrom(req.user);
    const accessStatus = await getPatronAccessStatus(userId);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phiên làm việc đã hết hạn (${config.maxEntryHours}h). Vui lòng vào lại qua cổng.de muon sach.`);
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
        if (!copy.isAvailable) throw new HttpError(409, 'Bản sao nay hien dang duoc muon');
      }
      if (!book || !copy) throw new HttpError(404, 'Khong tim thay sach');
      if (await repo.getActiveBorrow(userId, book.id)) throw new HttpError(409, 'Sach nay ban dang muon');
      if ((await repo.getOverdueBorrows(userId)).length) throw new HttpError(409, 'Ban co sách quá hạn. Vui long tra sach truoc khi muon them.');
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

// GET /history — Patron borrow history
router.get('/history', async (req: AuthRequest, res, next) => {
  try {
    const records = await new BorrowRepository().getBorrowsByPatron(patronIdFrom(req.user), req.query.status_filter as string | undefined);
    res.json(records.map(serializeBorrowRecord));
  } catch (error) {
    next(error);
  }
});

// GET /patron/active — Patron active borrows
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

// POST /renew — Renew a borrow
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
      throw new HttpError(409, 'Khong the gia han sách quá hạn. Vui long tra sach va muon lai.');
    }

    const newDueAt = new Date(record.dueAt);
    newDueAt.setDate(newDueAt.getDate() + config.maxBorrowDays);
    record.dueAt = newDueAt;
    record.renewalCount += 1;
    await AppDataSource.getRepository(BorrowRecord).save(record);

    res.json({
      status: 'success',
      message: `Gia hạn thành công. Han tra moi: ${newDueAt.toLocaleDateString('vi-VN')}`,
      record: serializeBorrowRecord(record),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
