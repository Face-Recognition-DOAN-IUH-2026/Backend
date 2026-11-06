import { finalizeReturnFees } from '../../services/returnFinalizer';
import { FineConfig } from '../../services/ConfigService';

const FINE_CONFIG: FineConfig = {
  fineBrackets: [{ from: 1, to: 7, amount: 10000 }, { from: 8, to: 14, amount: 20000 }],
  finePerDay: 5000,
  damageFeePct: { minor: 30, major: 70, lost: 100 },
  damageFeeFixed: { minor: 5000, major: 10000, lost: 10000 },
  fallbackBookPrice: 100000,
  fineLockThresholdDays: 30,
};

function buildRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'r1',
    dueAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days overdue
    returnAt: new Date(),
    returnCondition: 'good',
    book: { price: 120000 },
    fineAmount: 0,
    damageFee: 0,
    finePaid: false,
    paymentMethod: null,
    paymentRef: null,
    paidAt: null,
    ...overrides,
  } as any;
}

/**
 * BLF-FEE-01 — finalizeReturnFees must surface priceUnavailable so staff can
 * value an unpriced book instead of silently charging an invented price.
 */
describe('BLF-FEE-01 returnFinalizer — unknown book price', () => {
  it('priced book: fee computed, priceUnavailable=false', () => {
    const record = buildRecord({
      returnCondition: 'major_damage',
      book: { price: 120000 },
    });
    const result = finalizeReturnFees(
      record,
      { isPaidImmediately: true, paymentMethod: 'qr_code' },
      FINE_CONFIG,
    );
    expect(result.priceUnavailable).toBe(false);
    expect(record.damageFee).toBe(120000 * 0.7 + 10000); // 94000
    expect(result.total).toBe(10000 + 94000);
  });

  it('unpriced book (null): damageFee 0, priceUnavailable=true, no charge', () => {
    const record = buildRecord({
      returnCondition: 'major_damage',
      book: { price: null },
    });
    const result = finalizeReturnFees(
      record,
      { isPaidImmediately: true, paymentMethod: 'cash' },
      FINE_CONFIG,
    );
    expect(result.priceUnavailable).toBe(true);
    expect(record.damageFee).toBe(0);
    expect(record.finePaid).toBe(true); // zero total → paid, no ledger noise
    expect(result.total).toBe(10000); // only overdue, no damage
  });

  it('unpriced book (0): same as null', () => {
    const record = buildRecord({
      returnCondition: 'lost',
      book: { price: 0 },
    });
    const result = finalizeReturnFees(
      record,
      { isPaidImmediately: false },
      FINE_CONFIG,
    );
    expect(result.priceUnavailable).toBe(true);
    expect(record.damageFee).toBe(0);
    expect(record.finePaid).toBe(false); // debt remains, staff must value it
  });
});
