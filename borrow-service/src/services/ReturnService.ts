import { BorrowRepository } from '../repositories/BorrowRepository';
import { HttpError } from '../middlewares/errorHandler';
import { serializeBorrowRecord } from './serializers';
import { publishEvent } from '../utils/eventPublisher';
import { lookupPatronByStudentCode } from '../clients/UserServiceClient';
import { suspendCardAutoFine } from '../clients/UserServiceClient';
import { normalizeCondition } from '../constants/copy';
import { findCopyByBarcode, sanitizeBarcode } from '../utils/barcode';
import { publishFineIncurred } from '../utils/fineEvents';
import { configService } from './ConfigService';
import { PaymentFinalization } from '../utils/fineCalculator';

function normalizeBookCode(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/\.0+$/, '');
}

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

function recordTotal(record: any): number {
  return (Number(record?.fineAmount) || 0) + (Number(record?.damageFee) || 0);
}

function recordOverdueDays(record: any): number {
  if (!record?.returnAt || !record?.dueAt) return 0;
  return Math.max(0, Math.ceil((new Date(record.returnAt).getTime() - new Date(record.dueAt).getTime()) / (1000 * 60 * 60 * 24)));
}

export class ReturnService {
  private repo: BorrowRepository;

  constructor() {
    this.repo = new BorrowRepository();
  }

  private async maybeSuspendCard(record: any) {
    try {
      const total = recordTotal(record);
      if (record?.finePaid || total <= 0) return;
      const fineConfig = await configService.getFineConfig();
      const overdueDays = recordOverdueDays(record);
      if (overdueDays > fineConfig.fineLockThresholdDays) {
        await suspendCardAutoFine(record.patronId, `[AUTO-FINE] Nợ phí trả sách còn lại sau ${overdueDays} ngày quá hạn`);
      }
    } catch (err: any) {
      console.warn('[ReturnService] card suspend best-effort failed:', err?.message);
    }
  }

  async returnByBarcode(barcode: string, userId?: string | null, userEmail?: string | null, note?: string | null, condition?: string | null, payment?: PaymentFinalization) {
    const returnCondition = normalizeCondition(condition);

    const copy = await findCopyByBarcode(this.repo, barcode);
    if (!copy) throw new HttpError(404, `Khong tim thay ban sao nao voi ma vach ${barcode}`);

    const record = await this.repo.getActiveBorrowByCopy(copy.id);
    if (!record) throw new HttpError(404, 'Khong co ban ghi muon dang hoat dong cho ban sao nay');

    record.returnCondition = returnCondition;
    await this.repo.returnBook(record, userId, userEmail, 'staff_web', note, payment);
    await this.repo.applyReturnToCopy(copy, returnCondition, record, userId || null);

    publishEvent('book.returned', {
      bookId: record.bookId,
      title: record.book?.title,
      patronId: record.patronId,
      barcode: copy.barcode,
      fineAmount: record.fineAmount || 0,
      damageFee: record.damageFee || 0,
      total: recordTotal(record),
    });
    publishFineIncurred(record);
    await this.maybeSuspendCard(record);

    return serializeBorrowRecord(record);
  }

  async returnByPatron(studentCode: string, barcodeOrIsbn: string, userId?: string | null, userEmail?: string | null, note?: string | null, condition?: string | null, payment?: PaymentFinalization) {
    const returnCondition = normalizeCondition(condition);
    const patron = patronSummary(await lookupPatronByStudentCode(studentCode));
    const rawScanned = sanitizeBarcode(barcodeOrIsbn);
    const scanned = normalizeBookCode(rawScanned);

    // 1. Prioritize exact copy barcode lookup (e.g. LIB-<isbn>-<seq>)
    const exactCopy = await findCopyByBarcode(this.repo, rawScanned);
    let record: any = null;
    let book: any = null;
    let copy: any = exactCopy;

    if (exactCopy) {
      record = await this.repo.getActiveBorrowByCopy(exactCopy.id);
      if (record && record.patronId === patron.id) {
        book = exactCopy.book || (await this.repo.getBookById(exactCopy.bookId));
      } else {
        throw new HttpError(400, `Bản sao ${rawScanned} không thuộc danh sách sách đang mượn của độc giả`);
      }
    }

    const isCopyBarcode = /^LIB/i.test(rawScanned);
    if (!record && isCopyBarcode) {
      throw new HttpError(404, `Không tìm thấy bản sao nào với mã vạch ${rawScanned}`);
    }

    if (!record) {
      book = await this.repo.getBookByNormalizedIsbn(scanned);
      if (!book) throw new HttpError(404, 'Không tìm thấy sách với mã vừa quét');

      const records = await this.repo.getActiveBorrowsByPatronAndBook(patron.id, book.id);
      if (!records.length) throw new HttpError(404, 'Độc giả này không mượn sách có mã này');
      if (records.length > 1) throw new HttpError(409, 'Có nhiều bản ghi mượn trùng đầu sách. Vui lòng quét mã vạch bản sao (LIB-...).');

      record = records[0];
      if (!copy && record.copyId) copy = await this.repo.getCopyById(record.copyId);
    }

    record.returnCondition = returnCondition;
    await this.repo.returnBook(record, userId, userEmail, 'staff_mobile', note, payment);
    if (copy) await this.repo.applyReturnToCopy(copy, returnCondition, record, userId || null);

    publishEvent('book.returned', {
      bookId: book.id,
      title: book.title,
      patronId: patron.id,
      barcode: copy?.barcode,
      fineAmount: record.fineAmount || 0,
      damageFee: record.damageFee || 0,
      total: recordTotal(record),
    });
    publishFineIncurred(record);
    await this.maybeSuspendCard(record);

    return serializeBorrowRecord(record);
  }

  async batchReturn(studentCode: string, items: Array<{ barcode_or_isbn: string; condition?: string | null; note?: string | null; is_paid_immediately?: boolean; payment_method?: string }>, userId?: string | null, userEmail?: string | null) {
    const patron = patronSummary(await lookupPatronByStudentCode(studentCode));
    const results: Array<{ barcode_or_isbn: string; status: string; message: string }> = [];
    let ok = 0;
    let fail = 0;

    const processedRecordIds = new Set<string>();

    for (const item of items) {
      const rawScanned = sanitizeBarcode(item.barcode_or_isbn);
      const scanned = normalizeBookCode(rawScanned);
      try {
        const returnCondition = normalizeCondition(item.condition);

        const exactCopy = await findCopyByBarcode(this.repo, rawScanned);
        let record: any = null;
        let book: any = null;
        let copy: any = exactCopy;

        if (exactCopy) {
          record = await this.repo.getActiveBorrowByCopy(exactCopy.id);
          if (record && record.patronId === patron.id) {
            book = exactCopy.book || (await this.repo.getBookById(exactCopy.bookId));
          } else {
            throw new HttpError(400, `Bản sao ${item.barcode_or_isbn} không thuộc danh sách sách đang mượn của độc giả`);
          }
        }

        const isItemCopyBarcode = /^LIB/i.test(rawScanned);
        if (!record && isItemCopyBarcode) {
          throw new HttpError(404, `Không tìm thấy bản sao nào với mã vạch ${item.barcode_or_isbn}`);
        }

        if (!record) {
          book = await this.repo.getBookByNormalizedIsbn(scanned);
          if (!book) {
            throw new HttpError(404, 'Không tìm thấy sách với mã vừa quét');
          }
          const records = await this.repo.getActiveBorrowsByPatronAndBook(patron.id, book.id);
          const availableRecords = records.filter(r => !processedRecordIds.has(r.id));
          if (!availableRecords.length) {
            if (records.some(r => processedRecordIds.has(r.id))) {
              results.push({ barcode_or_isbn: item.barcode_or_isbn, status: 'skipped', message: 'Sách này đã được xử lý trả trong cùng lượt' });
              continue;
            }
            throw new HttpError(404, 'Độc giả này không mượn sách có mã này');
          }
          if (availableRecords.length > 1) {
            throw new HttpError(409, 'Có nhiều bản ghi mượn trùng đầu sách. Vui lòng quét mã vạch bản sao (LIB-...).');
          }
          record = availableRecords[0];
          if (!copy && record.copyId) copy = await this.repo.getCopyById(record.copyId);
        }

        if (processedRecordIds.has(record.id)) {
          results.push({ barcode_or_isbn: item.barcode_or_isbn, status: 'skipped', message: 'Sách này đã được xử lý trả trong cùng lượt' });
          continue;
        }
        processedRecordIds.add(record.id);
        record.returnCondition = returnCondition;
        const itemPayment: PaymentFinalization = {
          isPaidImmediately: item.is_paid_immediately,
          paymentMethod: item.payment_method,
        };
        await this.repo.returnBook(record, userId, userEmail, 'staff_mobile', item.note || null, itemPayment);
        if (copy) await this.repo.applyReturnToCopy(copy, returnCondition, record, userId || null);

        publishEvent('book.returned', {
          bookId: book.id,
          title: book.title,
          patronId: patron.id,
          barcode: copy?.barcode,
          fineAmount: record.fineAmount || 0,
          damageFee: record.damageFee || 0,
          total: recordTotal(record),
        });
        publishFineIncurred(record);
        await this.maybeSuspendCard(record);

        results.push({ barcode_or_isbn: item.barcode_or_isbn, status: 'success', message: 'Trả sách thành công' });
        ok += 1;
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : (err instanceof Error ? err.message : 'Loi khong xac dinh');
        results.push({ barcode_or_isbn: item.barcode_or_isbn, status: 'failed', message: msg });
        fail += 1;
      }
    }

    return { results, ok, fail };
  }

  async returnById(recordId: string, userId?: string | null, userEmail?: string | null, note?: string | null, condition?: string | null, payment?: PaymentFinalization) {
    const returnCondition = normalizeCondition(condition);
    const record = await this.repo.getBorrowRecordById(recordId);
    if (!record) throw new HttpError(404, 'Khong tim thay phieu muon');
    if (record.status !== 'borrowed' || record.returnAt) throw new HttpError(409, 'Phieu muon nay da duoc tra hoac khong con hieu luc');

    const copy = record.copyId ? await this.repo.getCopyById(record.copyId) : null;
    record.returnCondition = returnCondition;
    await this.repo.returnBook(record, userId, userEmail, 'staff_web', note, payment);
    if (copy) await this.repo.applyReturnToCopy(copy, returnCondition, record, userId || null);

    publishEvent('book.returned', {
      bookId: record.bookId,
      title: record.book?.title,
      patronId: record.patronId,
      barcode: copy?.barcode,
      fineAmount: record.fineAmount || 0,
      damageFee: record.damageFee || 0,
      total: recordTotal(record),
    });
    publishFineIncurred(record);
    await this.maybeSuspendCard(record);

    return serializeBorrowRecord(record);
  }
}
