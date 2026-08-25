import { CreateAiMemoryTable1720200000002 } from '../../../migrations/1720200000002-CreateAiMemoryTable';

describe('CreateAiMemoryTable Migration', () => {
  let migration: CreateAiMemoryTable1720200000002;

  beforeEach(() => {
    migration = new CreateAiMemoryTable1720200000002();
  });

  it('should have correct migration name', () => {
    expect(migration.name).toBe('CreateAiMemoryTable1720200000002');
  });

  it('should have up method', () => {
    expect(typeof migration.up).toBe('function');
  });

  it('should have down method', () => {
    expect(typeof migration.down).toBe('function');
  });

  it('should create ai_memories table with correct columns', async () => {
    const mockQueryRunner = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    await migration.up(mockQueryRunner as any);

    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS ai.ai_memories')
    );
  });

  it('should create indexes on patron_id', async () => {
    const mockQueryRunner = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    await migration.up(mockQueryRunner as any);

    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_ai_memories_patron_id')
    );
  });

  it('should create unique constraint on patron_id and memory_key', async () => {
    const mockQueryRunner = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    await migration.up(mockQueryRunner as any);

    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_memories_patron_key')
    );
  });

  it('should drop table on down migration', async () => {
    const mockQueryRunner = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    await migration.down(mockQueryRunner as any);

    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE IF EXISTS ai.ai_memories')
    );
  });
});
