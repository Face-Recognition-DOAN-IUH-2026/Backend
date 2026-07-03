import { Router } from 'express';
import request from 'supertest';

// Mock shared auth to bypass validation
jest.mock('../../../shared', () => ({
  createAuth: () => (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  createInternalAuth: () => (_req: any, _res: any, next: any) => next(),
  HttpError: class HttpError extends Error {
    constructor(public statusCode: number, message: string) {
      super(message);
    }
  },
}));

// Mock AccessService
let mockSetStatus = jest.fn();
let mockGetStatus = jest.fn();
let mockFindKioskDevice = jest.fn();
let mockRecordKioskPresence = jest.fn();

jest.mock('../../services/AccessService', () => ({
  accessService: {
    setStatus: (...args: any[]) => mockSetStatus(...args),
    getStatus: (...args: any[]) => mockGetStatus(...args),
    findKioskDevice: (...args: any[]) => mockFindKioskDevice(...args),
    recordKioskPresence: (...args: any[]) => mockRecordKioskPresence(...args),
  },
}));

// Mock AmqpClient
jest.mock('../../clients/AmqpClient', () => ({
  amqpClient: {
    connect: jest.fn(),
    publish: jest.fn(),
    publishFanout: jest.fn(),
    subscribeFanout: jest.fn(),
  },
}));

// Mock UserServiceClient
jest.mock('../../clients/UserServiceClient', () => ({
  UserServiceClient: jest.fn(() => ({
    getUsers: jest.fn(),
    lookupPatron: jest.fn(),
  })),
}));

// Mock realtimeHub
jest.mock('../../realtime/RealtimeHub', () => ({
  realtimeHub: {
    connectBroker: jest.fn(),
    publish: jest.fn(),
    addSseClient: jest.fn(),
  },
}));

describe('POST /access/kiosk/presence', () => {
  let app: any;

  beforeAll(async () => {
    const express = require('express');
    app = express();
    app.use(express.json());
    const routeModule = await import('../../routes/access.routes');
    app.use('/access', routeModule.default);
    app.use((err: any, _req: any, res: any, _next: any) => {
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message || 'Internal server error' });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 when patron_id is missing', async () => {
    const res = await request(app)
      .post('/access/kiosk/presence')
      .send({ student_code: 'SV001', device_id: 'kiosk-1' });
    expect(res.status).toBe(400);
  });

  it('should return 400 when device_id is missing', async () => {
    const res = await request(app)
      .post('/access/kiosk/presence')
      .send({ patron_id: 'p1', student_code: 'SV001' });
    expect(res.status).toBe(400);
  });

  it('should return 403 for unknown device', async () => {
    mockFindKioskDevice.mockResolvedValue(null);

    const res = await request(app)
      .post('/access/kiosk/presence')
      .send({ patron_id: 'p1', student_code: 'SV001', device_id: 'unknown-device' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('không hợp lệ');
  });

  it('should set status to inside and return 200 for valid request', async () => {
    const device = { id: 'kiosk-1', deviceName: 'Main Kiosk', ipAddress: '127.0.0.1', isActive: true };
    mockFindKioskDevice.mockResolvedValue(device);
    mockRecordKioskPresence.mockResolvedValue({
      patron_id: 'p1',
      current_status: 'inside',
      currentStatus: 'inside',
      message: 'Đã ghi nhận hiện diện qua Kiosk',
      skipped: false,
    });

    const res = await request(app)
      .post('/access/kiosk/presence')
      .send({ patron_id: 'p1', student_code: 'SV001', device_id: 'kiosk-1' });

    expect(res.status).toBe(200);
    expect(mockRecordKioskPresence).toHaveBeenCalledWith('p1', 'SV001', 'kiosk-1');
    expect(res.body.current_status).toBe('inside');
  });
});
