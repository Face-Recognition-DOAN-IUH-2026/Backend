import express, { Express } from 'express';
import request from 'supertest';
import staffRoutes from '../../routes/staff.routes';
import { createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
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

describe('GET /borrow/stats/finance', () => {
  it('returns finance totals, payment method breakdown and monthly series', async () => {
    (mockRepo as any).getFinanceStats = jest.fn().mockResolvedValue({
      collected_total: 100000,
      by_method: { cash: 80000, qr: 20000, qr_code: 20000 },
      outstanding_total: 40000,
      paid_count: 10,
      unpaid_count: 1,
      monthly: [
        { month: '2026-10', collected: 100000, outstanding_snapshot: 40000 }
      ],
    });

    const res = await request(createApp())
      .get('/borrow/stats/finance?months=6')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', 'staff');

    expect(res.status).toBe(200);
    expect(res.body.collected_total).toBe(100000);
    expect(res.body.by_method.cash).toBe(80000);
    expect(res.body.outstanding_total).toBe(40000);
    expect(res.body.paid_count).toBe(10);
    expect(res.body.unpaid_count).toBe(1);
    expect(res.body.monthly).toHaveLength(1);
    expect((mockRepo as any).getFinanceStats).toHaveBeenCalledWith(6);
  });

  it('clamps months query parameter between 1 and 24', async () => {
    (mockRepo as any).getFinanceStats = jest.fn().mockResolvedValue({
      collected_total: 0,
      by_method: { cash: 0, qr: 0 },
      outstanding_total: 0,
      paid_count: 0,
      unpaid_count: 0,
      monthly: [],
    });

    await request(createApp())
      .get('/borrow/stats/finance?months=100')
      .set('x-test-role', 'admin');

    expect((mockRepo as any).getFinanceStats).toHaveBeenCalledWith(24);
  });

  it('rejects non-staff patrons with 403', async () => {
    const res = await request(createApp())
      .get('/borrow/stats/finance')
      .set('x-test-role', 'patron');

    expect(res.status).toBe(403);
  });
});

describe('GET /borrow/stats/inventory', () => {
  it('returns inventory stats with status, condition, exploded categories, and price coverage', async () => {
    (mockRepo as any).getInventoryStats = jest.fn().mockResolvedValue({
      books_total: 50,
      copies_total: 120,
      copies_by_status: { available: 80, borrowed: 30, maintenance: 5, disposed: 5 },
      copies_by_condition: { new: 20, good: 70, minor_damage: 15, major_damage: 10, lost: 5 },
      categories: [
        { name: 'Công nghệ thông tin', count: 25 },
        { name: 'Kinh tế', count: 15 },
        { name: 'Chưa phân loại', count: 10 },
      ],
      price_coverage: { priced: 40, unpriced: 10 },
      imports_last_30d: 12,
    });

    const res = await request(createApp())
      .get('/borrow/stats/inventory')
      .set('x-test-role', 'staff');

    expect(res.status).toBe(200);
    expect(res.body.books_total).toBe(50);
    expect(res.body.copies_total).toBe(120);
    expect(res.body.copies_by_status.available).toBe(80);
    expect(res.body.categories[0].name).toBe('Công nghệ thông tin');
    expect(res.body.price_coverage.priced).toBe(40);
    expect(res.body.imports_last_30d).toBe(12);
  });

  it('rejects non-staff patrons with 403', async () => {
    const res = await request(createApp())
      .get('/borrow/stats/inventory')
      .set('x-test-role', 'patron');

    expect(res.status).toBe(403);
  });
});
