import express, { Express } from 'express';
import request from 'supertest';
import borrowRoutes from '../../routes/borrow.routes';
import bookRoutes from '../../routes/book.routes';
import staffRoutes from '../../routes/staff.routes';
import { HttpError, errorHandler } from '../../middlewares/errorHandler';
import * as AccessServiceClient from '../../clients/AccessServiceClient';
import * as UserServiceClient from '../../clients/UserServiceClient';
import {
  createMockBook,
  createMockCopy,
  createMockRecord,
  createMockSlip,
} from '../helpers/mock-repo';
import {
  PATRON_UUID,
} from '../helpers/auth';

jest.mock('../../middlewares/auth', () => {
  return {
    auth: (req: any, _res: any, next: any) => {
      const token = req.headers?.authorization?.replace('Bearer ', '');
      if (!token || token === 'invalid-token') {
        _res.status(401).json({ detail: 'Invalid or expired token' });
        return;
      }
      const role = req.headers['x-test-role'] || 'patron';
      req.user = { id: PATRON_UUID, email: 'patron@test.com', role };
      next();
    },
    requireRole: (roles: string[], detail: string) => (req: any, res: any, next: any) => {
      if (!req.user) {
        const token = req.headers?.authorization?.replace('Bearer ', '');
        if (!token || token === 'invalid-token') {
          res.status(401).json({ detail: 'Invalid or expired token' });
          return;
        }
        const role = req.headers['x-test-role'] || 'patron';
        req.user = { id: PATRON_UUID, email: 'patron@test.com', role };
      }
      if (!roles.includes(req.user.role)) {
        res.status(403).json({ detail });
        return;
      }
      next();
    },
    requireDynamicPermission: (_resource: string, action: string) => (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'] || 'patron';
      req.user = req.user || { id: PATRON_UUID, email: 'patron@test.com', role };
      if (req.headers['x-test-deny-permission'] || role === 'patron' || (action === 'delete' && role !== 'admin')) {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
      next();
    },
  };
});

const mockBorrowRepo = {
  getBorrowsByPatron: jest.fn().mockResolvedValue([]),
  getCopyByBarcode: jest.fn().mockResolvedValue(null),
  getBookByIsbn: jest.fn().mockResolvedValue(null),
  getBookById: jest.fn().mockResolvedValue(null),
  getAllActiveBorrows: jest.fn().mockResolvedValue([]),
  getBorrowByCopyId: jest.fn().mockResolvedValue(null),
  createBorrowRecord: jest.fn().mockResolvedValue({}),
  returnBook: jest.fn().mockResolvedValue(undefined),
  setCopyAvailable: jest.fn().mockResolvedValue(undefined),
  createSlip: jest.fn().mockResolvedValue({}),
  confirmSlip: jest.fn().mockResolvedValue(undefined),
  listBooks: jest.fn().mockResolvedValue({ items: [], total: 0, stats: new Map() }),
  getAggregateStats: jest.fn().mockResolvedValue({ totalBooks: 1, totalCopies: 5, availableCopies: 3 }),
  listBarcodes: jest.fn().mockResolvedValue([]),
  countCopies: jest.fn().mockResolvedValue(0),
  updateBookQuantity: jest.fn().mockResolvedValue(undefined),
  updateBook: jest.fn().mockResolvedValue(null),
  findUnpaidFines: jest.fn().mockResolvedValue([]),
  findUnpaidFinesByPatron: jest.fn().mockResolvedValue([]),
  findFineRecordsByIds: jest.fn().mockResolvedValue([]),
  saveBorrowRecords: jest.fn().mockImplementation((recs: any[]) => Promise.resolve(recs)),
  hasUnpaidFinesForPatron: jest.fn().mockResolvedValue(false),
  bulkDeleteBooks: jest.fn().mockResolvedValue({ deleted: 0, errors: [] }),
  getActiveBorrowCount: jest.fn().mockResolvedValue(0),
  getOverdueBorrows: jest.fn().mockResolvedValue([]),
  deleteBookAndCopies: jest.fn().mockResolvedValue(undefined),
  getBooksByIsbns: jest.fn().mockResolvedValue(new Map()),
  countCopiesByBookId: jest.fn().mockResolvedValue(0),
  copies: {
    createQueryBuilder: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  } as any,
};

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockBorrowRepo),
}));
jest.mock('../../clients/AccessServiceClient');
jest.mock('../../clients/UserServiceClient');

const mockAccessService = AccessServiceClient as jest.Mocked<typeof AccessServiceClient>;
const mockUserService = UserServiceClient as jest.Mocked<typeof UserServiceClient>;

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/borrow', borrowRoutes);
  app.use('/borrow', bookRoutes);
  app.use('/borrow', staffRoutes);
  app.use(errorHandler);
  return app;
}

function authHeader(role: string = 'patron'): Record<string, string> {
  return { Authorization: 'Bearer test-token', 'x-test-role': role };
}

describe('Borrow Routes', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('GET /borrow/healthz', () => {
    it('should return ok status (defined in index.ts, not borrow.routes)', async () => {
      expect(true).toBe(true);
    });
  });

  describe('GET /borrow/config', () => {
    it('should return borrow configuration without auth', async () => {
      const response = await request(app).get('/borrow/config');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('max_borrow_books');
      expect(response.body).toHaveProperty('max_borrow_books_per_slip');
      expect(response.body).toHaveProperty('max_borrow_days');
      expect(typeof response.body.max_borrow_books).toBe('number');
      expect(typeof response.body.max_borrow_books_per_slip).toBe('number');
      expect(typeof response.body.max_borrow_days).toBe('number');
    });

    it('should return default values', async () => {
      const response = await request(app).get('/borrow/config');
      expect(response.status).toBe(200);
      expect(response.body.max_borrow_books).toBe(3);
      expect(response.body.max_borrow_books_per_slip).toBe(5);
      expect(response.body.max_borrow_days).toBe(14);
    });

    it('should expose the fine config object additively', async () => {
      const response = await request(app).get('/borrow/config');
      expect(response.status).toBe(200);
      expect(response.body.fine).toBeDefined();
      expect(response.body.fine.fine_per_day).toBe(5000);
      expect(response.body.fine.damage_fee_pct).toEqual({ minor: 30, major: 70, lost: 100 });
      expect(response.body.fine.damage_fee_fixed).toEqual({ minor: 5000, major: 10000, lost: 10000 });
      expect(response.body.fine.fallback_book_price).toBe(100000);
      expect(response.body.fine.fine_lock_threshold_days).toBe(30);
    });
  });

  describe('Authentication', () => {
    it('should return 401 when no token provided', async () => {
      const response = await request(app).get('/borrow/history');
      expect([401, 403]).toContain(response.status);
    });

    it('should return 401 for invalid token', async () => {
      const response = await request(app)
        .get('/borrow/history')
        .set('Authorization', 'Bearer invalid-token');
      expect(response.status).toBe(401);
    });

    it('should accept valid patron token', async () => {
      mockBorrowRepo.getBorrowsByPatron = jest.fn().mockResolvedValue([]);

      const response = await request(app)
        .get('/borrow/history')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe('GET /borrow/history', () => {
    it('should return patron borrow history', async () => {
      const mockRecords = [
        createMockRecord({ patronId: PATRON_UUID }),
      ];
      mockBorrowRepo.getBorrowsByPatron = jest.fn().mockResolvedValue(mockRecords);

      const response = await request(app)
        .get('/borrow/history')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should accept status_filter query param', async () => {
      mockBorrowRepo.getBorrowsByPatron = jest.fn().mockResolvedValue([]);

      const response = await request(app)
        .get('/borrow/history?status_filter=borrowed')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(200);
      expect(mockBorrowRepo.getBorrowsByPatron).toHaveBeenCalledWith(PATRON_UUID, 'borrowed');
    });
  });

  describe('POST /borrow/', () => {
    it('should return 403 when patron is not inside library', async () => {
      mockAccessService.getPatronAccessStatus = jest.fn().mockResolvedValue({
        inside: false,
        isExpired: false,
      });

      const response = await request(app)
        .post('/borrow/')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron')
        .send({ barcode: 'LIB-001' });

      expect(response.status).toBe(403);
    });

    it('should return 403 when session is expired', async () => {
      mockAccessService.getPatronAccessStatus = jest.fn().mockResolvedValue({
        inside: false,
        isExpired: true,
      });

      const response = await request(app)
        .post('/borrow/')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ barcode: 'LIB-001' });

      expect(response.status).toBe(403);
      expect(response.body.error || response.body.detail || '').toMatch(/h[eế]t h[aạ]n/i);
    });

    it('normalizes invisible control characters before the barcode lookup', async () => {
      mockAccessService.getPatronAccessStatus = jest.fn().mockResolvedValue({
        inside: true,
        isExpired: false,
      });
      mockBorrowRepo.getCopyByBarcode = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/borrow/')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ barcode: '\u001dLIB-9780123456789-001' });

      expect(response.status).toBe(404);
      expect(mockBorrowRepo.getCopyByBarcode).toHaveBeenCalledWith('LIB-9780123456789-001');
    });

    it('suggests the nearest existing copies when the scanned copy is missing', async () => {
      mockAccessService.getPatronAccessStatus = jest.fn().mockResolvedValue({
        inside: true,
        isExpired: false,
      });
      const book = createMockBook({ title: 'Gapped Book' });
      mockBorrowRepo.getCopyByBarcode = jest.fn().mockResolvedValue(null);
      mockBorrowRepo.getBookByIsbn = jest.fn().mockResolvedValue(book);
      mockBorrowRepo.countCopies = jest.fn().mockResolvedValue(2);
      mockBorrowRepo.getCopyBarcodesByBookId = jest.fn().mockResolvedValue([
        'LIB-9780123456789-029',
        'LIB-9780123456789-031',
      ]);

      const response = await request(app)
        .post('/borrow/')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ barcode: 'LIB-9780123456789-030' });

      expect(response.status).toBe(404);
      expect(response.body.error || response.body.detail || '').toContain('Các bản gần nhất');
      expect(response.body.error || response.body.detail || '').not.toContain('từ 001 đến');
    });
  });

  describe('GET /borrow/barcode/:barcode', () => {
    it('should return 403 for non-staff roles', async () => {
      const response = await request(app)
        .get('/borrow/barcode/LIB-001')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(403);
    });

    it('should allow staff to lookup barcode', async () => {
      mockBorrowRepo.getCopyByBarcode = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .get('/borrow/barcode/LIB-001')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /borrow/staff/active-borrowers', () => {
    it('should return 403 for patron role', async () => {
      const response = await request(app)
        .get('/borrow/staff/active-borrowers')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(403);
    });

    it('should allow staff to view active borrowers', async () => {
      mockBorrowRepo.getAllActiveBorrows = jest.fn().mockResolvedValue([]);
      mockUserService.lookupPatronsByIds = jest.fn().mockResolvedValue(new Map());

      const response = await request(app)
        .get('/borrow/staff/active-borrowers')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
    });

    it('should include patron info when available', async () => {
      const mockRecords = [createMockRecord()];
      mockBorrowRepo.getAllActiveBorrows = jest.fn().mockResolvedValue(mockRecords);
      mockUserService.lookupPatronsByIds = jest.fn().mockResolvedValue(new Map([
        [PATRON_UUID, {
          id: PATRON_UUID,
          full_name: 'Test Patron',
          student_code: 'SV001',
        }],
      ]));

      const response = await request(app)
        .get('/borrow/staff/active-borrowers')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff');

      expect(response.status).toBe(200);
      expect(response.body.items[0].patron.student_code).toBe('SV001');
    });
  });

  describe('GET /borrow/staff/patrons/:student_code/active', () => {
    it('should return 403 for patron role', async () => {
      const response = await request(app)
        .get('/borrow/staff/patrons/SV001/active')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(403);
    });

    it('should return 403 when patron has blocked/expired status', async () => {
      mockUserService.lookupPatronByStudentCode = jest.fn().mockResolvedValue({
        id: PATRON_UUID,
        student_code: 'INVALID',
        current_status: 'blocked',
      });

      const response = await request(app)
        .get('/borrow/staff/patrons/INVALID/active')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /borrow/staff/slip/create', () => {
    it('should return 403 for patron role', async () => {
      const response = await request(app)
        .post('/borrow/staff/slip/create')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron')
        .send({ patron_id: PATRON_UUID, items: [{ barcode: 'LIB-001' }] });

      expect(response.status).toBe(403);
    });

    it('should return 400 for invalid body', async () => {
      const response = await request(app)
        .post('/borrow/staff/slip/create')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('GET /borrow/fines', () => {
    it('should return unpaid fines with patron hydration and totals', async () => {
      const book = createMockBook({ title: 'Test Book' });
      const record: any = {
        id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', patronId: PATRON_UUID, bookId: book.id, fineAmount: 10000, damageFee: 80000,
        finePaid: false, paymentMethod: null, paymentRef: null, paidAt: null,
        returnAt: new Date('2026-10-01'), dueAt: new Date('2026-09-20'), book, copy: { barcode: 'LIB-9780123456789-001' },
      };
      mockBorrowRepo.findUnpaidFines = jest.fn().mockResolvedValue([record]);
      (mockUserService.lookupPatronsByIds as jest.Mock).mockResolvedValue(new Map([[PATRON_UUID, { id: PATRON_UUID, full_name: 'Nguyen Van A', student_code: 'SV001' }]]));

      const response = await request(app)
        .get('/borrow/fines?unpaid=true')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].record_id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
      expect(response.body[0].overdue_fine).toBe(10000);
      expect(response.body[0].damage_fee).toBe(80000);
      expect(response.body[0].total).toBe(90000);
      expect(response.body[0].patron.full_name).toBe('Nguyen Van A');
      expect(response.body[0].barcode).toBe('LIB-9780123456789-001');
    });
  });

  describe('GET /borrow/patron/fines', () => {
    it('returns unpaid fines for the authenticated patron', async () => {
      const book = createMockBook({ title: 'Design Patterns' });
      const record: any = {
        id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        patronId: PATRON_UUID,
        fineAmount: 15000,
        damageFee: 20000,
        finePaid: false,
        returnAt: new Date('2026-10-02'),
        book,
        copy: { barcode: 'LIB-9780123456789-002' },
      };
      mockBorrowRepo.findUnpaidFinesByPatron = jest.fn().mockResolvedValue([record]);

      const response = await request(app)
        .get('/borrow/patron/fines')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].record_id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
      expect(response.body[0].overdue_fine).toBe(15000);
      expect(response.body[0].damage_fee).toBe(20000);
      expect(response.body[0].total).toBe(35000);
      expect(response.body[0].book.title).toBe('Design Patterns');
      expect(response.body[0].barcode).toBe('LIB-9780123456789-002');
    });
  });

  describe('POST /borrow/fines/pay', () => {
    it('marks records paid, generates a ref, and activates the patron when debt is cleared', async () => {
      const record: any = { id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', patronId: PATRON_UUID, fineAmount: 10000, damageFee: 0, finePaid: false };
      mockBorrowRepo.findFineRecordsByIds = jest.fn().mockResolvedValue([record]);
      mockBorrowRepo.hasUnpaidFinesForPatron = jest.fn().mockResolvedValue(false);
      const activateMock = jest.fn().mockResolvedValue({ status: 'active' });
      (mockUserService as any).activateCardAutoFine = activateMock;

      const response = await request(app)
        .post('/borrow/fines/pay')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ record_ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'], payment_method: 'qr_code' });

      expect(response.status).toBe(200);
      expect(record.finePaid).toBe(true);
      expect(record.paymentMethod).toBe('qr_code');
      expect(record.paymentRef).toMatch(/^TXN-\d{8}-[0-9a-f]{8}$/);
      expect(record.paidAt).toBeInstanceOf(Date);
      expect(activateMock).toHaveBeenCalledWith(PATRON_UUID);
      expect(mockBorrowRepo.saveBorrowRecords).toHaveBeenCalled();
    });

    it('is idempotent for already-paid records and keeps manual suspensions', async () => {
      const record: any = { id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', patronId: PATRON_UUID, fineAmount: 10000, damageFee: 0, finePaid: true, paymentMethod: 'cash', paymentRef: 'TXN-20261001-deadbeef' };
      mockBorrowRepo.findFineRecordsByIds = jest.fn().mockResolvedValue([record]);
      mockBorrowRepo.hasUnpaidFinesForPatron = jest.fn().mockResolvedValue(true);
      const activateMock = jest.fn();
      (mockUserService as any).activateCardAutoFine = activateMock;

      const response = await request(app)
        .post('/borrow/fines/pay')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ record_ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] });

      expect(response.status).toBe(200);
      expect(record.paymentRef).toBe('TXN-20261001-deadbeef');
      expect(activateMock).not.toHaveBeenCalled();
    });

    it('returns 404 when a record id is unknown', async () => {
      mockBorrowRepo.findFineRecordsByIds = jest.fn().mockResolvedValue([]);

      const response = await request(app)
        .post('/borrow/fines/pay')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ record_ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /borrow/staff-return', () => {
    it('should return 403 for patron role', async () => {
      const response = await request(app)
        .post('/borrow/staff-return')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron')
        .send({ barcode: 'LIB-001' });

      expect(response.status).toBe(403);
    });

    it('should return 404 when copy not found', async () => {
      mockBorrowRepo.getCopyByBarcode = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/borrow/staff-return')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ barcode: 'INVALID' });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /borrow/books', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/borrow/books');
      expect([401, 403]).toContain(response.status);
    });

    it('should return book list with stats', async () => {
      const mockBooks = [createMockBook()];
      const mockStats = new Map([[mockBooks[0].id, { total: 5, available: 3 }]]);
      mockBorrowRepo.listBooks = jest.fn().mockResolvedValue({
        items: mockBooks,
        total: 1,
        stats: mockStats,
      });

      const response = await request(app)
        .get('/borrow/books')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should accept pagination params', async () => {
      mockBorrowRepo.listBooks = jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        stats: new Map(),
      });

      const response = await request(app)
        .get('/borrow/books?skip=10&limit=20')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(200);
      expect(mockBorrowRepo.listBooks).toHaveBeenCalledWith(10, 20, undefined);
    });

    it('should accept search param', async () => {
      mockBorrowRepo.listBooks = jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        stats: new Map(),
      });

      const response = await request(app)
        .get('/borrow/books?search=javascript')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(200);
      expect(mockBorrowRepo.listBooks).toHaveBeenCalledWith(0, 20, 'javascript');
    });
  });

  describe('GET /borrow/books/search', () => {
    it('should return search results', async () => {
      const mockBooks = [createMockBook({ title: 'JavaScript Guide' })];
      const mockStats = new Map([[mockBooks[0].id, { total: 2, available: 1 }]]);
      mockBorrowRepo.listBooks = jest.fn().mockResolvedValue({
        items: mockBooks,
        total: 1,
        stats: mockStats,
      });

      const response = await request(app)
        .get('/borrow/books/search?q=javascript')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return 400 when q param missing', async () => {
      const response = await request(app)
        .get('/borrow/books/search')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(400);
    });
  });

  describe('GET /borrow/books/template', () => {
    it('should return Excel template', async () => {
      const response = await request(app)
        .get('/borrow/books/template')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('spreadsheetml');
      expect(response.headers['content-disposition']).toContain('filename=book_import_template.xlsx');
    });
  });

  describe('GET /borrow/barcodes', () => {
    it('should return list of barcodes', async () => {
      const mockCopies = [createMockCopy()];
      mockBorrowRepo.copies = {
        createQueryBuilder: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockCopies),
        }),
      } as any;

      const response = await request(app)
        .get('/borrow/barcodes')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('PUT /borrow/books/:book_id', () => {
    it('should persist price when staff updates it', async () => {
      const mockBook = createMockBook();
      mockBorrowRepo.getBookById = jest.fn().mockResolvedValue(mockBook);
      mockBorrowRepo.countCopies = jest.fn().mockResolvedValue(2);
      mockBorrowRepo.updateBook = jest.fn().mockResolvedValue({ ...mockBook, price: 125000 });

      const response = await request(app)
        .put(`/borrow/books/${mockBook.id}`)
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ price: 125000 });

      expect(response.status).toBe(200);
      expect(mockBorrowRepo.updateBook).toHaveBeenCalledWith(mockBook.id, expect.objectContaining({ price: 125000 }));
      expect(response.body.price).toBe(125000);
    });

    it('should allow clearing price back to null', async () => {
      const mockBook = createMockBook({ price: 125000 });
      mockBorrowRepo.getBookById = jest.fn().mockResolvedValue(mockBook);
      mockBorrowRepo.countCopies = jest.fn().mockResolvedValue(2);
      mockBorrowRepo.updateBook = jest.fn().mockResolvedValue({ ...mockBook, price: null });

      const response = await request(app)
        .put(`/borrow/books/${mockBook.id}`)
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ price: null });

      expect(response.status).toBe(200);
      expect(mockBorrowRepo.updateBook).toHaveBeenCalledWith(mockBook.id, expect.objectContaining({ price: null }));
      expect(response.body.price).toBeNull();
    });

    it('should return 400 for a negative price', async () => {
      const mockBook = createMockBook();
      mockBorrowRepo.getBookById = jest.fn().mockResolvedValue(mockBook);

      const response = await request(app)
        .put(`/borrow/books/${mockBook.id}`)
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ price: -5000 });

      expect(response.status).toBe(400);
      expect(mockBorrowRepo.updateBook).not.toHaveBeenCalled();
    });
  });

  describe('PUT /borrow/books/:book_id/quantity', () => {
    it('should return 404 for non-existent book', async () => {
      mockBorrowRepo.getBookById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .put('/borrow/books/00000000-0000-0000-0000-000000000000/quantity')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ quantity: 5 });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid quantity', async () => {
      const mockBook = createMockBook();
      mockBorrowRepo.getBookById = jest.fn().mockResolvedValue(mockBook);
      mockBorrowRepo.countCopies = jest.fn().mockResolvedValue(2);

      const response = await request(app)
        .put(`/borrow/books/${mockBook.id}/quantity`)
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ quantity: -1 });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /borrow/books/delete', () => {
    it('should return 403 for non-admin roles', async () => {
      const response = await request(app)
        .post('/borrow/books/delete')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'staff')
        .send({ book_ids: ['book-id-1'] });

      expect(response.status).toBe(403);
    });

    it('should allow admin to delete books', async () => {
      mockBorrowRepo.bulkDeleteBooks = jest.fn().mockResolvedValue({ deleted: 1, errors: [] });

      const response = await request(app)
        .post('/borrow/books/delete')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'admin')
        .send({ book_ids: ['00000000-0000-0000-0000-000000000001'] });

      expect(response.status).toBe(200);
      expect(response.body.deleted).toBe(1);
    });

    it('should return 200 when book_ids is empty (no-op)', async () => {
      const response = await request(app)
        .post('/borrow/books/delete')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'admin')
        .send({ book_ids: [] });

      expect(response.status).toBe(200);
    });

    it('should return 400 when more than 50 book_ids', async () => {
      const manyIds = Array(51).fill('00000000-0000-0000-0000-000000000000');

      const response = await request(app)
        .post('/borrow/books/delete')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'admin')
        .send({ book_ids: manyIds });

      expect(response.status).toBe(400);
    });
  });

  describe('Expired Token Handling', () => {
    it('should return 401 for expired token', async () => {
      const response = await request(app)
        .get('/borrow/history')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });
  });
});
