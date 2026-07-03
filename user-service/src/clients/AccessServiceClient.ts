import { config } from '../config';
import { getServiceToken } from '../../../shared';

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
        'Authorization': `Bearer ${getServiceToken('user-service', config.jwtSecret)}`,
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

export const accessServiceClient = {
  async getDailyStats(): Promise<{
    active_inside: number;
    today_entries: number;
    today_exits: number;
  }> {
    const result = await request(`${config.accessServiceUrl}/internal/access/stats`);
    return {
      active_inside: result.active_inside ?? result.activeInside ?? 0,
      today_entries: result.today_entries || result.todayEntries || 0,
      today_exits: result.today_exits || result.todayExits || 0,
    };
  },

  async getPatronStatus(patronId: string): Promise<string> {
    try {
      const result = await request(`${config.accessServiceUrl}/internal/access/patrons/${encodeURIComponent(patronId)}/status`);
      return result.currentStatus || result.current_status || 'outside';
    } catch {
      return 'outside';
    }
  },

  async setPatronStatus(patronId: string, status: 'inside' | 'outside', cameraId?: string): Promise<void> {
    await request(`${config.accessServiceUrl}/internal/access/patrons/${encodeURIComponent(patronId)}/status`, {
      method: 'POST',
      body: { current_status: status, camera_id: cameraId || 'manual' },
    });
  },
};
