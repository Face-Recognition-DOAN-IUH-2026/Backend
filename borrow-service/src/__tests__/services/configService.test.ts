import { ConfigService } from '../../services/ConfigService';
import { AppDataSource } from '../../data-source';

jest.mock('../../data-source', () => {
  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn().mockImplementation((entities) => Promise.resolve(entities)),
    create: jest.fn().mockImplementation((data) => data),
  };

  return {
    AppDataSource: {
      getRepository: jest.fn().mockReturnValue(mockRepo),
    },
  };
});

const getMockRepo = () =>
  AppDataSource.getRepository('SystemConfig' as any) as any;

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'cfg-1',
    category: overrides.category ?? 'borrow',
    configKey: overrides.configKey ?? 'max_borrow_days',
    configValue: overrides.configValue ?? 14,
    label: overrides.label ?? 'Số ngày mượn tối đa',
    description: overrides.description ?? null,
    isEncrypted: overrides.isEncrypted ?? false,
    updatedAt: new Date('2025-01-01'),
    updatedBy: overrides.updatedBy ?? null,
  };
}

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConfigService();
  });

  describe('getAll', () => {
    it('should return grouped settings by category', async () => {
      const repo = getMockRepo();
      repo.find.mockResolvedValue([
        makeConfig({ id: '1', category: 'borrow', configKey: 'max_borrow_days', configValue: 14 }),
        makeConfig({ id: '2', category: 'borrow', configKey: 'max_borrow_books', configValue: 3 }),
        makeConfig({ id: '3', category: 'fine', configKey: 'fine_per_day', configValue: 5000 }),
      ]);

      const result = await service.getAll();

      expect(Object.keys(result)).toEqual(['borrow', 'fine']);
      expect(result.borrow).toHaveLength(2);
      expect(result.fine).toHaveLength(1);
      expect(result.borrow[0].config_key).toBe('max_borrow_days');
      expect(result.borrow[0].config_value).toBe(14);
    });

    it('should mask encrypted values', async () => {
      const repo = getMockRepo();
      repo.find.mockResolvedValue([
        makeConfig({ id: '1', category: 'smtp', configKey: 'pass', configValue: 'real-secret', isEncrypted: true }),
      ]);

      const result = await service.getAll();

      expect(result.smtp[0].config_value).toBe('••••••••');
    });

    it('should return empty object when no configs exist', async () => {
      const repo = getMockRepo();
      repo.find.mockResolvedValue([]);

      const result = await service.getAll();

      expect(result).toEqual({});
    });
  });

  describe('getByCategory', () => {
    it('should return settings for given category', async () => {
      const repo = getMockRepo();
      repo.find.mockResolvedValue([
        makeConfig({ id: '1', category: 'borrow', configKey: 'max_borrow_days', configValue: 14 }),
      ]);

      const result = await service.getByCategory('borrow');

      expect(result).toHaveLength(1);
      expect(result[0].config_key).toBe('max_borrow_days');
    });

    it('should throw NotFoundError for unknown category', async () => {
      const repo = getMockRepo();
      repo.find.mockResolvedValue([]);

      await expect(service.getByCategory('nonexistent')).rejects.toThrow('not found');
    });

    it('should mask encrypted values', async () => {
      const repo = getMockRepo();
      repo.find.mockResolvedValue([
        makeConfig({ id: '1', category: 'smtp', configKey: 'pass', configValue: 'secret', isEncrypted: true }),
      ]);

      const result = await service.getByCategory('smtp');

      expect(result[0].config_value).toBe('••••••••');
    });
  });

  describe('updateCategory', () => {
    it('should update config values in a category', async () => {
      const repo = getMockRepo();
      const existing = [
        makeConfig({ id: '1', configKey: 'max_borrow_days', configValue: 14 }),
        makeConfig({ id: '2', configKey: 'max_borrow_books', configValue: 3 }),
      ];
      repo.find.mockResolvedValue(existing);

      const result = await service.updateCategory('borrow', { max_borrow_days: 21 }, 'admin-1');

      expect(repo.save).toHaveBeenCalled();
      const saved = (repo.save as jest.Mock).mock.calls[0][0];
      expect(saved[0].configValue).toBe(21);
      expect(saved[0].updatedBy).toBe('admin-1');
      expect(saved[1].configValue).toBe(3);
    });

    it('should preserve encrypted value when masked input sent', async () => {
      const repo = getMockRepo();
      const existing = [
        makeConfig({ id: '1', category: 'smtp', configKey: 'pass', configValue: 'real-secret', isEncrypted: true }),
      ];
      repo.find.mockResolvedValue(existing);

      await service.updateCategory('smtp', { pass: '••••••••' }, 'admin-1');

      const saved = (repo.save as jest.Mock).mock.calls[0][0];
      expect(saved[0].configValue).toBe('real-secret');
    });

    it('should throw NotFoundError for unknown category', async () => {
      const repo = getMockRepo();
      repo.find.mockResolvedValue([]);

      await expect(service.updateCategory('nonexistent', {}, null)).rejects.toThrow('not found');
    });

    it('should ignore keys not in existing configs', async () => {
      const repo = getMockRepo();
      const existing = [
        makeConfig({ id: '1', configKey: 'max_borrow_days', configValue: 14 }),
      ];
      repo.find.mockResolvedValue(existing);

      const result = await service.updateCategory('borrow', { unknown_key: 100 }, null);

      const saved = (repo.save as jest.Mock).mock.calls[0][0];
      expect(saved[0].configValue).toBe(14);
      expect(result[0].config_value).toBe(14);
    });
  });
});
