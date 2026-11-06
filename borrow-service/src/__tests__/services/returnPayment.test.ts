import { ReturnService } from '../../services/ReturnService';
import { createMockBook, createMockCopy, createMockRecord, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { PATRON_UUID, STAFF_UUID } from '../helpers/auth';
import * as UserServiceClient from '../../clients/UserServiceClient';
import * as eventPublisher from '../../utils/eventPublisher';

let mockRepo: MockBorrowRepository;

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
}));
jest.mock('../../utils/eventPublisher');
jest.mock('../../services/ConfigService', () => ({
  configService: {
    getBorrowLimits: jest.fn().mockResolvedValue({ maxBorrowBooks: 3, maxBorrowBooksPerSlip: 5, maxBorrowDays: 14 }),
    getFineConfig: jest.fn().mockResolvedValue({
      finePerDay: 5000,
      fineBrackets: [],
      damageFeePct: { minor: 30, major: 70, lost: 100 },
      damageFeeFixed: { minor: 5000, major: 10000, lost: 10000 },
      fallbackBookPrice: 100000,
      fineLockThresholdDays: 30,
    }),
  },
}));

const mockUserService = UserServiceClient as jest.Mocked<typeof UserServiceClient>;
const mockPublishEvent = eventPublisher.publishEvent as jest.MockedFunction<typeof eventPublisher.publishEvent>;

function primeReturn() {
  const book = createMockBook();
  const copy = createMockCopy({ status: 'borrowed', isAvailable: false });
  (copy as any).book = book;
  const record = createMockRecord({ bookId: book.id, copyId: copy.id, dueAt: new Date(Date.now() - 40 * 86400000) });
  (record as any).book = book;
  mockRepo.getCopyByBarcode.mockResolvedValue(copy);
  mockRepo.getActiveBorrowByCopy.mockResolvedValue(record);
  mockRepo.applyReturnToCopy.mockResolvedValue(copy);
  return { book, copy, record };
}

describe('ReturnService — payment finalization + card suspend', () => {
  beforeEach(() => {
    mockRepo = createMockBorrowRepository();
    mockRepo.returnBook.mockImplementation(async (record: any, userId: any, email: any, method: any, note: any, payment: any) => {
      record.returnAt = new Date();
      record.status = 'returned';
      record.returnMethod = method ?? 'staff_web';
      const fineConfig = await (require('../../services/ConfigService').configService.getFineConfig());
      require('../../services/returnFinalizer').finalizeReturnFees(record, payment ?? {}, fineConfig);
      return record;
    });
    (mockUserService.suspendCardAutoFine as jest.Mock).mockResolvedValue({ status: 'suspended' });
  });

  it('forwards payment options to the repository and succeeds when total is zero', async () => {
    primeRecordWithNoFees();
    const payment = { isPaidImmediately: false, paymentMethod: 'qr_code' } as const;

    await new ReturnService().returnByBarcode('LIB-9780123456789-001', STAFF_UUID, 'staff@test.com', null, 'good', payment);

    expect(mockRepo.returnBook).toHaveBeenCalledWith(
      expect.anything(), STAFF_UUID, 'staff@test.com', 'staff_web', null, payment,
    );
    expect(mockPublishEvent.mock.calls.filter((c) => c[0] === 'fine.incurred')).toHaveLength(0);
    expect(mockUserService.suspendCardAutoFine).not.toHaveBeenCalled();
  });

  it('suspends the card when the return settles unpaid debt past the lock threshold', async () => {
    const { record } = primeReturn({ fineAmount: 10000, damageFee: 0, dueAt: new Date(Date.now() - 40 * 86400000) });

    await new ReturnService().returnByBarcode('LIB-9780123456789-001', STAFF_UUID, 'staff@test.com', null, 'good', {
      isPaidImmediately: false,
    } as any);

    expect(mockUserService.suspendCardAutoFine).toHaveBeenCalledWith(PATRON_UUID, expect.stringMatching(/^\[AUTO-FINE\]/));
  });

  it('does not suspend when the debt was settled immediately', async () => {
    primeReturn({ fineAmount: 10000, damageFee: 0, dueAt: new Date(Date.now() - 40 * 86400000) });

    await new ReturnService().returnByBarcode('LIB-9780123456789-001', STAFF_UUID, 'staff@test.com', null, 'good', {
      isPaidImmediately: true,
    } as any);

    expect(mockUserService.suspendCardAutoFine).not.toHaveBeenCalled();
  });

  it('still settles the return when user-service is unreachable', async () => {
    primeReturn({ fineAmount: 10000, damageFee: 0, dueAt: new Date(Date.now() - 40 * 86400000) });
    (mockUserService.suspendCardAutoFine as jest.Mock).mockRejectedValue(new Error('user-service down'));

    const res = await new ReturnService().returnByBarcode('LIB-9780123456789-001', STAFF_UUID, 'staff@test.com', null, 'good', {
      isPaidImmediately: false,
    } as any);

    expect(res.status).toBe('returned');
  });

  it('publishes fine.incurred with the extended payload when there is a total', async () => {
    const { record } = primeReturn({
      fineAmount: 10000,
      damageFee: 80000,
      returnCondition: 'major_damage',
    });
    // price is null by default in the mock; set a real price so damage is computable.
    record.book.price = 100000;

    await new ReturnService().returnByBarcode('LIB-9780123456789-001', STAFF_UUID, 'staff@test.com', null, 'major_damage', {
      isPaidImmediately: true,
    } as any);

    const calls = mockPublishEvent.mock.calls.filter((c) => c[0] === 'fine.incurred');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ overdue_fine: 0, damage_fee: 80000, total: 80000, category: 'damage', condition: 'major_damage' });
  });

  function primeReturn(overrides: Record<string, any> = {}) {
    const book = createMockBook();
    const copy = createMockCopy({ status: 'borrowed', isAvailable: false });
    (copy as any).book = book;
    const record = createMockRecord({ bookId: book.id, copyId: copy.id, ...overrides });
    (record as any).book = book;
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getActiveBorrowByCopy.mockResolvedValue(record);
    mockRepo.applyReturnToCopy.mockResolvedValue(copy);
    return { book, copy, record };
  }

  function primeRecordWithNoFees() {
    primeReturn({ dueAt: new Date(Date.now() + 86400000) });
  }
});
