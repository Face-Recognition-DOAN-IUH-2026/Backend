import { BorrowRepository } from '../repositories/BorrowRepository';
import { HttpError } from '../middlewares/errorHandler';
import { serializeBorrowRecord } from './serializers';
import { publishEvent } from '../utils/eventPublisher';
import { lookupPatronByStudentCode } from '../clients/UserServiceClient';

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

export class ReturnService {
  private repo: BorrowRepository;

  constructor() {
    this.repo = new BorrowRepository();
  }

  async returnByBarcode(barcode: string, userId?: string | null, userEmail?: string | null, note?: string | null) {
    const copy = await this.repo.getCopyByBarcode(barcode.trim());
    if (!copy) throw new HttpError(404, `Khong tim thay ban sao nao voi ma vach ${barcode}`);

    const record = await this.repo.getActiveBorrowByCopy(copy.id);
    if (!record) throw new HttpError(404, 'Khong co ban ghi muon dang hoat dong cho ban sao nay');

    await this.repo.returnBook(record, userId, userEmail, 'staff_web', note);
    await this.repo.setCopyAvailable(copy, true);

    publishEvent('book.returned', {
      bookId: record.bookId,
      title: record.book?.title,
      patronId: record.patronId,
      barcode: copy.barcode,
      fineAmount: record.fineAmount || 0,
    });

    return serializeBorrowRecord(record);
  }

  async returnByPatron(studentCode: string, barcodeOrIsbn: string, userId?: string | null, userEmail?: string | null, note?: string | null) {
    const patron = patronSummary(await lookupPatronByStudentCode(studentCode));
    const rawScanned = barcodeOrIsbn.trim();
    const scanned = normalizeBookCode(rawScanned);

    let book = await this.repo.getBookByNormalizedIsbn(scanned);
    const legacyCopy = !book ? await this.repo.getCopyByBarcode(rawScanned) : null;
    if (!book && legacyCopy) book = legacyCopy.book || await this.repo.getBookById(legacyCopy.bookId);
    if (!book) throw new HttpError(404, 'Khong tim thay sach voi ma vua quet');

    const records = await this.repo.getActiveBorrowsByPatronAndBook(patron.id, book.id);
    if (!records.length) throw new HttpError(404, 'Độc giả này không mượn sách có mã này');
    if (records.length > 1) throw new HttpError(409, 'Co nhieu ban ghi muon trung sach. Vui long chon ban ghi thu cong hoac dung barcode ban sao.');

    const record = records[0];
    const copy = legacyCopy || (record.copyId ? await this.repo.getCopyById(record.copyId) : null);

    await this.repo.returnBook(record, userId, userEmail, 'staff_mobile', note);
    if (copy) await this.repo.setCopyAvailable(copy, true);

    publishEvent('book.returned', {
      bookId: book.id,
      title: book.title,
      patronId: patron.id,
      barcode: copy?.barcode,
      fineAmount: record.fineAmount || 0,
    });

    return serializeBorrowRecord(record);
  }

  async batchReturn(studentCode: string, items: Array<{ barcode_or_isbn: string; note?: string | null }>, userId?: string | null, userEmail?: string | null) {
    const patron = patronSummary(await lookupPatronByStudentCode(studentCode));
    const results: Array<{ barcode_or_isbn: string; status: string; message: string }> = [];
    let ok = 0;
    let fail = 0;

    for (const item of items) {
      const rawScanned = item.barcode_or_isbn.trim();
      const scanned = normalizeBookCode(rawScanned);
      try {
        let book = await this.repo.getBookByNormalizedIsbn(scanned);
        const legacyCopy = !book ? await this.repo.getCopyByBarcode(rawScanned) : null;
        if (!book && legacyCopy) book = legacyCopy.book || await this.repo.getBookById(legacyCopy.bookId);
        if (!book) {
          throw new HttpError(404, 'Khong tim thay sach voi ma vua quet');
        }
        const records = await this.repo.getActiveBorrowsByPatronAndBook(patron.id, book.id);
        if (!records.length) {
          throw new HttpError(404, 'Độc giả này không mượn sách có mã này');
        }
        if (records.length > 1) {
          throw new HttpError(409, 'Co nhieu ban ghi muon trung sach. Vui long chon ban ghi thu cong hoac dung barcode ban sao.');
        }
        const record = records[0];
        const copy = legacyCopy || (record.copyId ? await this.repo.getCopyById(record.copyId) : null);
        await this.repo.returnBook(record, userId, userEmail, 'staff_mobile', item.note || null);
        if (copy) await this.repo.setCopyAvailable(copy, true);

        publishEvent('book.returned', {
          bookId: book.id,
          title: book.title,
          patronId: patron.id,
          barcode: copy?.barcode,
          fineAmount: record.fineAmount || 0,
        });

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

  async returnById(recordId: string, userId?: string | null, userEmail?: string | null, note?: string | null) {
    const record = await this.repo.getBorrowRecordById(recordId);
    if (!record) throw new HttpError(404, 'Khong tim thay phieu muon');
    if (record.status !== 'borrowed' || record.returnAt) throw new HttpError(409, 'Phieu muon nay da duoc tra hoac khong con hieu luc');

    const copy = record.copyId ? await this.repo.getCopyById(record.copyId) : null;
    await this.repo.returnBook(record, userId, userEmail, 'staff_web', note);
    if (copy) await this.repo.setCopyAvailable(copy, true);

    publishEvent('book.returned', {
      bookId: record.bookId,
      title: record.book?.title,
      patronId: record.patronId,
      barcode: copy?.barcode,
      fineAmount: record.fineAmount || 0,
    });

    return serializeBorrowRecord(record);
  }
}
