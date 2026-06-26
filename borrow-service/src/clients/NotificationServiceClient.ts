import { config } from '../config';

interface RequestOptions {
  method?: string;
  body?: any;
  timeout?: number;
}

async function request(url: string, options: RequestOptions = {}): Promise<any> {
  const { method = 'GET', body, timeout = 5000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': config.internalApiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

export const notificationServiceClient = {
  async sendNotification(input: {
    userId: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, any>;
  }) {
    return request(`${config.notificationServiceUrl}/internal/`, {
      method: 'POST',
      body: input,
    });
  },
};
