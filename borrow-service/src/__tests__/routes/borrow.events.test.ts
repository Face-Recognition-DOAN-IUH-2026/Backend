import express, { Express } from 'express';
import request from 'supertest';
import { HttpError } from '../../../../shared';
import { AppDataSource } from '../../data-source';
import * as AccessServiceClient from '../../clients/AccessServiceClient';
import * as UserServiceClient from '../../clients/UserServiceClient';
import * as eventPublisher from '../../utils/eventPublisher';
import { createMockBook, createMockCopy, createMockRecord, createMockSlip, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { PATRON_UUID, STAFF_UUID } from '../helpers/auth';

let mockRepo: MockBorrowRepository;

jest.mock('../../repositories/BorrowRepository', () => {
  return {
    BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
  };
});
jest.mock('../../clients/AccessServiceClient');
jest.mock('../../clients/UserServiceClient');
jest.mock('../../utils/eventPublisher');
jest.mock('../../../../shared', () => {
  const actual = jest.requireActual('../../../../shared');
  return {
    ...actual,
    createInternalAuth: (config: any) => (req: any, res: any, next: any) => {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        next();
        return;
      }
      res.status(403).json({ error: 'Missing Authorization header' });
    },
  };
});
jest.mock('../../../shared/auth', () => {
  const actual = jest.requireActual('../../../shared/auth');
  return {
    ...actual,
    createInternalAuth: (config: any) => (req: any, res: any, next: any) => {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        next();
        return;
      }
      res.status(403).json({ error: 'Missing Authorization header' });
    },
  };
});
jest.mock('../../middlewares/auth', () => {
  return {
    auth: (req: any, _res: any, next: any) => {
      const role = req.headers['x-test-role'] || 'patron';
      req.user = { id: PATRON_UUID, email: 'patron@test.com', role };
      next();
    },
    requireRole: (roles: string[], detail: string) => (req: any, res: any, next: any) => {
      if (!req.user) {
        const role = req.headers['x-test-role'] || 'patron';
        req.user = { id: PATRON_UUID, email: 'patron@test.com', role };
      }
      if (!roles.includes(req.user.role)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      next();
    },
    requireDynamicPermission: (_resource: string, _action: string) => (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'] || 'patron';
      req.user = req.user || { id: PATRON_UUID, email: 'patron@test.com', role };
      if (req.headers['x-test-deny-permission']) {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
      next();
    },
    internalAuth: (req: any, res: any, next: any) => {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        next();
      } else {
        res.status(401).json({ detail: 'Invalid token' });
      }
    },
  };
});

const mockAccessService = AccessServiceClient as jest.Mocked<typeof AccessServiceClient>;
const mockUserService = UserServiceClient as jest.Mocked<typeof UserServiceClient>;
const mockPublishEvent = eventPublisher.publishEvent as jest.MockedFunction<typeof eventPublisher.publishEvent>;

function createBorrowApp(): Express {
  const app = express();
  app.use(express.json());
  const borrowRoutes = require('../../routes/borrow.routes').default;
  const staffRoutes = require('../../routes/staff.routes').default;
  app.use('/borrow', borrowRoutes);
  app.use('/borrow', staffRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof HttpError) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

function createInternalApp(): Express {
  const app = express();
  app.use(express.json());
  const borrowInternalRoutes = require('../../routes/borrow-internal.routes').default;
  app.use('/borrow/internal', borrowInternalRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof HttpError) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

describe('Borrow Event Publishing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo = createMockBorrowRepository();
  });

  describe('C-1: book.borrowed event', () => {
    let app: Express;
    beforeEach(() => { app = createBorrowApp(); });

    it('POST /borrow/ should publish book.borrowed on successful borrow', async () => {
      const mockBook = createMockBook();
      const mockCopy = createMockCopy({ isAvailable: true });
      const mockRecord = createMockRecord();

      mockAccessService.getPatronAccessStatus = jest.fn().mockResolvedValue({ inside: true, isExpired: false });
      mockRepo.getCopyByBarcode = jest.fn().mockResolvedValue(mockCopy);
      mockRepo.getBookById = jest.fn().mockResolvedValue(mockBook);
      mockRepo.getActiveBorrow = jest.fn().mockResolvedValue(null);
      mockRepo.getOverdueBorrows = jest.fn().mockResolvedValue([]);
      mockRepo.countActiveBorrows = jest.fn().mockResolvedValue(0);
      mockRepo.createBorrowRecord = jest.fn().mockResolvedValue(mockRecord);

      const res = await request(app)
        .post('/borrow/')
        .set('Authorization', 'Bearer fake-token')
        .set('X-Test-Role', 'staff')
        .send({ barcode: 'LIB-9780123456789-001' });

      expect(res.status).toBe(200);
      expect(mockPublishEvent).toHaveBeenCalledWith('book.borrowed', expect.objectContaining({
        bookId: mockBook.id,
        patronId: PATRON_UUID,
        borrowRecordId: mockRecord.id,
      }));
    });

    it('POST /borrow/staff/slip/confirm should publish book.borrowed for each record', async () => {
      const mockBook = createMockBook();
      const mockCopy = createMockCopy({ isAvailable: true });
      const mockSlip = createMockSlip();
      const mockRecords = [createMockRecord({ bookId: mockBook.id })];

      mockUserService.lookupPatronById = jest.fn().mockResolvedValue({ id: PATRON_UUID, fullName: 'Test', student_code: 'SV001', studentCode: 'SV001' });
      mockAccessService.getPatronRawAccessStatus = jest.fn().mockResolvedValue({ inside: true, isExpired: false });
      mockRepo.getCopyById = jest.fn().mockResolvedValue(mockCopy);
      mockRepo.getBookById = jest.fn().mockResolvedValue(mockBook);
      mockRepo.getActiveBorrow = jest.fn().mockResolvedValue(null);
      mockRepo.getOverdueBorrows = jest.fn().mockResolvedValue([]);
      mockRepo.countActiveBorrows = jest.fn().mockResolvedValue(0);
      mockRepo.createSlip = jest.fn().mockResolvedValue({ slip: mockSlip, records: mockRecords });
      mockRepo.setCopyAvailable = jest.fn().mockResolvedValue(undefined);
      mockRepo.copies.find = jest.fn().mockResolvedValue([mockCopy]);
      mockRepo.books.find = jest.fn().mockResolvedValue([mockBook]);
      mockRepo.copies.save = jest.fn().mockResolvedValue(undefined);

      const res = await request(app)
        .post('/borrow/staff/slip/confirm')
        .set('Authorization', 'Bearer fake-token')
        .set('X-Test-Role', 'staff')
        .send({
          patron_id: PATRON_UUID,
          items: [{ barcode: 'LIB-9780123456789-001', book_id: mockBook.id, copy_id: mockCopy.id }],
        });

      expect(res.status).toBe(200);
      expect(mockPublishEvent).toHaveBeenCalledWith('book.borrowed', expect.objectContaining({
        bookId: mockBook.id,
        patronId: PATRON_UUID,
      }));
    });

    it('POST /borrow/staff/slip/create should publish book.borrowed for each record', async () => {
      const mockBook = createMockBook();
      const mockCopy = createMockCopy({ isAvailable: true });
      const mockSlip = createMockSlip();
      const mockRecords = [createMockRecord({ bookId: mockBook.id })];

      mockUserService.lookupPatronById = jest.fn().mockResolvedValue({ id: PATRON_UUID, fullName: 'Test', student_code: 'SV001', studentCode: 'SV001' });
      mockAccessService.getPatronRawAccessStatus = jest.fn().mockResolvedValue({ inside: true, isExpired: false });
      mockRepo.getBookByIsbn = jest.fn().mockResolvedValue(mockBook);
      mockRepo.getAvailableCopy = jest.fn().mockResolvedValue(mockCopy);
      mockRepo.getActiveBorrow = jest.fn().mockResolvedValue(null);
      mockRepo.getOverdueBorrows = jest.fn().mockResolvedValue([]);
      mockRepo.countActiveBorrows = jest.fn().mockResolvedValue(0);
      mockRepo.createSlip = jest.fn().mockResolvedValue({ slip: mockSlip, records: mockRecords });
      mockRepo.setCopyAvailable = jest.fn().mockResolvedValue(undefined);
      mockRepo.getCopyById = jest.fn().mockResolvedValue(mockCopy);
      mockRepo.getBookById = jest.fn().mockResolvedValue(mockBook);

      const res = await request(app)
        .post('/borrow/staff/slip/create')
        .set('Authorization', 'Bearer fake-token')
        .set('X-Test-Role', 'staff')
        .send({
          patron_id: PATRON_UUID,
          items: [{ barcode: 'LIB-9780123456789-001', isbn: '9780123456789' }],
        });

      expect(res.status).toBe(200);
      expect(mockPublishEvent).toHaveBeenCalledWith('book.borrowed', expect.objectContaining({
        bookId: mockBook.id,
        patronId: PATRON_UUID,
      }));
    });
  });

  describe('C-2: book.returned event', () => {
    let app: Express;
    beforeEach(() => { app = createBorrowApp(); });

    it('POST /borrow/staff-return should publish book.returned', async () => {
      const mockCopy = createMockCopy();
      const mockRecord = createMockRecord({ returnAt: null, status: 'borrowed' });
      mockRepo.getCopyByBarcode = jest.fn().mockResolvedValue(mockCopy);
      mockRepo.getActiveBorrowByCopy = jest.fn().mockResolvedValue(mockRecord);
      mockRepo.returnBook = jest.fn().mockImplementation(async (r: any) => { r.returnAt = new Date(); r.status = 'returned'; return r; });
      mockRepo.setCopyAvailable = jest.fn().mockResolvedValue(undefined);

      const res = await request(app)
        .post('/borrow/staff-return')
        .set('Authorization', 'Bearer fake-token')
        .set('X-Test-Role', 'staff')
        .send({ barcode: 'LIB-9780123456789-001' });

      expect(res.status).toBe(200);
      expect(mockPublishEvent).toHaveBeenCalledWith('book.returned', expect.objectContaining({
        bookId: mockRecord.bookId,
        patronId: mockRecord.patronId,
      }));
    });

    it('POST /borrow/staff-return/by-patron should publish book.returned', async () => {
      const mockBook = createMockBook();
      const mockRecord = createMockRecord({ returnAt: null, status: 'borrowed' });

      mockUserService.lookupPatronByStudentCode = jest.fn().mockResolvedValue({ id: PATRON_UUID, fullName: 'Test', student_code: 'SV001', studentCode: 'SV001' });
      mockRepo.getBookByNormalizedIsbn = jest.fn().mockResolvedValue(mockBook);
      mockRepo.getActiveBorrowsByPatronAndBook = jest.fn().mockResolvedValue([mockRecord]);
      mockRepo.returnBook = jest.fn().mockImplementation(async (r: any) => { r.returnAt = new Date(); r.status = 'returned'; return r; });
      mockRepo.setCopyAvailable = jest.fn().mockResolvedValue(undefined);

      const res = await request(app)
        .post('/borrow/staff-return/by-patron')
        .set('Authorization', 'Bearer fake-token')
        .set('X-Test-Role', 'staff')
        .send({ student_code: 'SV001', barcode_or_isbn: '9780123456789' });

      expect(res.status).toBe(200);
      expect(mockPublishEvent).toHaveBeenCalledWith('book.returned', expect.objectContaining({
        bookId: mockBook.id,
        patronId: PATRON_UUID,
      }));
    });

    it('POST /borrow/staff-return/batch should publish book.returned for each item', async () => {
      const mockBook = createMockBook();
      const mockRecord = createMockRecord({ returnAt: null, status: 'borrowed' });

      mockUserService.lookupPatronByStudentCode = jest.fn().mockResolvedValue({ id: PATRON_UUID, fullName: 'Test', student_code: 'SV001', studentCode: 'SV001' });
      mockRepo.getBookByNormalizedIsbn = jest.fn().mockResolvedValue(mockBook);
      mockRepo.getActiveBorrowsByPatronAndBook = jest.fn().mockResolvedValue([mockRecord]);
      mockRepo.returnBook = jest.fn().mockImplementation(async (r: any) => { r.returnAt = new Date(); r.status = 'returned'; return r; });
      mockRepo.setCopyAvailable = jest.fn().mockResolvedValue(undefined);

      const res = await request(app)
        .post('/borrow/staff-return/batch')
        .set('Authorization', 'Bearer fake-token')
        .set('X-Test-Role', 'staff')
        .send({ student_code: 'SV001', items: [{ barcode_or_isbn: '9780123456789' }] });

      expect(res.status).toBe(200);
      expect(mockPublishEvent).toHaveBeenCalledWith('book.returned', expect.objectContaining({ bookId: mockBook.id }));
    });

    it('POST /borrow/staff-return/record/:record_id should publish book.returned', async () => {
      const mockRecord = createMockRecord({ returnAt: null, status: 'borrowed' });
      mockRepo.getBorrowRecordById = jest.fn().mockResolvedValue(mockRecord);
      mockRepo.returnBook = jest.fn().mockImplementation(async (r: any) => { r.returnAt = new Date(); r.status = 'returned'; return r; });
      mockRepo.setCopyAvailable = jest.fn().mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/borrow/staff-return/record/${mockRecord.id}`)
        .set('Authorization', 'Bearer fake-token')
        .set('X-Test-Role', 'staff')
        .send({});

      expect(res.status).toBe(200);
      expect(mockPublishEvent).toHaveBeenCalledWith('book.returned', expect.objectContaining({
        bookId: mockRecord.bookId,
        patronId: mockRecord.patronId,
      }));
    });
  });

  describe('C-4: fine.incurred event', () => {
    let app: Express;
    beforeEach(() => { app = createInternalApp(); });

    it('should publish fine.incurred when book is overdue', async () => {
      const pastDate = new Date(Date.now() - 5 * 86400000);
      const mockRecord = createMockRecord({ dueAt: pastDate, returnAt: null, status: 'borrowed' });
      mockRecord.book = { title: 'Test Book' } as any;

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(mockRecord),
        save: jest.fn().mockImplementation(async (r: any) => {
          r.returnAt = new Date();
          r.status = 'returned';
          r.fineAmount = 5000;
          return r;
        }),
      };

      (AppDataSource.transaction as jest.Mock) = jest.fn().mockImplementation(async (fn: any) => fn(mockManager));

      const res = await request(app)
        .post('/borrow/internal/return')
        .set('Authorization', 'Bearer test-service-token')
        .send({ barcode: 'LIB-001' });

      expect(mockPublishEvent).toHaveBeenCalledWith('fine.incurred', expect.objectContaining({
        patronId: mockRecord.patronId,
        fineAmount: 5000,
        daysOverdue: expect.any(Number),
      }));
    });

    it('should NOT publish fine.incurred when not overdue', async () => {
      const futureDate = new Date(Date.now() + 5 * 86400000);
      const mockRecord = createMockRecord({ dueAt: futureDate, returnAt: null, status: 'borrowed' });
      mockRecord.book = { title: 'Test Book' } as any;

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(mockRecord),
        save: jest.fn().mockImplementation(async (r: any) => {
          r.returnAt = new Date();
          r.status = 'returned';
          r.fineAmount = 0;
          return r;
        }),
      };

      (AppDataSource.transaction as jest.Mock) = jest.fn().mockImplementation(async (fn: any) => fn(mockManager));
      mockPublishEvent.mockClear();

      await request(app)
        .post('/borrow/internal/return')
        .set('Authorization', 'Bearer test-service-token')
        .send({ barcode: 'LIB-001' });

      const fineCalls = mockPublishEvent.mock.calls.filter(c => c[0] === 'fine.incurred');
      expect(fineCalls).toHaveLength(0);
    });
  });

  describe('C-3: due-soon endpoint', () => {
    let app: Express;
    beforeEach(() => { app = createInternalApp(); });

    it('GET /borrow/internal/due-soon should return records', async () => {
      const dueDate = new Date(Date.now() + 2 * 86400000);
      const mockRecords = [{ id: '1', patron_id: PATRON_UUID, book_id: 'b1', due_at: dueDate, book: { title: 'Test' } }];

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRecords),
      };

      (AppDataSource.getRepository as jest.Mock).mockReturnValue({ createQueryBuilder: jest.fn().mockReturnValue(mockQb) });

      const res = await request(app)
        .get('/borrow/internal/due-soon?days_before=3')
        .set('Authorization', 'Bearer test-service-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });

    it('GET /borrow/internal/due-soon should default to 3 days', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      (AppDataSource.getRepository as jest.Mock).mockReturnValue({ createQueryBuilder: jest.fn().mockReturnValue(mockQb) });

      const res = await request(app)
        .get('/borrow/internal/due-soon')
        .set('Authorization', 'Bearer test-service-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
