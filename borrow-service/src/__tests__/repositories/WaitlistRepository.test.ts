import { WaitlistRepository } from '../../repositories/WaitlistRepository';
import { AppDataSource } from '../../data-source';
import { QueryFailedError } from 'typeorm';

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
        where: jest.fn().mockReturnThis(),
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

  describe('getNextInQueue', () => {
    it('should return null when no waiting entries', async () => {
      mockWaitlistRepo.find.mockResolvedValue([]);

      const result = await repo.getNextInQueue('book-1');

      expect(result).toBeNull();
      expect(mockWaitlistRepo.find).toHaveBeenCalledWith({
        where: { bookId: 'book-1', status: 'waiting' },
        order: { createdAt: 'ASC' },
        take: 1,
      });
    });

    it('should return the first waiting entry', async () => {
      const entry = { id: 'wl-1', bookId: 'book-1', patronId: 'p1', status: 'waiting', createdAt: new Date('2025-01-01') };
      mockWaitlistRepo.find.mockResolvedValue([entry]);

      const result = await repo.getNextInQueue('book-1');

      expect(result).toEqual(entry);
    });
  });

  describe('markExpired', () => {
    it('should update status to expired', async () => {
      await repo.markExpired('wl-1');

      expect(mockWaitlistRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('markFulfilled', () => {
    it('should update status to fulfilled', async () => {
      await repo.markFulfilled('wl-1');

      expect(mockWaitlistRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('getExpiredNotifications', () => {
    it('should return entries with notifiedAt older than threshold', async () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const recent = new Date(Date.now() - 1 * 60 * 60 * 1000);
      const entries = [
        { id: 'wl-1', status: 'notified', notifiedAt: old },
        { id: 'wl-2', status: 'notified', notifiedAt: recent },
      ];
      mockWaitlistRepo.find.mockResolvedValue(entries);

      const result = await repo.getExpiredNotifications(24);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('wl-1');
    });

    it('should return empty when no entries exceed threshold', async () => {
      const recent = new Date(Date.now() - 1 * 60 * 60 * 1000);
      mockWaitlistRepo.find.mockResolvedValue([
        { id: 'wl-1', status: 'notified', notifiedAt: recent },
      ]);

      const result = await repo.getExpiredNotifications(24);

      expect(result).toHaveLength(0);
    });
  });

  describe('joinWaitlist — duplicate handling (BLF-WL-01 1a)', () => {
    it('returns the existing row when a concurrent save hits the unique index (23505)', async () => {
      mockBookRepo.findOne.mockResolvedValue({ id: 'book-1' });
      const winner = { id: 'wl-winner', bookId: 'book-1', patronId: 'patron-1', status: 'waiting' };

      const dupErr = new QueryFailedError(
        'insert into waitlists',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      mockWaitlistRepo.save.mockRejectedValue(dupErr);
      // pre-check: null (nothing yet); re-read after 23505: the concurrent winner.
      mockWaitlistRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(winner);

      const result = await repo.joinWaitlist('book-1', 'patron-1');

      expect(result).toEqual(winner);
      expect(mockWaitlistRepo.save).toHaveBeenCalledTimes(1);
    });

    it('re-throws non-23505 save errors', async () => {
      mockBookRepo.findOne.mockResolvedValue({ id: 'book-1' });
      mockWaitlistRepo.findOne.mockResolvedValue(null);
      mockWaitlistRepo.save.mockRejectedValue(new Error('connection lost'));

      await expect(repo.joinWaitlist('book-1', 'patron-1')).rejects.toThrow('connection lost');
    });
  });

  describe('resetNotifiedToWaiting (BLF-WL-01 1b)', () => {
    it('resets notified rows back to waiting for the book only', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      mockWaitlistRepo.createQueryBuilder.mockReturnValue(qb);

      await repo.resetNotifiedToWaiting('book-1');

      expect(qb.update).toHaveBeenCalledWith(expect.anything());
      expect(qb.set).toHaveBeenCalledWith({ status: 'waiting', notifiedAt: null });
      expect(qb.where).toHaveBeenCalledWith({ bookId: 'book-1', status: 'notified' });
      expect(qb.execute).toHaveBeenCalledTimes(1);
    });

    it('still executes when there are no notified rows', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      mockWaitlistRepo.createQueryBuilder.mockReturnValue(qb);

      await repo.resetNotifiedToWaiting('book-1');

      expect(qb.execute).toHaveBeenCalledTimes(1);
    });
  });
});
