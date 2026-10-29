import express, { Express } from 'express';
import request from 'supertest';
import { createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';

let mockRepo: MockBorrowRepository;

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
}));
jest.mock('../../clients/AccessServiceClient');
jest.mock('../../clients/UserServiceClient');
jest.mock('../../utils/eventPublisher');
jest.mock('../../services/ConfigService', () => ({
  configService: {
    getBorrowLimits: jest.fn().mockResolvedValue({ maxBorrowBooks: 3, maxBorrowBooksPerSlip: 5, maxBorrowDays: 14 }),
    getFineConfig: jest.fn().mockResolvedValue({ finePerDay: 5000, fineBrackets: [], damageFeePct: { minor: 30, major: 70, lost: 100 }, damageFeeFixed: { minor: 5000, major: 10000, lost: 10000 }, fallbackBookPrice: 100000, fineLockThresholdDays: 30 }),
  },
}));
jest.mock('../../../../shared', () => {
  const actual = jest.requireActual('../../../../shared');
  return { ...actual, createInternalAuth: () => (_req: any, _res: any, next: any) => next() };
});
jest.mock('../../../shared/auth', () => {
  const actual = jest.requireActual('../../../shared/auth');
  return { ...actual, createInternalAuth: () => (_req: any, _res: any, next: any) => next() };
});

function createInternalApp(): Express {
  const app = express();
  app.use(express.json());
  const borrowInternalRoutes = require('../../routes/borrow-internal.routes').default;
  app.use('/borrow/internal', borrowInternalRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, detail: err.message || 'Internal server error' });
  });
  return app;
}

const authHeader = { Authorization: 'Bearer test-service-token' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo = createMockBorrowRepository();
});

describe('borrow-internal quantity zod bound (#15)', () => {
  it('POST /books rejects quantity > 1000', async () => {
    const res = await request(createInternalApp())
      .post('/borrow/internal/books')
      .set(authHeader)
      .send({ isbn: '978-0', title: 'Test', quantity: 100000 });
    expect(res.status).toBe(400);
  });

  it('POST /books rejects quantity < 1', async () => {
    const res = await request(createInternalApp())
      .post('/borrow/internal/books')
      .set(authHeader)
      .send({ isbn: '978-0', title: 'Test', quantity: 0 });
    expect(res.status).toBe(400);
  });

  it('POST /books rejects non-integer quantity', async () => {
    const res = await request(createInternalApp())
      .post('/borrow/internal/books')
      .set(authHeader)
      .send({ isbn: '978-0', title: 'Test', quantity: 1.5 });
    expect(res.status).toBe(400);
  });

  it('PUT /books/:book_id/quantity rejects quantity > 1000', async () => {
    const res = await request(createInternalApp())
      .put('/borrow/internal/books/b1/quantity')
      .set(authHeader)
      .send({ quantity: 100000 });
    expect(res.status).toBe(400);
  });

  it('PUT /books/:book_id/quantity rejects quantity < 1', async () => {
    const res = await request(createInternalApp())
      .put('/borrow/internal/books/b1/quantity')
      .set(authHeader)
      .send({ quantity: 0 });
    expect(res.status).toBe(400);
  });
});
