import { SlipService } from '../../services/SlipService';
import { createMockBook, createMockCopy, createMockBorrowRepository, MockBorrowRepository } from '../helpers/mock-repo';
import { PATRON_UUID, STAFF_UUID } from '../helpers/auth';
import * as AccessServiceClient from '../../clients/AccessServiceClient';
import * as UserServiceClient from '../../clients/UserServiceClient';

let mockRepo: MockBorrowRepository;

jest.mock('../../repositories/BorrowRepository', () => ({
  BorrowRepository: jest.fn().mockImplementation(() => mockRepo),
}));
jest.mock('../../utils/eventPublisher');
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
const mockUserService = UserServiceClient as jest.Mocked<typeof UserServiceClient>;

const PATRON = {
  id: PATRON_UUID,
  student_code: 'SV001',
  full_name: 'Test Patron',
  email: 'patron@test.com',
};

function primeHappyPath() {
  mockRepo.getBookByIsbn.mockResolvedValue(null);
  mockRepo.getBookById.mockResolvedValue(null);
  mockRepo.getCopyByBarcode.mockResolvedValue(null);
  mockRepo.getAvailableCopy.mockResolvedValue(null);
  mockRepo.countCopies.mockResolvedValue(1);
  mockRepo.getActiveBorrow.mockResolvedValue(null);
  mockRepo.getOverdueBorrows.mockResolvedValue([]);
  mockRepo.countActiveBorrows.mockResolvedValue(0);
}

function copyWithBook(condition: string, status: string) {
  const book = createMockBook();
  const copy = createMockCopy({ condition: condition as any, status: status as any });
  (copy as any).book = book;
  return { book, copy };
}

beforeEach(() => {
  mockRepo = createMockBorrowRepository();
  (mockUserService.lookupPatronById as jest.Mock).mockResolvedValue(PATRON);
  (mockAccessService.getPatronAccessStatus as jest.Mock).mockResolvedValue({ inside: true, isExpired: false });
  (mockAccessService.getPatronRawAccessStatus as jest.Mock).mockResolvedValue({ inside: true, isExpired: false });
  primeHappyPath();
});

describe('SlipService.lookup — exact copy resolution from scanned barcode', () => {
  it('resolves a copy barcode to that exact copy when ISBN lookup finds nothing', async () => {
    const { book, copy } = copyWithBook('good', 'available');
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);
    mockRepo.countCopies.mockResolvedValue(2);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: copy.barcode }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(copy.id);
    expect(res.items[0].reason).toBeNull();
    expect(res.errors).toEqual([]);
    expect(res.can_create).toBe(true);
  });

  it('uses an available copy when the ISBN path resolves the book', async () => {
    const book = createMockBook();
    const available = createMockCopy({ condition: 'new', status: 'available' });
    mockRepo.getBookByIsbn.mockResolvedValue(book);
    mockRepo.getAvailableCopy.mockResolvedValue(available);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: '9780123456789' }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(available.id);
    expect(res.can_create).toBe(true);
  });

  it('blocks a maintenance copy and makes the slip uncreatable', async () => {
    const { copy } = copyWithBook('good', 'maintenance');
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(createMockBook());

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: copy.barcode }], true);

    expect(res.items[0].can_borrow).toBe(false);
    expect(res.items[0].reason!.toLowerCase()).toContain('bảo trì');
    expect(res.items[0].copy).toBeNull();
    expect(res.errors).toHaveLength(1);
    expect(res.can_create).toBe(false);
  });

  it('blocks a disposed copy', async () => {
    const { copy } = copyWithBook('good', 'disposed');
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(createMockBook());

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: copy.barcode }], true);

    expect(res.items[0].can_borrow).toBe(false);
    expect(res.items[0].reason!.toLowerCase()).toContain('thanh lý');
    expect(res.can_create).toBe(false);
  });

  it('blocks a copy whose condition is lost', async () => {
    const { copy } = copyWithBook('lost', 'available');
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(createMockBook());

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: copy.barcode }], true);

    expect(res.items[0].can_borrow).toBe(false);
    expect(res.items[0].reason!.toLowerCase()).toContain('mất');
    expect(res.can_create).toBe(false);
  });

  it('warns about a major_damage copy without blocking slip creation', async () => {
    const { copy } = copyWithBook('major_damage', 'available');
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(createMockBook());

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: copy.barcode }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(copy.id);
    expect(res.items[0].reason!.toLowerCase()).toContain('hư hỏng nặng');
    expect(res.errors).toEqual([]);
    expect(res.can_create).toBe(true);
  });

  it('blocks an ISBN-scanned book when its only copy is in maintenance', async () => {
    const book = createMockBook();
    mockRepo.getBookByIsbn.mockResolvedValue(book);
    mockRepo.getAvailableCopy.mockResolvedValue(null);
    const ownCopy = createMockCopy({ condition: 'good', status: 'maintenance' });
    mockRepo.getCopyByBarcode.mockResolvedValue(ownCopy);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: '9780123456789' }], true);

    expect(res.items[0].can_borrow).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.can_create).toBe(false);
  });

  it('reports an unknown book', async () => {
    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: '0000000000000' }], true);

    expect(res.items[0].can_borrow).toBe(false);
    expect(res.items[0].reason).toBe('Khong co sach nay trong thu vien (ma quet: "0000000000000")');
    expect(res.can_create).toBe(false);
  });

  it('still blocks when the patron already borrows this title', async () => {
    const book = createMockBook();
    const available = createMockCopy({ condition: 'good', status: 'available' });
    mockRepo.getBookByIsbn.mockResolvedValue(book);
    mockRepo.getAvailableCopy.mockResolvedValue(available);
    mockRepo.getActiveBorrow.mockResolvedValue({ id: 'record-x' });

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: '9780123456789' }], true);

    expect(res.items[0].can_borrow).toBe(false);
    expect(res.can_create).toBe(false);
  });
});

describe('SlipService.lookup — scanned label format tolerance', () => {
  it('resolves a scanned barcode whose sequence has extra leading zeros (LIB-...-0001 -> LIB-...-001)', async () => {
    const { book, copy } = copyWithBook('good', 'available');
    const norm = (b: string) => b.replace(/[\s-]/g, '').toLowerCase();
    mockRepo.getCopyByBarcode.mockImplementation((barcode: string) =>
      Promise.resolve(norm(barcode) === norm(copy.barcode) ? (copy as any) : null),
    );
    mockRepo.getBookById.mockResolvedValue(book as any);
    mockRepo.countCopies.mockResolvedValue(1);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: 'LIB-9780123456789-0001' }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(copy.id);
    expect(res.items[0].reason).toBeNull();
    expect(res.errors).toEqual([]);
    expect(res.can_create).toBe(true);
  });

  it('finds the book when the scanned ISBN-13 differs from the stored ISBN-10', async () => {
    const book = createMockBook({ isbn: '0306406152' });
    const available = createMockCopy({ condition: 'new', status: 'available' });
    mockRepo.getBookByIsbn.mockImplementation((isbn: string) =>
      Promise.resolve(isbn.replace(/[\s-]/g, '') === '0306406152' ? (book as any) : null),
    );
    mockRepo.getAvailableCopy.mockResolvedValue(available as any);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: '9780306406157' }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(available.id);
    expect(res.can_create).toBe(true);
  });

  it('resolves a glued ISBN+seq barcode without the LIB prefix (9780123456789001 -> copy 001)', async () => {
    const { book, copy } = copyWithBook('good', 'available');
    const norm = (b: string) => b.replace(/[\s-]/g, '').toLowerCase();
    mockRepo.getCopyByBarcode.mockImplementation((barcode: string) =>
      Promise.resolve(norm(barcode) === norm(copy.barcode) ? (copy as any) : null),
    );
    mockRepo.getBookByIsbn.mockResolvedValue(null);
    mockRepo.getBookById.mockResolvedValue(book as any);
    mockRepo.countCopies.mockResolvedValue(1);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: '9780123456789001' }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(copy.id);
    expect(res.items[0].reason).toBeNull();
    expect(res.errors).toEqual([]);
    expect(res.can_create).toBe(true);
  });

  it('resolves a glued ISBN-10+seq barcode to the copy stored under the ISBN-13', async () => {
    const book = createMockBook({ isbn: '0306406152' });
    const copy = createMockCopy({ barcode: 'LIB-9780306406157-001' });
    (copy as any).book = book;
    const norm = (b: string) => b.replace(/[\s-]/g, '').toLowerCase();
    mockRepo.getCopyByBarcode.mockImplementation((barcode: string) =>
      Promise.resolve(norm(barcode) === norm(copy.barcode) ? (copy as any) : null),
    );
    mockRepo.getBookByIsbn.mockResolvedValue(null);
    mockRepo.getBookById.mockResolvedValue(book as any);
    mockRepo.countCopies.mockResolvedValue(1);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: '0306406152001' }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(copy.id);
    expect(res.items[0].reason).toBeNull();
    expect(res.errors).toEqual([]);
    expect(res.can_create).toBe(true);
  });

  it('resolves a barcode carrying an invisible GS1 control character (FNC1 prefix)', async () => {
    const { book, copy } = copyWithBook('good', 'available');
    const norm = (b: string) => b.replace(/[\s-]/g, '').toLowerCase();
    mockRepo.getCopyByBarcode.mockImplementation((barcode: string) =>
      Promise.resolve(norm(barcode) === norm(copy.barcode) ? (copy as any) : null),
    );
    mockRepo.getBookById.mockResolvedValue(book as any);
    mockRepo.countCopies.mockResolvedValue(1);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: '\u001dLIB-9780123456789-001' }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(copy.id);
    expect(res.items[0].reason).toBeNull();
    expect(res.errors).toEqual([]);
    expect(res.can_create).toBe(true);
  });

  it('strips a trailing NUL byte before resolving the copy (no infrastructure error)', async () => {
    const { book, copy } = copyWithBook('good', 'available');
    const norm = (b: string) => b.replace(/[\s-]/g, '').toLowerCase();
    mockRepo.getCopyByBarcode.mockImplementation((barcode: string) =>
      Promise.resolve(norm(barcode) === norm(copy.barcode) ? (copy as any) : null),
    );
    mockRepo.getBookById.mockResolvedValue(book as any);
    mockRepo.countCopies.mockResolvedValue(1);

    const res = await new SlipService().lookup(PATRON_UUID, [{ barcode: 'LIB-9780123456789-001\u0000' }], true);

    expect(res.items[0].can_borrow).toBe(true);
    expect(res.items[0].copy?.id).toBe(copy.id);
    expect(res.items[0].reason).toBeNull();
    expect(res.errors).toEqual([]);
    expect(res.can_create).toBe(true);
  });
});

describe('SlipService.confirm — stale condition re-validation', () => {
  it('rejects with 409 when the selected copy moved to maintenance', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ condition: 'good', status: 'maintenance', isAvailable: true });
    mockRepo.copies.find.mockResolvedValue([copy]);
    mockRepo.books.find.mockResolvedValue([book]);
    mockRepo.getActiveBorrow.mockResolvedValue(null);
    mockRepo.getOverdueBorrows.mockResolvedValue([]);
    mockRepo.countActiveBorrows.mockResolvedValue(0);

    await expect(
      new SlipService().confirm(PATRON_UUID, [{ barcode: copy.barcode, book_id: book.id, copy_id: copy.id }], STAFF_UUID, 'staff@test.com', null),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('rejects with 409 when the selected copy condition became lost', async () => {
    const book = createMockBook();
    const copy = createMockCopy({ condition: 'lost', status: 'available', isAvailable: true });
    mockRepo.copies.find.mockResolvedValue([copy]);
    mockRepo.books.find.mockResolvedValue([book]);
    mockRepo.getActiveBorrow.mockResolvedValue(null);
    mockRepo.getOverdueBorrows.mockResolvedValue([]);
    mockRepo.countActiveBorrows.mockResolvedValue(0);

    await expect(
      new SlipService().confirm(PATRON_UUID, [{ barcode: copy.barcode, book_id: book.id, copy_id: copy.id }], STAFF_UUID, 'staff@test.com', null),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });
});

describe('SlipService.create — stale condition re-validation', () => {
  it('rejects with 409 when the resolved exact copy is lost', async () => {
    const { book, copy } = copyWithBook('lost', 'available');
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);
    mockRepo.getActiveBorrow.mockResolvedValue(null);
    mockRepo.getOverdueBorrows.mockResolvedValue([]);
    mockRepo.countActiveBorrows.mockResolvedValue(0);

    await expect(
      new SlipService().create(PATRON_UUID, [{ barcode: copy.barcode }], STAFF_UUID, 'staff@test.com', null, true),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockRepo.createSlip).not.toHaveBeenCalled();
  });

  it('rejects with 409 when the resolved copy is in maintenance', async () => {
    const { book, copy } = copyWithBook('good', 'maintenance');
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);
    mockRepo.getActiveBorrow.mockResolvedValue(null);
    mockRepo.getOverdueBorrows.mockResolvedValue([]);
    mockRepo.countActiveBorrows.mockResolvedValue(0);

    await expect(
      new SlipService().create(PATRON_UUID, [{ barcode: copy.barcode }], STAFF_UUID, 'staff@test.com', null, true),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creates the slip for a good condition copy', async () => {
    const { book, copy } = copyWithBook('good', 'available');
    mockRepo.getCopyByBarcode.mockResolvedValue(copy);
    mockRepo.getBookById.mockResolvedValue(book);
    mockRepo.getActiveBorrow.mockResolvedValue(null);
    mockRepo.getOverdueBorrows.mockResolvedValue([]);
    mockRepo.countActiveBorrows.mockResolvedValue(0);
    mockRepo.copies.find.mockResolvedValue([copy]);
    mockRepo.books.find.mockResolvedValue([book]);

    const res = await new SlipService().create(PATRON_UUID, [{ barcode: copy.barcode }], STAFF_UUID, 'staff@test.com', null, true);

    expect(res.slip).toBeDefined();
    expect(mockRepo.createSlip).toHaveBeenCalled();
  });

  it('sanitizes a NUL-laden ISBN before the book lookup (no infrastructure error)', async () => {
    const book = createMockBook();
    const available = createMockCopy({ condition: 'new', status: 'available' });
    mockRepo.getBookByIsbn.mockImplementation((isbn: string) =>
      Promise.resolve(isbn === '9780123456789' ? (book as any) : null),
    );
    mockRepo.getAvailableCopy.mockResolvedValue(available as any);
    mockRepo.getActiveBorrow.mockResolvedValue(null);
    mockRepo.getOverdueBorrows.mockResolvedValue([]);
    mockRepo.countActiveBorrows.mockResolvedValue(0);
    mockRepo.copies.find.mockResolvedValue([available]);
    mockRepo.books.find.mockResolvedValue([book]);

    const res = await new SlipService().create(PATRON_UUID, [{ barcode: '9780123456789\u0000' }], STAFF_UUID, 'staff@test.com', null, true);

    expect(res.slip).toBeDefined();
    expect(mockRepo.getBookByIsbn).toHaveBeenCalledWith('9780123456789');
    expect(mockRepo.getBookByIsbn).not.toHaveBeenCalledWith('9780123456789\u0000');
  });
});
