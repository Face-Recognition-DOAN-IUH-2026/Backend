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

let mockRetrieve: jest.Mock;

jest.mock('../../rag/retriever', () => {
  const actual = jest.requireActual('../../rag/retriever');
  mockRetrieve = jest.fn().mockResolvedValue([]);
  return { ...actual, retrieve: mockRetrieve };
});

jest.mock('../../clients/nvidia', () => ({
  nvidiaClient: {
    createChatCompletion: jest.fn().mockResolvedValue('Tôi có thể giúp bạn tìm kiếm sách. Bạn cần tìm sách gì?'),
  },
}));

import { buildSystemPrompt, processMessage, type UserContext } from '../../agent/agent';
import type { ToolDef } from '../../tools/registry';

const MOCK_TOOLS: ToolDef[] = [
  {
    name: 'search_books',
    description: 'Tim kiem sach',
    func: jest.fn().mockResolvedValue({ success: true, data: [] }),
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_library_hours',
    description: 'Xem gio mo cua',
    func: jest.fn().mockResolvedValue({ success: true, data: {} }),
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

describe('buildSystemPrompt', () => {
  beforeEach(() => {
    mockRetrieve.mockReturnValue([]);
  });

  it('includes base system prompt text', () => {
    const result = buildSystemPrompt([], undefined, MOCK_TOOLS);
    expect(result).toContain('TVTL');
    expect(result).toContain('tra cuu (read-only)');
    expect(result).toContain('KHONG BAO GIO thuc hien cac thao tac ghi/xoa/sua');
  });

  it('includes patron role block and not staff block', () => {
    const ctx: UserContext = { userId: 'u1', email: 'p@test.com', role: 'patron', fullName: 'Nguyen A' };
    const result = buildSystemPrompt([], ctx, MOCK_TOOLS);
    expect(result).toContain('Doc gia (patron)');
    expect(result).toContain('Nguyen A');
    expect(result).not.toContain('Quan tri vien');
  });

  it('includes staff role block', () => {
    const ctx: UserContext = { userId: 'u2', email: 's@test.com', role: 'staff', fullName: 'Staff B' };
    const result = buildSystemPrompt([], ctx, MOCK_TOOLS);
    expect(result).toContain('Nhan vien (staff)');
    expect(result).toContain('NHUNG phai co MSSV/Ma the hop le');
  });

  it('includes admin role block', () => {
    const ctx: UserContext = { userId: 'u3', email: 'a@test.com', role: 'admin', fullName: 'Admin C' };
    const result = buildSystemPrompt([], ctx, MOCK_TOOLS);
    expect(result).toContain('Quan tri vien (admin)');
  });

  it('includes KB context when documents provided', () => {
    const docs = [{ docTitle: 'Rules', content: 'No food in library.' }];
    const result = buildSystemPrompt(docs as any, undefined, MOCK_TOOLS);
    expect(result).toContain('Knowledge Base Context');
    expect(result).toContain('No food in library.');
  });

  it('does NOT include KB section when no documents', () => {
    const result = buildSystemPrompt([], undefined, MOCK_TOOLS);
    expect(result).not.toContain('Knowledge Base Context');
  });

  it('includes book_card format rule (UI Format Rule)', () => {
    const result = buildSystemPrompt([], undefined, MOCK_TOOLS);
    expect(result).toContain('FORMAT CARD SACH');
    expect(result).toContain(':::book_card');
    expect(result).toContain('"title"');
    expect(result).toContain('"author"');
    expect(result).toContain('"cover_url"');
    expect(result).toContain('KHONG BAO GIO hien thi thong tin sach bang text thuan');
  });

  it('lists available tools in prompt', () => {
    const result = buildSystemPrompt([], undefined, MOCK_TOOLS);
    expect(result).toContain('search_books');
  });
});

describe('processMessage', () => {
  beforeEach(() => {
    mockRetrieve.mockReturnValue([]);
  });

  it('returns response and sessionId', async () => {
    const result = await processMessage('hi', 's1', 'patron', [], undefined, MOCK_TOOLS);
    expect(result.sessionId).toBe('s1');
    expect(result.response).toBeTruthy();
    expect(typeof result.response).toBe('string');
  });
});
