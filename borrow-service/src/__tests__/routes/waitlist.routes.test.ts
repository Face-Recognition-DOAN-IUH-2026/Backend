import express, { Express } from 'express';
import request from 'supertest';
import borrowRoutes from '../../routes/borrow.routes';
import { HttpError } from '../../middlewares/errorHandler';

jest.mock('../../middlewares/auth', () => {
  const PATRON_UUID = '11111111-1111-1111-1111-111111111111';
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

const mockWaitlistRepo = {
  joinWaitlist: jest.fn(),
  cancelWaitlist: jest.fn(),
  getWaitlistByBook: jest.fn().mockResolvedValue([]),
  markNotified: jest.fn().mockResolvedValue(undefined),
  getWaitlistById: jest.fn().mockResolvedValue(null),
};

jest.mock('../../repositories/WaitlistRepository', () => ({
  WaitlistRepository: jest.fn().mockImplementation(() => mockWaitlistRepo),
}));

const mockBorrowRepo = {
  getBorrowsByPatron: jest.fn().mockResolvedValue([]),
  getCopyByBarcode: jest.fn().mockResolvedValue(null),
  getBookByIsbn: jest.fn().mockResolvedValue(null),
  getBookById: jest.fn().mockResolvedValue(null),
  getAllActiveBorrows: jest.fn().mockResolvedValue([]),
  listBooks: jest.fn().mockResolvedValue({ items: [], total: 0, stats: new Map() }),
  getBooksByIsbns: jest.fn().mockResolvedValue(new Map()),
  countCopies: jest.fn().mockResolvedValue(0),
  getCopyCountsByBookIds: jest.fn().mockResolvedValue(new Map()),
  getBarcodeOffsetsByBooks: jest.fn().mockResolvedValue(new Map()),
  copies: { createQueryBuilder: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]) }) },
};

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockBorrowRepo),
}));

jest.mock('../../clients/AccessServiceClient', () => ({
  isPatronInside: jest.fn().mockResolvedValue(true),
  getPatronAccessStatus: jest.fn().mockResolvedValue({ inside: true, isExpired: false, lastEntryAt: null, expiresAt: null, source: 'test' }),
  getPatronRawAccessStatus: jest.fn().mockResolvedValue({ inside: true, isExpired: false, lastEntryAt: null, expiresAt: null, source: 'test' }),
}));

jest.mock('../../clients/UserServiceClient', () => ({
  lookupPatronById: jest.fn().mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111', full_name: 'Test Patron', student_code: 'ST001', email: 'patron@test.com' }),
  lookupPatronByStudentCode: jest.fn().mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111', full_name: 'Test Patron', student_code: 'ST001', email: 'patron@test.com' }),
  lookupPatronsByIds: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('../../clients/GoogleBooksClient', () => ({
  fetchGoogleBooks: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../data-source', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      save: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    }),
    query: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../middlewares/errorHandler', () => ({
  HttpError: class HttpError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

jest.mock('../../utils/eventPublisher', () => ({
  publishEvent: jest.fn(),
}));

const PATRON_UUID = '11111111-1111-1111-1111-111111111111';
const BOOK_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function authHeaders(role = 'patron') {
  return { Authorization: 'Bearer test-token', 'x-test-role': role };
}

describe('Waitlist Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/borrow', borrowRoutes);
    app.use((err: any, _req: any, res: any, _next: any) => {
      if (err instanceof HttpError || err.statusCode) {
        return res.status(err.statusCode || 500).json({ detail: err.message });
      }
      res.status(500).json({ detail: 'Internal server error' });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /borrow/waitlist', () => {
    it('should join waitlist successfully', async () => {
      const entry = { id: 'wl-1', bookId: BOOK_ID, patronId: PATRON_UUID, status: 'waiting', createdAt: new Date() };
      mockWaitlistRepo.joinWaitlist.mockResolvedValue(entry);

      const res = await request(app)
        .post('/borrow/waitlist')
        .set(authHeaders())
        .send({ book_id: BOOK_ID });

      expect(res.status).toBe(201);
      expect(res.body.book_id).toBe(BOOK_ID);
      expect(res.body.status).toBe('waiting');
      expect(mockWaitlistRepo.joinWaitlist).toHaveBeenCalledWith(BOOK_ID, PATRON_UUID);
    });

    it('should return 409 if already on waitlist', async () => {
      const error = Object.assign(new Error('Already on waitlist for this book'), { statusCode: 409 });
      mockWaitlistRepo.joinWaitlist.mockRejectedValue(error);

      const res = await request(app)
        .post('/borrow/waitlist')
        .set(authHeaders())
        .send({ book_id: BOOK_ID });

      expect(res.status).toBe(409);
    });

    it('should return 404 if book not found', async () => {
      const error = Object.assign(new Error('Book not found'), { statusCode: 404 });
      mockWaitlistRepo.joinWaitlist.mockRejectedValue(error);

      const res = await request(app)
        .post('/borrow/waitlist')
        .set(authHeaders())
        .send({ book_id: BOOK_ID });

      expect(res.status).toBe(404);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/borrow/waitlist')
        .send({ book_id: BOOK_ID });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /borrow/waitlist/:id', () => {
    it('should cancel own waitlist entry', async () => {
      mockWaitlistRepo.cancelWaitlist.mockResolvedValue(undefined);

      const res = await request(app)
        .delete('/borrow/waitlist/wl-1')
        .set(authHeaders());

      expect(res.status).toBe(204);
      expect(mockWaitlistRepo.cancelWaitlist).toHaveBeenCalledWith('wl-1', PATRON_UUID);
    });

    it('should return 403 if not owner', async () => {
      const error = Object.assign(new Error('Not your waitlist entry'), { statusCode: 403 });
      mockWaitlistRepo.cancelWaitlist.mockRejectedValue(error);

      const res = await request(app)
        .delete('/borrow/waitlist/wl-1')
        .set(authHeaders());

      expect(res.status).toBe(403);
    });

    it('should return 404 if not found', async () => {
      const error = Object.assign(new Error('Waitlist entry not found'), { statusCode: 404 });
      mockWaitlistRepo.cancelWaitlist.mockRejectedValue(error);

      const res = await request(app)
        .delete('/borrow/waitlist/wl-nonexistent')
        .set(authHeaders());

      expect(res.status).toBe(404);
    });
  });

  describe('GET /borrow/waitlist', () => {
    it('should return patron waitlist entries', async () => {
      const res = await request(app)
        .get('/borrow/waitlist')
        .set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });
  });
});
