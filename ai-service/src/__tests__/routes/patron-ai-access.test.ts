import request from 'supertest';
import jwt from 'jsonwebtoken';

// Full config stub: this suite boots the real app from src/index.ts, which reads
// many config fields at import time (corsOrigins, db, chroma*, ai, llm).
// jest.setup.js only provides a partial mock, so it is overridden here.
jest.mock('../../config', () => ({
  config: {
    port: 3004,
    nodeEnv: 'test',
    jwtSecret: 'test-jwt-secret',
    jwtIssuer: 'test-issuer',
    jwtAudience: 'test-audience',
    serviceJwtSecret: 'test-service-jwt-secret',
    accessServiceUrl: 'http://access-service:3003',
    borrowServiceUrl: 'http://borrow-service:8000',
    scheduleServiceUrl: 'http://schedule-service:3002',
    userServiceUrl: 'http://user-service:3001',
    chromaDbUrl: 'http://localhost:8000',
    chromaCollection: 'library-kb-test',
    corsOrigins: ['*'],
    ai: { refreshMinutes: 15, mockMode: true },
    db: { host: 'localhost', port: 5432, database: 'aidb', schema: 'ai', user: 'u', password: 'p' },
    openRouter: { apiKey: '', model: 'test-model', baseUrl: 'https://openrouter.ai/api/v1' },
    llm: { baseUrl: 'https://llm.invalid/v1', apiKey: '', model: 'test-model' },
    nvidiaApiKey: '',
    nvidiaModel: 'test-model',
    nvidiaEmbedModel: 'test-embed-model',
    tts: { provider: 'mock', apiKey: '' },
    asr: { provider: 'mock', apiKey: '' },
  },
}));

jest.mock('../../services/AiService', () => ({
  aiService: {
    getSummary: jest.fn(),
    listInsights: jest.fn(),
    dismissInsight: jest.fn(),
    explainInsight: jest.fn(),
    chat: jest.fn(),
    recommendBooks: jest.fn(),
  },
}));

import { app } from '../../index';
import { aiService } from '../../services/AiService';

function signToken(sub: string, role: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub,
      roles: [role],
      role,
      iss: 'test-issuer',
      aud: 'test-audience',
      typ: 'access',
      iat: now,
      exp: now + 3600,
    },
    'test-jwt-secret',
  );
}

const asPatron = () => `Bearer ${signToken('patron-1', 'patron')}`;
const asStaff = () => `Bearer ${signToken('staff-1', 'staff')}`;

const RECOMMENDATION_FIXTURE = {
  recommendations: [
    { book_id: 'book-1', title: 'Clean Code', author: 'Robert Martin', reason: 'Cùng chủ đề', score: 0.9 },
  ],
  generated_at: '2026-11-13T00:00:00.000Z',
};

beforeEach(() => {
  (aiService.recommendBooks as jest.Mock).mockResolvedValue(RECOMMENDATION_FIXTURE);
  (aiService.getSummary as jest.Mock).mockResolvedValue({});
  (aiService.listInsights as jest.Mock).mockResolvedValue({ items: [], total: 0 });
});

describe('patron access to /ai routes (mount-order regression)', () => {
  it('lets a patron load book recommendations', async () => {
    const res = await request(app)
      .get('/ai/recommendations/patron/21000001')
      .set('Authorization', asPatron());

    expect(res.status).toBe(200);
    expect(res.body.recommendations).toHaveLength(1);
    expect(aiService.recommendBooks).toHaveBeenCalledWith(expect.any(String), '21000001');
  });

  it('rejects anonymous callers on recommendations with 401', async () => {
    const res = await request(app).get('/ai/recommendations/patron/21000001');
    expect(res.status).toBe(401);
  });

  it('blocks a patron from the staff-only book text parser', async () => {
    const res = await request(app)
      .post('/ai/parse-book-text')
      .set('Authorization', asPatron())
      .send({ raw_text: 'Tên sách: Lập trình TypeScript' });

    expect(res.status).toBe(403);
  });

  it('allows staff to use the book text parser', async () => {
    const res = await request(app)
      .post('/ai/parse-book-text')
      .set('Authorization', asStaff())
      .send({ raw_text: 'Tên sách: Lập trình TypeScript' });

    expect(res.status).toBe(200);
  });

  it('keeps staff-only insights hidden from patrons', async () => {
    const res = await request(app).get('/ai/insights').set('Authorization', asPatron());
    expect(res.status).toBe(403);
  });

  it('does not shadow patron AI session retrieval', async () => {
    const res = await request(app)
      .get('/ai/sessions/session-1')
      .set('Authorization', asPatron());

    expect(res.status).not.toBe(403);
  });
});
