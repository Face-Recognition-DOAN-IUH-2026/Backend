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

class NvidiaNIMClient {
  private client: AxiosInstance;
  private maxRetries: number = 3;

  constructor() {
    const baseUrl = config.openRouter.apiKey
      ? (config.openRouter.baseUrl || 'https://openrouter.ai/api/v1')
      : 'https://integrate.api.nvidia.com/v1';
    const apiKey = config.openRouter.apiKey || config.nvidiaApiKey;

    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: {
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<string> {
    const { temperature = 0.7, maxTokens = 2048 } = options;

    const request: ChatCompletionRequest = {
      model: config.openRouter.apiKey ? (config.openRouter.model || 'openai/gpt-4.1-mini') : config.nvidiaModel,
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
          return content || '';
        }

        throw new Error('No response content from NVIDIA NIM');
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries) {
          await this.delay(1000 * attempt);
        }
      }
    }

    throw new Error(`NVIDIA NIM request failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const nvidiaClient = new NvidiaNIMClient();
export default nvidiaClient;