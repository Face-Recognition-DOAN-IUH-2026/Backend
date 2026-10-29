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
    chromaDbUrl: 'http://localhost:8000',
    chromaCollection: 'library-kb',
    ai: { refreshMinutes: 15, mockMode: true },
    db: { host: 'localhost', port: 5432, database: 'aidb', schema: 'ai', user: 'test', password: 'test' },
    corsOrigins: [],
    tts: { provider: 'mock', apiKey: '' },
    asr: { provider: 'mock', apiKey: '' },
  },
}));

const mockCreateChatCompletion = jest.fn();
const mockStreamChatCompletion = jest.fn();
jest.mock('../../clients/nvidia', () => ({
  nvidiaClient: {
    createChatCompletion: (...args: any[]) => mockCreateChatCompletion(...args),
    streamChatCompletion: (...args: any[]) => mockStreamChatCompletion(...args),
  },
}));

const mockRetrieve = jest.fn().mockResolvedValue([]);
jest.mock('../../rag/retriever', () => ({
  retrieve: (...args: any[]) => mockRetrieve(...args),
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
  audioBase64: 'mock-audio',
  visemes: [{ time: 0, value: 0 }],
  durationMs: 400,
});
jest.mock('../../clients/TTSClient', () => ({
  TTSClient: jest.fn().mockImplementation(() => ({
    synthesizeSpeech: (...args: any[]) => mockSynthesizeSpeech(...args),
  })),
}));

const mockTranscribeAudio = jest.fn().mockResolvedValue({ transcript: 'sach react' });
jest.mock('../../clients/ASRClient', () => ({
  ASRClient: jest.fn().mockImplementation(() => ({
    transcribeAudio: (...args: any[]) => mockTranscribeAudio(...args),
  })),
}));

const mockSearchBooks = jest.fn().mockResolvedValue({ success: true, data: [{ title: 'React Docs' }] });
jest.mock('../../tools/registry', () => {
  const actual = jest.requireActual('../../tools/registry');
  const searchTool = {
    name: 'search_books',
    description: 'Tim kiem sach',
    func: mockSearchBooks,
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  };
  return {
    patronToolDefs: [searchTool],
    toOpenAITools: actual.toOpenAITools,
    bindToolArgs: actual.bindToolArgs,
    getToolDefsForRole: jest.fn().mockReturnValue([searchTool]),
  };
});

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { createAuth } from '../../../../shared/auth';
import { sessionStore } from '../../sessions';
import companionRouter from '../../routes/companion';

const JWT_SECRET = 'test-jwt-secret';

function signToken(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub, roles: ['patron'], iss: 'test-issuer', aud: 'test-audience', typ: 'access', iat: now, exp: now + 3600 },
    JWT_SECRET,
  );
}

function parseSse(text: string): any[] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
}

async function* gen(events: any[]): AsyncGenerator<any> {
  for (const e of events) yield e;
}

function deltas(...contents: string[]) {
  return contents.map((c) => ({ type: 'text_delta', content: c }));
}

function done(content: string, toolCalls: any[] = []) {
  return { type: 'done', content, toolCalls };
}

describe('POST /ai/companion/stream (SSE route)', () => {
  let app: express.Express;

  beforeAll(() => {
    const auth = createAuth({ jwtSecret: JWT_SECRET, jwtAudience: 'test-audience', jwtIssuer: 'test-issuer' });
    app = express();
    app.use(express.json());
    app.use('/ai/companion', auth, companionRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRetrieve.mockResolvedValue([]);
    mockGetMemoriesForPatron.mockResolvedValue({});
    mockConsolidateNewMemories.mockResolvedValue(undefined);
    mockSynthesizeSpeech.mockResolvedValue({ audioBase64: 'mock-audio', visemes: [], durationMs: 400 });
    mockTranscribeAudio.mockResolvedValue({ transcript: 'sach react' });
    // Default: legacy non-stream completion (the pre-streaming contract).
    mockCreateChatCompletion.mockResolvedValue('Thu vien mo cua tu 8h den 21h.');
    // Default: new streaming contract.
    mockStreamChatCompletion.mockImplementation(() =>
      gen([...deltas('Thu ', 'vien '), done('Thu vien mo cua tu 8h den 21h.')]),
    );
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/ai/companion/stream').send({ message: 'hi' });
    expect(res.status).toBe(401);
    expect(mockStreamChatCompletion).not.toHaveBeenCalled();
    expect(mockCreateChatCompletion).not.toHaveBeenCalled();
  });

  it('returns 400 when neither message nor audioBase64 is provided', async () => {
    const res = await request(app)
      .post('/ai/companion/stream')
      .set('Authorization', `Bearer ${signToken('patron-123')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(mockStreamChatCompletion).not.toHaveBeenCalled();
    expect(mockCreateChatCompletion).not.toHaveBeenCalled();
  });

  it('blocks image content without starting the agent', async () => {
    const res = await request(app)
      .post('/ai/companion/stream')
      .set('Authorization', `Bearer ${signToken('patron-123')}`)
      .send({ message: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(res.status).toBe(400);
    expect(mockStreamChatCompletion).not.toHaveBeenCalled();
    expect(mockCreateChatCompletion).not.toHaveBeenCalled();
  });

  it('streams text_delta chunks to the client AND persists the answer exactly once', async () => {
    const res = await request(app)
      .post('/ai/companion/stream')
      .set('Authorization', `Bearer ${signToken('patron-123')}`)

      .send({ message: 'Thu vien mo cua gio nao?' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = parseSse(res.text);
    const types = events.map((e) => e.type);

    // Token-by-token streaming must be visible BEFORE the authoritative final text.
    const deltaContents = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => e.data.content)
      .join('');
    expect(deltaContents.length).toBeGreaterThan(0);
    expect(types.indexOf('text_delta')).toBeLessThan(types.lastIndexOf('text'));

    // The final text must be marked authoritative so clients can replace streamed text.
    const finalTexts = events.filter((e) => e.type === 'text');
    expect(finalTexts[finalTexts.length - 1].data.final).toBe(true);
    expect(finalTexts[finalTexts.length - 1].data.content).toBe('Thu vien mo cua tu 8h den 21h.');

    expect(types[types.length - 1]).toBe('companion_done');
    const sessionId = events.find((e) => e.type === 'companion_done').data.sessionId;

    const session = sessionStore.get(sessionId)!;
    const assistant = session.messages.filter((m) => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe('Thu vien mo cua tu 8h den 21h.');
    expect(assistant[0].content).not.toContain('Thu Thu vien');
    expect(assistant[0].content).not.toContain('vien Thu vien');
  });

  it('keeps the [Voice] transcript prefix in front of the streamed answer and persists it once', async () => {
    mockStreamChatCompletion.mockImplementation(() =>
      gen([...deltas('Toi tim thay '), done('Toi tim thay sach.')]),
    );
    mockCreateChatCompletion.mockResolvedValue('Toi tim thay sach.');

    const res = await request(app)
      .post('/ai/companion/stream')
      .set('Authorization', `Bearer ${signToken('patron-123')}`)
      .send({ message: '', audioBase64: Buffer.from('fake-audio').toString('base64') });

    expect(res.status).toBe(200);
    expect(mockTranscribeAudio).toHaveBeenCalled();

    const events = parseSse(res.text);
    const types = events.map((e) => e.type);

    // The voice transcript arrives first as a non-final text chunk, then the answer streams.
    expect(types).toContain('text');
    expect(types.indexOf('text')).toBeLessThan(types.lastIndexOf('text'));
    expect(
      events
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.data.content)
        .join(''),
    ).toContain('Toi tim thay ');

    const sessionId = events.find((e) => e.type === 'companion_done').data.sessionId;
    const assistant = sessionStore.get(sessionId)!.messages.filter((m) => m.role === 'assistant');

    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe('[Voice] sach reactToi tim thay sach.');
    expect(assistant[0].content).not.toContain('Toi tim thay sach.Toi tim thay sach.');
  });

  it('streams a native tool call round-trip without leaking tool JSON as visible text', async () => {
    mockStreamChatCompletion
      .mockReturnValueOnce(gen([done('', [{ id: 'c1', name: 'search_books', args: { query: 'react' } }])]))
      .mockReturnValueOnce(gen([...deltas('Tim thay sach.'), done('Tim thay sach.')]));

    const res = await request(app)
      .post('/ai/companion/stream')
      .set('Authorization', `Bearer ${signToken('patron-123')}`)
      .send({ message: 'tim sach react' });

    const events = parseSse(res.text);
    const types = events.map((e) => e.type);
    const visible = events
      .filter((e) => e.type === 'text_delta' || e.type === 'text')
      .map((e) => e.data.content)
      .join('');

    expect(mockSearchBooks).toHaveBeenCalledWith('react');
    expect(types.indexOf('tool_result')).toBeLessThan(types.lastIndexOf('text'));
    expect(visible).not.toContain('"tool"');
    expect(visible).not.toContain('search_books');

    const sessionId = events.find((e) => e.type === 'companion_done').data.sessionId;
    const assistant = sessionStore.get(sessionId)!.messages.filter((m) => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe('Tim thay sach.');
  });

  it('returns an SSE error chunk when the agent throws after headers are sent', async () => {
    mockStreamChatCompletion.mockImplementation(() => {
      throw new Error('provider exploded');
    });
    mockCreateChatCompletion.mockRejectedValue(new Error('provider exploded'));

    const res = await request(app)
      .post('/ai/companion/stream')
      .set('Authorization', `Bearer ${signToken('patron-123')}`)
      .send({ message: 'hi' });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.text);
    expect(events.some((e) => e.type === 'error' || e.type === 'text')).toBe(true);
  });
});
