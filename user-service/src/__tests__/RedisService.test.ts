import { RedisService } from '../services/RedisService';

jest.unmock('../services/RedisService');
jest.mock('ioredis', () => {
  const store: Record<string, string> = {};
  const MockRedis = jest.fn().mockImplementation(() => ({
    get: jest.fn(async (key: string) => store[key] ?? null),
    setex: jest.fn(async (key: string, _ttl: number, val: string) => { store[key] = val; }),
    del: jest.fn(async (key: string) => { delete store[key]; }),
    pipeline: jest.fn(() => ({
      get: jest.fn((key: string) => ({
        exec: jest.fn(async () => [[null, store[key] ?? null]]),
      })),
      setex: jest.fn((key: string, _ttl: number, val: string) => {
        store[key] = val;
        return { exec: jest.fn(async () => [[null, 'OK']]) };
      }),
      exec: jest.fn(async () => {
        const results: [null, string | null][] = [];
        return results;
      }),
    })),
    publish: jest.fn(async () => 1),
    on: jest.fn(),
  }));
  return { __esModule: true, default: MockRedis };
});

jest.mock('../config', () => ({
  config: {
    redisUrl: 'redis://localhost:6379/0',
    serviceJwtSecret: 'test-key',
  },
}));

describe('RedisService - Face Status Caching', () => {
  let redis: RedisService;

  beforeEach(() => {
    redis = new RedisService();
  });

  describe('cacheFaceStatus / getFaceStatus', () => {
    it('should cache and retrieve face status', async () => {
      await redis.cacheFaceStatus('user-1', true);
      const result = await redis.getFaceStatus('user-1');
      expect(result).toBe(true);
    });

    it('should return null for uncached user', async () => {
      const result = await redis.getFaceStatus('nonexistent');
      expect(result).toBeNull();
    });

    it('should cache false correctly', async () => {
      await redis.cacheFaceStatus('user-2', false);
      const result = await redis.getFaceStatus('user-2');
      expect(result).toBe(false);
    });
  });

  describe('invalidateFaceStatus', () => {
    it('should remove cached face status', async () => {
      await redis.cacheFaceStatus('user-1', true);
      await redis.invalidateFaceStatus('user-1');
      const result = await redis.getFaceStatus('user-1');
      expect(result).toBeNull();
    });
  });
});
