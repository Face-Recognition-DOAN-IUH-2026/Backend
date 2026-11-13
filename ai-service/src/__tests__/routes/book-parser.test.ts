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
  const router = require('../../routes/book-parser').default;
  app.use('/ai', router);
  return app;
}

describe('POST /ai/parse-book-text', () => {
  beforeEach(() => {
    capturedBody = null;
    globalThis.fetch = async (_input: any, init?: any) => {
      capturedBody = typeof init?.body === 'string' ? init.body : null;
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Giáo trình Cấu trúc Dữ liệu và Giải thuật',
                author: 'Trần Văn Nam',
                isbn: '978-604-0-12345-6',
                publisher: 'NXB Giáo Dục',
                publish_year: 2023,
                categories: 'Khoa học máy tính',
                ddc_code: '005.1',
                summary: 'Giới thiệu các cấu trúc dữ liệu cơ bản và giải thuật sắp xếp, tìm kiếm.',
              }),
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

  const RAW_BOOK_TEXT = `Tên sách: Giáo trình Cấu trúc Dữ liệu và Giải thuật
Tác giả: Trần Văn Nam
NXB: NXB Giáo Dục
Năm XB: 2023
ISBN: 9786040123456
DDC: 005.1`;

  it('returns 400 when raw_text is missing', async () => {
    const response = await request(buildApp()).post('/ai/parse-book-text').send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('raw_text is required and must be a string');
  });

  it('returns 400 when raw_text is empty string', async () => {
    const response = await request(buildApp()).post('/ai/parse-book-text').send({ raw_text: '   ' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('raw_text cannot be empty');
  });

  it('parses LLM book response successfully with normalized ISBN', async () => {
    const response = await request(buildApp()).post('/ai/parse-book-text').send({ raw_text: RAW_BOOK_TEXT });
    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Giáo trình Cấu trúc Dữ liệu và Giải thuật');
    expect(response.body.author).toBe('Trần Văn Nam');
    expect(response.body.isbn).toBe('9786040123456');
    expect(response.body.publisher).toBe('NXB Giáo Dục');
    expect(response.body.publish_year).toBe(2023);
    expect(response.body.ddc_code).toBe('005.1');
  });

  it('falls back to regex parsing when OpenRouter fails', async () => {
    globalThis.fetch = async () => {
      return new Response('OpenRouter Server Error', { status: 500 }) as any;
    };

    const response = await request(buildApp()).post('/ai/parse-book-text').send({ raw_text: RAW_BOOK_TEXT });
    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Giáo trình Cấu trúc Dữ liệu và Giải thuật');
    expect(response.body.author).toBe('Trần Văn Nam');
    expect(response.body.isbn).toBe('9786040123456');
    expect(response.body.publisher).toBe('NXB Giáo Dục');
    expect(response.body.publish_year).toBe(2023);
  });
});

