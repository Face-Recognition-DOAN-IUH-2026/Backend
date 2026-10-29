import { Router } from 'express';
import { z } from 'zod';
import { AppDataSource } from '../data-source';
import { auth, AuthRequest, requireRole, requireDynamicPermission } from '../middlewares/auth';
import { HttpError } from '../../../shared/error-handler';
import { BorrowRepository } from '../repositories/BorrowRepository';
import { isPatronInside, getPatronAccessStatus } from '../clients/AccessServiceClient';
import { lookupPatronById, lookupPatronsByIds, PatronSummary } from '../clients/UserServiceClient';
import { activateCardAutoFine } from '../clients/UserServiceClient';
import { generatePaymentRef } from '../utils/fineCalculator';
import { serializeBook, serializeBorrowRecord } from '../services/serializers';
import { publishEvent } from '../utils/eventPublisher';
import { nearestCopyBarcodes, sanitizeBarcode } from '../utils/barcode';
import { config } from '../config';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';
import { BorrowRecord } from '../entities/BorrowRecord';
import { configService } from '../services/ConfigService';
import { assessCopyBorrowability, markCopyAsBorrowed } from '../constants/copy';
import { patronIdFrom, patronSummary } from '../utils/patron';

const router = Router();

// GET /config — Public, returns borrow configuration for frontend
router.get('/config', async (_req, res, next) => {
  try {
    const limits = await configService.getBorrowLimits();
    const fineConfig = await configService.getFineConfig().catch(() => null);
    res.json({
      max_borrow_books: limits.maxBorrowBooks,
      max_borrow_books_per_slip: limits.maxBorrowBooksPerSlip,
      max_borrow_days: limits.maxBorrowDays,
      fine: fineConfig ? {
        fine_brackets: fineConfig.fineBrackets,
        fine_per_day: fineConfig.finePerDay,
        damage_fee_pct: fineConfig.damageFeePct,
        damage_fee_fixed: fineConfig.damageFeeFixed,
        fallback_book_price: fineConfig.fallbackBookPrice,
        fine_lock_threshold_days: fineConfig.fineLockThresholdDays,
      } : undefined,
    });
  } catch (error) {
    next(error);
  }
});

router.use(auth);

// GET /fines — unpaid fine ledger (staff/admin)
router.get('/fines', requireDynamicPermission('borrows', 'update'), async (req: AuthRequest, res, next) => {
  try {
    if (req.query.unpaid !== undefined && req.query.unpaid !== 'true' && req.query.unpaid !== 'false') {
      throw new HttpError(400, 'unpaid must be true or false');
    }
    const repo = new BorrowRepository();
    const records = await repo.findUnpaidFines();
    const patronIds = [...new Set(records.map((r) => r.patronId))];
    const patrons = await lookupPatronsByIds(patronIds).catch(() => new Map());
    res.json(records.map((r) => ({
      record_id: r.id,
      patron: {
        id: r.patronId,
        full_name: (patrons.get(r.patronId) as any)?.full_name ?? (patrons.get(r.patronId) as any)?.fullName ?? null,
        student_code: (patrons.get(r.patronId) as any)?.student_code ?? (patrons.get(r.patronId) as any)?.studentCode ?? null,
      },
      book: r.book ? { title: r.book.title, isbn: r.book.isbn } : null,
      barcode: r.copy?.barcode ?? null,
      overdue_fine: Number(r.fineAmount) || 0,
      damage_fee: Number(r.damageFee) || 0,
      total: (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0),
      return_at: r.returnAt,
    })));
  } catch (error) {
    next(error);
  }
});

// POST /fines/pay — settle debts at the counter
router.post('/fines/pay', requireDynamicPermission('borrows', 'update'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      record_ids: z.array(z.string().uuid()).min(1).max(100),
      payment_method: z.enum(['cash', 'qr_code']).optional(),
    }).parse(req.body);

    const repo = new BorrowRepository();
    const records = await repo.findFineRecordsByIds(body.record_ids);
    const missing = body.record_ids.filter((id) => !records.some((r) => r.id === id));
    if (missing.length > 0) throw new HttpError(404, 'Không tìm thấy bản ghi phí cho record_id: ' + missing[0]);

    const now = new Date();
    const paid: Array<Record<string, any>> = [];
    for (const r of records) {
      if (r.finePaid) {
        paid.push({ record_id: r.id, payment_ref: r.paymentRef, already_paid: true });
        continue;
      }
      r.finePaid = true;
      r.paymentMethod = body.payment_method ?? 'cash';
      r.paymentRef = generatePaymentRef();
      r.paidAt = now;
      paid.push({ record_id: r.id, payment_ref: r.paymentRef, already_paid: false });
    }
    await repo.saveBorrowRecords(records);

    const patronIds = [...new Set(records.map((r) => r.patronId))];
    const activated: string[] = [];
    for (const patronId of patronIds) {
      try {
        if (!(await repo.hasUnpaidFinesForPatron(patronId))) {
          await activateCardAutoFine(patronId);
          activated.push(patronId);
        }
      } catch (err: any) {
        console.warn('[fines/pay] card auto-activate best-effort failed:', err?.message);
      }
    }

    res.json({ ok: true, paid, activated });
  } catch (error) {
    next(error);
  }
});

const patronStatusMiddleware = requireRole(['patron', 'admin', 'staff']);

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
router.post('/', requireRole(['patron', 'admin', 'staff']), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ barcode: z.string().min(1), isbn: z.string().optional() }).parse(req.body);
    const userId = patronIdFrom(req.user);
    const accessStatus = await getPatronAccessStatus(userId);
    if (!accessStatus.inside) {
      if (accessStatus.isExpired) {
        throw new HttpError(403, `Phiên làm việc tại thư viện đã hết hạn (${config.maxEntryHours}h). Vui lòng quét thẻ hoặc khuôn mặt tại cổng vào để tiếp tục mượn sách.`, 'PATRON_ACCESS_EXPIRED');
      }
      throw new HttpError(403, 'Bạn phải có mặt trong thư viện để mượn sách. Vui lòng quét khuôn mặt hoặc thẻ tại cổng vào để xác nhận hiện diện.', 'PATRON_NOT_INSIDE');
    }
    const repo = new BorrowRepository();
    const barcode = sanitizeBarcode(body.barcode);
    const isbnInput = body.isbn ? sanitizeBarcode(body.isbn) : undefined;

    let book: Book | null | undefined;
    let copy: BookCopy | null | undefined;
    const isCopy = /^LIB/i.test(barcode.replace(/[\s-]/g, '')) || /^LIB/i.test((isbnInput || '').replace(/[\s-]/g, ''));
    if (!isCopy && (isbnInput || (/^\d+$/.test(barcode) && [10, 13].includes(barcode.length)))) {
      const isbn = isbnInput || barcode;
      book = await repo.getBookByIsbn(isbn);
      if (!book) {
        throw new HttpError(404, `Khong co sach nay trong thu vien (ma quet: "${barcode}")`);
      }
      copy = await repo.getAvailableCopy(book.id);
      if (!copy) throw new HttpError(409, 'Sach nay hien da het ban co the muon');
    } else {
      const copyBarcode = /^LIB/i.test(barcode.replace(/[\s-]/g, '')) ? barcode : (isbnInput || barcode);
      copy = await repo.getCopyByBarcode(copyBarcode);
      if (!copy) {
        const cleanScan = copyBarcode.replace(/[\s-]/g, '');
        const match = cleanScan.match(/^LIB(\d{10,13})(\d+)?$/i);
        if (match) {
          const parentBook = await repo.getBookByIsbn(match[1]);
          if (parentBook) {
            const totalCopies = await repo.countCopies(parentBook.id, false);
            const neighbors = nearestCopyBarcodes(copyBarcode, await repo.getCopyBarcodesByBookId(parentBook.id), 3);
            const neighborHint = neighbors.length > 0
              ? ` Các bản gần nhất: ${neighbors.map((b) => `"${b}"`).join(', ')}.`
              : '';
            throw new HttpError(404, `Sách "${parentBook.title}" hiện có ${totalCopies} bản. Không tìm thấy bản sao "${copyBarcode}".${neighborHint}`);
          }
        }
        throw new HttpError(404, `Khong tim thay ban sao nao voi ma vach ${barcode}`);
      }
      book = copy.book || (await repo.getBookById(copy.bookId));
      if (!book) throw new HttpError(404, 'Khong tim thay sach');
      if (!copy.isAvailable) throw new HttpError(409, 'Bản sao nay hien dang duoc muon');
    }
    if (!book || !copy) throw new HttpError(404, 'Khong tim thay sach');

    const assessment = assessCopyBorrowability(copy);
    if (assessment.blocked) throw new HttpError(409, assessment.reason!);

    const { record } = await AppDataSource.transaction(async (manager) => {
      if (await repo.getActiveBorrow(userId, book!.id)) throw new HttpError(409, 'Sach nay ban dang muon');
      if ((await repo.getOverdueBorrows(userId)).length) throw new HttpError(409, 'Ban co sách quá hạn. Vui long tra sach truoc khi muon them.');
      const limits = await configService.getBorrowLimits();
      if (await repo.countActiveBorrows(userId) >= limits.maxBorrowBooks) throw new HttpError(409, `Da qua gioi han muon sach (toi da ${limits.maxBorrowBooks} cuon)`);

      markCopyAsBorrowed(copy!);
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

    res.json({
      status: 'success',
      message: `Muon sach thanh cong. Vui long tra truoc ngay ${record.dueAt.toLocaleDateString('vi-VN')}.`,
      condition_warning: assessment.warning,
      record: serializeBorrowRecord(record),
      book: serializeBook(book),
    });
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

// GET /patron/fines — Patron unpaid fines
router.get('/patron/fines', async (req: AuthRequest, res, next) => {
  try {
    const patronId = patronIdFrom(req.user);
    const repo = new BorrowRepository();
    const records = await repo.findUnpaidFinesByPatron(patronId);
    res.json(records.map((r) => ({
      record_id: r.id,
      book: r.book ? { title: r.book.title, isbn: r.book.isbn } : null,
      barcode: r.copy?.barcode ?? null,
      overdue_fine: Number(r.fineAmount) || 0,
      damage_fee: Number(r.damageFee) || 0,
      total: (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0),
      return_at: r.returnAt,
    })));
  } catch (error) {
    next(error);
  }
});

// POST /renew — Renew a borrow
router.post('/renew', auth, async (req: AuthRequest, res, next) => {
  try {
    const rawId = req.body?.record_id || req.body?.borrow_id || req.body?.recordId;
    const body = z.object({ record_id: z.string().uuid() }).parse({ record_id: rawId });
    const userId = patronIdFrom(req.user);

    const record = await AppDataSource.getRepository(BorrowRecord).findOne({
      where: { id: body.record_id, patronId: userId, status: 'borrowed' as any },
      relations: { book: true, copy: true },
    });
    if (!record) throw new HttpError(404, 'Khong tim thay phieu muon');
    if (record.status !== 'borrowed') throw new HttpError(409, 'Phieu muon nay da het hieu luc');
    const limits = await configService.getBorrowLimits();
    if (record.renewalCount >= limits.maxRenewals) {
      throw new HttpError(409, `Da dat gioi han gia han toi da ${limits.maxRenewals} lan`);
    }

    const now = new Date();
    if (now > new Date(record.dueAt)) {
      throw new HttpError(409, 'Khong the gia han sách quá hạn. Vui long tra sach va muon lai.');
    }

    const newDueAt = new Date(record.dueAt);
    newDueAt.setDate(newDueAt.getDate() + limits.maxBorrowDays);
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
