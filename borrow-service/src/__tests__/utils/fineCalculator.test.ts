import { calculateOverdueFine, calculateDamageFee, applyPaymentState, generatePaymentRef } from '../../utils/fineCalculator';

describe('calculateOverdueFine', () => {
  it('returns 0 when not overdue (0 days)', () => {
    expect(calculateOverdueFine(0)).toBe(0);
  });

  it('returns 0 for negative days', () => {
    expect(calculateOverdueFine(-1)).toBe(0);
  });

  it('returns 10000 for 1-7 days overdue', () => {
    expect(calculateOverdueFine(1)).toBe(10000);
    expect(calculateOverdueFine(3)).toBe(10000);
    expect(calculateOverdueFine(7)).toBe(10000);
  });

  it('returns 20000 for 8-14 days overdue', () => {
    expect(calculateOverdueFine(8)).toBe(20000);
    expect(calculateOverdueFine(10)).toBe(20000);
    expect(calculateOverdueFine(14)).toBe(20000);
  });

  it('returns 50000 for 15-30 days overdue', () => {
    expect(calculateOverdueFine(15)).toBe(50000);
    expect(calculateOverdueFine(20)).toBe(50000);
    expect(calculateOverdueFine(30)).toBe(50000);
  });

  it('returns 100000 for 31+ days overdue', () => {
    expect(calculateOverdueFine(31)).toBe(100000);
    expect(calculateOverdueFine(60)).toBe(100000);
    expect(calculateOverdueFine(365)).toBe(100000);
  });

  describe('custom dynamic brackets', () => {
    const customBrackets = [
      { from: 1, to: 3, amount: 5000 },
      { from: 4, to: 10, amount: 15000 },
      { from: 11, to: null, amount: 80000 },
    ];

    it('uses custom bracket amounts', () => {
      expect(calculateOverdueFine(2, customBrackets)).toBe(5000);
      expect(calculateOverdueFine(5, customBrackets)).toBe(15000);
      expect(calculateOverdueFine(15, customBrackets)).toBe(80000);
    });

    it('falls back to per-day fine when days exceed closed brackets', () => {
      const closedBrackets = [
        { from: 1, to: 5, amount: 10000 },
      ];
      expect(calculateOverdueFine(8, closedBrackets, 3000)).toBe(24000);
    });
  });
});

const DAMAGE_CONFIG = {
  damageFeePct: { minor: 30, major: 70, lost: 100 },
  damageFeeFixed: { minor: 5000, major: 10000, lost: 10000 },
  fallbackBookPrice: 100000,
};

describe('calculateDamageFee', () => {
  it.each(['new', 'good', null, undefined])('returns 0 for condition %j', (condition) => {
    expect(calculateDamageFee(condition as any, 120000, DAMAGE_CONFIG)).toEqual({
      amount: 0,
      priceUnavailable: false,
    });
  });

  it('minor_damage = round(price*30%) + 5000', () => {
    expect(calculateDamageFee('minor_damage', 100000, DAMAGE_CONFIG)).toEqual({
      amount: 35000,
      priceUnavailable: false,
    });
  });

  it('major_damage = round(price*70%) + 10000', () => {
    expect(calculateDamageFee('major_damage', 100000, DAMAGE_CONFIG)).toEqual({
      amount: 80000,
      priceUnavailable: false,
    });
  });

  it('lost = round(price*100%) + 10000', () => {
    expect(calculateDamageFee('lost', 100000, DAMAGE_CONFIG)).toEqual({
      amount: 110000,
      priceUnavailable: false,
    });
  });

  it('uses fallback price when book price is null — REMOVED: price null now means priceUnavailable, amount 0', () => {
    expect(calculateDamageFee('lost', null, DAMAGE_CONFIG)).toEqual({
      amount: 0,
      priceUnavailable: true,
    });
  });

  it('uses fallback price when book price is 0 — REMOVED: price 0 now means priceUnavailable, amount 0', () => {
    expect(calculateDamageFee('major_damage', 0, DAMAGE_CONFIG)).toEqual({
      amount: 0,
      priceUnavailable: true,
    });
  });

  it('honors custom config pcts/fixed when a price is known', () => {
    const custom = {
      damageFeePct: { minor: 10, major: 50, lost: 90 },
      damageFeeFixed: { minor: 1000, major: 2000, lost: 3000 },
      fallbackBookPrice: 50000,
    };
    expect(calculateDamageFee('minor_damage', 200000, custom)).toEqual({
      amount: 21000,
      priceUnavailable: false,
    });
    // No price → no fee is invented, regardless of fallbackBookPrice.
    expect(calculateDamageFee('major_damage', undefined, custom)).toEqual({
      amount: 0,
      priceUnavailable: true,
    });
    expect(calculateDamageFee('lost', undefined, custom)).toEqual({
      amount: 0,
      priceUnavailable: true,
    });
  });
});

describe('applyPaymentState', () => {
  const buildRecord = (total: number) => ({ fineAmount: total, damageFee: 0, finePaid: false, paymentMethod: null as string | null, paymentRef: null as string | null, paidAt: null as Date | null });

  it('marks zero-total record as paid with no payment details', () => {
    const record = buildRecord(0);
    applyPaymentState(record, { isPaidImmediately: true, paymentMethod: 'cash' });
    expect(record.finePaid).toBe(true);
    expect(record.paymentMethod).toBeNull();
    expect(record.paymentRef).toBeNull();
    expect(record.paidAt).toBeNull();
  });

  it('sets full payment details when total > 0 and paid immediately', () => {
    const record = buildRecord(90000);
    applyPaymentState(record, { isPaidImmediately: true, paymentMethod: 'qr_code' });
    expect(record.finePaid).toBe(true);
    expect(record.paymentMethod).toBe('qr_code');
    expect(record.paymentRef).toMatch(/^TXN-\d{8}-[0-9a-f]{8}$/);
    expect(record.paidAt).toBeInstanceOf(Date);
  });

  it('defaults payment method to cash when immediate payment and method omitted', () => {
    const record = buildRecord(10000);
    applyPaymentState(record, { isPaidImmediately: true });
    expect(record.paymentMethod).toBe('cash');
  });

  it('leaves debt when not paid immediately', () => {
    const record = buildRecord(90000);
    applyPaymentState(record, { isPaidImmediately: false, paymentMethod: 'cash' });
    expect(record.finePaid).toBe(false);
    expect(record.paymentMethod).toBeNull();
    expect(record.paymentRef).toBeNull();
    expect(record.paidAt).toBeNull();
  });

  it('payment state treats fineAmount+damageFee as the settled total', () => {
    const record = { fineAmount: 10000, damageFee: 80000, finePaid: false, paymentMethod: null as string | null, paymentRef: null as string | null, paidAt: null as Date | null };
    applyPaymentState(record, { isPaidImmediately: true, paymentMethod: 'cash' });
    expect(record.finePaid).toBe(true);
  });
});

describe('generatePaymentRef', () => {
  it('produces TXN-YYYYMMDD-<8 hex> and is unique across calls', () => {
    const a = generatePaymentRef();
    const b = generatePaymentRef();
    expect(a).toMatch(/^TXN-\d{8}-[0-9a-f]{8}$/);
    expect(b).toMatch(/^TXN-\d{8}-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
});
