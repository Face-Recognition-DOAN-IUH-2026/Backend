import { BorrowRepository } from '../../repositories/BorrowRepository';
import { AppDataSource } from '../../data-source';
import {
  createMockBook,
  createMockCopy,
  createMockRecord,
  createMockSlip,
} from '../helpers/mock-repo';

jest.mock('../../data-source');

describe('BorrowRepository', () => {
  let repo: BorrowRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    (AppDataSource as any).createQueryRunner = jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        create: jest.fn().mockImplementation((_entity: any, data: any) => data),
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue({
            setLock: jest.fn().mockReturnThis(),
            whereInIds: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([]),
          }),
          save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
          create: jest.fn().mockImplementation((data: any) => data),
        }),
      },
    });
    repo = new BorrowRepository();
  });

  describe('getBookByIsbn', () => {
    it('should call createQueryBuilder with correct params', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (AppDataSource.getRepository('Book').createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      await repo.getBookByIsbn('9780123456789');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') = :isbn",
        { isbn: '9780123456789' }
      );
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
    });

    it('should normalize ISBN by removing hyphens and spaces', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (AppDataSource.getRepository('Book').createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      await repo.getBookByIsbn('978-0-12-34567-89');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "REPLACE(REPLACE(book.isbn, '-', ''), ' ', '') = :isbn",
        { isbn: '9780123456789' }
      );
    });

    it('should return book when found', async () => {
      const mockBook = createMockBook();
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockBook),
      };
      (AppDataSource.getRepository('Book').createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await repo.getBookByIsbn('9780123456789');

      expect(result).toEqual(mockBook);
    });
  });

  describe('getCopyByBarcode', () => {
    it('should normalize barcode before query', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (AppDataSource.getRepository('BookCopy').createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      await repo.getCopyByBarcode('LIB-978-012-345-6789-001');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "LOWER(REPLACE(REPLACE(copy.barcode, '-', ''), ' ', '')) = :barcode",
        { barcode: 'lib9780123456789001' }
      );
    });
  });

  describe('getAvailableCopy', () => {
    it('only selects copies that are available, in stock status and not lost', async () => {
      const mockFindOne = jest.fn().mockResolvedValue(null);
      (AppDataSource.getRepository('BookCopy').findOne as jest.Mock) = mockFindOne;

      await repo.getAvailableCopy('book-id');

      expect(mockFindOne).toHaveBeenCalledWith({
        where: {
          bookId: 'book-id',
          isAvailable: true,
          status: 'available',
          condition: expect.anything(),
        },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('getActiveBorrow', () => {
    it('should use IsNull for returnAt check', async () => {
      const mockFindOne = jest.fn().mockResolvedValue(null);
      (AppDataSource.getRepository('BorrowRecord').findOne as jest.Mock) = mockFindOne;

      await repo.getActiveBorrow('patron-id', 'book-id');

      expect(mockFindOne).toHaveBeenCalledWith({
        where: {
          patronId: 'patron-id',
          bookId: 'book-id',
          status: 'borrowed',
          returnAt: expect.anything(),
        },
        relations: { book: true, copy: true },
      });
    });
  });

  describe('getOverdueBorrows', () => {
    it('should query with dueAt less than now', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      (AppDataSource.getRepository('BorrowRecord').createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      await repo.getOverdueBorrows('patron-id');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'record.dueAt < :now',
        { now: expect.any(Date) }
      );
    });
  });

  describe('createBorrowRecord', () => {
    it('should create record with calculated due date', async () => {
      const mockSave = jest.fn().mockImplementation((entity: any) => Promise.resolve(entity));
      (AppDataSource.getRepository('BorrowRecord').create as jest.Mock).mockImplementation((data) => data);
      (AppDataSource.getRepository('BorrowRecord').save as jest.Mock) = mockSave;

      const patronId = 'patron-id';
      const bookId = 'book-id';
      const copyId = 'copy-id';
      const shelfLocation = 'A-1';

      await repo.createBorrowRecord(patronId, bookId, copyId, shelfLocation);

      expect(mockSave).toHaveBeenCalled();
      const savedRecord = mockSave.mock.calls[0][0];
      expect(savedRecord.patronId).toBe(patronId);
      expect(savedRecord.bookId).toBe(bookId);
      expect(savedRecord.copyId).toBe(copyId);
      expect(savedRecord.shelfLocation).toBe(shelfLocation);
      expect(savedRecord.status).toBe('borrowed');
      expect(savedRecord.dueAt).toBeInstanceOf(Date);
    });
  });

  describe('returnBook', () => {
    it('should set returnAt and status to returned', async () => {
      const record = createMockRecord();
      const mockSave = jest.fn().mockImplementation((entity: any) => Promise.resolve(entity));
      (AppDataSource.getRepository('BorrowRecord').save as jest.Mock) = mockSave;
      (AppDataSource.getRepository('BorrowRecord').findOne as jest.Mock) = jest.fn().mockResolvedValue(null);

      await repo.returnBook(record as any, 'staff-id', 'staff@test.com', 'staff_web', 'Note');

      expect(record.returnAt).toBeInstanceOf(Date);
      expect(record.status).toBe('returned');
      expect(record.returnedByUserId).toBe('staff-id');
      expect(record.returnedByEmail).toBe('staff@test.com');
      expect(record.returnMethod).toBe('staff_web');
      expect(record.note).toBe('Note');
    });
  });

  describe('setCopyAvailable', () => {
    it('should update isAvailable to false', async () => {
      const copy = createMockCopy({ isAvailable: true });
      const mockSave = jest.fn().mockImplementation((entity: any) => Promise.resolve(entity));
      (AppDataSource.getRepository('BookCopy').save as jest.Mock) = mockSave;

      await repo.setCopyAvailable(copy as any, false);

      expect(copy.isAvailable).toBe(false);
      expect(copy.updatedAt).toBeInstanceOf(Date);
    });

    it('should update isAvailable to true', async () => {
      const copy = createMockCopy({ isAvailable: false });
      const mockSave = jest.fn().mockImplementation((entity: any) => Promise.resolve(entity));
      (AppDataSource.getRepository('BookCopy').save as jest.Mock) = mockSave;

      await repo.setCopyAvailable(copy as any, true);

      expect(copy.isAvailable).toBe(true);
    });
  });

  describe('createSlip', () => {
    it('should create slip with correct totalItems', async () => {
      const patronId = 'patron-id';
      const bookIds = ['book-1', 'book-2', 'book-3'];
      const copyIds = ['copy-1', 'copy-2', 'copy-3'];
      const shelfLocations = ['A-1', 'B-2', 'C-3'];

      let savedSlip: any;
      const mockSave = jest.fn().mockImplementation((entity: any) => {
        if (entity.id === undefined) {
          entity.id = 'new-slip-id';
          savedSlip = entity;
        }
        return Promise.resolve(entity);
      });
      const mockCreate = jest.fn().mockImplementation((data: any) => data);

      (AppDataSource.getRepository('BorrowSlip').create as jest.Mock) = mockCreate;
      (AppDataSource.getRepository('BorrowSlip').save as jest.Mock) = mockSave;
      (AppDataSource.getRepository('BorrowRecord').create as jest.Mock) = mockCreate;
      (AppDataSource.getRepository('BorrowRecord').save as jest.Mock) = mockSave;

      const result = await repo.createSlip(
        patronId,
        bookIds as any,
        copyIds as any,
        shelfLocations as any,
        'staff-id',
        'staff@test.com'
      );

      expect(result.slip).toBeDefined();
      expect(result.slip.patronId).toBe(patronId);
      expect(result.slip.totalItems).toBe(bookIds.length);
      expect(result.records).toHaveLength(bookIds.length);
    });
  });

  describe('getStats', () => {
    it('should return total, active, and overdue counts', async () => {
      const mockCount = jest.fn();
      (AppDataSource.getRepository('BorrowRecord').count as jest.Mock) = mockCount;
      mockCount.mockResolvedValueOnce(100);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(10),
      };
      (AppDataSource.getRepository('BorrowRecord').createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await repo.getStats();

      expect(result.total).toBe(100);
      expect(result.overdue).toBe(10);
    });
  });

  describe('deleteBookAndCopies', () => {
    it('should delete records, copies, and book', async () => {
      const mockDelete = jest.fn().mockResolvedValue({ affected: 1 });
      (AppDataSource.getRepository('BorrowRecord').createQueryBuilder as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: mockDelete,
      });
      (AppDataSource.getRepository('BookCopy').delete as jest.Mock) = mockDelete;
      (AppDataSource.getRepository('Book').delete as jest.Mock) = mockDelete;

      await repo.deleteBookAndCopies('book-id');

      expect(mockDelete).toHaveBeenCalledTimes(3);
    });
  });

  describe('getBooksByIsbns', () => {
    it('should return map of isbn to book', async () => {
      const mockBooks = [
        createMockBook({ isbn: '9780000000001' }),
        createMockBook({ isbn: '9780000000002' }),
      ];
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockBooks),
      };
      (AppDataSource.getRepository('Book').createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await repo.getBooksByIsbns(['9780000000001', '9780000000002']);

      expect(result).toBeInstanceOf(Map);
      expect(result.get('9780000000001')).toBeDefined();
      expect(result.get('9780000000002')).toBeDefined();
    });

    it('should return empty map for empty input', async () => {
      const result = await repo.getBooksByIsbns([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe('countCopies', () => {
    it('should count total copies when availableOnly is false', async () => {
      const mockCount = jest.fn().mockResolvedValue(5);
      (AppDataSource.getRepository('BookCopy').count as jest.Mock) = mockCount;

      const result = await repo.countCopies('book-id', false);

      expect(result).toBe(5);
      expect(mockCount).toHaveBeenCalledWith({ where: { bookId: 'book-id' } });
    });

    it('should count available copies when availableOnly is true', async () => {
      const mockCount = jest.fn().mockResolvedValue(3);
      (AppDataSource.getRepository('BookCopy').count as jest.Mock) = mockCount;

      const result = await repo.countCopies('book-id', true);

      expect(result).toBe(3);
      expect(mockCount).toHaveBeenCalledWith({ where: { bookId: 'book-id', isAvailable: true } });
    });
  });
});