import express, { Express } from 'express';
import request from 'supertest';
import * as AccessServiceClient from '../../clients/AccessServiceClient';
import * as UserServiceClient from '../../clients/UserServiceClient';
import { createMockBook, createMockCopy, createMockRecord, createMockSlip, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { PATRON_UUID, STAFF_UUID } from '../helpers/auth';

let mockRepo: MockBorrowRepository;

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
}));
jest.mock('../../clients/AccessServiceClient');
jest.mock('../../clients/UserServiceClient');
jest.mock('../../utils/eventPublisher');
jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, _res: any, next: any) => {
    req.user = { id: STAFF_UUID, email: 'staff@test.com', role: req.headers['x-test-role'] || 'staff' };
    next();
  },
  requireRole: (roles: string[], detail: string) => (req: any, res: any, next: any) => {
    const role = req.headers['x-test-role'] || 'staff';
    req.user = req.user || { id: STAFF_UUID, email: `${role}@test.com`, role };
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  requireDynamicPermission: (_resource: string, _action: string) => (req: any, res: any, next: any) => next(),
  internalAuth: (req: any, res: any, next: any) => {
    if (req.headers.authorization?.startsWith('Bearer ')) return next();
    res.status(401).json({ detail: 'Invalid token' });
  },
}));

function createApp(): Express {
  const app = express();
  app.use(express.json());
  const staffRoutes = require('../../routes/staff.routes').default;
  app.use('/borrow', staffRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
  });
  return app;
}

const PATRON = { id: PATRON_UUID, fullName: 'Test', student_code: 'SV001', studentCode: 'SV001' };

function stubPatronAndAccess() {
  (UserServiceClient as any).lookupPatronById = jest.fn().mockResolvedValue(PATRON);
  (AccessServiceClient as any).getPatronRawAccessStatus = jest.fn().mockResolvedValue({ inside: true, isExpired: false });
  (AccessServiceClient as any).getPatronAccessStatus = jest.fn().mockResolvedValue({ inside: true, isExpired: false });
}

function stubHappyPath() {
  mockRepo.getActiveBorrow = jest.fn().mockResolvedValue(null);
  mockRepo.getOverdueBorrows = jest.fn().mockResolvedValue([]);
  mockRepo.countActiveBorrows = jest.fn().mockResolvedValue(0);
  mockRepo.createSlip = jest.fn().mockImplementation((patronId: string, bookIds: string[], copyIds: (string | null)[]) => {
    const slip = createMockSlip({ patronId, totalItems: bookIds.length });
    const records = bookIds.map((bookId: string, i: number) =>
      createMockRecord({ patronId, bookId, copyId: copyIds[i] || undefined, slipId: slip.id })
    );
    return Promise.resolve({ slip, records });
  });
}

function buildCopy(overrides: Partial<ReturnType<typeof createMockCopy>> = {}) {
  const book = createMockBook();
  const copy = createMockCopy({ isAvailable: true, status: 'available', condition: 'good', ...overrides });
  (copy as any).book = book;
  return { book, copy };
}

const authHeaders = { Authorization: 'Bearer fake-token', 'X-Test-Role': 'staff' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo = createMockBorrowRepository();
  stubPatronAndAccess();
  stubHappyPath();
});

describe('POST /borrow/staff/slip/confirm — copy condition gate', () => {
  async function confirm(copyOverrides: any) {
    const { book, copy } = buildCopy(copyOverrides);
    mockRepo.copies.find = jest.fn().mockResolvedValue([copy]);
    mockRepo.books.find = jest.fn().mockResolvedValue([book]);

    const res = await request(createApp())
      .post('/borrow/staff/slip/confirm')
      .set(authHeaders)
      .send({
        patron_id: PATRON_UUID,
        items: [{ barcode: copy.barcode, book_id: book.id, copy_id: copy.id }],
      });
    return { res, copy };
  }

  it('blocks a minor_damage copy with 409 and creates nothing', async () => {
    const { res } = await confirm({ condition: 'minor_damage' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/hư hỏng nhẹ/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a major_damage copy with 409 and creates nothing', async () => {
    const { res } = await confirm({ condition: 'major_damage' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/hư hỏng nặng/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a lost copy with 409 and creates nothing', async () => {
    const { res } = await confirm({ condition: 'lost' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/mất/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a maintenance copy with 409 and creates nothing', async () => {
    const { res } = await confirm({ status: 'maintenance' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/bảo trì/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a disposed copy with 409 and creates nothing', async () => {
    const { res } = await confirm({ status: 'disposed' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/thanh lý/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('still allows a good-condition copy (control)', async () => {
    const { res } = await confirm({ condition: 'good', status: 'available' });
    expect(res.status).toBe(200);
    expect(mockRepo.createSlip).toHaveBeenCalledTimes(1);
  });

  it('still allows a new-condition copy (control)', async () => {
    const { res } = await confirm({ condition: 'new', status: 'available' });
    expect(res.status).toBe(200);
    expect(mockRepo.createSlip).toHaveBeenCalledTimes(1);
  });
});

describe('POST /borrow/staff/slip/create — copy condition gate', () => {
  async function create(copyOverrides: any) {
    const { book, copy } = buildCopy(copyOverrides);
    mockRepo.getCopyByBarcode = jest.fn().mockResolvedValue(copy);
    mockRepo.getBookById = jest.fn().mockResolvedValue(book);

    const res = await request(createApp())
      .post('/borrow/staff/slip/create')
      .set(authHeaders)
      .send({ patron_id: PATRON_UUID, items: [{ barcode: copy.barcode }] });
    return { res, copy };
  }

  it('blocks a minor_damage copy with 409 and creates nothing', async () => {
    const { res } = await create({ condition: 'minor_damage' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/hư hỏng nhẹ/i);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a major_damage copy with 409 and creates nothing', async () => {
    const { res } = await create({ condition: 'major_damage' });
    expect(res.status).toBe(409);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a lost copy with 409 and creates nothing', async () => {
    const { res } = await create({ condition: 'lost' });
    expect(res.status).toBe(409);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('blocks a maintenance copy with 409 and creates nothing', async () => {
    const { res } = await create({ status: 'maintenance' });
    expect(res.status).toBe(409);
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('still allows a good-condition copy (control)', async () => {
    const { res } = await create({ condition: 'good', status: 'available' });
    expect(res.status).toBe(200);
    expect(mockRepo.createSlip).toHaveBeenCalledTimes(1);
  });
});
