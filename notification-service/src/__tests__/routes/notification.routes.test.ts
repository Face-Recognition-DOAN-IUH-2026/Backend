import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const mockList = jest.fn();
const mockUnreadCount = jest.fn();
const mockMarkAllAsRead = jest.fn();
const mockMarkAsRead = jest.fn();

jest.mock('../../services/NotificationService', () => ({
  notificationService: {
    list: (...args: any[]) => mockList(...args),
    getUnreadCount: (...args: any[]) => mockUnreadCount(...args),
    markAllAsRead: (...args: any[]) => mockMarkAllAsRead(...args),
    markAsRead: (...args: any[]) => mockMarkAsRead(...args),
  },
}));

jest.mock('../../services/DeviceTokenService', () => ({
  deviceTokenService: { register: jest.fn(), unregister: jest.fn() },
}));

jest.mock('../../realtime/NotificationHub', () => ({
  notificationHub: { getConnectionCount: jest.fn(() => 0) },
}));

import notificationRoutes from '../../routes/notification.routes';

function signHs256Jwt(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      roles: ['patron'],
      role: 'patron',
      iss: 'face-recognition',
      aud: 'face-recognition-users',
      typ: 'access',
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', 'test-secret').update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('Notification Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/notifications', notificationRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(401);
  });

  it('lists notifications and unread count for authenticated user', async () => {
    mockList.mockResolvedValue({ items: [{ id: 'n1' }], total: 1, unread: 1 });
    mockUnreadCount.mockResolvedValue(1);

    const token = signHs256Jwt('user-123');
    const res1 = await request(app).get('/notifications?unread=true').set('Authorization', `Bearer ${token}`);
    expect(res1.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith('user-123', { unreadOnly: true, skip: 0, limit: 20 });

    const res2 = await request(app).get('/notifications/unread-count').set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ count: 1 });
  });

  it('routes /read-all before /:id/read and returns 404 for missing notification', async () => {
    mockMarkAllAsRead.mockResolvedValue(5);
    mockMarkAsRead.mockResolvedValue(null);

    const token = signHs256Jwt('user-123');
    const resAll = await request(app).put('/notifications/read-all').set('Authorization', `Bearer ${token}`);
    expect(resAll.status).toBe(200);
    expect(resAll.body).toEqual({ updated: 5 });

    const resMissing = await request(app).put('/notifications/missing-id/read').set('Authorization', `Bearer ${token}`);
    expect(resMissing.status).toBe(404);
  });
});
