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
    openRouter: { apiKey: 'or-key', model: 'openai/gpt-oss-20b:free', baseUrl: 'https://openrouter.ai/api/v1' },
    nvidiaApiKey: 'nvidia-key',
    nvidiaModel: 'meta/llama-3.1-70b-instruct',
    nvidiaEmbedModel: 'nvidia/nv-embedqa-e5-v5',
    chromaDbUrl: 'http://localhost:8000',
    chromaCollection: 'library-kb',
    ai: { refreshMinutes: 15, mockMode: false },
    db: { host: 'localhost', port: 5432, database: 'aidb', schema: 'ai', user: 'test', password: 'test' },
    corsOrigins: [],
  },
}));

const mockPost = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({ post: mockPost })),
    isAxiosError: jest.fn(() => false),
  },
}));

import { Readable } from 'stream';
import { nvidiaClient } from '../../clients/nvidia';

const NVIDIA_MODEL = 'meta/llama-3.1-70b-instruct';
const OR_MODEL = 'openai/gpt-oss-20b:free';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_books',
      description: 'Tim kiem sach',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
];

/** Build a Node Readable that emits one chunk per raw SSE frame (simulates real socket arrival). */
function sseReadable(frames: string[]): Readable {
  return Readable.from(frames.map((f) => `data: ${f}\n\n`));
}

function contentFrame(text: string, finish: string | null = null): string {
  return JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] });
}

function toolCallFrame(argsJson: string, finish: string | null = null): string {
  return JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_books', arguments: argsJson } }],
        },
        finish_reason: finish,
      },
    ],
  });
}

function toolsRejected(): never {
  const err: any = new Error('Request failed with status code 400');
  err.response = { status: 400, data: { error: { message: 'tools is not supported by this model' } } };
  throw err;
}

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('streamChatCompletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `nvidiaClient` is a module-level singleton: reset its memoized degradation state
    // so each test starts from "native tools not yet known to be unsupported".
    (nvidiaClient as any).toolsUnsupported = false;
  });

  it('yields text_delta per arriving frame, then a single done event with full content', async () => {
    mockPost.mockImplementation((_url: string, request: any) => {
      if (request.stream && request.model === NVIDIA_MODEL) {
        return Promise.resolve({
          data: sseReadable([contentFrame('Thu '), contentFrame('vien '), contentFrame('mo cua.', 'stop')]),
        });
      }
      throw new Error('unexpected request: ' + JSON.stringify({ model: request.model, stream: request.stream }));
    });

    const events = await collect(
      nvidiaClient.streamChatCompletion([{ role: 'user', content: 'hi' }], { tools: TOOLS as any }),
    );

    expect(events.filter((e) => e.type === 'text_delta').map((e) => e.content)).toEqual([
      'Thu ',
      'vien ',
      'mo cua.',
    ]);

    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    expect(done.content).toBe('Thu vien mo cua.');
    expect(done.toolCalls).toEqual([]);
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
  });

  it('stitches multi-frame native tool_calls arguments into a parsed object', async () => {
    mockPost.mockImplementation((_url: string, request: any) => {
      if (request.stream && request.model === NVIDIA_MODEL) {
        return Promise.resolve({
          data: sseReadable([toolCallFrame(''), toolCallFrame('{"que'), toolCallFrame('ry":"react"}', 'tool_calls')]),
        });
      }
      throw new Error('unexpected request');
    });

    const events = await collect(
      nvidiaClient.streamChatCompletion([{ role: 'user', content: 'tim sach react' }], { tools: TOOLS as any }),
    );

    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    expect(done.toolCalls).toEqual([{ id: 'call_1', name: 'search_books', args: { query: 'react' } }]);
    // native tool_calls must never be emitted as visible text
    expect(events.some((e) => e.type === 'text_delta')).toBe(false);
  });

  it('sends tools + tool_choice + stream:true to the provider', async () => {
    mockPost.mockImplementation((_url: string, request: any) => {
      if (request.stream) {
        return Promise.resolve({ data: sseReadable([contentFrame('ok', 'stop')]) });
      }
      throw new Error('unexpected non-stream request');
    });

    await collect(nvidiaClient.streamChatCompletion([{ role: 'user', content: 'hi' }], { tools: TOOLS as any }));

    expect(mockPost).toHaveBeenCalledTimes(1);
    const request = mockPost.mock.calls[0][1];
    expect(request.stream).toBe(true);
    expect(request.tools).toEqual(TOOLS);
    expect(request.tool_choice).toBe('auto');
  });

  it('fails over to the fallback provider when the primary rejects native tools', async () => {
    mockPost.mockImplementation((_url: string, request: any) => {
      if (request.model === NVIDIA_MODEL) return Promise.reject(toolsRejected());
      if (request.stream) return Promise.resolve({ data: sseReadable([contentFrame('tu OpenRouter', 'stop')]) });
      throw new Error('unexpected non-stream request');
    });

    const events = await collect(
      nvidiaClient.streamChatCompletion([{ role: 'user', content: 'hi' }], { tools: TOOLS as any }),
    );

    expect(events.some((e) => e.type === 'text_delta' && e.content === 'tu OpenRouter')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('degrades to a single non-streamed done event when every provider rejects tools', async () => {
    mockPost.mockImplementation((_url: string, request: any) => {
      if (request.stream && request.tools) return Promise.reject(toolsRejected());
      if (!request.stream) {
        expect(request.tools).toBeUndefined();
        return Promise.resolve({ data: { choices: [{ message: { role: 'assistant', content: 'cau tra loi buffered' } }] } });
      }
      return Promise.resolve({ data: sseReadable([contentFrame('leak?', 'stop')]) });
    });

    const events = await collect(
      nvidiaClient.streamChatCompletion([{ role: 'user', content: 'hi' }], { tools: TOOLS as any }),
    );

    // Degraded mode must not stream: a stream could contain raw tool-call JSON.
    expect(events.filter((e) => e.type === 'text_delta')).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'done', content: 'cau tra loi buffered', toolCalls: [] });
  });

  it('memoizes tools-unsupported so later turns skip the doomed streaming attempt', async () => {
    let streamAttemptsWithTools = 0;
    mockPost.mockImplementation((_url: string, request: any) => {
      if (request.stream && request.tools) {
        streamAttemptsWithTools++;
        return Promise.reject(toolsRejected());
      }
      if (request.stream) return Promise.resolve({ data: sseReadable([contentFrame('x', 'stop')]) });
      return Promise.resolve({ data: { choices: [{ message: { role: 'assistant', content: 'buffered' } }] } });
    });

    const opts = { tools: TOOLS as any };
    await collect(nvidiaClient.streamChatCompletion([{ role: 'user', content: 'a' }], opts));
    const attemptsAfterFirst = streamAttemptsWithTools;

    await collect(nvidiaClient.streamChatCompletion([{ role: 'user', content: 'b' }], opts));

    // Second turn must not retry a stream+tools request that is known to fail.
    expect(attemptsAfterFirst).toBeGreaterThan(0);
    expect(streamAttemptsWithTools).toBe(attemptsAfterFirst);
  });
});
