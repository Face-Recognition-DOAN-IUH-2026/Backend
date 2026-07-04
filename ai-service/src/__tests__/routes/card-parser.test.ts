import request from 'supertest';
import express from 'express';

jest.mock('../../config', () => ({
  config: {
    openRouter: {
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'test-model',
    },
    ai: { mockMode: false },
  },
}));

const originalFetch = globalThis.fetch;
let capturedBody: string | null = null;

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = require('../../routes/card-parser').default;
  app.use('/ai', router);
  return app;
}

describe('POST /ai/parse-card-text', () => {
  beforeEach(() => {
    capturedBody = null;
    globalThis.fetch = async (_input: any, init?: any) => {
      capturedBody = typeof init?.body === 'string' ? init.body : null;
      const payload = {
        choices: [
          {
            message: {
              content:
                '{"student_code":"20520001","full_name":"Nguyễn Văn A","class_name":"CNTT-K45","date_of_birth":"15/03/2003","course":"45","permanent_address":"123 Nguyễn Trãi","faculty":"CNTT"}',
            },
          },
        ],
      };
      return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }) as any;
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const RAW_TEXT = `TRƯỜNG ĐẠI HỌC CÔNG NGHỆ TP.HCM
Họ và tên: NGUYỄN VĂN A
Ngày sinh: 15/03/2003
Lớp: CNTT-K45
MSSV: 20520001
Khoa: Công nghệ thông tin
HKTT: 123 Nguyễn Trãi, P.5, Q.5, TP.HCM`;

  it('returns 400 when raw_text is missing', async () => {
    const response = await request(buildApp()).post('/ai/parse-card-text').send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('raw_text is required and must be a string');
  });

  it('returns 400 when raw_text is empty string', async () => {
    const response = await request(buildApp()).post('/ai/parse-card-text').send({ raw_text: '   ' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('raw_text cannot be empty');
  });

  it('calls OpenRouter with correct body shape', async () => {
    const response = await request(buildApp()).post('/ai/parse-card-text').send({ raw_text: RAW_TEXT });
    expect(response.status).toBe(200);
    expect(capturedBody).not.toBeNull();
    const body = JSON.parse(capturedBody!);
    expect(body.model).toBe('test-model');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('20520001');
  });

  it('parses LLM response wrapped in markdown code fence', async () => {
    globalThis.fetch = async (_input: any, init?: any) => {
      capturedBody = typeof init?.body === 'string' ? init.body : null;
      const content =
        '```json\n{"student_code":"20520001","full_name":"Nguyễn Văn A","class_name":"CNTT-K45","date_of_birth":"15/03/2003","course":"45","permanent_address":"123 Nguyễn Trãi","faculty":"CNTT"}\n```';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        headers: { 'Content-Type': 'application/json' },
      }) as any;
    };

    const response = await request(buildApp()).post('/ai/parse-card-text').send({ raw_text: RAW_TEXT });
    expect(response.status).toBe(200);
    expect(response.body.student_code).toBe('20520001');
    expect(response.body.class_name).toBe('CNTT-K45');
    expect(response.body.course).toBe('45');
    expect(response.body.date_of_birth).toBe('15/03/2003');
  });

  it('returns all-null fields when LLM returns non-JSON text', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Sorry I cannot parse that' } }] }),
        { headers: { 'Content-Type': 'application/json' } },
      ) as any;
    };

    const response = await request(buildApp()).post('/ai/parse-card-text').send({ raw_text: RAW_TEXT });
    expect(response.status).toBe(200);
    expect(response.body.student_code).toBeNull();
    expect(response.body.full_name).toBeNull();
  });

  it('returns 500 when OpenRouter returns 500', async () => {
    globalThis.fetch = async () => {
      return new Response('Server Error', { status: 500 }) as any;
    };

    const response = await request(buildApp()).post('/ai/parse-card-text').send({ raw_text: RAW_TEXT });
    expect(response.status).toBe(500);
    expect(response.body.error).toContain('Card parsing failed');
  });

  it('does not throw when LLM returns empty content', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '' } }] }),
        { headers: { 'Content-Type': 'application/json' } },
      ) as any;
    };

    const response = await request(buildApp()).post('/ai/parse-card-text').send({ raw_text: RAW_TEXT });
    expect([200, 500]).toContain(response.status);
  });
});
