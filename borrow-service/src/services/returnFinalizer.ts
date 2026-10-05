import { FineConfig } from './ConfigService';
import { applyPaymentState, calculateDamageFee, calculateOverdueFine, PaymentFinalization } from '../utils/fineCalculator';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Single payment-finalization point for every return path (staff single/batch/by-patron,
 * patron self-return via ReturnService, and internal kiosk returns).
 * Recomputes overdue + damage fees and settles the payment state on the record.
 */
export function finalizeReturnFees(
  record: {
    dueAt?: Date | string | null;
    returnAt?: Date | string | null;
    returnCondition?: string | null;
    book?: { price?: number | null } | null;
    fineAmount: number;
    damageFee: number;
    finePaid: boolean;
    paymentMethod: string | null;
    paymentRef: string | null;
    paidAt: Date | null;
  },
  options: PaymentFinalization,
  fineConfig: FineConfig,
): { overdueDays: number; total: number } {
  const now = record.returnAt ? new Date(record.returnAt) : new Date();
  const dueAt = record.dueAt ? new Date(record.dueAt) : null;

  let overdueDays = 0;
  if (dueAt && now.getTime() > dueAt.getTime()) {
    overdueDays = Math.ceil((now.getTime() - dueAt.getTime()) / MS_PER_DAY);
  }

  record.fineAmount = calculateOverdueFine(overdueDays, fineConfig.fineBrackets, fineConfig.finePerDay);
  record.damageFee = calculateDamageFee(record.returnCondition, record.book?.price, {
    damageFeePct: fineConfig.damageFeePct,
    damageFeeFixed: fineConfig.damageFeeFixed,
    fallbackBookPrice: fineConfig.fallbackBookPrice,
  });

  applyPaymentState(record, options);

  return { overdueDays, total: (Number(record.fineAmount) || 0) + (Number(record.damageFee) || 0) };
}
