import { BorrowRecord } from '../../entities/BorrowRecord';
import { BorrowSlip } from '../../entities/BorrowSlip';
import { Book } from '../../entities/Book';
import { BookCopy } from '../../entities/BookCopy';

export interface MockBook extends Partial<Book> {
  id: string;
  isbn: string;
  title: string;
}

export interface MockCopy extends Partial<BookCopy> {
  id: string;
  bookId: string;
  barcode: string;
  isAvailable: boolean;
}

export interface MockRecord extends Partial<BorrowRecord> {
  id: string;
  patronId: string;
  bookId: string;
  status: string;
}

export interface MockSlip extends Partial<BorrowSlip> {
  id: string;
  patronId: string;
  status: string;
}

export function createMockBook(overrides: Partial<MockBook> = {}): MockBook {
  const id = overrides.id || 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const now = new Date();
  return {
    id,
    isbn: '9780123456789',
    title: 'Test Book',
    author: null,
    coverUrl: null,
    shelfLocation: null,
    isAvailable: true,
    copies: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as MockBook;
}

export function createMockCopy(overrides: Partial<MockCopy> = {}): MockCopy {
  const id = overrides.id || 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const bookId = overrides.bookId || 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const now = new Date();
  return {
    id,
    bookId,
    barcode: `LIB-9780123456789-001`,
    isAvailable: true,
    shelfLocation: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as MockCopy;
}

export function createMockRecord(overrides: Partial<MockRecord> = {}): MockRecord {
  const id = overrides.id || 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr';
  const patronId = overrides.patronId || '11111111-1111-1111-1111-111111111111';
  const bookId = overrides.bookId || 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const now = new Date();
  const dueAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    id,
    patronId,
    bookId,
    copyId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    slipId: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    borrowAt: now,
    dueAt,
    returnAt: null,
    shelfLocation: null,
    status: 'borrowed',
    returnedByUserId: null,
    returnedByEmail: null,
    returnMethod: null,
    note: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as MockRecord;
}

export function createMockSlip(overrides: Partial<MockSlip> = {}): MockSlip {
  const id = overrides.id || 'ssssssss-ssss-ssss-ssss-ssssssssssss';
  const patronId = overrides.patronId || '11111111-1111-1111-1111-111111111111';
  const now = new Date();
  const dueAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    id,
    patronId,
    borrowAt: now,
    dueAt,
    status: 'active',
    createdByUserId: '22222222-2222-2222-2222-222222222222',
    createdByEmail: 'staff@example.com',
    totalItems: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as MockSlip;
}

export type MockBorrowRepository = {
  getBookByIsbn: jest.Mock;
  getBookById: jest.Mock;
  getCopyByBarcode: jest.Mock;
  getCopyById: jest.Mock;
  getAvailableCopy: jest.Mock;
  getActiveBorrow: jest.Mock;
  getActiveBorrowsByPatronAndBook: jest.Mock;
  getActiveBorrowByCopy: jest.Mock;
  getBookByNormalizedIsbn: jest.Mock;
  getBorrowRecordById: jest.Mock;
  getAllActiveBorrows: jest.Mock;
  getActiveBorrowsByPatron: jest.Mock;
  getBorrowsByPatron: jest.Mock;
  getOverdueBorrows: jest.Mock;
  countActiveBorrows: jest.Mock;
  countCopies: jest.Mock;
  setCopyAvailable: jest.Mock;
  createBorrowRecord: jest.Mock;
  returnBook: jest.Mock;
  createSlip: jest.Mock;
  getBooksByIsbns: jest.Mock;
  listBooks: jest.Mock;
  upsertBook: jest.Mock;
  createCopy: jest.Mock;
  createCopiesBatchWithSkip: jest.Mock;
  deleteCopies: jest.Mock;
  bulkDeleteBooks: jest.Mock;
  getStats: jest.Mock;
  getBarcodeOffsetsByBooks: jest.Mock;
  getMaxBarcodeNumberForBook: jest.Mock;
  getAvailableCopiesByBarcodeDesc: jest.Mock;
  hasActiveBorrows: jest.Mock;
  createQueryBuilder: jest.Mock;
  copies: {
    find: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  books: {
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  records: {
    createQueryBuilder: jest.Mock;
  };
  slips: {
    createQueryBuilder: jest.Mock;
  };
};

export function createMockBorrowRepository(): MockBorrowRepository {
  return {
    getBookByIsbn: jest.fn().mockResolvedValue(null),
    getBookById: jest.fn().mockResolvedValue(null),
    getCopyByBarcode: jest.fn().mockResolvedValue(null),
    getCopyById: jest.fn().mockResolvedValue(null),
    getAvailableCopy: jest.fn().mockResolvedValue(null),
    getActiveBorrow: jest.fn().mockResolvedValue(null),
    getActiveBorrowsByPatronAndBook: jest.fn().mockResolvedValue([]),
    getActiveBorrowByCopy: jest.fn().mockResolvedValue(null),
    getBookByNormalizedIsbn: jest.fn().mockResolvedValue(null),
    getBorrowRecordById: jest.fn().mockResolvedValue(null),
    getAllActiveBorrows: jest.fn().mockResolvedValue([]),
    getActiveBorrowsByPatron: jest.fn().mockResolvedValue([]),
    getBorrowsByPatron: jest.fn().mockResolvedValue([]),
    getOverdueBorrows: jest.fn().mockResolvedValue([]),
    countActiveBorrows: jest.fn().mockResolvedValue(0),
    countCopies: jest.fn().mockResolvedValue(0),
    setCopyAvailable: jest.fn().mockResolvedValue(undefined),
    createBorrowRecord: jest.fn().mockImplementation((patronId: string, bookId: string, copyId: string | null | undefined, shelfLocation: string | null) =>
      Promise.resolve(createMockRecord({ patronId, bookId, copyId: copyId || undefined, shelfLocation: shelfLocation || undefined }))
    ),
    returnBook: jest.fn().mockImplementation((record: any) => {
      record.returnAt = new Date();
      record.status = 'returned';
      return Promise.resolve(record);
    }),
    createSlip: jest.fn().mockImplementation((patronId: string, bookIds: string[], copyIds: (string | null)[], shelfLocations: (string | null)[], createdByUserId?: string | null, createdByEmail?: string | null) => {
      const slip = createMockSlip({ patronId, createdByUserId, createdByEmail, totalItems: bookIds.length });
      const records = bookIds.map((bookId: string, i: number) =>
        createMockRecord({
          patronId,
          bookId,
          copyId: copyIds[i] || undefined,
          slipId: slip.id,
          shelfLocation: shelfLocations[i] || undefined,
        })
      );
      return Promise.resolve({ slip, records });
    }),
    getBooksByIsbns: jest.fn().mockResolvedValue(new Map<string, MockBook>()),
    listBooks: jest.fn().mockResolvedValue({ items: [], total: 0, stats: new Map() }),
    upsertBook: jest.fn().mockImplementation((isbn: string, title: string, author?: string | null, coverUrl?: string | null) =>
      Promise.resolve({ book: createMockBook({ isbn, title, author, coverUrl }), created: true })
    ),
    createCopy: jest.fn().mockImplementation((bookId: string, barcode: string, shelfLocation?: string | null) =>
      Promise.resolve(createMockCopy({ bookId, barcode, shelfLocation: shelfLocation || undefined }))
    ),
    createCopiesBatchWithSkip: jest.fn().mockResolvedValue([]),
    deleteCopies: jest.fn().mockResolvedValue(undefined),
    bulkDeleteBooks: jest.fn().mockResolvedValue({ deleted: 0, errors: [] }),
    getStats: jest.fn().mockResolvedValue({ total: 0, active: 0, overdue: 0 }),
    getBarcodeOffsetsByBooks: jest.fn().mockResolvedValue(new Map<string, number>()),
    getMaxBarcodeNumberForBook: jest.fn().mockResolvedValue(0),
    getAvailableCopiesByBarcodeDesc: jest.fn().mockResolvedValue([]),
    hasActiveBorrows: jest.fn().mockResolvedValue(false),
    createQueryBuilder: jest.fn().mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getMany: jest.fn().mockResolvedValue([]),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(null),
    }),
    copies: {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
      save: jest.fn().mockResolvedValue(undefined),
    },
    books: {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    },
    records: {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    },
    slips: {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    },
  };
}