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

const mockStreamChatCompletion = jest.fn();
jest.mock('../../clients/nvidia', () => ({
  nvidiaClient: {
    createChatCompletion: jest.fn().mockResolvedValue('fallback non-stream answer'),
    streamChatCompletion: (...args: any[]) => mockStreamChatCompletion(...args),
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
  audioBase64: 'mock-audio',
  visemes: [{ time: 0, value: 0 }],
  durationMs: 500,
});
jest.mock('../../clients/TTSClient', () => ({
  TTSClient: jest.fn().mockImplementation(() => ({
    synthesizeSpeech: (...args: any[]) => mockSynthesizeSpeech(...args),
  })),
}));

const mockSearchBooks = jest.fn().mockResolvedValue({ success: true, data: [{ title: 'React Docs' }] });
const mockGetPatronInfo = jest.fn().mockResolvedValue({ success: true, data: { name: 'Nguyen A' } });
jest.mock('../../tools/registry', () => {
  const actual = jest.requireActual('../../tools/registry');
  const searchBooksTool = {
    name: 'search_books',
    description: 'Tim kiem sach',
    func: mockSearchBooks,
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  };
  const patronInfoTool = {
    name: 'get_patron_info',
    description: 'Thong tin tai khoan',
    func: mockGetPatronInfo,
    injectUserId: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  };
  return {
    ...actual,
    patronToolDefs: [searchBooksTool, patronInfoTool],
    getToolDefsForRole: jest.fn().mockReturnValue([searchBooksTool, patronInfoTool]),
  };
});

import { processCompanionMessage, type CompanionChunk } from '../../agent/agent';

async function* gen(events: any[]): AsyncGenerator<any> {
  for (const e of events) yield e;
}

async function collect(message: string): Promise<CompanionChunk[]> {
  const chunks: CompanionChunk[] = [];
  for await (const c of processCompanionMessage({
    message,
    sessionId: 's1',
    role: 'patron',
    patronId: 'patron-123',
  })) {
    chunks.push(c);
  }
  return chunks;
}

const deltas = (...contents: string[]) => contents.map((c) => ({ type: 'text_delta', content: c }));
const done = (content: string, toolCalls: any[] = []) => ({ type: 'done', content, toolCalls });

describe('processCompanionMessage — real streaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `clearAllMocks` does NOT discard queued `mockReturnValueOnce` values. Leftovers from
    // an earlier test would silently shift this test's sequence, so reset the queue here.
    mockStreamChatCompletion.mockReset();
    mockRetrieve.mockResolvedValue([]);
    mockGetMemoriesForPatron.mockResolvedValue({});
    mockConsolidateNewMemories.mockResolvedValue(undefined);
    mockSynthesizeSpeech.mockResolvedValue({ audioBase64: 'mock-audio', visemes: [], durationMs: 500 });
  });

  it('emits text_delta chunks as they arrive BEFORE the final text', async () => {
    mockStreamChatCompletion.mockReturnValueOnce(
      gen([...deltas('Thu ', 'vien ', 'mo cua.'), done('Thu vien mo cua.')]),
    );

    const chunks = await collect('Thu vien mo cua gio nao?');
    const types = chunks.map((c) => c.type);

    expect(types.filter((t) => t === 'text_delta').length).toBeGreaterThanOrEqual(2);
    expect(types.indexOf('text_delta')).toBeLessThan(types.indexOf('text'));

    const streamed = chunks
      .filter((c) => c.type === 'text_delta')
      .map((c) => (c.data as any).content)
      .join('');
    expect(streamed).toBe('Thu vien mo cua.');
  });

  it('marks the final text chunk as authoritative (final:true) and keeps it the full answer', async () => {
    mockStreamChatCompletion.mockReturnValueOnce(
      gen([...deltas('Xin ', 'chao'), done('Xin chao ban!')]),
    );

    const chunks = await collect('Xin chao');
    const finalText = chunks.find((c) => c.type === 'text')!;

    expect((finalText.data as any).final).toBe(true);
    expect((finalText.data as any).content).toBe('Xin chao ban!');
  });

  it('ends with companion_done and still yields audio + viseme after the text', async () => {
    mockStreamChatCompletion.mockReturnValueOnce(gen([done('Cau tra loi')]));

    const chunks = await collect('hoi');
    const types = chunks.map((c) => c.type);

    expect(types).toEqual(expect.arrayContaining(['text', 'audio', 'viseme']));
    expect(types[types.length - 1]).toBe('companion_done');
  });

  it('executes a native tool call then streams the synthesized final answer', async () => {
    mockStreamChatCompletion
      .mockReturnValueOnce(gen([done('', [{ id: 'c1', name: 'search_books', args: { query: 'react' } }])]))
      .mockReturnValueOnce(gen([...deltas('Tim thay ', 'sach.'), done('Tim thay sach.')]));

    const chunks = await collect('Tim sach react');
    const types = chunks.map((c) => c.type);

    expect(mockSearchBooks).toHaveBeenCalledWith('react');
    expect(types.indexOf('tool_result')).toBeLessThan(types.indexOf('text_delta'));
    expect(types.indexOf('text_delta')).toBeLessThan(types.lastIndexOf('text'));

    const toolChunk = chunks.find((c) => c.type === 'tool_result')!;
    expect((toolChunk.data as any).name).toBe('search_books');
  });

  it('passes the OpenAI tools schema built from the role allowlist to the LLM', async () => {
    mockStreamChatCompletion.mockReturnValueOnce(gen([done('ok')]));

    await collect('hi');

    const [, options] = mockStreamChatCompletion.mock.calls[0];
    expect(Array.isArray(options.tools)).toBe(true);
    expect(options.tools.length).toBe(2);
    const names = options.tools.map((t: any) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['search_books', 'get_patron_info']));
    expect(options.tools[0].type).toBe('function');
    expect(options.tool_choice === undefined || options.tool_choice === 'auto').toBe(true);
  });

  it('binds native args by schema order and still injects server userId for injectUserId tools', async () => {
    mockStreamChatCompletion
      .mockReturnValueOnce(gen([done('', [{ id: 'c1', name: 'get_patron_info', args: {} }])]))
      .mockReturnValueOnce(gen([done('Day la thong tin cua ban.')]));

    await collect('thong tin tai khoan toi');

    // Server-side userId injection must win over anything the model supplies.
    expect(mockGetPatronInfo).toHaveBeenCalledWith('patron-123');
    expect(mockGetPatronInfo).toHaveBeenCalledTimes(1);
  });

  it('reports a structured tool error when a required native arg is missing (no crash)', async () => {
    mockStreamChatCompletion
      .mockReturnValueOnce(gen([done('', [{ id: 'c1', name: 'search_books', args: {} }])]))
      .mockReturnValueOnce(gen([done('Toi khong ro tu khoa.')]));

    const chunks = await collect('tim gi do');

    const toolChunk = chunks.find((c) => c.type === 'tool_result')!;
    expect((toolChunk.data as any).result?.error).toMatch(/query/i);
    expect(mockSearchBooks).not.toHaveBeenCalled();
  });

  it('NEVER leaks tool-call JSON into a text_delta (degraded mode buffers, regex runs internally)', async () => {
    // Degraded provider: single done event whose content embeds the legacy tool JSON.
    mockStreamChatCompletion.mockReturnValueOnce(
      gen([done('{"tool": "search_books", "arguments": {"query": "python"}}')]),
    );
    mockStreamChatCompletion.mockReturnValueOnce(gen([done('Tim thay sach python.')]));

    const chunks = await collect('tim sach python');

    const leaked = chunks
      .filter((c) => c.type === 'text_delta' || c.type === 'text')
      .map((c) => (c.data as any).content as string)
      .join('');

    expect(mockSearchBooks).toHaveBeenCalledWith('python');
    expect(leaked).not.toContain('{"tool"');
    expect(chunks.some((c) => c.type === 'tool_result')).toBe(true);
  });

  it('still works when the stream yields only a done event (no deltas) — final text present', async () => {
    mockStreamChatCompletion.mockReturnValueOnce(gen([done('Cau tra loi cuoi cung.')]));

    const chunks = await collect('hoi');

    expect(chunks.filter((c) => c.type === 'text_delta')).toHaveLength(0);
    const finalText = chunks.find((c) => c.type === 'text')!;
    expect((finalText.data as any).content).toBe('Cau tra loi cuoi cung.');
    expect((finalText.data as any).final).toBe(true);
  });

  it('strips leaked tool JSON from the final text when a regex hit arrives after streaming', async () => {
    // Realistic provider behaviour: the tool-call JSON is part of the accumulated content,
    // and arrives as a streamed fragment after a legitimate prose prefix.
    mockStreamChatCompletion.mockReturnValueOnce(
      gen([
        ...deltas('Dung: ', '{"tool": "search_books", "arguments": {"query": "x"}}'),
        done('Dung: {"tool": "search_books", "arguments": {"query": "x"}}'),
      ]),
    );
    mockStreamChatCompletion.mockReturnValueOnce(gen([done('Ket qua tot.')]));

    const chunks = await collect('test');

    const visible = chunks
      .filter((c) => c.type === 'text_delta' || c.type === 'text')
      .map((c) => (c.data as any).content as string)
      .join('');

    // The prose prefix may stream, but the tool JSON must never be rendered as text.
    expect(mockSearchBooks).toHaveBeenCalledWith('x');
    expect(visible).not.toContain('{"tool"');
    expect(chunks.some((c) => c.type === 'tool_result')).toBe(true);
  });
});
