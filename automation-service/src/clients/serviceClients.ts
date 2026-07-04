import { config } from '../config';
import { amqpClient } from './AmqpClient';
import { getServiceToken, CircuitBreaker, retryWithBackoff } from '../../../shared';

interface RequestOptions {
  method?: string;
  body?: any;
  timeout?: number;
}

const circuit = new CircuitBreaker(5, 60_000);

async function request(url: string, options: RequestOptions = {}): Promise<any> {
  const { method = 'GET', body, timeout = 5000 } = options;

  if (!circuit.canRequest()) {
    throw new Error(`Circuit breaker open for ${url.split('//')[1]?.split('/')[0] || 'downstream service'}`);
  }

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
    if (res.status >= 500) {
      circuit.recordFailure();
      throw new Error(`HTTP ${res.status}: downstream service error`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    circuit.recordSuccess();
    return res.json();
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof TypeError || (error as any)?.name === 'AbortError') {
      circuit.recordFailure();
    }
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
    let publishedCount = 0;
    try {
      for (const input of notifications) {
        const published = await amqpClient.publish('notification.send', {
          emailType: 'push',
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data || {},
        });
        if (published) publishedCount++;
      }
      if (publishedCount > 0) {
        return { success: true, via: 'rabbitmq', count: publishedCount };
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

  async getExpiredWaitlist(hours: number) {
    return request(`${config.services.borrowService}/borrow/internal/waitlist/expired?hours=${hours}`);
  },

  async advanceWaitlist(id: string) {
    return request(`${config.services.borrowService}/borrow/internal/waitlist/advance/${id}`, {
      method: 'POST',
    });
  },

  async getWaitlistByBook(bookId: string) {
    return request(`${config.services.borrowService}/borrow/internal/book/${bookId}/waitlist`);
  },

  async batchNotifyWaitlist(ids: string[]) {
    return request(`${config.services.borrowService}/borrow/internal/waitlist/batch-notify`, {
      method: 'PATCH',
      body: { ids },
    });
  },
};

export const scheduleClient = {
  async getTodayAssignments() {
    return request(`${config.services.scheduleService}/internal/today`);
  },

  async getUpcomingAssignments(from: string, to: string) {
    return request(`${config.services.scheduleService}/internal/upcoming?from=${from}&to=${to}`);
  },

  async getAttendance(scheduleId: string) {
    return request(`${config.services.scheduleService}/schedules/assignments/${scheduleId}/attendance`);
  },

  async autoCheckout(timeout = 30000) {
    return request(`${config.services.scheduleService}/schedules/internal/auto-checkout`, {
      method: 'POST',
      timeout,
    });
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

  async cleanupExpiredPending(seconds: number = 30) {
    return request(`${config.services.accessService}/internal/access/cleanup-expired-pending`, {
      method: 'POST',
      body: { seconds },
    });
  },
};

export const userClient = {
  async getUser(id: string) {
    return request(`${config.services.userService}/internal/users/${id}`);
  },

  async getUsers(ids: string[]): Promise<Record<string, any>> {
    if (ids.length === 0) return {};
    return request(`${config.services.userService}/internal/users/batch`, {
      method: 'POST',
      body: { ids },
    });
  },

  async getUsersByRole(role: string) {
    return request(`${config.services.userService}/internal/users?role=${role}`);
  },

  async getExpiringMemberships(days: number) {
    return request(`${config.services.userService}/internal/users/expiring-membership?days=${days}`);
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
