import { PatronService } from '../../services/PatronService';
import { PatronRepository } from '../../repositories/PatronRepository';
import { RedisService } from '../../services/RedisService';

jest.mock('../../repositories/PatronRepository');

describe('PatronService — card auto-fine suspend/activate', () => {
  let patronService: PatronService;
  let patronRepo: jest.Mocked<PatronRepository>;
  let redis: jest.Mocked<RedisService>;

  const basePatron: any = {
    id: 'p1',
    studentCode: 'SV001',
    cardNumber: 'THV-SV001',
    status: 'active',
    fullName: 'Test User',
    suspendedReason: null,
  };

  beforeEach(() => {
    patronRepo = {
      findById: jest.fn(),
      findByStudentCode: jest.fn(),
      findByCardNumber: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findPatrons: jest.fn(),
      getActivePatrons: jest.fn(),
      countActivePatrons: jest.fn(),
      countActiveInside: jest.fn(),
      updateCurrentStatus: jest.fn(),
    } as any;

    redis = {
      publishUserDeleted: jest.fn(),
      publishUserUpdated: jest.fn(),
      setPasswordResetCode: jest.fn(),
      getPasswordResetCode: jest.fn(),
      deletePasswordResetCode: jest.fn(),
    } as any;

    patronService = new PatronService(patronRepo, redis);
  });

  describe('suspendCardAutoFine', () => {
    it('suspends with an [AUTO-FINE] reason prefix', async () => {
      patronRepo.findById.mockResolvedValue({ ...basePatron } as any);
      patronRepo.update.mockImplementation(async (_id: string, data: any) => ({ ...basePatron, ...data }) as any);

      const result = await patronService.suspendCardAutoFine('p1', 'Nợ phí quá hạn 45 ngày');

      expect(patronRepo.update).toHaveBeenCalledWith('p1', expect.objectContaining({
        status: 'suspended',
        suspendedReason: '[AUTO-FINE] Nợ phí quá hạn 45 ngày',
      }));
      expect(result.alreadySuspended).toBe(false);
    });

    it('does not overwrite a manual suspension', async () => {
      patronRepo.findById.mockResolvedValue({ ...basePatron, status: 'suspended', suspendedReason: 'Vi phạm nội quy' } as any);

      const result = await patronService.suspendCardAutoFine('p1', 'Nợ phí');

      expect(patronRepo.update).not.toHaveBeenCalled();
      expect(result.alreadySuspended).toBe(true);
      expect(result.reason).toBe('Vi phạm nội quy');
    });

    it('is idempotent for an already [AUTO-FINE]-suspended card', async () => {
      patronRepo.findById.mockResolvedValue({ ...basePatron, status: 'suspended', suspendedReason: '[AUTO-FINE] old' } as any);

      const result = await patronService.suspendCardAutoFine('p1', 'new reason');

      expect(patronRepo.update).not.toHaveBeenCalled();
      expect(result.alreadySuspended).toBe(true);
    });
  });

  describe('activateCardAutoFine', () => {
    it('reactivates only system-suspended cards', async () => {
      patronRepo.findById.mockResolvedValue({ ...basePatron, status: 'suspended', suspendedReason: '[AUTO-FINE] Nợ phí' } as any);
      patronRepo.update.mockImplementation(async (_id: string, data: any) => ({ ...basePatron, ...data, status: data.status }) as any);

      const result = await patronService.activateCardAutoFine('p1');

      expect(patronRepo.update).toHaveBeenCalledWith('p1', { status: 'active', suspendedReason: null });
      expect(result.activated).toBe(true);
    });

    it('never clears a manual suspension', async () => {
      patronRepo.findById.mockResolvedValue({ ...basePatron, status: 'suspended', suspendedReason: 'Vi phạm nội quy' } as any);

      const result = await patronService.activateCardAutoFine('p1');

      expect(patronRepo.update).not.toHaveBeenCalled();
      expect(result.activated).toBe(false);
    });

    it('is a no-op when the patron is already active', async () => {
      patronRepo.findById.mockResolvedValue({ ...basePatron } as any);

      const result = await patronService.activateCardAutoFine('p1');

      expect(patronRepo.update).not.toHaveBeenCalled();
      expect(result.activated).toBe(false);
    });
  });
});
