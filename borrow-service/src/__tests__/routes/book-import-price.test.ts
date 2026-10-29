import express, { Express } from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import bookRoutes from '../../routes/book.routes';
import { HttpError } from '../../../../shared/error-handler';
import { createMockBook, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { STAFF_UUID } from '../helpers/auth';

let mockRepo: MockBorrowRepository;

jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, res: any, next: any) => {
    const token = req.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    req.user = { id: STAFF_UUID, email: 'staff@test.com', role: 'staff' };
    next();
  },
  requireRole: (_roles: string[], _detail: string) => (req: any, _res: any, next: any) => next(),
  requireDynamicPermission: (_resource: string, _action: string) => (req: any, res: any, next: any) => {
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
    getBorrowLimits: jest.fn().mockResolvedValue({ maxBorrowBooks: 3, maxBorrowBooksPerSlip: 5, maxBorrowDays: 14 }),
  },
}));

function createBookApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/borrow', bookRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof HttpError) return res.status(err.statusCode).json({ error: err.message });
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed' });
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function buildXlsx(headers: string[], rows: any[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Books Import');
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as any);
}

const authHeader = { Authorization: 'Bearer test-token' };

beforeEach(() => {
  mockRepo = createMockBorrowRepository();
});

describe('POST /borrow/books/import/preview with price column', () => {
  it('returns the price parsed from the Price column', async () => {
    mockRepo.getBooksByIsbns.mockResolvedValue(new Map());
    mockRepo.getBarcodeOffsetsByBooks.mockResolvedValue(new Map());
    const file = await buildXlsx(['ISBN', 'Quantity', 'Price'], [['9780140328721', 2, 110000]]);

    const res = await request(createBookApp())
      .post('/borrow/books/import/preview')
      .set(authHeader)
      .attach('file', file, 'import.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].price).toBe(110000);
  });

  it('falls back to the existing book price when the file has no price', async () => {
    const book = createMockBook({ price: 150000 });
    mockRepo.getBooksByIsbns.mockResolvedValue(new Map([['9780140328721', book]]));
    mockRepo.getBarcodeOffsetsByBooks.mockResolvedValue(new Map());
    const file = await buildXlsx(['ISBN', 'Quantity'], [['9780140328721', 2]]);

    const res = await request(createBookApp())
      .post('/borrow/books/import/preview')
      .set(authHeader)
      .attach('file', file, 'import.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.rows[0].price).toBe(150000);
  });
});

describe('POST /borrow/books/import persists price', () => {
  it('saves the price for newly created books', async () => {
    mockRepo.getBooksByIsbns.mockResolvedValue(new Map());
    mockRepo.getBarcodeOffsetsByBooks.mockResolvedValue(new Map());
    const file = await buildXlsx(['ISBN', 'Quantity', 'Price'], [['9780140328721', 2, 110000]]);

    const res = await request(createBookApp())
      .post('/borrow/books/import')
      .set(authHeader)
      .attach('file', file, 'import.xlsx');

    expect(res.status).toBe(200);
    expect(mockRepo.upsertBook).toHaveBeenCalledWith(
      '9780140328721',
      'ISBN: 9780140328721',
      undefined,
      undefined,
      expect.objectContaining({ price: 110000 }),
    );
  });

  it('updates the price of existing books', async () => {
    const book = createMockBook({ price: 90000 });
    mockRepo.getBooksByIsbns.mockResolvedValue(new Map([['9780140328721', book]]));
    mockRepo.getBarcodeOffsetsByBooks.mockResolvedValue(new Map());
    (mockRepo as any).updateBook = jest.fn().mockResolvedValue({ ...book, price: 110000 });
    const file = await buildXlsx(['ISBN', 'Quantity', 'Price'], [['9780140328721', 2, 110000]]);

    const res = await request(createBookApp())
      .post('/borrow/books/import')
      .set(authHeader)
      .attach('file', file, 'import.xlsx');

    expect(res.status).toBe(200);
    expect(mockRepo.updateBook).toHaveBeenCalledWith(book.id, { price: 110000 });
  });
});

describe('POST /borrow/books/bulk-price', () => {
  it('updates the price for all selected books', async () => {
    (mockRepo as any).bulkUpdateBookPrices = jest.fn().mockResolvedValue({ updated: 3 });

    const res = await request(createBookApp())
      .post('/borrow/books/bulk-price')
      .set(authHeader)
      .send({ book_ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'], price: 120000 });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(3);
    expect((mockRepo as any).bulkUpdateBookPrices).toHaveBeenCalledWith(
      ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      120000,
    );
  });

  it('rejects a negative price with 400', async () => {
    const res = await request(createBookApp())
      .post('/borrow/books/bulk-price')
      .set(authHeader)
      .send({ book_ids: ['11111111-1111-1111-1111-111111111111'], price: -5000 });

    expect(res.status).toBe(400);
  });
});

describe('POST /borrow/copies/bulk-dispose', () => {
  const ID_A = '11111111-1111-1111-1111-111111111111';
  const ID_B = '22222222-2222-2222-2222-222222222222';

  it('deletes what it can and reports per-item skips', async () => {
    (mockRepo as any).disposeCopies = jest.fn().mockResolvedValue({
      deleted: [ID_A],
      skipped: [{ copy_id: ID_B, reason: 'Bản sao đang được mượn nên không thể xóa' }],
    });

    const res = await request(createBookApp())
      .post('/borrow/copies/bulk-dispose')
      .set(authHeader)
      .send({ copy_ids: [ID_A, ID_B] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(res.body.deleted_ids).toEqual([ID_A]);
    expect(res.body.skipped).toHaveLength(1);
    expect((mockRepo as any).disposeCopies).toHaveBeenCalledWith([ID_A, ID_B]);
  });

  it('returns 403 when the caller lacks books:delete', async () => {
    const disposeMock = jest.fn();
    (mockRepo as any).disposeCopies = disposeMock;

    const res = await request(createBookApp())
      .post('/borrow/copies/bulk-dispose')
      .set(authHeader)
      .set('x-test-deny-permission', '1')
      .send({ copy_ids: [ID_A] });

    expect(res.status).toBe(403);
    expect(disposeMock).not.toHaveBeenCalled();
  });
});
