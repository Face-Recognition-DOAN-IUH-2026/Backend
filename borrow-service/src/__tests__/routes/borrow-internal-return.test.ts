import express, { Express } from 'express';
import request from 'supertest';
import { HttpError } from '../../../../shared';
import { AppDataSource } from '../../data-source';
import * as AccessServiceClient from '../../clients/AccessServiceClient';
import * as UserServiceClient from '../../clients/UserServiceClient';
import * as eventPublisher from '../../utils/eventPublisher';
import {
  createMockBook,
  createMockCopy,
  createMockRecord,
  createMockBorrowRepository,
  MockBorrowRepository,
} from '../helpers/mock-repo';

let mockRepo: MockBorrowRepository;

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
}));
jest.mock('../../clients/AccessServiceClient');
jest.mock('../../clients/UserServiceClient');
jest.mock('../../utils/eventPublisher');
jest.mock('../../services/ConfigService', () => ({
  configService: {
    getBorrowLimits: jest.fn().mockResolvedValue({
      maxBorrowBooks: 3,
      maxBorrowBooksPerSlip: 5,
      maxBorrowDays: 14,
    }),
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
jest.mock('../../../../shared', () => {
  const actual = jest.requireActual('../../../../shared');
  return {
    ...actual,
    createInternalAuth: () => (req: any, res: any, next: any) => {
      if (req.headers.authorization?.startsWith('Bearer ')) return next();
      res.status(403).json({ error: 'Missing Authorization header' });
    },
  };
});
jest.mock('../../../shared/auth', () => {
  const actual = jest.requireActual('../../../shared/auth');
  return {
    ...actual,
    createInternalAuth: () => (req: any, res: any, next: any) => {
      if (req.headers.authorization?.startsWith('Bearer ')) return next();
      res.status(403).json({ error: 'Missing Authorization header' });
    },
  };
});

const mockPublishEvent = eventPublisher.publishEvent as jest.MockedFunction<typeof eventPublisher.publishEvent>;

function createInternalApp(): Express {
  const app = express();
  app.use(express.json());
  const borrowInternalRoutes = require('../../routes/borrow-internal.routes').default;
  app.use('/borrow/internal', borrowInternalRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof HttpError) return res.status(err.statusCode).json({ success: false, detail: err.message });
    res.status(500).json({ success: false, detail: 'Internal server error' });
  });
  return app;
}

function stubTransaction(manager: any) {
  (AppDataSource as any).transaction = jest.fn().mockImplementation((cb: any) => cb(manager));
}

function buildReturnedRecord(barcode: string, overrides: any = {}) {
  const copy = createMockCopy({ barcode, isAvailable: false, status: 'borrowed', ...overrides.copy });
  const book = createMockBook();
  const record = createMockRecord({
    returnAt: null,
    status: 'borrowed',
    fineAmount: 0,
    ...overrides.record,
  });
  (record as any).copy = copy;
  (record as any).book = book;
  return { copy, book, record };
}

const authHeader = { Authorization: 'Bearer test-service-token' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo = createMockBorrowRepository();
});

afterEach(() => {
  delete (AppDataSource as any).transaction;
});

describe('POST /borrow/internal/return', () => {
  it('writes the copy back through the shared return helper', async () => {
    const { copy, record } = buildReturnedRecord('LIB-9780123456789-001');
    const manager = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn().mockImplementation((r: any) => Promise.resolve(r)),
    };
    stubTransaction(manager);

    const res = await request(createInternalApp())
      .post('/borrow/internal/return')
      .set(authHeader)
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(200);
    expect(record.returnCondition).toBe('good');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledTimes(1);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(
      copy,
      'good',
      record,
      null,
      expect.any(Object),
    );
  });

  it('keeps the book.returned payload and still publishes fine.incurred when overdue', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    const { copy, record } = buildReturnedRecord('LIB-9780123456789-001', {
      record: { dueAt: threeDaysAgo, fineAmount: 0 },
    });
    const manager = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn().mockImplementation((r: any) => Promise.resolve(r)),
    };
    stubTransaction(manager);

    const res = await request(createInternalApp())
      .post('/borrow/internal/return')
      .set(authHeader)
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(200);
    expect(record.fineAmount).toBeGreaterThan(0);

    const returned = mockPublishEvent.mock.calls.filter((c) => c[0] === 'book.returned');
    expect(returned).toHaveLength(1);
    expect(Object.keys(returned[0][1]).sort()).toEqual([
      'barcode',
      'bookId',
      'damageFee',
      'fineAmount',
      'patronId',
      'title',
      'total',
    ]);
    expect(returned[0][1]).toEqual({
      bookId: record.bookId,
      title: 'Test Book',
      patronId: record.patronId,
      barcode: copy.barcode,
      fineAmount: record.fineAmount,
      damageFee: record.damageFee,
      total: (Number(record.fineAmount) || 0) + (Number(record.damageFee) || 0),
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      'fine.incurred',
      expect.objectContaining({
        patronId: record.patronId,
        fineAmount: record.fineAmount,
        daysOverdue: expect.any(Number),
      }),
    );
  });

  it('responds 404 without touching the copy helper when no active borrow exists', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((r: any) => Promise.resolve(r)),
    };
    stubTransaction(manager);

    const res = await request(createInternalApp())
      .post('/borrow/internal/return')
      .set(authHeader)
      .send({ barcode: 'LIB-NOTHING' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(mockRepo.applyReturnToCopy).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});

describe('POST /borrow/internal/batch-return', () => {
  it('routes every matched copy through the shared return helper', async () => {
    const a = buildReturnedRecord('LIB-A');
    const b = buildReturnedRecord('LIB-B');
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([a.record, b.record]),
      }),
      save: jest.fn().mockImplementation((r: any) => Promise.resolve(r)),
    };
    stubTransaction(manager);

    const res = await request(createInternalApp())
      .post('/borrow/internal/batch-return')
      .set(authHeader)
      .send({ barcodes: ['LIB-A', 'LIB-B'] });

    expect(res.status).toBe(200);
    expect(a.record.returnCondition).toBe('good');
    expect(b.record.returnCondition).toBe('good');
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledTimes(2);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(
      a.copy,
      'good',
      a.record,
      null,
      expect.any(Object),
    );
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(
      b.copy,
      'good',
      b.record,
      null,
      expect.any(Object),
    );
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((item: any) => item.success === true)).toBe(true);
  });

  it('reports an unmatched barcode without failing the batch', async () => {
    const a = buildReturnedRecord('LIB-A');
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([a.record]),
      }),
      save: jest.fn().mockImplementation((r: any) => Promise.resolve(r)),
    };
    stubTransaction(manager);

    const res = await request(createInternalApp())
      .post('/borrow/internal/batch-return')
      .set(authHeader)
      .send({ barcodes: ['LIB-A', 'LIB-MISSING'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.find((i: any) => i.barcode === 'LIB-A').success).toBe(true);
    expect(res.body.data.find((i: any) => i.barcode === 'LIB-MISSING').success).toBe(false);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledTimes(1);
  });
});
