import express, { Express } from 'express';
import request from 'supertest';
import staffRoutes from '../../routes/staff.routes';
import { createMockBook, createMockCopy, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { STAFF_UUID } from '../helpers/auth';

let mockRepo: MockBorrowRepository;

jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, res: any, next: any) => next(),
  requireRole: (roles: string[], detail: string) => (req: any, res: any, next: any) => {
    const role = req.headers['x-test-role'] || 'staff';
    req.user = req.user || { id: STAFF_UUID, email: `${role}@test.com`, role };
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ detail });
      return;
    }
    next();
  },
  requireDynamicPermission: (_resource: string, _action: string) => (req: any, res: any, next: any) => next(),
}));

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
}));
jest.mock('../../utils/eventPublisher');
jest.mock('../../clients/AccessServiceClient');
jest.mock('../../clients/UserServiceClient', () => ({
  lookupPatronById: jest.fn(),
  lookupPatronByStudentCode: jest.fn(),
  lookupPatronsByIds: jest.fn(),
  suspendCardAutoFine: jest.fn(),
  activateCardAutoFine: jest.fn(),
}));
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

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/borrow', staffRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo = createMockBorrowRepository();
});

describe('GET /borrow/stats/condition-attention', () => {
  it('returns summary counts and per-copy recommendations', async () => {
    const book = createMockBook({ title: 'Old Tales' });
    const minor = createMockCopy({ barcode: 'LIB-1', condition: 'minor_damage' });
    const major = createMockCopy({ barcode: 'LIB-2', condition: 'major_damage' });
    const lost = createMockCopy({ barcode: 'LIB-3', condition: 'lost' });
    (minor as any).book = book;
    (major as any).book = book;
    (lost as any).book = book;
    (mockRepo as any).getConditionAttention = jest.fn().mockResolvedValue({
      summary: { minor_damage: 1, major_damage: 1, lost: 1, maintenance: 0, disposed: 0, total: 3 },
      items: [
        { copy: lost, book, recommendation: { action: 'dispose', label: 'Đề xuất thanh lý', reason: 'Sách đã mất' } },
        { copy: major, book, recommendation: { action: 'review', label: 'Đề xuất sửa chữa hoặc thanh lý', reason: 'Hư hỏng nặng' } },
        { copy: minor, book, recommendation: { action: 'repair', label: 'Đề xuất sửa chữa', reason: 'Hư hỏng nhẹ' } },
      ],
    });

    const res = await request(createApp())
      .get('/borrow/stats/condition-attention')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'staff');

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ minor_damage: 1, major_damage: 1, lost: 1, total: 3 });
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0].recommendation.action).toBe('dispose');
    expect(res.body.items[0].barcode).toBe('LIB-3');
  });

  it('returns an empty report when nothing needs attention', async () => {
    (mockRepo as any).getConditionAttention = jest.fn().mockResolvedValue({
      summary: { minor_damage: 0, major_damage: 0, lost: 0, maintenance: 0, disposed: 0, total: 0 },
      items: [],
    });

    const res = await request(createApp())
      .get('/borrow/stats/condition-attention')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'staff');

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.summary.total).toBe(0);
  });

  it('rejects patrons with 403', async () => {
    const res = await request(createApp())
      .get('/borrow/stats/condition-attention')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'patron');

    expect(res.status).toBe(403);
  });
});

describe('GET /borrow/stats/condition-distribution', () => {
  it('returns condition and status breakdowns', async () => {
    (mockRepo as any).getConditionDistribution = jest.fn().mockResolvedValue({
      conditions: { good: 80, minor_damage: 5, lost: 2 },
      statuses: { available: 70, borrowed: 17 },
      total_copies: 87,
    });

    const res = await request(createApp())
      .get('/borrow/stats/condition-distribution')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'staff');

    expect(res.status).toBe(200);
    expect(res.body.conditions).toMatchObject({ good: 80, minor_damage: 5 });
    expect(res.body.total_copies).toBe(87);
  });

  it('rejects patrons with 403', async () => {
    const res = await request(createApp())
      .get('/borrow/stats/condition-distribution')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'patron');

    expect(res.status).toBe(403);
  });
});
