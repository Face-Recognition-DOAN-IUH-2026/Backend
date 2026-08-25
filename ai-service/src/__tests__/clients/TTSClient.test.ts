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
    tts: { provider: 'mock', apiKey: '' },
  },
}));

import { TTSClient } from '../../clients/TTSClient';

describe('TTSClient', () => {
  let ttsClient: TTSClient;

  beforeEach(() => {
    jest.clearAllMocks();
    ttsClient = new TTSClient();
  });

  describe('synthesizeSpeech', () => {
    it('should return mock audio data in mock mode', async () => {
      const result = await ttsClient.synthesizeSpeech('Xin chào');

      expect(result).toBeDefined();
      expect(result.audioBase64).toBeDefined();
      expect(result.visemes).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should generate visemes array', async () => {
      const result = await ttsClient.synthesizeSpeech('Hello world');

      expect(Array.isArray(result.visemes)).toBe(true);
      expect(result.visemes.length).toBeGreaterThan(0);
    });

    it('should handle empty text', async () => {
      const result = await ttsClient.synthesizeSpeech('');

      expect(result).toBeDefined();
      expect(result.audioBase64).toBeDefined();
    });

    it('should generate consistent audio length based on text', async () => {
      const shortText = await ttsClient.synthesizeSpeech('Hi');
      const longText = await ttsClient.synthesizeSpeech('Đây là một câu văn dài hơn nhiều để kiểm tra thời lượng audio');

      expect(longText.durationMs).toBeGreaterThanOrEqual(shortText.durationMs);
    });
  });
});
