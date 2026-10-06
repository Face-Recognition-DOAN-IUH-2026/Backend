import express, { Express } from 'express';
import request from 'supertest';
import staffRoutes from '../../routes/staff.routes';
import { HttpError } from '../../middlewares/errorHandler';
import { createMockBook, createMockCopy, createMockRecord, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { PATRON_UUID, STAFF_UUID } from '../helpers/auth';
import * as eventPublisher from '../../utils/eventPublisher';
import * as UserServiceClient from '../../clients/UserServiceClient';

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
      res.status(403).json({ detail });
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
jest.mock('../../clients/UserServiceClient', () => ({
  lookupPatronById: jest.fn(),
  lookupPatronByStudentCode: jest.fn(),
  lookupPatronsByIds: jest.fn(),
}));
jest.mock('../../services/ConfigService', () => ({
  configService: {
    getBorrowLimits: jest.fn().mockResolvedValue({ maxBorrowBooks: 3, maxBorrowBooksPerSlip: 5, maxBorrowDays: 14 }),
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

const publishEventMock = eventPublisher.publishEvent as jest.Mock;
const lookupPatronMock = UserServiceClient.lookupPatronByStudentCode as jest.Mock;

function createStaffApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/borrow', staffRoutes);
  app.use(errorHandler);
  return app;
}

function errorHandler(err: any, _req: any, res: any, _next: any) {
  if (err instanceof HttpError) return res.status(err.statusCode).json({ error: err.message });
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed' });
  res.status(500).json({ error: 'Internal server error' });
}

const authHeader = { Authorization: 'Bearer test-token' };

function primeBarcodeReturn(condition = 'good') {
  const book = createMockBook();
  const copy = createMockCopy({ bookId: book.id, condition });
  (copy as any).book = book;
  const record = createMockRecord({ bookId: book.id, copyId: copy.id });
  (record as any).book = book;
  mockRepo.getCopyByBarcode.mockResolvedValue(copy);
  mockRepo.getActiveBorrowByCopy.mockResolvedValue(record);
  return { book, copy, record };
}

function primePatronReturn() {
  const book = createMockBook();
  const copy = createMockCopy({ bookId: book.id });
  (copy as any).book = book;
  const record = createMockRecord({ bookId: book.id, copyId: copy.id });
  (record as any).book = book;
  lookupPatronMock.mockResolvedValue({ id: PATRON_UUID, student_code: 'SV001', full_name: 'Sinh vien 01' });
  mockRepo.getBookByNormalizedIsbn.mockResolvedValue(book);
  mockRepo.getActiveBorrowsByPatronAndBook.mockResolvedValue([record]);
  mockRepo.getCopyById.mockResolvedValue(copy);
  return { book, copy, record };
}

beforeEach(() => {
  mockRepo = createMockBorrowRepository();
  publishEventMock.mockClear();
  lookupPatronMock.mockReset();
});

describe('POST /borrow/return', () => {
  it('writes the submitted condition through the shared return helper', async () => {
    const { copy, record } = primeBarcodeReturn('good');

    const res = await request(createStaffApp())
      .post('/borrow/return')
      .set(authHeader)
      .send({ barcode: copy.barcode, condition: 'lost', note: 'mat tai lieu' });

    expect(res.status).toBe(200);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'lost', record, STAFF_UUID);
    expect(mockRepo.setCopyAvailable).not.toHaveBeenCalled();
    expect(res.body.record.return_condition).toBe('lost');
    expect(record.returnCondition).toBe('lost');
  });

  it('keeps the legacy default of good when no condition is sent', async () => {
    const { copy, record } = primeBarcodeReturn('good');

    const res = await request(createStaffApp())
      .post('/borrow/return')
      .set(authHeader)
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(200);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'good', record, STAFF_UUID);
    expect(res.body.record.return_condition).toBe('good');
  });

  it('rejects an unknown condition code with 400', async () => {
    primeBarcodeReturn();

    const res = await request(createStaffApp())
      .post('/borrow/return')
      .set(authHeader)
      .send({ barcode: 'LIB-9780123456789-001', condition: 'ruined' });

    expect(res.status).toBe(400);
    expect(mockRepo.returnBook).not.toHaveBeenCalled();
    expect(mockRepo.applyReturnToCopy).not.toHaveBeenCalled();
  });

  it('keeps the response shape, return_method and book.returned payload', async () => {
    const { copy, record } = primeBarcodeReturn();

    const res = await request(createStaffApp())
      .post('/borrow/return')
      .set(authHeader)
      .send({ barcode: copy.barcode });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'record', 'status']);
    expect(res.body.status).toBe('success');
    expect(res.body.message).toBe('Trả sách thành công');
    expect(res.body.record.return_method).toBe('staff_web');
    expect(mockRepo.returnBook).toHaveBeenCalledWith(record, STAFF_UUID, 'staff@test.com', 'staff_web', undefined, { isPaidImmediately: undefined, paymentMethod: undefined });

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const [eventType, payload] = publishEventMock.mock.calls[0];
    expect(eventType).toBe('book.returned');
    expect(Object.keys(payload).sort()).toEqual(['barcode', 'bookId', 'damageFee', 'fineAmount', 'patronId', 'title', 'total']);
    expect(payload).toMatchObject({
      bookId: record.bookId,
      patronId: record.patronId,
      barcode: copy.barcode,
      fineAmount: 0,
    });
  });
});

describe('POST /borrow/return/by-patron', () => {
  it('uses return_method staff_mobile and writes the condition back', async () => {
    const { book, copy, record } = primePatronReturn();

    const res = await request(createStaffApp())
      .post('/borrow/return/by-patron')
      .set(authHeader)
      .send({ student_code: 'SV001', barcode_or_isbn: book.isbn, condition: 'major_damage' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'record', 'status']);
    expect(res.body.record.return_method).toBe('staff_mobile');
    expect(res.body.record.return_condition).toBe('major_damage');
    expect(mockRepo.returnBook).toHaveBeenCalledWith(record, STAFF_UUID, 'staff@test.com', 'staff_mobile', undefined, { isPaidImmediately: undefined, paymentMethod: undefined });
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'major_damage', record, STAFF_UUID);
    expect(mockRepo.setCopyAvailable).not.toHaveBeenCalled();

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const [eventType, payload] = publishEventMock.mock.calls[0];
    expect(eventType).toBe('book.returned');
    expect(Object.keys(payload).sort()).toEqual(['barcode', 'bookId', 'damageFee', 'fineAmount', 'patronId', 'title', 'total']);
  });

  it('returns 404 when the patron has no matching active borrow', async () => {
    primePatronReturn();
    mockRepo.getActiveBorrowsByPatronAndBook.mockResolvedValue([]);

    const res = await request(createStaffApp())
      .post('/borrow/return/by-patron')
      .set(authHeader)
      .send({ student_code: 'SV001', barcode_or_isbn: '9780123456789' });

    expect(res.status).toBe(404);
    expect(mockRepo.returnBook).not.toHaveBeenCalled();
  });
});

describe('POST /borrow/return/batch', () => {
  it('applies each item condition independently and keeps the response shape', async () => {
    const bookA = createMockBook({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', isbn: '9780000000001' });
    const copyA = createMockCopy({ id: 'aaaaaaaa-0000-0000-0000-00000000000c', bookId: bookA.id });
    (copyA as any).book = bookA;
    const recordA = createMockRecord({ id: 'aaaaaaaa-0000-0000-0000-00000000000r', bookId: bookA.id, copyId: copyA.id });
    (recordA as any).book = bookA;

    lookupPatronMock.mockResolvedValue({ id: PATRON_UUID, student_code: 'SV001' });
    mockRepo.getBookByNormalizedIsbn.mockImplementation((isbn: string) =>
      Promise.resolve(isbn === '9780000000001' ? bookA : null),
    );
    mockRepo.getActiveBorrowsByPatronAndBook.mockResolvedValue([recordA]);
    mockRepo.getCopyById.mockResolvedValue(copyA);

    const res = await request(createStaffApp())
      .post('/borrow/return/batch')
      .set(authHeader)
      .send({
        student_code: 'SV001',
        items: [
          { barcode_or_isbn: '9780000000001', condition: 'lost' },
          { barcode_or_isbn: '9999999999999', condition: 'good' },
        ],
      });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['fail', 'ok', 'results']);
    expect(res.body.ok).toBe(1);
    expect(res.body.fail).toBe(1);
    expect(res.body.results[0]).toMatchObject({ barcode_or_isbn: '9780000000001', status: 'success' });
    expect(res.body.results[1]).toMatchObject({ barcode_or_isbn: '9999999999999', status: 'failed' });
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copyA, 'lost', recordA, STAFF_UUID);
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledTimes(1);
    expect(mockRepo.setCopyAvailable).not.toHaveBeenCalled();
    expect(recordA.returnMethod).toBe('staff_mobile');
  });
});

describe('POST /borrow/return/record/:record_id', () => {
  it('uses return_method staff_web and writes the condition back', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ bookId: book.id });
    (copy as any).book = book;
    const record = createMockRecord({ bookId: book.id, copyId: copy.id });
    (record as any).book = book;
    mockRepo.getBorrowRecordById.mockResolvedValue(record);
    mockRepo.getCopyById.mockResolvedValue(copy);

    const res = await request(createStaffApp())
      .post(`/borrow/return/record/${record.id}`)
      .set(authHeader)
      .send({ condition: 'minor_damage' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'record', 'status']);
    expect(res.body.record.return_method).toBe('staff_web');
    expect(res.body.record.return_condition).toBe('minor_damage');
    expect(mockRepo.returnBook).toHaveBeenCalledWith(record, STAFF_UUID, 'staff@test.com', 'staff_web', undefined, { isPaidImmediately: undefined, paymentMethod: undefined });
    expect(mockRepo.applyReturnToCopy).toHaveBeenCalledWith(copy, 'minor_damage', record, STAFF_UUID);
    expect(mockRepo.setCopyAvailable).not.toHaveBeenCalled();
    expect(publishEventMock.mock.calls[0][1]).not.toHaveProperty('availableCopies');
  });

  it('returns 409 when the record was already returned', async () => {
    const record = createMockRecord({ status: 'returned', returnAt: new Date() });
    mockRepo.getBorrowRecordById.mockResolvedValue(record);

    const res = await request(createStaffApp())
      .post(`/borrow/return/record/${record.id}`)
      .set(authHeader)
      .send({ condition: 'good' });

    expect(res.status).toBe(409);
    expect(mockRepo.returnBook).not.toHaveBeenCalled();
    expect(mockRepo.applyReturnToCopy).not.toHaveBeenCalled();
  });
});
