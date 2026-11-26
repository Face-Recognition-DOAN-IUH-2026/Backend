jest.mock('../../config', () => ({
  config: {
    ai: { mockMode: true },
    anthropic: {
      baseUrl: 'https://1gw.gwai.cloud/v1/messages',
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
    },
    llm: { baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: 'meta/llama-3.1-70b-instruct' },
    openRouter: { apiKey: '', model: 'openai/gpt-4.1-mini', baseUrl: 'https://openrouter.ai/api/v1' },
  },
}));

import { buildAnthropicPayload } from '../../clients/nvidia';

describe('buildAnthropicPayload', () => {
  it('extracts system prompts and keeps user/assistant turns', () => {
    const payload = buildAnthropicPayload(
      [
        { role: 'system', content: 'System rule 1' },
        { role: 'system', content: 'System rule 2' },
        { role: 'user', content: 'Thư viện mở cửa mấy giờ?' },
      ],
      'gemini-3.8-flash',
      { temperature: 0.3, maxTokens: 512, stream: true },
    );

    expect(payload.model).toBe('gemini-3.8-flash');
    expect(payload.system).toBe('System rule 1\n\nSystem rule 2');
    expect(payload.messages).toEqual([
      { role: 'user', content: 'Thư viện mở cửa mấy giờ?' },
    ]);
    expect(payload.temperature).toBe(0.3);
    expect(payload.max_tokens).toBe(512);
    expect(payload.stream).toBe(true);
  });

  it('converts OpenAI tool schemas into Anthropic input_schema format', () => {
    const payload = buildAnthropicPayload(
      [{ role: 'user', content: 'Tìm sách React' }],
      'gemini-3.8-flash',
      {
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_books',
              description: 'Search books',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          },
        ],
      },
    );

    expect(payload.tools).toEqual([
      {
        name: 'search_books',
        description: 'Search books',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ]);
  });
});
