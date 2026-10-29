import { HttpError } from '../../../../shared/error-handler';
import {
  CONDITION_CODES,
  CONDITION_LABELS,
  COPY_STATUS_CODES,
  COPY_STATUS_LABELS,
  DEFAULT_CONDITION,
  assessCopyBorrowability,
  recommendCopyAction,
  markCopyAsBorrowed,
  normalizeCondition,
  normalizeCopyStatus,
} from '../../constants/copy';

describe('copy condition & status allowlists', () => {
  it('exposes exactly 5 condition codes with Vietnamese labels', () => {
    expect([...CONDITION_CODES].sort()).toEqual(['good', 'lost', 'major_damage', 'minor_damage', 'new']);
    for (const code of CONDITION_CODES) {
      expect(CONDITION_LABELS[code]).toBeTruthy();
      expect(CONDITION_LABELS[code]).toMatch(/[A-ZĐ]/i);
    }
  });

  it('exposes exactly 4 copy status codes with Vietnamese labels', () => {
    expect([...COPY_STATUS_CODES].sort()).toEqual(['available', 'borrowed', 'disposed', 'maintenance']);
    for (const code of COPY_STATUS_CODES) {
      expect(COPY_STATUS_LABELS[code]).toBeTruthy();
    }
  });

  it('defaults a missing condition to good', () => {
    expect(DEFAULT_CONDITION).toBe('good');
    expect(normalizeCondition(undefined)).toBe('good');
    expect(normalizeCondition(null)).toBe('good');
    expect(normalizeCondition('')).toBe('good');
    expect(normalizeCondition('  ')).toBe('good');
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeCondition(' NEW ')).toBe('new');
    expect(normalizeCondition('Major_Damage')).toBe('major_damage');
    expect(normalizeCopyStatus(' Maintenance ')).toBe('maintenance');
  });

  it('rejects unknown condition codes with a 400 business error', () => {
    for (const bad of ['broken', 'ok', 'new2', 'MAINTENANCE ']) {
      let thrown: unknown;
      try {
        normalizeCondition(bad);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as HttpError).statusCode).toBe(400);
    }
  });

  it('defaults a missing status to available and rejects unknown statuses', () => {
    expect(normalizeCopyStatus(undefined)).toBe('available');
    expect(normalizeCopyStatus(null)).toBe('available');
    expect(() => normalizeCopyStatus('retired')).toThrow(HttpError);
  });
});

describe('assessCopyBorrowability', () => {
  it.each([
    ['maintenance', 'good'],
    ['disposed', 'good'],
    ['lost', 'good'],
    ['borrowed', 'good'],
    ['maintenance', 'major_damage'],
    ['disposed', 'lost'],
  ])('blocks status=%s condition=%s', (status, condition) => {
    const result = assessCopyBorrowability({ status, condition });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBeTruthy();
    expect(result.warning).toBeNull();
  });

  it('blocks a major_damage copy so damaged books never circulate', () => {
    const result = assessCopyBorrowability({ status: 'available', condition: 'major_damage' });
    expect(result.blocked).toBe(true);
    expect(result.warning).toBeNull();
    expect(result.reason).toContain('hư hỏng nặng');
  });

  it('blocks a minor_damage copy so damaged books never circulate', () => {
    const result = assessCopyBorrowability({ status: 'available', condition: 'minor_damage' });
    expect(result.blocked).toBe(true);
    expect(result.warning).toBeNull();
    expect(result.reason).toContain('hư hỏng nhẹ');
  });

  it.each([
    ['available', 'new'],
    ['available', 'good'],
  ])('allows status=%s condition=%s', (status, condition) => {
    const result = assessCopyBorrowability({ status, condition });
    expect(result).toEqual({ blocked: false, warning: null, reason: null });
  });

  it('fails closed for an unknown non-available status', () => {
    const { blocked, warning, reason } = assessCopyBorrowability({
      status: 'retired',
      condition: 'good',
    });
    expect(blocked).toBe(true);
    expect(warning).toBeNull();
    expect(reason).toContain('retired');
  });

  it('blocks a maintenance copy with a reason mentioning bao tri', () => {
    const { reason } = assessCopyBorrowability({ status: 'maintenance', condition: 'good' });
    expect(reason!.toLowerCase()).toContain('bảo trì');
  });

  it('blocks a lost copy with a reason mentioning mat', () => {
    const { reason } = assessCopyBorrowability({ status: 'available', condition: 'lost' });
    expect(reason!.toLowerCase()).toContain('mất');
  });

  it('blocks a disposed copy with a reason mentioning thanh ly', () => {
    const { reason } = assessCopyBorrowability({ status: 'disposed', condition: 'good' });
    expect(reason!.toLowerCase()).toContain('thanh lý');
  });

  it('treats legacy copies without condition or status as borrowable', () => {
    const result = assessCopyBorrowability({ status: null, condition: null });
    expect(result).toEqual({ blocked: false, warning: null, reason: null });
  });
});

describe('recommendCopyAction', () => {
  it('recommends disposal for lost copies', () => {
    expect(recommendCopyAction('lost')).toMatchObject({ action: 'dispose' });
  });

  it('recommends review (repair or dispose) for major_damage copies', () => {
    expect(recommendCopyAction('major_damage')).toMatchObject({ action: 'review' });
  });

  it('recommends repair for minor_damage copies', () => {
    expect(recommendCopyAction('minor_damage')).toMatchObject({ action: 'repair' });
  });

  it.each(['new', 'good', null, undefined])('returns null when no action is needed (%j)', (condition) => {
    expect(recommendCopyAction(condition as any)).toBeNull();
  });
});

describe('markCopyAsBorrowed', () => {
  it('marks an available copy as borrowed and unavailable', () => {
    const copy = { isAvailable: true, status: 'available' as const };
    markCopyAsBorrowed(copy);
    expect(copy).toEqual({ isAvailable: false, status: 'borrowed' });
  });

  it('is idempotent for a copy that is already borrowed', () => {
    const copy = { isAvailable: false, status: 'borrowed' as const };
    markCopyAsBorrowed(copy);
    expect(copy).toEqual({ isAvailable: false, status: 'borrowed' });
  });

  it('never overwrites maintenance or disposed status', () => {
    for (const status of ['maintenance', 'disposed'] as const) {
      const copy = { isAvailable: true, status };
      markCopyAsBorrowed(copy);
      expect(copy.isAvailable).toBe(false);
      expect(copy.status).toBe(status);
    }
  });

  it('never masks an unknown status', () => {
    const copy = { isAvailable: true, status: 'something_odd' as any };
    markCopyAsBorrowed(copy);
    expect(copy.isAvailable).toBe(false);
    expect(copy.status).toBe('something_odd');
  });

  it('treats a legacy copy without a status as borrowed', () => {
    const copy: { isAvailable: boolean; status?: any } = { isAvailable: true };
    markCopyAsBorrowed(copy);
    expect(copy).toEqual({ isAvailable: false, status: 'borrowed' });
  });
});
