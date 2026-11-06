import { Repository, IsNull } from 'typeorm';
import { AppDataSource } from '../data-source';
import { BorrowSlip } from '../entities/BorrowSlip';
import { BorrowRecord } from '../entities/BorrowRecord';

/**
 * BorrowSlipRepository — persistence for BorrowSlip entities only.
 * Single responsibility: borrow slip CRUD and slip completion check.
 * Repositories are injected via constructor (defaults to AppDataSource).
 */
export class BorrowSlipRepository {
  private slips: Repository<BorrowSlip>;
  private records: Repository<BorrowRecord>;

  constructor(
    slips: Repository<BorrowSlip> = AppDataSource.getRepository(BorrowSlip),
    records: Repository<BorrowRecord> = AppDataSource.getRepository(BorrowRecord),
  ) {
    this.slips = slips;
    this.records = records;
  }

  getActiveSlip(slipId: string) {
    return this.slips.findOne({ where: { id: slipId, status: 'active' } });
  }

  async closeSlipIfComplete(slipId: string) {
    const remaining = await this.records.count({ where: { slipId, status: 'borrowed', returnAt: IsNull() } });
    if (remaining === 0) {
      await this.slips.update(slipId, { status: 'closed', updatedAt: new Date() });
      return true;
    }
    return false;
  }

  getRecordsBySlipId(slipId: string) {
    return this.records.find({ where: { slipId }, relations: { book: true, copy: true }, order: { borrowAt: 'DESC' } });
  }

  getSlipsByPatron(patronId: string, limit = 100) {
    return this.slips.find({ where: { patronId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
