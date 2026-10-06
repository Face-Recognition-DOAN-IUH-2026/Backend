import { AccessService } from '../../services/AccessService';
import { AppDataSource } from '../../data-source';
import { realtimeHub } from '../../realtime/RealtimeHub';
import * as redisCounters from '../../redis';

jest.mock('../../redis', () => {
  const actual = jest.requireActual('../../redis');
  return {
    ...actual,
    incrementAccessCounter: jest.fn(),
    getAccessCounters: jest.fn(),
  };
});

jest.mock('../../clients/AmqpClient', () => ({
  amqpClient: {
    connect: jest.fn(),
    publish: jest.fn().mockResolvedValue(true),
    publishFanout: jest.fn(),
    subscribeFanout: jest.fn(),
  },
}));

const mockIncrement = redisCounters.incrementAccessCounter as jest.Mock;
const mockGetCounters = redisCounters.getAccessCounters as jest.Mock;

function mockRepos() {
  const logRepo = {
    save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
    create: jest.fn().mockImplementation((e: any) => e),
    createQueryBuilder: jest.fn(),
  };
  const stateRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation((e: any) => e),
  };
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
    const name = entity?.name || '';
    if (name === 'AccessLog') return logRepo;
    if (name === 'PatronAccessState') return stateRepo;
    return { findOne: jest.fn(), save: jest.fn(), create: jest.fn((e: any) => e) };
  });
  return { logRepo, stateRepo };
}

describe('AccessService.recordRecognitionEvent — spoof audit', () => {
  let service: AccessService;
  let repos: ReturnType<typeof mockRepos>;

  beforeEach(() => {
    repos = mockRepos();
    mockIncrement.mockResolvedValue(1);
    service = new AccessService();
  });

  it('persists a spoof row without touching patron state', async () => {
    await service.recordRecognitionEvent({
      event_id: 'evt-spoof-1',
      camera_id: 'kiosk',
      status: 'spoof',
      patron_id: 'patron-1',
      confidence: 0.2,
      image_url: 'minio://spoof_1.jpg',
      occurred_at: new Date().toISOString(),
    });

    expect(repos.logRepo.save).toHaveBeenCalledTimes(1);
    const saved = repos.logRepo.save.mock.calls[0][0];
    expect(saved.status).toBe('spoof');
    expect(saved.patronId).toBe('patron-1');
    expect(saved.cameraId).toBe('kiosk');
    expect(repos.stateRepo.save).not.toHaveBeenCalled();
    expect(repos.stateRepo.update).not.toHaveBeenCalled();
  });

  it('still persists granted rows and upserts state', async () => {
    repos.stateRepo.findOne.mockResolvedValue(null);

    await service.recordRecognitionEvent({
      event_id: 'evt-ok-1',
      camera_id: 'entry_gate',
      status: 'granted',
      patron_id: 'patron-1',
      confidence: 0.9,
      occurred_at: new Date().toISOString(),
    });

    expect(repos.logRepo.save).toHaveBeenCalledTimes(1);
    expect(repos.stateRepo.save).toHaveBeenCalled();
  });

  it('does not persist no_match rows', async () => {
    await service.recordRecognitionEvent({
      event_id: 'evt-nm-1',
      camera_id: 'entry_gate',
      status: 'no_match',
      occurred_at: new Date().toISOString(),
    });

    expect(repos.logRepo.save).not.toHaveBeenCalled();
    expect(repos.stateRepo.save).not.toHaveBeenCalled();
    expect(repos.stateRepo.update).not.toHaveBeenCalled();
  });

  it('increments server-side counters for spoof and no_match', async () => {
    await service.recordRecognitionEvent({
      event_id: 'evt-spoof-2',
      camera_id: 'kiosk',
      status: 'spoof',
      occurred_at: new Date().toISOString(),
    });
    await service.recordRecognitionEvent({
      event_id: 'evt-nm-2',
      camera_id: 'entry_gate',
      status: 'no_match',
      occurred_at: new Date().toISOString(),
    });

    expect(mockIncrement).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'spoof', cameraId: 'kiosk' }),
    );
    expect(mockIncrement).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'no_match', cameraId: 'entry_gate' }),
    );
  });
});

describe('AccessService.getStats — Redis-backed spoof/no_match', () => {
  let service: AccessService;

  beforeEach(() => {
    const logRepo: any = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
      find: jest.fn().mockResolvedValue([]),
    };
    (AppDataSource.getRepository as jest.Mock).mockImplementation(() => logRepo);
    mockGetCounters.mockResolvedValue({ spoof: 4, no_match: 9 });
    service = new AccessService();
    (realtimeHub.publish as jest.Mock).mockResolvedValue(undefined);
  });

  it('merges Redis counters into stats', async () => {
    const stats = await service.getStats();

    expect(stats.today_spoof).toBe(4);
    expect(stats.today_no_match).toBe(9);
    expect(stats.today_entries).toBe(0);
  });

  it('falls back to zero counters when Redis fails', async () => {
    mockGetCounters.mockRejectedValue(new Error('Redis down'));

    const stats = await service.getStats();

    expect(stats.today_spoof).toBe(0);
    expect(stats.today_no_match).toBe(0);
  });
});
