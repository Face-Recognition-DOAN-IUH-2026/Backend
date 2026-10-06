import express from 'express';
import request from 'supertest';
import accessRoutes from '../../routes/access.routes';
import internalRoutes from '../../routes/internal.routes';
import { accessService } from '../../services/AccessService';

jest.mock('../../services/AccessService', () => ({
  accessService: {
    rollupRecognition: jest.fn(),
    getRecognitionStats: jest.fn(),
    getHourlyStats: jest.fn(),
    getStats: jest.fn(),
  },
}));

jest.mock('../../../shared/auth', () => ({
  createAuth: () => (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user', role: req.headers['x-test-role'] || 'admin' };
    next();
  },
  requireRole: (roles: string[]) => (req: any, res: any, next: any) => {
    const role = req.user?.role || 'user';
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  createInternalAuth: () => (req: any, res: any, next: any) => {
    if (req.headers['x-service-token'] !== 'valid-service-token') {
      res.status(403).json({ error: 'Service token required' });
      return;
    }
    next();
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/access', accessRoutes);
  app.use('/internal', internalRoutes);
  return app;
}

describe('Access Stats Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /internal/access/rollup-recognition', () => {
    it('calls accessService.rollupRecognition when valid service token is provided', async () => {
      (accessService.rollupRecognition as jest.Mock).mockResolvedValue({
        date: '2026-10-03',
        cameras: [{ camera_id: 'entry_gate', granted: 10 }],
      });

      const res = await request(createApp())
        .post('/internal/access/rollup-recognition')
        .set('x-service-token', 'valid-service-token')
        .send({ date: '2026-10-03' });

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-10-03');
      expect(accessService.rollupRecognition).toHaveBeenCalledWith('2026-10-03');
    });

    it('rejects without service token with 403', async () => {
      const res = await request(createApp())
        .post('/internal/access/rollup-recognition')
        .send({ date: '2026-10-03' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /access/stats/recognition', () => {
    it('returns recognition series for staff/admin', async () => {
      (accessService.getRecognitionStats as jest.Mock).mockResolvedValue([
        { date: '2026-10-03', granted: 10, spoof: 1, no_match: 2, other: 0, accuracy: 0.77 },
      ]);

      const res = await request(createApp())
        .get('/access/stats/recognition?days=30')
        .set('x-test-role', 'staff');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(accessService.getRecognitionStats).toHaveBeenCalledWith(30);
    });

    it('rejects patrons with 403', async () => {
      const res = await request(createApp())
        .get('/access/stats/recognition')
        .set('x-test-role', 'patron');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /access/stats/hourly', () => {
    it('returns 24 buckets for staff/admin', async () => {
      (accessService.getHourlyStats as jest.Mock).mockResolvedValue(
        Array.from({ length: 24 }, (_, i) => ({ hour: i, entries: 5, exits: 3, total: 8 }))
      );

      const res = await request(createApp())
        .get('/access/stats/hourly?date=2026-10-03')
        .set('x-test-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(24);
      expect(accessService.getHourlyStats).toHaveBeenCalledWith('2026-10-03');
    });

    it('rejects patrons with 403', async () => {
      const res = await request(createApp())
        .get('/access/stats/hourly')
        .set('x-test-role', 'patron');

      expect(res.status).toBe(403);
    });
  });
});
