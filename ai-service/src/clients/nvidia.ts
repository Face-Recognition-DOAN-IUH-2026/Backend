import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: ToolSchema[];
  tool_choice?: string;
}

export interface NativeToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'done'; content: string; toolCalls: NativeToolCall[] };

export interface StreamChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSchema[];
}

/**
 * Raised when the provider rejects native `tools` (HTTP 400/404).
 * The caller must degrade to a non-streamed call and the legacy regex tool parser.
 */
export class NativeToolsUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeToolsUnsupportedError';
  }
}

function isToolsRejection(error: any, sentTools: boolean): boolean {
  if (!sentTools) return false;
  const status = error?.response?.status;
  return status === 400 || status === 404;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolve the primary chat LLM endpoint. `config.llm` is the canonical source; test mocks and
 * older deployments may only expose the legacy NVIDIA_* fields, so fall back to those.
 */
function primaryLlm(): { baseUrl: string; apiKey: string; model: string } {
  const llm = config.llm;
  return {
    baseUrl: (llm?.baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
    apiKey: llm?.apiKey || config.nvidiaApiKey || '',
    model: llm?.model || config.nvidiaModel,
  };
}

/** Human-readable provider label for logs and errors (the endpoint host). */
function llmProviderName(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'LLM';
  }
}

/**
 * Accumulate a non-`arguments` stream fragment: accept the first value, extend it when the
 * provider splits it across frames, and ignore verbatim repeats from the next frame.
 */
function extendFirst(current: string, incoming: string): string {
  if (!current) return incoming;
  if (incoming.length > current.length && incoming.startsWith(current)) return incoming;
  return current;
}

/**
 * POST a `stream:true` completion request, retrying only until the stream opens.
 * Retries are impossible once bytes have been delivered (that would duplicate text).
 */
async function postStreamRequest(
  client: AxiosInstance,
  request: ChatCompletionRequest,
  name: string,
  maxRetries: number,
): Promise<any> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.post('/chat/completions', request, { responseType: 'stream' });
      return response.data;
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const retryAfter = error.response?.headers?.['retry-after'];

      if (isToolsRejection(error, Boolean(request.tools))) {
        throw new NativeToolsUnsupportedError(
          `${name} rejected native tools (${status}): ${error.response?.data?.error?.message || error.message}`,
        );
      }

      if (status === 429) {
        const backoffMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(2000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 30000);
        console.log(`[${name}] 429 rate limited, attempt ${attempt}/${maxRetries}, retrying in ${backoffMs}ms`);
        if (attempt < maxRetries) {
          await delay(backoffMs);
          continue;
        }
      }

      if (status && status >= 400 && status < 500 && status !== 429) {
        throw new Error(`${name} stream client error ${status}: ${error.response?.data?.error?.message || error.message}`);
      }

      if (attempt < maxRetries) {
        await delay(Math.min(1000 * Math.pow(2, attempt - 1), 10000));
      }
    }
  }

  throw new Error(`${name} stream request failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Consume an OpenAI-style SSE stream and yield `text_delta` / `done` events.
 *
 * Deltas are only emitted when the request carried native `tools`: without them the
 * model may answer with raw tool-call JSON in `content`, which must never be shown.
 */
async function* emitStreamEvents(rawStream: any, emitDeltas: boolean): AsyncGenerator<StreamEvent> {
  let fullText = '';
  const pending = new Map<number, { id: string; name: string; argsJson: string }>();

  const applyFrame = (payload: string): StreamEvent[] => {
    let frame: any;
    try {
      frame = JSON.parse(payload);
    } catch {
      return [];
    }
    const choice = frame?.choices?.[0];
    if (!choice) return [];
    const delta = choice.delta;
    const events: StreamEvent[] = [];

    if (typeof delta?.content === 'string' && delta.content.length > 0) {
      fullText += delta.content;
      if (emitDeltas) events.push({ type: 'text_delta', content: delta.content });
    }

    if (Array.isArray(delta?.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc.index === 'number' ? tc.index : 0;
        const entry = pending.get(index) ?? { id: '', name: '', argsJson: '' };
        // id/name may arrive whole (and be repeated every frame) OR be split across frames.
        // Keep the longest prefix-extension so both provider styles resolve correctly.
        if (tc.id) entry.id = extendFirst(entry.id, tc.id);
        if (tc.function?.name) entry.name = extendFirst(entry.name, tc.function.name);
        if (tc.function?.arguments) entry.argsJson += tc.function.arguments;
        pending.set(index, entry);
      }
    }

    return events;
  };

  const takePayload = (line: string): string | null => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return null;
    return payload;
  };

  let buffer = '';
  for await (const chunk of rawStream) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const payload = takePayload(line);
      if (payload === null) continue;
      for (const event of applyFrame(payload)) yield event;
    }
  }
  // A provider may omit the trailing newline on its last frame.
  const lastPayload = takePayload(buffer);
  if (lastPayload !== null) {
    for (const event of applyFrame(lastPayload)) yield event;
  }

  const toolCalls: NativeToolCall[] = [...pending.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => {
      let args: Record<string, any> = {};
      if (entry.argsJson.trim()) {
        try {
          args = JSON.parse(entry.argsJson);
        } catch (e) {
          console.warn(`[LLM] Could not parse streamed tool arguments for "${entry.name}": ${entry.argsJson}`);
        }
      }
      return { id: entry.id, name: entry.name, args };
    })
    .filter((call) => call.name);

  yield { type: 'done', content: fullText, toolCalls };
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface LLMClient {
  createChatCompletion(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string>;
  streamChatCompletion(
    messages: ChatMessage[],
    options?: StreamChatOptions
  ): AsyncGenerator<StreamEvent>;
}

class NvidiaNIMClient implements LLMClient {
  private client: AxiosInstance;
  private maxRetries: number = 2;
  private model: string;
  private providerName: string;

  constructor() {
    const llm = primaryLlm();
    this.model = llm.model;
    this.providerName = llmProviderName(llm.baseUrl);

    this.client = axios.create({
      baseURL: llm.baseUrl,
      headers: {
        'Authorization': `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 22000,
    });
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<string> {
    const { temperature = 0.7, maxTokens = 2048 } = options;

    const request: ChatCompletionRequest = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post<ChatCompletionResponse>(
          '/chat/completions',
          request
        );

        if (response.data.choices && response.data.choices.length > 0) {
          const content = response.data.choices[0].message.content;
          if (content && content.trim() !== '') {
            return content;
          }
        }

        throw new Error(`Empty or invalid response content from ${this.providerName}`);
      } catch (error: any) {
        lastError = error;

        const status = error.response?.status;
        const retryAfter = error.response?.headers?.['retry-after'];

        if (status === 429) {
          const backoffMs = retryAfter
            ? Math.min(parseInt(retryAfter, 10) * 1000, 3000)
            : Math.min(1000 * Math.pow(2, attempt - 1), 3000);

          console.log(`[${this.providerName}] 429 rate limited, attempt ${attempt}/${this.maxRetries}, retrying in ${backoffMs}ms`);

          if (attempt < this.maxRetries) {
            await this.delay(backoffMs);
            continue;
          }
        }

        if (status && status >= 400 && status < 500 && status !== 429) {
          throw new Error(`${this.providerName} client error ${status}: ${error.response?.data?.error?.message || error.message}`);
        }

        if (attempt < this.maxRetries) {
          const backoffMs = Math.min(800 * Math.pow(2, attempt - 1), 3000);
          await this.delay(backoffMs);
        }
      }
    }

    throw new Error(`${this.providerName} request failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  async *streamChatCompletion(
    messages: ChatMessage[],
    options: StreamChatOptions = {}
  ): AsyncGenerator<StreamEvent> {
    const { temperature = 0.7, maxTokens = 2048, tools } = options;

    const request: ChatCompletionRequest = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    };

    const rawStream = await postStreamRequest(this.client, request, this.providerName, this.maxRetries);
    yield* emitStreamEvents(rawStream, Boolean(tools && tools.length > 0));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class OpenRouterClient implements LLMClient {
  private client: AxiosInstance;
  private maxRetries: number = 2;

  constructor() {
    this.client = axios.create({
      baseURL: config.openRouter.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://library-iuh.edu.vn',
        'X-Title': 'IUH Library AI',
      },
      timeout: 30000,
    });
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<string> {
    const { temperature = 0.7, maxTokens = 2048 } = options;

    const request: ChatCompletionRequest = {
      model: config.openRouter.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post<ChatCompletionResponse>(
          '/chat/completions',
          request
        );

        if (response.data.choices && response.data.choices.length > 0) {
          const content = response.data.choices[0].message.content;
          if (content && content.trim() !== '') {
            return content;
          }
        }

        throw new Error('Empty or invalid response content from OpenRouter');
      } catch (error: any) {
        lastError = error;

        const status = error.response?.status;
        const retryAfter = error.response?.headers?.['retry-after'];

        if (status === 429) {
          const backoffMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : Math.min(2000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 30000);

          console.log(`[OpenRouter] 429 rate limited, attempt ${attempt}/${this.maxRetries}, retrying in ${backoffMs}ms`);

          if (attempt < this.maxRetries) {
            await this.delay(backoffMs);
            continue;
          }
        }

        if (status && status >= 400 && status < 500 && status !== 429) {
          throw new Error(`OpenRouter client error ${status}: ${error.response?.data?.error?.message || error.message}`);
        }

        if (attempt < this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await this.delay(backoffMs);
        }
      }
    }

    throw new Error(`OpenRouter request failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  async *streamChatCompletion(
    messages: ChatMessage[],
    options: StreamChatOptions = {}
  ): AsyncGenerator<StreamEvent> {
    const { temperature = 0.7, maxTokens = 2048, tools } = options;

    const request: ChatCompletionRequest = {
      model: config.openRouter.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    };

    const rawStream = await postStreamRequest(this.client, request, 'OpenRouter', this.maxRetries);
    yield* emitStreamEvents(rawStream, Boolean(tools && tools.length > 0));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export function buildAnthropicPayload(
  messages: ChatMessage[],
  model: string,
  options: { temperature?: number; maxTokens?: number; stream?: boolean; tools?: ToolSchema[] } = {}
): Record<string, any> {
  const systemParts: string[] = [];
  const chatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content?.trim()) systemParts.push(m.content.trim());
    } else if (m.role === 'user' || m.role === 'assistant') {
      chatMessages.push({ role: m.role, content: m.content });
    }
  }

  if (chatMessages.length === 0) {
    chatMessages.push({ role: 'user', content: 'Xin chào' });
  }

  const payload: Record<string, any> = {
    model,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    messages: chatMessages,
  };

  if (systemParts.length > 0) {
    payload.system = systemParts.join('\n\n');
  }
  if (options.stream) {
    payload.stream = true;
  }
  if (options.tools && options.tools.length > 0) {
    payload.tools = options.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  return payload;
}

export class AnthropicMessagesClient implements LLMClient {
  private client: AxiosInstance;
  private maxRetries: number = 2;
  private endpointUrl: string;
  private model: string;
  private providerName: string;

  constructor() {
    const anthropic = config.anthropic || {
      baseUrl: 'https://1gw.gwai.cloud/v1/messages',
      apiKey: '',
      model: 'gemini-3.8-flash',
    };
    this.endpointUrl = anthropic.baseUrl;
    this.model = anthropic.model;
    this.providerName = llmProviderName(this.endpointUrl);

    this.client = axios.create({
      headers: {
        'x-api-key': anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 22000,
    });
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<string> {
    const payload = buildAnthropicPayload(messages, this.model, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: false,
    });

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post<any>(this.endpointUrl, payload);
        const blocks = response.data?.content;
        if (Array.isArray(blocks)) {
          const text = blocks
            .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('');
          if (text.trim()) return text;
        }
        if (typeof response.data?.completion === 'string' && response.data.completion.trim()) {
          return response.data.completion;
        }
        throw new Error(`Empty response content from ${this.providerName}`);
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw new Error(
            `${this.providerName} client error ${status}: ${error.response?.data?.error?.message || error.message}`
          );
        }
        if (attempt < this.maxRetries) {
          await delay(Math.min(800 * Math.pow(2, attempt - 1), 3000));
        }
      }
    }

    throw new Error(`${this.providerName} request failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  async *streamChatCompletion(
    messages: ChatMessage[],
    options: StreamChatOptions = {}
  ): AsyncGenerator<StreamEvent> {
    const payload = buildAnthropicPayload(messages, this.model, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: true,
      tools: options.tools,
    });

    const response = await this.client.post(this.endpointUrl, payload, { responseType: 'stream' });
    const rawStream = response.data;
    const emitDeltas = Boolean(options.tools && options.tools.length > 0);

    let fullText = '';
    const toolCallsMap = new Map<number, { id: string; name: string; argsJson: string }>();
    let buffer = '';

    const processLine = (line: string): StreamEvent[] => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return [];
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === '[DONE]') return [];
      let evt: any;
      try {
        evt = JSON.parse(raw);
      } catch {
        return [];
      }

      const out: StreamEvent[] = [];
      if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        const idx = typeof evt.index === 'number' ? evt.index : 0;
        toolCallsMap.set(idx, {
          id: evt.content_block.id || `tc_${idx}`,
          name: evt.content_block.name || '',
          argsJson: '',
        });
      } else if (evt.type === 'content_block_delta') {
        if (evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
          fullText += evt.delta.text;
          if (emitDeltas) out.push({ type: 'text_delta', content: evt.delta.text });
        } else if (evt.delta?.type === 'input_json_delta' && typeof evt.delta.partial_json === 'string') {
          const idx = typeof evt.index === 'number' ? evt.index : 0;
          const entry = toolCallsMap.get(idx);
          if (entry) entry.argsJson += evt.delta.partial_json;
        }
      }
      return out;
    };

    for await (const chunk of rawStream) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        for (const ev of processLine(line)) yield ev;
      }
    }
    if (buffer.trim()) {
      for (const ev of processLine(buffer)) yield ev;
    }

    const toolCalls: NativeToolCall[] = [...toolCallsMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, entry]) => {
        let args: Record<string, any> = {};
        if (entry.argsJson.trim()) {
          try {
            args = JSON.parse(entry.argsJson);
          } catch {}
        }
        return { id: entry.id, name: entry.name, args };
      })
      .filter((tc) => tc.name);

    yield { type: 'done', content: fullText, toolCalls };
  }
}

class MockLLMClient implements LLMClient {
  async createChatCompletion(
    messages: ChatMessage[],
    _options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<string> {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const lower = lastUser.toLowerCase();

    // Simple rule-based mock: if user asks about books / search, return tool call
    if (/(sách|book|tìm|tim|tra cứu|lookup|isbn)/i.test(lastUser) && !/đã tìm/i.test(lower)) {
      const queryMatch = lastUser.match(/(?:tìm|sách|book)\s*(.*)/i);
      const query = queryMatch?.[1]?.trim() || lastUser.slice(0, 40);
      if (query.length > 2) {
        return `{"tool": "search_books", "arguments": {"query": "${query.replace(/"/g, "'").slice(0, 80)}"}}`;
      }
    }
    if (/(giờ|mo cua|dong cua|dia chi|lien he)/i.test(lower)) {
      return 'Thư viện IUH mở cửa Thứ 2 - Thứ 6: 6:30 - 21:00, Thứ 7 - CN: 8:00 - 19:30. Địa chỉ liên hệ library@iuh.edu.vn. (Mock AI)';
    }
    // Default mock answer in Vietnamese
    return `Xin chào! Tôi là TVTL - trợ lý thư viện IUH (Mock mode).\n\nBạn hỏi: "${lastUser.slice(0, 120)}"\n\nThư viện mở cửa T2-T6 6:30-21:00, T7-CN 8:00-19:30. Tôi có thể giúp tìm sách, tra cứu vị trí tầng, quy định mượn trả, và lịch trực. Bạn cần hỗ trợ gì thêm?`;
  }

  /**
   * Mock answers that embed tool-call JSON must arrive as a single `done` event so the
   * agent's regex parser can consume them without the JSON ever reaching the UI.
   */
  async *streamChatCompletion(
    messages: ChatMessage[],
    options: StreamChatOptions = {}
  ): AsyncGenerator<StreamEvent> {
    const content = await this.createChatCompletion(messages, options);

    if (/^\s*\{\s*"tool"\s*:/.test(content)) {
      yield { type: 'done', content, toolCalls: [] };
      return;
    }

    for (const part of content.split(/(\s+)/)) {
      if (part) yield { type: 'text_delta', content: part };
    }
    yield { type: 'done', content, toolCalls: [] };
  }
}

class FallbackLLMClient implements LLMClient {
  private primary: LLMClient;
  private fallbacks: Array<{ name: string; client: LLMClient }> = [];
  private primaryName: string;

  constructor() {
    if (config.ai.mockMode) {
      this.primary = new MockLLMClient();
      this.primaryName = 'Mock';
      return;
    }

    const providers: Array<{ name: string; client: LLMClient }> = [];
    if (config.anthropic?.apiKey) {
      providers.push({
        name: llmProviderName(config.anthropic.baseUrl),
        client: new AnthropicMessagesClient(),
      });
    }
    const llm = primaryLlm();
    if (llm.apiKey) {
      providers.push({
        name: llmProviderName(llm.baseUrl),
        client: new NvidiaNIMClient(),
      });
    }
    if (config.openRouter.apiKey) {
      providers.push({
        name: 'OpenRouter',
        client: new OpenRouterClient(),
      });
    }

    if (providers.length === 0) {
      throw new Error('No LLM API key configured (ANTHROPIC_API_KEY, LLM_API_KEY, NVIDIA_API_KEY or OPENROUTER_API_KEY required)');
    }

    this.primary = providers[0].client;
    this.primaryName = providers[0].name;
    this.fallbacks = providers.slice(1);
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<string> {
    try {
      return await this.primary.createChatCompletion(messages, options);
    } catch (primaryError: any) {
      console.log(`[LLM] Primary (${this.primaryName}) failed: ${primaryError.message}`);

      let lastErr = primaryError;
      for (const fb of this.fallbacks) {
        console.log(`[LLM] Falling back to ${fb.name}`);
        try {
          return await fb.client.createChatCompletion(messages, options);
        } catch (fallbackError: any) {
          console.log(`[LLM] Fallback (${fb.name}) also failed: ${fallbackError.message}`);
          lastErr = fallbackError;
        }
      }

      if (this.fallbacks.length > 0) {
        throw new Error(`All LLM providers failed. Primary (${this.primaryName}): ${primaryError.message}. Last fallback: ${lastErr.message}`);
      }
      throw primaryError;
    }
  }

  /**
   * True once a provider has rejected native `tools`: streaming is then unsafe because a
   * tool-free response may embed raw tool JSON, so later turns go straight to the
   * buffered non-streaming path instead of paying for another doomed 400 round-trip.
   */
  private toolsUnsupported = false;

  private async degradedDone(
    messages: ChatMessage[],
    options: StreamChatOptions
  ): Promise<StreamEvent> {
    const content = await this.createChatCompletion(messages, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
    return { type: 'done', content, toolCalls: [] };
  }

  async *streamChatCompletion(
    messages: ChatMessage[],
    options: StreamChatOptions = {}
  ): AsyncGenerator<StreamEvent> {
    if (this.toolsUnsupported) {
      yield await this.degradedDone(messages, options);
      return;
    }

    const attempts: Array<{ name: string; client: LLMClient }> = [
      { name: this.primaryName, client: this.primary },
      ...this.fallbacks,
    ];

    let lastError: Error | null = null;
    let toolsRejected = false;

    for (const { name, client } of attempts) {
      let emitted = false;
      try {
        const iterator = client.streamChatCompletion(messages, options);
        while (true) {
          const { value, done } = await iterator.next();
          if (done) return;
          if (value?.type === 'text_delta') emitted = true;
          yield value;
        }
      } catch (error: any) {
        if (error instanceof NativeToolsUnsupportedError) {
          toolsRejected = true;
          console.log(`[LLM] ${name} rejected native tools — will try next provider / degraded path`);
          continue;
        }
        if (emitted) {
          // Text already reached the client; failing over now would duplicate it.
          console.log(`[LLM] ${name} failed mid-stream: ${error.message}`);
          throw error;
        }
        lastError = error;
        console.log(`[LLM] ${name} stream failed before first byte: ${error.message}`);
      }
    }

    if (toolsRejected && options.tools && options.tools.length > 0) {
      this.toolsUnsupported = true;
      console.log('[LLM] Native tool calling unsupported — degrading to buffered completion + regex parser');
      yield await this.degradedDone(messages, options);
      return;
    }

    throw lastError ?? new Error('No LLM provider available');
  }
}

export const nvidiaClient = new FallbackLLMClient();
export default nvidiaClient;
