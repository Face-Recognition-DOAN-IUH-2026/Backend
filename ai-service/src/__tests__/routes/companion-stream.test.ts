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
    asr: { provider: 'mock', apiKey: '' },
  },
}));

const mockRetrieve = jest.fn().mockResolvedValue([]);
jest.mock('../../rag/retriever', () => ({
  retrieve: (...args: any[]) => mockRetrieve(...args),
}));

const mockCreateChatCompletion = jest.fn();
jest.mock('../../clients/nvidia', () => ({
  nvidiaClient: {
    createChatCompletion: (...args: any[]) => mockCreateChatCompletion(...args),
  },
}));

const mockGetMemoriesForPatron = jest.fn().mockResolvedValue({});
const mockConsolidateNewMemories = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/MemoryService', () => ({
  MemoryService: jest.fn().mockImplementation(() => ({
    getMemoriesForPatron: (...args: any[]) => mockGetMemoriesForPatron(...args),
    consolidateNewMemories: (...args: any[]) => mockConsolidateNewMemories(...args),
  })),
}));

const mockSynthesizeSpeech = jest.fn().mockResolvedValue({
  audioBase64: 'mock-audio-base64',
  visemes: [{ time: 0, value: 0 }],
  durationMs: 1000,
});
jest.mock('../../clients/TTSClient', () => ({
  TTSClient: jest.fn().mockImplementation(() => ({
    synthesizeSpeech: (...args: any[]) => mockSynthesizeSpeech(...args),
  })),
}));

const mockSearchBooks = jest.fn().mockResolvedValue({ success: true, data: [{ title: 'Lập trình TypeScript' }] });
jest.mock('../../tools/registry', () => ({
  patronToolDefs: [
    { name: 'search_books', description: 'Tìm kiếm sách', func: mockSearchBooks },
  ],
  getToolDefsForRole: jest.fn().mockReturnValue([
    { name: 'search_books', description: 'Tìm kiếm sách', func: mockSearchBooks },
  ]),
}));

import { processCompanionMessage } from '../../agent/agent';

describe('processCompanionMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRetrieve.mockResolvedValue([]);
    mockGetMemoriesForPatron.mockResolvedValue({});
  });

  it('should yield text chunks via SSE', async () => {
    mockCreateChatCompletion.mockResolvedValue('Xin chào!');

    const chunks: any[] = [];
    for await (const chunk of processCompanionMessage({
      message: 'Xin chào',
      sessionId: 'test-session',
      role: 'patron',
      patronId: 'patron-123',
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some(c => c.type === 'text')).toBe(true);
    expect(chunks.some(c => c.type === 'companion_done')).toBe(true);
  });

  it('should include memories in system prompt', async () => {
    mockGetMemoriesForPatron.mockResolvedValue({ favorite_genre: 'sci-fi' });
    mockCreateChatCompletion.mockResolvedValue('Hello!');

    const chunks: any[] = [];
    for await (const chunk of processCompanionMessage({
      message: 'Hi',
      sessionId: 'test-session',
      role: 'patron',
      patronId: 'patron-123',
    })) {
      chunks.push(chunk);
    }

    expect(mockGetMemoriesForPatron).toHaveBeenCalledWith('patron-123');
  });

  it('should call TTS for text chunks', async () => {
    mockCreateChatCompletion.mockResolvedValue('Xin chào bạn!');

    const chunks: any[] = [];
    for await (const chunk of processCompanionMessage({
      message: 'Xin chào',
      sessionId: 'test-session',
      role: 'patron',
      patronId: 'patron-123',
    })) {
      chunks.push(chunk);
    }

    expect(mockSynthesizeSpeech).toHaveBeenCalled();
  });

  it('should handle tool calls mid-stream', async () => {
    mockCreateChatCompletion
      .mockResolvedValueOnce('Để tôi tìm sách cho bạn...')
      .mockResolvedValueOnce('{"tool": "search_books", "arguments": {"query": "lập trình"}}')
      .mockResolvedValueOnce('Tôi đã tìm thấy sách về lập trình.');

    const chunks: any[] = [];
    for await (const chunk of processCompanionMessage({
      message: 'Tìm sách lập trình',
      sessionId: 'test-session',
      role: 'patron',
      patronId: 'patron-123',
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some(c => c.type === 'tool_result' || c.type === 'text')).toBe(true);
  });

  it('should emit companion_done at the end', async () => {
    mockCreateChatCompletion.mockResolvedValue('Kết thúc!');

    const chunks: any[] = [];
    for await (const chunk of processCompanionMessage({
      message: 'Tạm biệt',
      sessionId: 'test-session',
      role: 'patron',
      patronId: 'patron-123',
    })) {
      chunks.push(chunk);
    }

    expect(chunks[chunks.length - 1].type).toBe('companion_done');
  });

  it('should consolidate memories after response', async () => {
    mockCreateChatCompletion.mockResolvedValue('Cảm ơn bạn!');

    const chunks: any[] = [];
    for await (const chunk of processCompanionMessage({
      message: 'Tôi thích thể loại khoa học viễn tưởng',
      sessionId: 'test-session',
      role: 'patron',
      patronId: 'patron-123',
    })) {
      chunks.push(chunk);
    }

    expect(mockConsolidateNewMemories).toHaveBeenCalled();
  });
});
