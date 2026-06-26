import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
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
}

class NvidiaNIMClient implements LLMClient {
  private client: AxiosInstance;
  private maxRetries: number = 3;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      headers: {
        'Authorization': `Bearer ${config.nvidiaApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<string> {
    const { temperature = 0.7, maxTokens = 2048 } = options;

    const request: ChatCompletionRequest = {
      model: config.nvidiaModel,
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

        throw new Error('Empty or invalid response content from NVIDIA NIM');
      } catch (error: any) {
        lastError = error;

        const status = error.response?.status;
        const retryAfter = error.response?.headers?.['retry-after'];

        if (status === 429) {
          const backoffMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : Math.min(2000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 30000);

          console.log(`[NVIDIA NIM] 429 rate limited, attempt ${attempt}/${this.maxRetries}, retrying in ${backoffMs}ms`);

          if (attempt < this.maxRetries) {
            await this.delay(backoffMs);
            continue;
          }
        }

        if (status && status >= 400 && status < 500 && status !== 429) {
          throw new Error(`NVIDIA NIM client error ${status}: ${error.response?.data?.error?.message || error.message}`);
        }

        if (attempt < this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await this.delay(backoffMs);
        }
      }
    }

    throw new Error(`NVIDIA NIM request failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class OpenRouterClient implements LLMClient {
  private client: AxiosInstance;
  private maxRetries: number = 3;

  constructor() {
    this.client = axios.create({
      baseURL: config.openRouter.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://library-iuh.edu.vn',
        'X-Title': 'IUH Library AI',
      },
      timeout: 120000,
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class FallbackLLMClient implements LLMClient {
  private primary: LLMClient;
  private fallback: LLMClient | null;
  private primaryName: string;
  private fallbackName: string;

  constructor() {
    if (config.nvidiaApiKey) {
      this.primary = new NvidiaNIMClient();
      this.primaryName = 'NVIDIA NIM';
      if (config.openRouter.apiKey) {
        this.fallback = new OpenRouterClient();
        this.fallbackName = 'OpenRouter';
      } else {
        this.fallback = null;
        this.fallbackName = '';
      }
    } else if (config.openRouter.apiKey) {
      this.primary = new OpenRouterClient();
      this.primaryName = 'OpenRouter';
      this.fallback = null;
      this.fallbackName = '';
    } else {
      throw new Error('No LLM API key configured (OPENROUTER_API_KEY or NVIDIA_API_KEY required)');
    }
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number } = {}
  ): Promise<string> {
    try {
      return await this.primary.createChatCompletion(messages, options);
    } catch (primaryError: any) {
      console.log(`[LLM] Primary (${this.primaryName}) failed: ${primaryError.message}`);

      if (this.fallback) {
        console.log(`[LLM] Falling back to ${this.fallbackName}`);
        try {
          return await this.fallback.createChatCompletion(messages, options);
        } catch (fallbackError: any) {
          console.log(`[LLM] Fallback (${this.fallbackName}) also failed: ${fallbackError.message}`);
          throw new Error(`Both LLM providers failed. Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`);
        }
      }

      throw primaryError;
    }
  }
}

export const nvidiaClient = new FallbackLLMClient();
export default nvidiaClient;
