import request from 'supertest';

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

jest.mock('../../services/AccessService', () => ({
  accessService: {
    findKioskDevice: jest.fn(),
    setStatus: jest.fn(),
    getStatus: jest.fn(),
    createApprovalRequest: jest.fn(),
    getPendingApprovalRequests: jest.fn(),
    getApprovalRequest: jest.fn(),
    approveRequest: jest.fn(),
    rejectRequest: jest.fn(),
  },
}));

jest.mock('../../clients/AmqpClient', () => ({
  amqpClient: {
    connect: jest.fn(),
    publish: jest.fn(),
    publishFanout: jest.fn(),
    subscribeFanout: jest.fn(),
  },
}));

jest.mock('../../clients/UserServiceClient', () => ({
  UserServiceClient: jest.fn(() => ({
    getUsers: jest.fn(),
    lookupPatron: jest.fn(),
  })),
}));

jest.mock('../../realtime/RealtimeHub', () => ({
  realtimeHub: {
    connectBroker: jest.fn(),
    publish: jest.fn(),
    addSseClient: jest.fn(),
  },
}));

let mockFindKioskDevice: jest.Mock;
let mockCreateApprovalRequest: jest.Mock;
let mockGetPendingApprovalRequests: jest.Mock;
let mockGetApprovalRequest: jest.Mock;
let mockApproveRequest: jest.Mock;
let mockRejectRequest: jest.Mock;

function setupMocks() {
  const svc = require('../../services/AccessService').accessService;
  mockFindKioskDevice = svc.findKioskDevice;
  mockCreateApprovalRequest = svc.createApprovalRequest;
  mockGetPendingApprovalRequests = svc.getPendingApprovalRequests;
  mockGetApprovalRequest = svc.getApprovalRequest;
  mockApproveRequest = svc.approveRequest;
  mockRejectRequest = svc.rejectRequest;
}

describe('KIOSK-1 Approval Flow', () => {
  let app: any;

  beforeAll(async () => {
    const express = require('express');
    app = express();
    app.use(express.json());
    const routes = await import('../../routes/access.routes');
    app.use('/access', routes.default);
    app.use((err: any, _req: any, res: any, _next: any) => {
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message || 'Internal server error' });
    });
    setupMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /access/kiosk/approval-request', () => {
    it('should return 400 when body is missing', async () => {
      const res = await request(app)
        .post('/access/kiosk/approval-request')
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 400 when patron_id is missing', async () => {
      const res = await request(app)
        .post('/access/kiosk/approval-request')
        .send({ device_id: 'd1', student_code: 'SV001' });
      expect(res.status).toBe(400);
    });

    it('should return 403 for unknown device', async () => {
      mockFindKioskDevice.mockResolvedValue(null);
      const res = await request(app)
        .post('/access/kiosk/approval-request')
        .send({ device_id: 'bad-device', patron_id: 'p1', student_code: 'SV001' });
      expect(res.status).toBe(403);
    });

    it('should create approval request and return event code', async () => {
      mockFindKioskDevice.mockResolvedValue({ id: 'd1', deviceName: 'Kiosk 1', ipAddress: '127.0.0.1', isActive: true });
      mockCreateApprovalRequest.mockResolvedValue({
        id: 'req-1',
        event_code: 'A45',
        device_auth_token: 'tok1',
        status: 'pending',
        expires_at: new Date(Date.now() + 300000).toISOString(),
      });

      const res = await request(app)
        .post('/access/kiosk/approval-request')
        .send({ device_id: 'd1', patron_id: 'p1', student_code: 'SV001' });

      expect(res.status).toBe(201);
      expect(res.body.event_code).toBe('A45');
      expect(res.body.device_auth_token).toBe('tok1');
    });
  });

  describe('GET /access/kiosk/approval-requests/pending', () => {
    it('should return list of pending requests', async () => {
      mockGetPendingApprovalRequests.mockResolvedValue([
        { id: 'req-1', event_code: 'A45', status: 'pending' },
      ]);

      const res = await request(app).get('/access/kiosk/approval-requests/pending');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].event_code).toBe('A45');
    });
  });

  describe('POST /access/kiosk/approval-requests/:code/approve', () => {
    it('should approve and return success', async () => {
      mockApproveRequest.mockResolvedValue({ status: 'approved', event_code: 'A45' });

      const res = await request(app)
        .post('/access/kiosk/approval-requests/A45/approve')
        .send({ approved_by: 'staff-1' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
    });

    it('should return 404 for unknown request', async () => {
      mockApproveRequest.mockRejectedValue({ statusCode: 404, message: 'Not found' });

      const res = await request(app)
        .post('/access/kiosk/approval-requests/ZZ99/approve')
        .send({ approved_by: 'staff-1' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /access/kiosk/approval-requests/:code/reject', () => {
    it('should reject and return success', async () => {
      mockRejectRequest.mockResolvedValue({ status: 'rejected', event_code: 'A45' });

      const res = await request(app)
        .post('/access/kiosk/approval-requests/A45/reject')
        .send({ approved_by: 'staff-1', reason: 'Hình ảnh không rõ' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
    });
  });

  describe('GET /access/kiosk/approval-requests/:code', () => {
    it('should return request status', async () => {
      mockGetApprovalRequest.mockResolvedValue({
        id: 'req-1',
        event_code: 'A45',
        status: 'pending',
        expires_at: new Date(Date.now() + 300000).toISOString(),
      });

      const res = await request(app).get('/access/kiosk/approval-requests/A45');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('pending');
    });
  });
});
