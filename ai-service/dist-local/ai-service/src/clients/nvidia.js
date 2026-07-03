"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nvidiaClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class NvidiaNIMClient {
    client;
    maxRetries = 3;
    constructor() {
        this.client = axios_1.default.create({
            baseURL: 'https://integrate.api.nvidia.com/v1',
            headers: {
                'Authorization': `Bearer ${config_1.config.nvidiaApiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 120000,
        });
    }
    async createChatCompletion(messages, options = {}) {
        const { temperature = 0.7, maxTokens = 2048 } = options;
        const request = {
            model: config_1.config.nvidiaModel,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
        };
        let lastError = null;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.client.post('/chat/completions', request);
                if (response.data.choices && response.data.choices.length > 0) {
                    const content = response.data.choices[0].message.content;
                    if (content && content.trim() !== '') {
                        return content;
                    }
                }
                throw new Error('Empty or invalid response content from NVIDIA NIM');
            }
            catch (error) {
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
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
class OpenRouterClient {
    client;
    maxRetries = 3;
    constructor() {
        this.client = axios_1.default.create({
            baseURL: config_1.config.openRouter.baseUrl,
            headers: {
                'Authorization': `Bearer ${config_1.config.openRouter.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://library-iuh.edu.vn',
                'X-Title': 'IUH Library AI',
            },
            timeout: 120000,
        });
    }
    async createChatCompletion(messages, options = {}) {
        const { temperature = 0.7, maxTokens = 2048 } = options;
        const request = {
            model: config_1.config.openRouter.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
        };
        let lastError = null;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.client.post('/chat/completions', request);
                if (response.data.choices && response.data.choices.length > 0) {
                    const content = response.data.choices[0].message.content;
                    if (content && content.trim() !== '') {
                        return content;
                    }
                }
                throw new Error('Empty or invalid response content from OpenRouter');
            }
            catch (error) {
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
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
class FallbackLLMClient {
    primary;
    fallback;
    primaryName;
    fallbackName;
    constructor() {
        if (config_1.config.nvidiaApiKey) {
            this.primary = new NvidiaNIMClient();
            this.primaryName = 'NVIDIA NIM';
            if (config_1.config.openRouter.apiKey) {
                this.fallback = new OpenRouterClient();
                this.fallbackName = 'OpenRouter';
            }
            else {
                this.fallback = null;
                this.fallbackName = '';
            }
        }
        else if (config_1.config.openRouter.apiKey) {
            this.primary = new OpenRouterClient();
            this.primaryName = 'OpenRouter';
            this.fallback = null;
            this.fallbackName = '';
        }
        else {
            throw new Error('No LLM API key configured (OPENROUTER_API_KEY or NVIDIA_API_KEY required)');
        }
    }
    async createChatCompletion(messages, options = {}) {
        try {
            return await this.primary.createChatCompletion(messages, options);
        }
        catch (primaryError) {
            console.log(`[LLM] Primary (${this.primaryName}) failed: ${primaryError.message}`);
            if (this.fallback) {
                console.log(`[LLM] Falling back to ${this.fallbackName}`);
                try {
                    return await this.fallback.createChatCompletion(messages, options);
                }
                catch (fallbackError) {
                    console.log(`[LLM] Fallback (${this.fallbackName}) also failed: ${fallbackError.message}`);
                    throw new Error(`Both LLM providers failed. Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`);
                }
            }
            throw primaryError;
        }
    }
}
exports.nvidiaClient = new FallbackLLMClient();
exports.default = exports.nvidiaClient;
