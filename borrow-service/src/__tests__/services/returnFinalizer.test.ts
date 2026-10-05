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

describe('finalizeReturnFees', () => {
  it('computes overdue fine from configured brackets (not per-day fallback)', () => {
    const record = buildRecord();
    finalizeReturnFees(record, { isPaidImmediately: true, paymentMethod: 'cash' }, FINE_CONFIG);
    expect(record.fineAmount).toBe(10000); // bracket 1-7d
  });

  it('computes damage fee from condition and book price and settles it paid', () => {
    const record = buildRecord({ returnCondition: 'major_damage', book: { price: 120000 } });
    const { total, overdueDays } = finalizeReturnFees(record, { isPaidImmediately: true, paymentMethod: 'qr_code' }, FINE_CONFIG);

    expect(overdueDays).toBe(5);
    expect(record.damageFee).toBe(120000 * 0.7 + 10000); // 94000
    expect(total).toBe(10000 + 94000);
    expect(record.finePaid).toBe(true);
    expect(record.paymentMethod).toBe('qr_code');
  });

  it('uses fallback price when the book price is null', () => {
    const record = buildRecord({ returnCondition: 'minor_damage', book: { price: null } });
    finalizeReturnFees(record, { isPaidImmediately: true }, FINE_CONFIG);

    expect(record.damageFee).toBe(100000 * 0.3 + 5000); // 35000
  });

  it('leaves the record as unpaid debt when payment is not immediate', () => {
    const record = buildRecord({ returnCondition: 'lost', book: { price: 100000 } });
    const { total } = finalizeReturnFees(record, { isPaidImmediately: false }, FINE_CONFIG);

    expect(record.damageFee).toBe(110000);
    expect(total).toBe(120000);
    expect(record.finePaid).toBe(false);
    expect(record.paymentMethod).toBeNull();
  });

  it('marks a zero-fee return as paid with no payment details', () => {
    const record = buildRecord({ dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }); // not overdue
    finalizeReturnFees(record, { isPaidImmediately: true, paymentMethod: 'cash' }, FINE_CONFIG);

    expect(record.fineAmount).toBe(0);
    expect(record.damageFee).toBe(0);
    expect(record.finePaid).toBe(true);
    expect(record.paymentMethod).toBeNull();
  });
});
