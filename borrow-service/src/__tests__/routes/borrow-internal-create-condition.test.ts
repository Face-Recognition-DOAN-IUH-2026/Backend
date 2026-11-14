import express, { Express } from 'express';
import request from 'supertest';
import { createMockBook, createMockCopy, createMockRecord, createMockSlip, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';

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
    createInternalAuth: () => (_req: any, _res: any, next: any) => next(),
  };
});
jest.mock('../../../../shared/auth', () => {
  const actual = jest.requireActual('../../../../shared/auth');
  return {
    ...actual,
    createInternalAuth: () => (_req: any, _res: any, next: any) => next(),
  };
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

const PATRON_UUID = '11111111-1111-1111-1111-111111111111';
const authHeader = { Authorization: 'Bearer test-service-token' };

function buildCopy(overrides: any = {}) {
  const book = createMockBook();
  const copy = createMockCopy({ isAvailable: true, status: 'available', condition: 'good', ...overrides });
  (copy as any).book = book;
  return { book, copy };
}

function stubHappyPath(copy: any) {
  mockRepo.getCopiesByIds = jest.fn().mockResolvedValue(new Map([[copy.id, copy]]));
  mockRepo.getActiveBorrowsByPatron = jest.fn().mockResolvedValue([]);
  mockRepo.getOverdueBorrows = jest.fn().mockResolvedValue([]);
  mockRepo.countActiveBorrows = jest.fn().mockResolvedValue(0);
  mockRepo.setCopyAvailable = jest.fn().mockResolvedValue(undefined);
  mockRepo.getBookById = jest.fn().mockResolvedValue(copy.book);
  mockRepo.createSlip = jest.fn().mockImplementation((patronId: string, bookIds: string[], copyIds: (string | null)[]) => {
    const slip = createMockSlip({ patronId, totalItems: bookIds.length });
    const records = bookIds.map((bookId: string, i: number) =>
      createMockRecord({ patronId, bookId, copyId: copyIds[i] || undefined, slipId: slip.id })
    );
    return Promise.resolve({ slip, records });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo = createMockBorrowRepository();
});

async function postCreate(copyOverrides: any) {
  const { copy } = buildCopy(copyOverrides);
  stubHappyPath(copy);
  const res = await request(createInternalApp())
    .post('/borrow/internal/create')
    .set(authHeader)
    .send({ patronId: PATRON_UUID, bookCopies: [{ bookCopyId: copy.id }] });
  return res;
}

describe('POST /borrow/internal/create — copy condition gate', () => {
  it('blocks a minor_damage copy with 409 and creates nothing', async () => {
    const res = await postCreate({ condition: 'minor_damage' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.detail).toMatch(/hư hỏng nhẹ/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
    expect(mockRepo.setCopyAvailable).not.toHaveBeenCalled();
  });

  it('blocks a major_damage copy with 409 and creates nothing', async () => {
    const res = await postCreate({ condition: 'major_damage' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.detail).toMatch(/hư hỏng nặng/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a lost copy with 409 and creates nothing', async () => {
    const res = await postCreate({ condition: 'lost' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/mất/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a maintenance copy with 409 and creates nothing', async () => {
    const res = await postCreate({ status: 'maintenance' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/bảo trì/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a disposed copy with 409 and creates nothing', async () => {
    const res = await postCreate({ status: 'disposed' });
    expect(res.status).toBe(409);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('still allows a good-condition copy (control)', async () => {
    const res = await postCreate({ condition: 'good', status: 'available' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockRepo.createSlip).toHaveBeenCalledTimes(1);
  });

  it('still allows a new-condition copy (control)', async () => {
    const res = await postCreate({ condition: 'new', status: 'available' });
    expect(res.status).toBe(200);
    expect(mockRepo.createSlip).toHaveBeenCalledTimes(1);
  });
});
