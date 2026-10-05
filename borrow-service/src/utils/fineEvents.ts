import { publishEvent } from './eventPublisher';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysOverdue(record: any): number {
  if (!record?.returnAt || !record?.dueAt) return 0;
  return Math.max(0, Math.ceil((new Date(record.returnAt).getTime() - new Date(record.dueAt).getTime()) / MS_PER_DAY));
}

/**
 * Publishes fine.incurred with the extended additive payload (legacy keys preserved).
 * No-op when there is no outstanding total.
 */
export function publishFineIncurred(record: any): void {
  const total = (Number(record?.fineAmount) || 0) + (Number(record?.damageFee) || 0);
  if (total <= 0) return;

  const hasDamage = (Number(record?.damageFee) || 0) > 0;
  let category: string;
  if (hasDamage && record?.returnCondition === 'lost') {
    category = 'lost';
  } else if (hasDamage) {
    category = 'damage';
  } else {
    category = 'overdue';
  }

  publishEvent('fine.incurred', {
    patronId: record.patronId,
    bookTitle: record.book?.title,
    fineAmount: Number(record.fineAmount) || 0,
    damageFee: Number(record.damageFee) || 0,
    total,
    condition: record.returnCondition ?? null,
    category,
    daysOverdue: daysOverdue(record),
    borrowRecordId: record.id,
    // Extended additive keys (new consumers):
    overdue_fine: Number(record.fineAmount) || 0,
    damage_fee: Number(record.damageFee) || 0,
    total_due: total,
  });
}
