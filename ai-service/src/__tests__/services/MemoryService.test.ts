const mockRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../../data-source', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue(mockRepository),
  },
}));

jest.mock('../../config', () => ({
  config: {
    port: 3004,
    nodeEnv: 'test',
    jwtSecret: 'test-jwt-secret',
    jwtIssuer: 'test-issuer',
    jwtAudience: 'test-audience',
    serviceJwtSecret: 'test-service-jwt',
    accessServiceUrl: 'http://access-service:3003',
    borrowServiceUrl: 'http://borrow-service:8000',
    scheduleServiceUrl: 'http://schedule-service:3002',
    userServiceUrl: 'http://user-service:3001',
    openRouter: { apiKey: '', model: 'openai/gpt-4.1-mini', baseUrl: 'https://openrouter.ai/api/v1' },
    nvidiaApiKey: '',
    nvidiaModel: 'meta/llama-3.1-70b-instruct',
    nvidiaEmbedModel: 'nvidia/nv-embedqa-e5-v5',
    chromaDbUrl: 'http://localhost:8000',
    chromaCollection: 'library-kb',
    ai: { refreshMinutes: 15, mockMode: true },
    db: { host: 'localhost', port: 5432, database: 'aidb', schema: 'ai', user: 'test', password: 'test' },
    corsOrigins: [],
  },
}));

import { MemoryService } from '../../services/MemoryService';
import { AppDataSource } from '../../data-source';

describe('MemoryService', () => {
  let memoryService: MemoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    memoryService = new MemoryService();
  });

  describe('getMemoriesForPatron', () => {
    it('should return memories as key-value map', async () => {
      const mockMemories = [
        { memoryKey: 'favorite_genre', memoryValue: 'sci-fi' },
        { memoryKey: 'preferred_language', memoryValue: 'Vietnamese' },
      ];
      mockRepository.find.mockResolvedValue(mockMemories);

      const result = await memoryService.getMemoriesForPatron('patron-123');

      expect(result).toEqual({
        favorite_genre: 'sci-fi',
        preferred_language: 'Vietnamese',
      });
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { patronId: 'patron-123' },
      });
    });

    it('should return empty object when no memories exist', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await memoryService.getMemoriesForPatron('patron-123');

      expect(result).toEqual({});
    });
  });

  describe('saveMemoryForPatron', () => {
    it('should create new memory if not exists', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue({
        patronId: 'patron-123',
        memoryKey: 'favorite_genre',
        memoryValue: 'sci-fi',
      });
      mockRepository.save.mockResolvedValue({
        id: 'mem-1',
        patronId: 'patron-123',
        memoryKey: 'favorite_genre',
        memoryValue: 'sci-fi',
      });

      await memoryService.saveMemoryForPatron('patron-123', 'favorite_genre', 'sci-fi');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { patronId: 'patron-123', memoryKey: 'favorite_genre' },
      });
      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should update existing memory', async () => {
      const existingMemory = {
        id: 'mem-1',
        patronId: 'patron-123',
        memoryKey: 'favorite_genre',
        memoryValue: 'old-value',
      };
      mockRepository.findOne.mockResolvedValue(existingMemory);
      mockRepository.save.mockResolvedValue({
        ...existingMemory,
        memoryValue: 'new-value',
      });

      await memoryService.saveMemoryForPatron('patron-123', 'favorite_genre', 'new-value');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { patronId: 'patron-123', memoryKey: 'favorite_genre' },
      });
      expect(mockRepository.save).toHaveBeenCalledWith({
        ...existingMemory,
        memoryValue: 'new-value',
      });
    });
  });

  describe('consolidateNewMemories', () => {
    it('should extract and save memories from chat history', async () => {
      const chatHistory = [
        { role: 'user', content: 'Tôi thích thể loại khoa học viễn tưởng' },
        { role: 'assistant', content: 'Cảm ơn bạn đã chia sẻ!' },
      ];
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue({
        patronId: 'patron-123',
        memoryKey: 'favorite_genre',
        memoryValue: 'sci-fi',
      });
      mockRepository.save.mockResolvedValue({});

      await memoryService.consolidateNewMemories('patron-123', chatHistory);

      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should handle empty chat history', async () => {
      await memoryService.consolidateNewMemories('patron-123', []);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('deleteMemoryForPatron', () => {
    it('should delete memory by patron and key', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      await memoryService.deleteMemoryForPatron('patron-123', 'favorite_genre');

      expect(mockRepository.delete).toHaveBeenCalledWith({
        patronId: 'patron-123',
        memoryKey: 'favorite_genre',
      });
    });
  });
});
