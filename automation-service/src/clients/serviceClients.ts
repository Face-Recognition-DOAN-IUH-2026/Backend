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

export const notificationClient = {
  async createNotification(input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }) {
    return request(`${config.services.notificationService}/internal/`, {
      method: 'POST',
      body: input,
    });
  },

  async createBulkNotifications(
    notifications: Array<{
      userId: string;
      type: string;
      title: string;
      body: string;
      data?: Record<string, any>;
    }>
  ) {
    return request(`${config.services.notificationService}/internal/bulk`, {
      method: 'POST',
      body: { notifications },
    });
  },
};

export const borrowClient = {
  async getOverdueBorrows() {
    return request(`${config.services.borrowService}/borrow/internal/overdue`);
  },

  async getActiveBorrowers() {
    return request(`${config.services.borrowService}/borrow/internal/active-borrowers`);
  },

  async getBooks(skip = 0, limit = 100) {
    return request(`${config.services.borrowService}/borrow/books?skip=${skip}&limit=${limit}`);
  },
};

export const scheduleClient = {
  async getTodayAssignments() {
    return request(`${config.services.scheduleService}/schedules/today`);
  },

  async getAttendance(scheduleId: string) {
    return request(`${config.services.scheduleService}/schedules/assignments/${scheduleId}/attendance`);
  },
};

export const accessClient = {
  async getStats() {
    return request(`${config.services.accessService}/internal/access/stats`);
  },

  async getActivePatrons() {
    return request(`${config.services.accessService}/internal/access/active`);
  },

  async getAccessLogs(dateFrom: string, limit = 200) {
    return request(`${config.services.accessService}/access/logs?dateFrom=${dateFrom}&limit=${limit}`);
  },
};

export const userClient = {
  async getUser(id: string) {
    return request(`${config.services.userService}/internal/users/${id}`);
  },

  async getUsers(ids: string[]) {
    const results = await Promise.allSettled(ids.map((id) => request(`${config.services.userService}/internal/users/${id}`)));
    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value);
  },

  async getUsersByRole(role: string) {
    return request(`${config.services.userService}/internal/users?role=${role}`);
  },
};
