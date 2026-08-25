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

import { AiMemory } from '../../entities/AiMemory';

describe('AiMemory Entity', () => {
  it('should create instance with all properties', () => {
    const instance = new AiMemory();
    expect(instance).toBeDefined();
    expect(instance).toBeInstanceOf(AiMemory);
  });

  it('should have correct property types', () => {
    const instance = new AiMemory();
    expect(typeof instance.id).toBe('undefined');
    expect(typeof instance.patronId).toBe('undefined');
    expect(typeof instance.memoryKey).toBe('undefined');
    expect(typeof instance.memoryValue).toBe('undefined');
    expect(typeof instance.updatedAt).toBe('undefined');
  });
});
