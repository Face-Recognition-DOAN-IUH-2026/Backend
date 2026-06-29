import { config } from '../config';
import { amqpClient } from './AmqpClient';
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
        'Authorization': `Bearer ${getServiceToken('automation-service', config.jwtSecret)}`,
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
    try {
      const published = await amqpClient.publish('notification.send', {
        emailType: 'push',
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data || {},
      });
      if (published) {
        return { success: true, via: 'rabbitmq' };
      }
    } catch (err: any) {
      console.error('[AMQP] RabbitMQ publish failed, falling back to HTTP sync:', err.message);
    }

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
    try {
      let allSuccess = true;
      for (const input of notifications) {
        const published = await amqpClient.publish('notification.send', {
          emailType: 'push',
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data || {},
        });
        if (!published) allSuccess = false;
      }
      if (allSuccess) {
        return { success: true, via: 'rabbitmq', count: notifications.length };
      }
    } catch (err: any) {
      console.error('[AMQP] RabbitMQ bulk publish failed, falling back to HTTP sync:', err.message);
    }

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

  async getDueSoonBorrows(daysBefore = 3) {
    return request(`${config.services.borrowService}/borrow/internal/due-soon?days_before=${daysBefore}`);
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

  async getUpcomingAssignments(from: string, to: string) {
    return request(`${config.services.scheduleService}/schedules/internal/upcoming?from=${from}&to=${to}`);
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

  async forceExitPatron(patronId: string) {
    return request(`${config.services.accessService}/internal/access/force-exit`, {
      method: 'POST',
      body: { patron_id: patronId },
    });
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

export const emailClient = {
  async sendOverdueEmail(toEmail: string, bookTitle: string, daysOverdue: number) {
    try {
      const published = await amqpClient.publish('notification.send', {
        emailType: 'overdue',
        toEmail,
        bookTitle,
        daysOverdue,
      });
      if (published) return { success: true, via: 'rabbitmq' };
    } catch (err: any) {
      console.error('[AMQP] RabbitMQ publish failed for overdue email:', err.message);
    }

    return request(`${config.services.notificationService}/internal/send-overdue-email`, {
      method: 'POST',
      body: { toEmail, bookTitle, daysOverdue },
    });
  },

  async sendFineEmail(toEmail: string, bookTitle: string, fineAmount: number, daysOverdue: number) {
    try {
      const published = await amqpClient.publish('notification.send', {
        emailType: 'fine',
        toEmail,
        bookTitle,
        fineAmount,
        daysOverdue,
      });
      if (published) return { success: true, via: 'rabbitmq' };
    } catch (err: any) {
      console.error('[AMQP] RabbitMQ publish failed for fine email:', err.message);
    }

    return request(`${config.services.notificationService}/internal/send-fine-email`, {
      method: 'POST',
      body: { toEmail, bookTitle, fineAmount, daysOverdue },
    });
  },

  async sendMembershipExpiryEmail(toEmail: string, expiryDate: string) {
    try {
      const published = await amqpClient.publish('notification.send', {
        emailType: 'membership_expiry',
        toEmail,
        expiryDate,
      });
      if (published) return { success: true, via: 'rabbitmq' };
    } catch (err: any) {
      console.error('[AMQP] RabbitMQ publish failed for membership expiry email:', err.message);
    }

    return request(`${config.services.notificationService}/internal/send-membership-expiry-email`, {
      method: 'POST',
      body: { toEmail, expiryDate },
    });
  },
};
