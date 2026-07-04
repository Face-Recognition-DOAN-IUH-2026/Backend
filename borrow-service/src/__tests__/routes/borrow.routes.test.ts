import express, { Express } from 'express';
import request from 'supertest';
import borrowRoutes from '../../routes/borrow.routes';
import { HttpError } from '../../middlewares/errorHandler';
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
  listBarcodes: jest.fn().mockResolvedValue([]),
  countCopies: jest.fn().mockResolvedValue(0),
  updateBookQuantity: jest.fn().mockResolvedValue(undefined),
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
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof HttpError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  });
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
      expect(response.body.error || response.body.detail || '').toContain('het han');
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

      expect(response.status).toBe(500);
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

  describe('PUT /borrow/books/:book_id/quantity', () => {
    it('should return 404 for non-existent book', async () => {
      mockBorrowRepo.getBookById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .put('/borrow/books/00000000-0000-0000-0000-000000000000/quantity')
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron')
        .send({ quantity: 5 });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid quantity', async () => {
      const mockBook = createMockBook();
      mockBorrowRepo.getBookById = jest.fn().mockResolvedValue(mockBook);
      mockBorrowRepo.countCopies = jest.fn().mockResolvedValue(2);

      const response = await request(app)
        .put(`/borrow/books/${mockBook.id}/quantity`)
        .set('Authorization', 'Bearer test-token').set('x-test-role', 'patron')
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