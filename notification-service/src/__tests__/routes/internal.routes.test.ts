import express from 'express';
import request from 'supertest';
import internalRoutes from '../../routes/internal.routes';

jest.mock('../../services/NotificationService');
jest.mock('../../realtime/NotificationHub');
jest.mock('../../services/EmailService', () => {
  return {
    EmailService: jest.fn().mockImplementation(() => ({
      sendPasswordResetCode: jest.fn().mockResolvedValue(undefined),
      sendOverdueEmail: jest.fn().mockResolvedValue(undefined),
      sendFineEmail: jest.fn().mockResolvedValue(undefined),
      sendMembershipExpiryEmail: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/internal', internalRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

describe('Internal Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  describe('POST /internal/send-password-reset', () => {
    it('should send password reset email', async () => {
      const res = await request(app)
        .post('/internal/send-password-reset')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'test@example.com', code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 for invalid email', async () => {
      const res = await request(app)
        .post('/internal/send-password-reset')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'not-an-email', code: '123456' });

      expect(res.status).toBe(400);
    });

    it('should return 400 for wrong code length', async () => {
      const res = await request(app)
        .post('/internal/send-password-reset')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'test@example.com', code: '123' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /internal/send-overdue-email', () => {
    it('should send overdue email', async () => {
      const res = await request(app)
        .post('/internal/send-overdue-email')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'test@example.com', bookTitle: 'Test Book', daysOverdue: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/internal/send-overdue-email')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'test@example.com' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /internal/send-fine-email', () => {
    it('should send fine email', async () => {
      const res = await request(app)
        .post('/internal/send-fine-email')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'test@example.com', bookTitle: 'Book', fineAmount: 5000, daysOverdue: 3 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 for missing fineAmount', async () => {
      const res = await request(app)
        .post('/internal/send-fine-email')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'test@example.com', bookTitle: 'Book', daysOverdue: 3 });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /internal/send-membership-expiry-email', () => {
    it('should send membership expiry email', async () => {
      const res = await request(app)
        .post('/internal/send-membership-expiry-email')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'test@example.com', expiryDate: '2026-12-31T00:00:00.000Z' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 for invalid date', async () => {
      const res = await request(app)
        .post('/internal/send-membership-expiry-email')
        .set('x-internal-api-key', 'test-internal-key')
        .send({ toEmail: 'test@example.com', expiryDate: 'not-a-date' });

      expect(res.status).toBe(400);
    });
  });

  describe('Authentication', () => {
    it('should return 403 when no API key', async () => {
      const res = await request(app)
        .post('/internal/send-overdue-email')
        .send({ toEmail: 'test@example.com', bookTitle: 'Book', daysOverdue: 1 });

      expect(res.status).toBe(403);
    });

    it('should return 403 for wrong API key', async () => {
      const res = await request(app)
        .post('/internal/send-overdue-email')
        .set('x-internal-api-key', 'wrong-key')
        .send({ toEmail: 'test@example.com', bookTitle: 'Book', daysOverdue: 1 });

      expect(res.status).toBe(403);
    });
  });
});
