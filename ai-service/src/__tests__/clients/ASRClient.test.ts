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
    asr: { provider: 'mock', apiKey: '' },
  },
}));

import { ASRClient } from '../../clients/ASRClient';

describe('ASRClient', () => {
  let asrClient: ASRClient;

  beforeEach(() => {
    jest.clearAllMocks();
    asrClient = new ASRClient();
  });

  describe('transcribeAudio', () => {
    it('should return mock transcript in mock mode', async () => {
      const mockAudioBuffer = Buffer.from('mock audio data');
      const result = await asrClient.transcribeAudio(mockAudioBuffer);

      expect(result).toBeDefined();
      expect(result.transcript).toBeDefined();
      expect(typeof result.transcript).toBe('string');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.language).toBe('vi');
    });

    it('should handle different audio buffer sizes', async () => {
      const smallBuffer = Buffer.from('small');
      const largeBuffer = Buffer.from('x'.repeat(10000));

      const smallResult = await asrClient.transcribeAudio(smallBuffer);
      const largeResult = await asrClient.transcribeAudio(largeBuffer);

      expect(smallResult).toBeDefined();
      expect(largeResult).toBeDefined();
    });

    it('should return Vietnamese language code', async () => {
      const mockAudioBuffer = Buffer.from('mock audio data');
      const result = await asrClient.transcribeAudio(mockAudioBuffer);

      expect(result.language).toBe('vi');
    });
  });
});
