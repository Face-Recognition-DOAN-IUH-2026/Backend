import express, { Express } from 'express';
import request from 'supertest';
import bookRoutes from '../../routes/book.routes';
import borrowRoutes from '../../routes/borrow.routes';
import { HttpError } from '../../../../shared/error-handler';
import { createMockBook, createMockCopy, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { PATRON_UUID, STAFF_UUID } from '../helpers/auth';
import * as AccessServiceClient from '../../clients/AccessServiceClient';

let mockRepo: MockBorrowRepository;

jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, res: any, next: any) => {
    const token = req.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    const role = req.headers['x-test-role'] || 'staff';
    req.user = { id: role === 'patron' ? PATRON_UUID : STAFF_UUID, email: `${role}@test.com`, role };
    next();
  },
  requireRole: (roles: string[], detail: string) => (req: any, res: any, next: any) => {
    if (!req.user) {
      const role = req.headers['x-test-role'] || 'staff';
      req.user = { id: role === 'patron' ? PATRON_UUID : STAFF_UUID, email: `${role}@test.com`, role };
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  requireDynamicPermission: (_resource: string, _action: string) => (req: any, res: any, next: any) => {
    const role = req.headers['x-test-role'] || 'staff';
    req.user = req.user || { id: role === 'patron' ? PATRON_UUID : STAFF_UUID, email: `${role}@test.com`, role };
    if (req.headers['x-test-deny-permission']) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
    next();
  },
}));

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
}));
jest.mock('../../data-source', () => ({
  AppDataSource: {
    transaction: (cb: any) => cb({ save: jest.fn().mockResolvedValue(undefined) }),
    getRepository: jest.fn(),
  },
}));
jest.mock('../../utils/eventPublisher');
jest.mock('../../clients/AccessServiceClient');
jest.mock('../../services/ConfigService', () => ({
  configService: {
    getBorrowLimits: jest.fn().mockResolvedValue({
      maxBorrowBooks: 3,
      maxBorrowBooksPerSlip: 5,
      maxBorrowDays: 14,
    }),
  },
}));

const mockAccessService = AccessServiceClient as jest.Mocked<typeof AccessServiceClient>;

function createBookApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/borrow', bookRoutes);
  app.use(errorHandler);
  return app;
}

function createBorrowApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/borrow', borrowRoutes);
  app.use(errorHandler);
  return app;
}

function errorHandler(err: any, _req: any, res: any, _next: any) {
  if (err instanceof HttpError) return res.status(err.statusCode).json({ error: err.message });
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed' });
  res.status(500).json({ error: 'Internal server error' });
}

const authHeader = { Authorization: 'Bearer test-token' };

beforeEach(() => {
  mockRepo = createMockBorrowRepository();
});

describe('GET /borrow/books/:book_id/copies', () => {
  it('lists copies with condition, status and imported_at', async () => {
    const now = new Date();
    mockRepo.getBookById.mockResolvedValue(createMockBook());
    mockRepo.listCopiesByBook.mockResolvedValue([
      createMockCopy({ condition: 'good', status: 'available', importedAt: now }),
      createMockCopy({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', barcode: 'LIB-9780123456789-002', condition: 'major_damage', status: 'borrowed', importedAt: now }),
    ]);

    const res = await request(createBookApp())
      .get(`/borrow/books/${createMockBook().id}/copies`)
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0]).toMatchObject({
      barcode: 'LIB-9780123456789-001',
      condition: 'good',
      status: 'available',
    });
    expect(res.body.items[0].imported_at).toBeDefined();
    expect(res.body.items[1].condition).toBe('major_damage');
  });

  it('returns 404 for an unknown book', async () => {
    mockRepo.getBookById.mockResolvedValue(null);

    const res = await request(createBookApp())
      .get('/borrow/books/11111111-1111-1111-1111-111111111111/copies')
      .set(authHeader);

    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller lacks books:read', async () => {
    const res = await request(createBookApp())
      .get('/borrow/books/11111111-1111-1111-1111-111111111111/copies')
      .set(authHeader)
      .set('x-test-deny-permission', '1');

    expect(res.status).toBe(403);
    expect(mockRepo.listCopiesByBook).not.toHaveBeenCalled();
  });

  it('returns 401 without a token', async () => {
    const res = await request(createBookApp()).get('/borrow/books/11111111-1111-1111-1111-111111111111/copies');
    expect(res.status).toBe(401);
  });
});

describe('POST /borrow/copies', () => {
  it('creates a copy with explicit condition and status', async () => {
    const now = new Date('2026-01-15T00:00:00.000Z');
    mockRepo.getBookById.mockResolvedValue(createMockBook());
    mockRepo.createCopy.mockResolvedValue(
      createMockCopy({ condition: 'minor_damage', status: 'maintenance', importedAt: now }),
    );

    const res = await request(createBookApp())
      .post('/borrow/copies')
      .set(authHeader)
      .send({
        book_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        barcode: 'LIB-9780123456789-010',
        shelf_location: 'A-3',
        condition: 'minor_damage',
        status: 'maintenance',
        imported_at: '2026-01-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.copy).toMatchObject({ condition: 'minor_damage', status: 'maintenance' });
    expect(mockRepo.createCopy).toHaveBeenCalledWith(
      expect.any(String),
      'LIB-9780123456789-010',
      'A-3',
      expect.objectContaining({ condition: 'minor_damage', status: 'maintenance' }),
    );
  });

  it('defaults condition to good and status to available when omitted', async () => {
    mockRepo.getBookById.mockResolvedValue(createMockBook());
    mockRepo.createCopy.mockResolvedValue(createMockCopy({ condition: 'good', status: 'available' }));

    const res = await request(createBookApp())
      .post('/borrow/copies')
      .set(authHeader)
      .send({ book_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', barcode: 'LIB-9780123456789-011' });

    expect(res.status).toBe(201);
    expect(mockRepo.createCopy).toHaveBeenCalledWith(
      expect.any(String),
      'LIB-9780123456789-011',
      null,
      expect.objectContaining({ condition: 'good', status: 'available' }),
    );
  });

  it('rejects an unknown condition code with 400', async () => {
    const res = await request(createBookApp())
      .post('/borrow/copies')
      .set(authHeader)
      .send({ book_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', barcode: 'LIB-1', condition: 'shredded' });

    expect(res.status).toBe(400);
    expect(mockRepo.createCopy).not.toHaveBeenCalled();
  });

  it('rejects an unknown status code with 400', async () => {
    const res = await request(createBookApp())
      .post('/borrow/copies')
      .set(authHeader)
      .send({ book_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', barcode: 'LIB-1', status: 'retired' });

    expect(res.status).toBe(400);
    expect(mockRepo.createCopy).not.toHaveBeenCalled();
  });

  it('maps a duplicate barcode unique violation to 400', async () => {
    mockRepo.getBookById.mockResolvedValue(createMockBook());
    mockRepo.createCopy.mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));

    const res = await request(createBookApp())
      .post('/borrow/copies')
      .set(authHeader)
      .send({ book_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', barcode: 'LIB-9780123456789-001' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 404 when the parent book does not exist', async () => {
    mockRepo.getBookById.mockResolvedValue(null);

    const res = await request(createBookApp())
      .post('/borrow/copies')
      .set(authHeader)
      .send({ book_id: '11111111-1111-1111-1111-111111111111', barcode: 'LIB-1' });

    expect(res.status).toBe(404);
    expect(mockRepo.createCopy).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller lacks books:create', async () => {
    const res = await request(createBookApp())
      .post('/borrow/copies')
      .set(authHeader)
      .set('x-test-deny-permission', '1')
      .send({ book_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', barcode: 'LIB-1' });

    expect(res.status).toBe(403);
    expect(mockRepo.createCopy).not.toHaveBeenCalled();
  });
});

describe('PATCH /borrow/copies/:id', () => {
  it('updates condition and records a history row', async () => {
    const copy = createMockCopy({ condition: 'good', status: 'available' });
    mockRepo.getCopyById.mockResolvedValue(copy);
    mockRepo.updateCopy.mockResolvedValue({ ...copy, condition: 'lost', status: 'disposed' });

    const res = await request(createBookApp())
      .patch(`/borrow/copies/${copy.id}`)
      .set(authHeader)
      .send({ condition: 'lost', status: 'disposed' });

    expect(res.status).toBe(200);
    expect(res.body.copy.condition).toBe('lost');
    expect(mockRepo.insertConditionHistory).toHaveBeenCalledWith(
      copy.id,
      'lost',
      expect.any(String),
      expect.anything(),
    );
  });

  it('updates shelf location without touching condition history', async () => {
    const copy = createMockCopy();
    mockRepo.getCopyById.mockResolvedValue(copy);
    mockRepo.updateCopy.mockResolvedValue({ ...copy, shelfLocation: 'B-9' });

    const res = await request(createBookApp())
      .patch(`/borrow/copies/${copy.id}`)
      .set(authHeader)
      .send({ shelf_location: 'B-9' });

    expect(res.status).toBe(200);
    expect(mockRepo.insertConditionHistory).not.toHaveBeenCalled();
  });

  it('rejects an unknown condition code with 400', async () => {
    const res = await request(createBookApp())
      .patch('/borrow/copies/cccccccc-cccc-cccc-cccc-cccccccccccc')
      .set(authHeader)
      .send({ condition: 'wrecked' });

    expect(res.status).toBe(400);
    expect(mockRepo.updateCopy).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown copy', async () => {
    mockRepo.getCopyById.mockResolvedValue(null);

    const res = await request(createBookApp())
      .patch('/borrow/copies/cccccccc-cccc-cccc-cccc-cccccccccccc')
      .set(authHeader)
      .send({ condition: 'good' });

    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller lacks books:update', async () => {
    const res = await request(createBookApp())
      .patch('/borrow/copies/cccccccc-cccc-cccc-cccc-cccccccccccc')
      .set(authHeader)
      .set('x-test-deny-permission', '1')
      .send({ condition: 'good' });

    expect(res.status).toBe(403);
    expect(mockRepo.updateCopy).not.toHaveBeenCalled();
  });
});

describe('DELETE /borrow/copies/:id', () => {
  it('deletes a copy that is not on loan', async () => {
    const copy = createMockCopy();
    (mockRepo as any).disposeCopy = jest.fn().mockResolvedValue({ detached: 2 });

    const res = await request(createBookApp())
      .delete(`/borrow/copies/${copy.id}`)
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: 1 });
    expect((mockRepo as any).disposeCopy).toHaveBeenCalledWith(copy.id);
  });

  it('returns 409 when the copy has an active borrow', async () => {
    (mockRepo as any).disposeCopy = jest.fn().mockRejectedValue(new HttpError(409, 'Bản sao đang được mượn nên không thể xóa'));

    const res = await request(createBookApp())
      .delete(`/borrow/copies/${createMockCopy().id}`)
      .set(authHeader);

    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown copy', async () => {
    (mockRepo as any).disposeCopy = jest.fn().mockRejectedValue(new HttpError(404, 'Bản sao không tồn tại'));

    const res = await request(createBookApp())
      .delete('/borrow/copies/cccccccc-cccc-cccc-cccc-cccccccccccc')
      .set(authHeader);

    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller lacks books:delete', async () => {
    const disposeMock = jest.fn();
    (mockRepo as any).disposeCopy = disposeMock;

    const res = await request(createBookApp())
      .delete('/borrow/copies/cccccccc-cccc-cccc-cccc-cccccccccccc')
      .set(authHeader)
      .set('x-test-deny-permission', '1');

    expect(res.status).toBe(403);
    expect(disposeMock).not.toHaveBeenCalled();
  });
});

describe('POST /borrow/ — condition-aware direct borrow', () => {
  beforeEach(() => {
    (mockAccessService.getPatronAccessStatus as jest.Mock).mockResolvedValue({ inside: true, isExpired: false });
    mockRepo.countCopies.mockResolvedValue(1);
    mockRepo.getActiveBorrow.mockResolvedValue(null);
    mockRepo.getOverdueBorrows.mockResolvedValue([]);
    mockRepo.countActiveBorrows.mockResolvedValue(0);
    mockRepo.createBorrowRecord.mockImplementation((patronId: string, bookId: string, copyId: string) =>
      Promise.resolve({ id: 'rec-1', patronId, bookId, copyId, dueAt: new Date(), status: 'borrowed' }),
    );
  });

  it('rejects with 409 when the scanned copy is in maintenance', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ condition: 'good', status: 'maintenance', isAvailable: true });
    (copy as any).book = book;
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);

    const res = await request(createBorrowApp())
      .post('/borrow/')
      .set(authHeader)
      .set('x-test-role', 'staff')
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(409);
    expect(mockRepo.createBorrowRecord).not.toHaveBeenCalled();
  });

  it('rejects with 409 when the scanned copy condition is lost', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ condition: 'lost', status: 'available', isAvailable: true });
    (copy as any).book = book;
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);

    const res = await request(createBorrowApp())
      .post('/borrow/')
      .set(authHeader)
      .set('x-test-role', 'staff')
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(409);
    expect(mockRepo.createBorrowRecord).not.toHaveBeenCalled();
  });

  it('rejects with 409 when the scanned copy is disposed', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ condition: 'good', status: 'disposed', isAvailable: true });
    (copy as any).book = book;
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);

    const res = await request(createBorrowApp())
      .post('/borrow/')
      .set(authHeader)
      .set('x-test-role', 'staff')
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(409);
    expect(mockRepo.createBorrowRecord).not.toHaveBeenCalled();
  });

  it('borrows a good-condition copy and creates a record', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ condition: 'good', status: 'available', isAvailable: true });
    (copy as any).book = book;
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);

    const res = await request(createBorrowApp())
      .post('/borrow/')
      .set(authHeader)
      .set('x-test-role', 'staff')
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(200);
    expect(mockRepo.createBorrowRecord).toHaveBeenCalledTimes(1);
    expect(copy.isAvailable).toBe(false);
    expect(copy.status).toBe('borrowed');
  });

  it('blocks a major_damage copy with 409 and creates nothing', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ condition: 'major_damage', status: 'available', isAvailable: true });
    (copy as any).book = book;
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);

    const res = await request(createBorrowApp())
      .post('/borrow/')
      .set(authHeader)
      .set('x-test-role', 'staff')
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(409);
    expect(mockRepo.createBorrowRecord).not.toHaveBeenCalled();
  });

  it('blocks a minor_damage copy with 409 and creates nothing', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ condition: 'minor_damage', status: 'available', isAvailable: true });
    (copy as any).book = book;
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);

    const res = await request(createBorrowApp())
      .post('/borrow/')
      .set(authHeader)
      .set('x-test-role', 'staff')
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(409);
    expect(mockRepo.createBorrowRecord).not.toHaveBeenCalled();
  });
});
