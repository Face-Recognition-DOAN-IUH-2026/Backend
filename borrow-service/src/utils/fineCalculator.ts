import { randomBytes } from 'crypto';

export interface FineBracket {
  from: number;
  to: number | null;
  amount: number;
}

export interface DamageFeeConfig {
  damageFeePct: { minor: number; major: number; lost: number };
  damageFeeFixed: { minor: number; major: number; lost: number };
  fallbackBookPrice: number;
}

export const DEFAULT_DAMAGE_FEE_CONFIG: DamageFeeConfig = {
  damageFeePct: { minor: 30, major: 70, lost: 100 },
  damageFeeFixed: { minor: 5000, major: 10000, lost: 10000 },
  fallbackBookPrice: 100000,
};

export interface DamageFeeResult {
  amount: number;
  /** True when book.price was null/0/negative and no fee was invented. */
  priceUnavailable: boolean;
}

/**
 * Damage fee derived from the returned copy's condition and the book's cover price.
 * new/good → no damage fee.
 *
 * BLF-FEE-01: when book.price is null / 0 / negative we do NOT substitute
 * fallbackBookPrice. The fee is 0 and priceUnavailable is true so the staff
 * flow can value the book manually instead of silently charging an invented
 * price.
 */
export function calculateDamageFee(
  condition: string | null | undefined,
  priceVnd: number | null | undefined,
  config: DamageFeeConfig = DEFAULT_DAMAGE_FEE_CONFIG,
): DamageFeeResult {
  const priceUnavailable =
    priceVnd === null || priceVnd === undefined || Number(priceVnd) <= 0;

  if (priceUnavailable) {
    return { amount: 0, priceUnavailable: true };
  }

  const effectivePrice = Number(priceVnd);

  switch (condition) {
    case 'minor_damage':
      return {
        amount: Math.round(effectivePrice * config.damageFeePct.minor / 100) + config.damageFeeFixed.minor,
        priceUnavailable: false,
      };
    case 'major_damage':
      return {
        amount: Math.round(effectivePrice * config.damageFeePct.major / 100) + config.damageFeeFixed.major,
        priceUnavailable: false,
      };
    case 'lost':
      return {
        amount: Math.round(effectivePrice * config.damageFeePct.lost / 100) + config.damageFeeFixed.lost,
        priceUnavailable: false,
      };
    default:
      return { amount: 0, priceUnavailable: false };
  }
}

/**
 * Backward-compatible thin wrapper returning just the fee amount.
 * New code should prefer calculateDamageFee so the priceUnavailable signal
 * is not silently dropped.
 */
export function calculateDamageFeeAmount(
  condition: string | null | undefined,
  priceVnd: number | null | undefined,
  config: DamageFeeConfig = DEFAULT_DAMAGE_FEE_CONFIG,
): number {
  return calculateDamageFee(condition, priceVnd, config).amount;
}

export function generatePaymentRef(now: Date = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `TXN-${ymd}-${randomBytes(4).toString('hex')}`;
}

export interface PaymentFinalization {
  isPaidImmediately?: boolean;
  paymentMethod?: string;
}

/**
 * Settles a record's payment state in place. Mutates the given record-like object.
 * - total == 0 → marked paid with no payment details (no ledger noise)
 * - total > 0 && paid immediately → paid with server-generated ref
 * - total > 0 && unpaid → debt: fine_paid=false, no ref/date/method
 */
export function applyPaymentState(
  record: {
    fineAmount: number;
    damageFee?: number | null;
    finePaid: boolean;
    paymentMethod: string | null;
    paymentRef: string | null;
    paidAt: Date | null;
  },
  options: PaymentFinalization,
): void {
  const total = (Number(record.fineAmount) || 0) + (Number(record.damageFee) || 0);

  if (total <= 0) {
    record.finePaid = true;
    record.paymentMethod = null;
    record.paymentRef = null;
    record.paidAt = null;
    return;
  }

  if (options.isPaidImmediately === false) {
    record.finePaid = false;
    record.paymentMethod = null;
    record.paymentRef = null;
    record.paidAt = null;
    return;
  }

  record.finePaid = true;
  record.paymentMethod = options.paymentMethod || 'cash';
  record.paymentRef = generatePaymentRef();
  record.paidAt = new Date();
}

/**
 * Calculate overdue fine using dynamic tiered brackets or fallback to default BA rules:
 * - 1-7 days: 10,000 VND
 * - 8-14 days: 20,000 VND
 * - 15-30 days: 50,000 VND
 * - 31+ days: 100,000 VND
 */
export function calculateOverdueFine(
  overdueDays: number,
  brackets?: FineBracket[] | null,
  finePerDay?: number | null,
): number {
  if (overdueDays <= 0) return 0;

  if (brackets && Array.isArray(brackets) && brackets.length > 0) {
    for (const b of brackets) {
      const from = Number(b.from);
      const to = b.to === null || b.to === undefined ? Infinity : Number(b.to);
      const amount = Number(b.amount);
      if (overdueDays >= from && overdueDays <= to) {
        return amount;
      }
    }
    const lastBracket = brackets[brackets.length - 1];
    if (lastBracket && (lastBracket.to === null || lastBracket.to === undefined)) {
      return Number(lastBracket.amount);
    }
    if (finePerDay && finePerDay > 0) {
      return overdueDays * Number(finePerDay);
    }
    return lastBracket ? Number(lastBracket.amount) : 100000;
  }

  if (overdueDays <= 7) return 10000;
  if (overdueDays <= 14) return 20000;
  if (overdueDays <= 30) return 50000;
  return 100000;
}

