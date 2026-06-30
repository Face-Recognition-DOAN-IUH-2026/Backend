import { WaitlistRepository } from '../../repositories/WaitlistRepository';
import { AppDataSource } from '../../data-source';

jest.mock('../../data-source');

describe('WaitlistRepository', () => {
  let repo: WaitlistRepository;
  let mockWaitlistRepo: any;
  let mockBookRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitlistRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      save: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        whereInIds: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      }),
    };
    mockBookRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
      if (entity === 'Waitlist' || entity?.name === 'Waitlist') return mockWaitlistRepo;
      if (entity === 'Book' || entity?.name === 'Book') return mockBookRepo;
      return mockWaitlistRepo;
    });
    repo = new WaitlistRepository();
  });

  describe('joinWaitlist', () => {
    it('should throw 404 if book not found', async () => {
      mockBookRepo.findOne.mockResolvedValue(null);

      await expect(repo.joinWaitlist('book-1', 'patron-1')).rejects.toThrow('Book not found');
    });

    it('should throw 409 if already on waitlist', async () => {
      mockBookRepo.findOne.mockResolvedValue({ id: 'book-1' });
      mockWaitlistRepo.findOne.mockResolvedValue({ id: 'existing', bookId: 'book-1', patronId: 'patron-1', status: 'waiting' });

      await expect(repo.joinWaitlist('book-1', 'patron-1')).rejects.toThrow('Already on waitlist');
    });

    it('should create and save waitlist entry', async () => {
      mockBookRepo.findOne.mockResolvedValue({ id: 'book-1' });
      mockWaitlistRepo.findOne.mockResolvedValue(null);
      const newEntry = { id: 'wl-1', bookId: 'book-1', patronId: 'patron-1', status: 'waiting' };
      mockWaitlistRepo.create.mockReturnValue(newEntry);
      mockWaitlistRepo.save.mockResolvedValue(newEntry);

      const result = await repo.joinWaitlist('book-1', 'patron-1');

      expect(mockWaitlistRepo.create).toHaveBeenCalledWith({ bookId: 'book-1', patronId: 'patron-1', status: 'waiting' });
      expect(mockWaitlistRepo.save).toHaveBeenCalledWith(newEntry);
      expect(result).toEqual(newEntry);
    });
  });

  describe('getWaitlistByBook', () => {
    it('should return empty array when no entries', async () => {
      mockWaitlistRepo.find.mockResolvedValue([]);

      const result = await repo.getWaitlistByBook('book-1');

      expect(result).toEqual([]);
      expect(mockWaitlistRepo.find).toHaveBeenCalledWith({
        where: { bookId: 'book-1', status: 'waiting' },
        order: { createdAt: 'ASC' },
      });
    });

    it('should return waiting entries sorted by createdAt', async () => {
      const entries = [
        { id: 'wl-1', bookId: 'book-1', patronId: 'p1', status: 'waiting', createdAt: new Date('2025-01-01') },
        { id: 'wl-2', bookId: 'book-1', patronId: 'p2', status: 'waiting', createdAt: new Date('2025-01-02') },
      ];
      mockWaitlistRepo.find.mockResolvedValue(entries);

      const result = await repo.getWaitlistByBook('book-1');

      expect(result).toEqual(entries);
    });
  });

  describe('cancelWaitlist', () => {
    it('should throw 404 if entry not found', async () => {
      mockWaitlistRepo.findOne.mockResolvedValue(null);

      await expect(repo.cancelWaitlist('wl-x', 'patron-1')).rejects.toThrow('Waitlist entry not found');
    });

    it('should throw 403 if not owner', async () => {
      mockWaitlistRepo.findOne.mockResolvedValue({ id: 'wl-1', patronId: 'patron-2' });

      await expect(repo.cancelWaitlist('wl-1', 'patron-1')).rejects.toThrow('Not your waitlist entry');
    });

    it('should remove entry if owner', async () => {
      const entry = { id: 'wl-1', patronId: 'patron-1' };
      mockWaitlistRepo.findOne.mockResolvedValue(entry);
      mockWaitlistRepo.remove.mockResolvedValue(entry);

      await repo.cancelWaitlist('wl-1', 'patron-1');

      expect(mockWaitlistRepo.remove).toHaveBeenCalledWith(entry);
    });
  });

  describe('markNotified', () => {
    it('should do nothing with empty ids', async () => {
      await repo.markNotified([]);

      expect(mockWaitlistRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should update status and notifiedAt for given ids', async () => {
      await repo.markNotified(['wl-1', 'wl-2']);

      expect(mockWaitlistRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });
});
