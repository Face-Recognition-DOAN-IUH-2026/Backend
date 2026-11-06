import { Repository, In, IsNull, Not } from 'typeorm';
import { AppDataSource } from '../data-source';
import { BorrowRecord } from '../entities/BorrowRecord';
import { Book } from '../entities/Book';
import { BookCopy } from '../entities/BookCopy';

/**
 * BorrowRecordRepository — persistence for BorrowRecord entities only.
 * Single responsibility: borrow record CRUD, active/overdue queries,
 * fine (unpaid) queries, and borrow record stats.
 * Repositories are injected via constructor (defaults to AppDataSource).
 */
export class BorrowRecordRepository {
  private records: Repository<BorrowRecord>;

  constructor(
    records: Repository<BorrowRecord> = AppDataSource.getRepository(BorrowRecord),
  ) {
    this.records = records;
  }

  async getActiveBorrow(patronId: string, bookId: string) {
    return this.records.findOne({ where: { patronId, bookId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true } });
  }

  async getActiveBorrowsByPatronAndBook(patronId: string, bookId: string) {
    return this.records.find({ where: { patronId, bookId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
  }

  async getActiveBorrowByCopy(copyId: string) {
    return this.records.findOne({ where: { copyId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true } });
  }

  getBorrowRecordById(id: string) {
    return this.records.findOne({ where: { id }, relations: { book: true, copy: true } });
  }

  async findUnpaidFines(): Promise<BorrowRecord[]> {
    const records = await this.records.find({
      where: { finePaid: false },
      relations: { book: true, copy: true },
      order: { returnAt: 'DESC' },
    });
    return records.filter((r) => (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0) > 0);
  }

  async findUnpaidFinesByPatron(patronId: string): Promise<BorrowRecord[]> {
    const records = await this.records.find({
      where: { patronId, finePaid: false },
      relations: { book: true, copy: true },
      order: { returnAt: 'DESC' },
    });
    return records.filter((r) => (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0) > 0);
  }

  async findFineRecordsByIds(ids: string[]): Promise<BorrowRecord[]> {
    if (ids.length === 0) return [];
    return this.records.find({ where: { id: In(ids) }, relations: { book: true, copy: true } });
  }

  async saveBorrowRecords(records: BorrowRecord[]): Promise<BorrowRecord[]> {
    return this.records.save(records);
  }

  async hasUnpaidFinesForPatron(patronId: string): Promise<boolean> {
    const recs = await this.records.find({ where: { patronId, finePaid: false } });
    return recs.some((r) => (Number(r.fineAmount) || 0) + (Number(r.damageFee) || 0) > 0);
  }

  getAllActiveBorrows() {
    // NOTE: No hard limit here — used by scheduled batch jobs that process all records.
    // Callers should use pagination or stream if the dataset grows large.
    return this.records.find({ where: { status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true }, order: { dueAt: 'ASC', borrowAt: 'DESC' } });
  }

  countActiveBorrows(patronId: string) {
    return this.records.count({ where: { patronId, status: 'borrowed', returnAt: IsNull() } });
  }

  getOverdueBorrows(patronId: string) {
    return this.records.createQueryBuilder('record')
      .where('record.patronId = :patronId', { patronId })
      .andWhere('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .andWhere('record.dueAt < :now', { now: new Date() })
      .getMany();
  }

  async getStats(): Promise<{ total: number; active: number; overdue: number }> {
    const total = await this.records.count();
    const active = await this.records.count({ where: { status: 'borrowed', returnAt: IsNull() } });
    const overdue = await this.records.createQueryBuilder('record')
      .where('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .andWhere('record.dueAt < :now', { now: new Date() })
      .getCount();
    return { total, active, overdue };
  }

  async getFinanceStats(months = 6): Promise<{
    collected_total: number;
    by_method: { cash: number; qr: number; qr_code: number };
    outstanding_total: number;
    paid_count: number;
    unpaid_count: number;
    monthly: Array<{ month: string; collected: number; outstanding_snapshot: number }>;
  }> {
    const clampedMonths = Math.min(Math.max(Number(months) || 6, 1), 24);

    const paidRows: Array<{
      payment_method: string | null;
      fine_amount: string | number | null;
      damage_fee: string | number | null;
      paid_at: Date | string | null;
      return_at: Date | string | null;
      borrow_at: Date | string | null;
    }> = await this.records.createQueryBuilder('record')
      .select('record.payment_method', 'payment_method')
      .addSelect('record.fine_amount', 'fine_amount')
      .addSelect('record.damage_fee', 'damage_fee')
      .addSelect('record.paid_at', 'paid_at')
      .addSelect('record.return_at', 'return_at')
      .addSelect('record.borrow_at', 'borrow_at')
      .where('record.fine_paid = true')
      .getRawMany();

    let collectedTotal = 0;
    let cashTotal = 0;
    let qrTotal = 0;
    let paidCount = 0;
    const paidByMonth: Record<string, number> = {};

    for (const r of paidRows) {
      const fee = (Number(r.fine_amount) || 0) + (Number(r.damage_fee) || 0);
      if (fee > 0) {
        paidCount++;
        collectedTotal += fee;
        const method = (r.payment_method || '').toLowerCase().trim();
        if (method === 'cash') {
          cashTotal += fee;
        } else if (method === 'qr' || method === 'qr_code') {
          qrTotal += fee;
        }

        const dateVal = r.paid_at || r.return_at || r.borrow_at;
        if (dateVal) {
          const d = new Date(dateVal);
          if (!isNaN(d.getTime())) {
            const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            paidByMonth[mKey] = (paidByMonth[mKey] || 0) + fee;
          }
        }
      }
    }

    const unpaidRows: Array<{
      fine_amount: string | number | null;
      damage_fee: string | number | null;
      due_at: Date | string | null;
      borrow_at: Date | string | null;
    }> = await this.records.createQueryBuilder('record')
      .select('record.fine_amount', 'fine_amount')
      .addSelect('record.damage_fee', 'damage_fee')
      .addSelect('record.due_at', 'due_at')
      .addSelect('record.borrow_at', 'borrow_at')
      .where('record.fine_paid = false')
      .andWhere('(record.fine_amount > 0 OR record.damage_fee > 0)')
      .getRawMany();

    let outstandingTotal = 0;
    let unpaidCount = 0;
    const unpaidByMonth: Record<string, number> = {};

    for (const r of unpaidRows) {
      const fee = (Number(r.fine_amount) || 0) + (Number(r.damage_fee) || 0);
      if (fee > 0) {
        unpaidCount++;
        outstandingTotal += fee;
        const dateVal = r.due_at || r.borrow_at;
        if (dateVal) {
          const d = new Date(dateVal);
          if (!isNaN(d.getTime())) {
            const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            unpaidByMonth[mKey] = (unpaidByMonth[mKey] || 0) + fee;
          }
        }
      }
    }

    const monthly: Array<{ month: string; collected: number; outstanding_snapshot: number }> = [];
    const now = new Date();
    for (let i = clampedMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthly.push({
        month: mKey,
        collected: paidByMonth[mKey] || 0,
        outstanding_snapshot: unpaidByMonth[mKey] || 0,
      });
    }

    return {
      collected_total: collectedTotal,
      by_method: {
        cash: cashTotal,
        qr: qrTotal,
        qr_code: qrTotal,
      },
      outstanding_total: outstandingTotal,
      paid_count: paidCount,
      unpaid_count: unpaidCount,
      monthly,
    };
  }

  getBorrowsByPatron(patronId: string, status?: string, limit = 200) {
    const where: any = { patronId };
    if (status) where.status = status;
    return this.records.find({ where, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' }, take: limit });
  }

  getActiveBorrowsByPatron(patronId: string) {
    return this.records.find({ where: { patronId, status: 'borrowed', returnAt: IsNull() }, relations: { book: true, copy: true }, order: { dueAt: 'ASC', borrowAt: 'DESC' }, take: 50 });
  }

  async findRecordsByCopyId(copyId: string): Promise<BorrowRecord[]> {
    return this.records.find({ where: { copyId } });
  }

  async hasActiveBorrows(bookId: string): Promise<boolean> {
    const count = await this.records.createQueryBuilder('record')
      .innerJoin('record.copy', 'copy')
      .where('copy.bookId = :bookId', { bookId })
      .andWhere('record.status = :status', { status: 'borrowed' })
      .andWhere('record.returnAt IS NULL')
      .getCount();
    return count > 0;
  }

  async hasActiveBorrowsForCopy(copyId: string): Promise<boolean> {
    const count = await this.records.count({ where: { copyId, status: 'borrowed', returnAt: IsNull() } });
    return count > 0;
  }

  async deleteBookAndCopiesRecords(bookId: string) {
    await this.records.createQueryBuilder()
      .delete()
      .from(BorrowRecord)
      .where('copyId IN (SELECT id FROM book_copies WHERE bookId = :bookId)', { bookId })
      .execute();
  }

  async bulkDeleteBooksRecords(bookIds: string[]) {
    await this.records.createQueryBuilder()
      .delete()
      .from(BorrowRecord)
      .where('copyId IN (SELECT id FROM book_copies WHERE bookId IN (:...bookIds))', { bookIds })
      .execute();
  }

  getRecordsBySlipId(slipId: string) {
    return this.records.find({ where: { slipId }, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
  }
}
