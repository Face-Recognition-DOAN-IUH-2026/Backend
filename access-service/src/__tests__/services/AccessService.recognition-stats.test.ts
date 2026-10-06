import { AccessService } from '../../services/AccessService';
import { AppDataSource } from '../../data-source';

jest.mock('../../redis', () => ({
  incrementAccessCounter: jest.fn().mockResolvedValue(1),
  getAccessCounters: jest.fn().mockResolvedValue({ spoof: 0, no_match: 0 }),
}));

jest.mock('../../clients/AmqpClient', () => ({
  amqpClient: {
    connect: jest.fn(),
    publish: jest.fn().mockResolvedValue(true),
    publishFanout: jest.fn(),
    subscribeFanout: jest.fn(),
  },
}));

describe('AccessService - Recognition Stats & Rollup', () => {
  let service: AccessService;
  let mockDailyRepo: any;
  let mockLogRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDailyRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
      create: jest.fn().mockImplementation((e: any) => e),
      createQueryBuilder: jest.fn(),
    };

    mockLogRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };

    (AppDataSource.getRepository as jest.Mock) = jest.fn().mockImplementation((entity: any) => {
      const name = entity?.name || '';
      if (name === 'AccessRecognitionDaily') return mockDailyRepo;
      if (name === 'AccessLog') return mockLogRepo;
      return { findOne: jest.fn(), save: jest.fn(), create: jest.fn((e: any) => e) };
    });

    service = new AccessService();
  });

  describe('rollupRecognition', () => {
    it('aggregates logs per camera and upserts into access_recognition_daily', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            camera_id: 'entry_gate',
            granted: '12',
            spoof: '3',
            no_match: '5',
            other: '0',
            avg_confidence: '0.92',
          },
        ]),
      };
      mockLogRepo.createQueryBuilder.mockReturnValue(qb);

      const dailyQb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ raw: [] }),
      };
      mockDailyRepo.createQueryBuilder.mockReturnValue(dailyQb);

      const result = await service.rollupRecognition('2026-10-03');

      expect(mockLogRepo.createQueryBuilder).toHaveBeenCalled();
      expect(result.date).toBe('2026-10-03');
      expect(result.cameras).toHaveLength(1);
      expect(result.cameras[0].granted).toBe(12);
      expect(result.cameras[0].spoof).toBe(3);
      expect(result.cameras[0].no_match).toBe(5);
      expect(result.cameras[0].avg_confidence).toBeCloseTo(0.92);
      expect(dailyQb.execute).toHaveBeenCalled();
    });
  });

  describe('getHourlyStats', () => {
    it('returns 24 buckets with entries and exits', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { hour: 8, access_type: 'entry', count: '15' },
          { hour: 8, access_type: 'exit', count: '2' },
          { hour: 17, access_type: 'exit', count: '20' },
        ]),
      };
      mockLogRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getHourlyStats('2026-10-03');

      expect(result).toHaveLength(24);
      expect(result[8]).toEqual({ hour: 8, entries: 15, exits: 2, total: 17 });
      expect(result[17]).toEqual({ hour: 17, entries: 0, exits: 20, total: 20 });
      expect(result[0]).toEqual({ hour: 0, entries: 0, exits: 0, total: 0 });
    });
  });

  describe('getRecognitionStats', () => {
    it('combines rolled-up past days with live today calculations and computes accuracy', async () => {
      // Past day rollup rows
      mockDailyRepo.find.mockResolvedValue([
        {
          statDate: '2026-10-02',
          cameraId: 'entry_gate',
          granted: 10,
          spoof: 2,
          noMatch: 3,
          other: 1,
          avgConfidence: 0.9,
        },
      ]);

      // Today live log queries
      const logQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          granted: '5',
          spoof: '1',
          no_match: '2',
          other: '0',
          avg_confidence: '0.88',
        }),
      };
      mockLogRepo.createQueryBuilder.mockReturnValue(logQb);

      const result = await service.getRecognitionStats(2);

      expect(result).toHaveLength(2);
      // Accuracy = granted / (granted + spoof + no_match)
      // For past day: 10 / (10 + 2 + 3) = 10 / 15 ≈ 0.6667
      const pastDay = result.find((r) => r.date === '2026-10-02');
      if (pastDay) {
        expect(pastDay.granted).toBe(10);
        expect(pastDay.accuracy).toBeCloseTo(10 / 15);
      }

      // Today: 5 / (5 + 1 + 2) = 5 / 8 = 0.625
      const todayItem = result[result.length - 1];
      expect(todayItem.granted).toBe(5);
      expect(todayItem.accuracy).toBeCloseTo(5 / 8);
    });
  });
});
