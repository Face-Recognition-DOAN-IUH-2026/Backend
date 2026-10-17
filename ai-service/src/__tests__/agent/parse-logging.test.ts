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

jest.mock('../../rag/retriever', () => {
  const actual = jest.requireActual('../../rag/retriever');
  return { ...actual, retrieve: jest.fn().mockResolvedValue([]) };
});

import { formatScheduleJson, parseToolCalls } from '../../agent/agent';

describe('agent parse failures log instead of silent swallow (#18)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('formatScheduleJson logs and returns original text on malformed schedule JSON', () => {
    const text = 'Hours ```json\n{"schedule": [{"days": Monday}]}\n```';
    const out = formatScheduleJson(text);
    expect(out).toBe(text);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('parseToolCalls logs malformed tool-call JSON and returns no calls', () => {
    const calls = parseToolCalls('{"tool": "search_books", "arguments": {broken}');
    expect(calls).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('parseToolCalls logs malformed NIM tool-call JSON and returns no calls', () => {
    const calls = parseToolCalls(
      'functions.lookup_book<|tool_call_argument_begin|>{bad json}<|tool_call_end|>'
    );
    expect(calls).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('parseToolCalls logs malformed bare JSON and returns no calls', () => {
    const calls = parseToolCalls('{"query": bad}');
    expect(calls).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });
});
