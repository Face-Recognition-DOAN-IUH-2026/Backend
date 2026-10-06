import { HttpError } from '../middlewares/errorHandler';

export const CONDITION_CODES = ['new', 'good', 'minor_damage', 'major_damage', 'lost'] as const;
export type CopyCondition = (typeof CONDITION_CODES)[number];

export const CONDITION_LABELS: Record<CopyCondition, string> = {
  new: 'Mới',
  good: 'Tốt',
  minor_damage: 'Hư hỏng nhẹ',
  major_damage: 'Hư hỏng nặng',
  lost: 'Mất',
};

export const COPY_STATUS_CODES = ['available', 'borrowed', 'maintenance', 'disposed'] as const;
export type CopyStatus = (typeof COPY_STATUS_CODES)[number];

export const COPY_STATUS_LABELS: Record<CopyStatus, string> = {
  available: 'Sẵn sàng',
  borrowed: 'Đang mượn',
  maintenance: 'Bảo trì',
  disposed: 'Đã thanh lý',
};

export const DEFAULT_CONDITION: CopyCondition = 'good';
export const DEFAULT_COPY_STATUS: CopyStatus = 'available';

export function normalizeCondition(input?: string | null): CopyCondition {
  if (input === undefined || input === null || String(input).trim() === '') return DEFAULT_CONDITION;
  const value = String(input).trim().toLowerCase();
  if ((CONDITION_CODES as readonly string[]).includes(value)) return value as CopyCondition;
  throw new HttpError(400, `Tình trạng bản sao không hợp lệ: ${input}`, 'INVALID_COPY_CONDITION');
}

export function normalizeCopyStatus(input?: string | null): CopyStatus {
  if (input === undefined || input === null || String(input).trim() === '') return DEFAULT_COPY_STATUS;
  const value = String(input).trim().toLowerCase();
  if ((COPY_STATUS_CODES as readonly string[]).includes(value)) return value as CopyStatus;
  throw new HttpError(400, `Trạng thái bản sao không hợp lệ: ${input}`, 'INVALID_COPY_STATUS');
}

/**
 * Write-back for the moment a copy is lended out: the copy becomes unavailable
 * and its lifecycle status moves to `borrowed`.
 * Statuses that are not an availability signal (maintenance, disposed, unknown)
 * are never overwritten, so a copy parked in repair does not become "borrowed".
 */
export function markCopyAsBorrowed(copy: { isAvailable: boolean; status?: string | null }): void {
  copy.isAvailable = false;
  const status = copy.status ? String(copy.status).trim().toLowerCase() : null;
  if (status === null || status === 'available' || status === 'borrowed') {
    copy.status = 'borrowed';
  }
}

export interface CopyActionRecommendation {
  action: 'repair' | 'review' | 'dispose';
  label: string;
  reason: string;
}

export interface BorrowabilityAssessment {
  blocked: boolean;
  warning: string | null;
  reason: string | null;
}

/**
 * What staff should do with a copy that needs attention.
 * Returns null when the copy needs no action (new/good/unknown).
 */
export function recommendCopyAction(condition?: string | null): CopyActionRecommendation | null {
  const normalized = condition ? String(condition).trim().toLowerCase() : null;
  switch (normalized) {
    case 'minor_damage':
      return { action: 'repair', label: 'Đề xuất sửa chữa', reason: 'Bản sao hư hỏng nhẹ — nên sửa chữa, đóng lại trước khi cho mượn tiếp' };
    case 'major_damage':
      return { action: 'review', label: 'Đề xuất sửa chữa hoặc thanh lý', reason: 'Bản sao hư hỏng nặng — kiểm tra khả năng sửa, nếu không sửa được thì thanh lý' };
    case 'lost':
      return { action: 'dispose', label: 'Đề xuất thanh lý', reason: 'Sách đã mất — đề xuất thanh lý, ghi giảm khỏi kho' };
    default:
      return null;
  }
}

const ALLOWED: BorrowabilityAssessment = { blocked: false, warning: null, reason: null };

const STATUS_MESSAGES: Record<string, string> = {
  maintenance: 'Bản sao đang được bảo trì',
  disposed: 'Bản sao đã thanh lý',
  borrowed: 'Bản sao đang được mượn',
};

const LOST_MESSAGE = 'Bản sao đã bị đánh dấu mất';
const MINOR_DAMAGE_MESSAGE = 'Bản sao bị hư hỏng nhẹ — không thể mượn, cần sửa chữa trước';
const MAJOR_DAMAGE_MESSAGE = 'Bản sao bị hư hỏng nặng — không thể mượn, cần sửa chữa hoặc thanh lý';

/**
 * Single source of truth for whether a copy may enter a borrow flow.
 * Only new/good copies circulate: maintenance/disposed/lost copies and
 * damaged (minor/major) copies are blocked so every loan starts from a
 * good-condition copy and return damage fees stay fair.
 */
export function assessCopyBorrowability(copy: {
  status?: string | null;
  condition?: string | null;
}): BorrowabilityAssessment {
  const status = copy.status ? String(copy.status).trim().toLowerCase() : null;
  const condition = copy.condition ? String(copy.condition).trim().toLowerCase() : null;

  // Fail-closed: anything other than an explicit "available" status blocks.
  if (status && status !== 'available') {
    const reason = STATUS_MESSAGES[status] ?? `Trạng thái bản sao không hợp lệ: ${status}`;
    return { blocked: true, warning: null, reason };
  }
  if (condition === 'lost') {
    return { blocked: true, warning: null, reason: LOST_MESSAGE };
  }
  if (condition === 'minor_damage') {
    return { blocked: true, warning: null, reason: MINOR_DAMAGE_MESSAGE };
  }
  if (condition === 'major_damage') {
    return { blocked: true, warning: null, reason: MAJOR_DAMAGE_MESSAGE };
  }
  return ALLOWED;
}
