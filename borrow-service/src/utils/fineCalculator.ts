export interface FineBracket {
  from: number;
  to: number | null;
  amount: number;
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

