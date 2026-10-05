import express, { Express } from 'express';
import request from 'supertest';
import { createPaymentRouter } from '../../routes/payment.routes';
import { errorHandler } from '../../middlewares/errorHandler';

jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, res: any, next: any) => {
    const token = req.headers?.authorization?.replace('Bearer ', '');
    if (!token || token === 'invalid-token') {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    req.user = { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', email: 'patron@test.com', role: 'patron' };
    next();
  },
}));

describe('Payment Routes (/borrow/payments)', () => {
  let app: Express;
  let mockPaymentServiceInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentServiceInstance = {
      createPaymentOrder: jest.fn(),
      getOrderStatus: jest.fn(),
      processWebhook: jest.fn(),
    };

    app = express();
    app.use(express.json());
    app.use('/borrow/payments', createPaymentRouter(mockPaymentServiceInstance));
    app.use(errorHandler);
  });

  describe('POST /borrow/payments/create', () => {
    it('returns 401 when token is missing', async () => {
      const res = await request(app)
        .post('/borrow/payments/create')
        .send({ record_ids: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'] });

      expect(res.status).toBe(401);
    });

    it('returns 400 when record_ids is empty', async () => {
      const res = await request(app)
        .post('/borrow/payments/create')
        .set('Authorization', 'Bearer valid-token')
        .send({ record_ids: [] });

      expect(res.status).toBe(400);
    });

    it('creates payment order successfully and returns 201', async () => {
      const mockResult = {
        id: 'order-1',
        orderCode: 'TXN-20261005-ABCD1234',
        patronId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        amount: 35000,
        status: 'pending',
        paymentMethod: 'vietqr',
        qrUrl: 'https://img.vietqr.io/...',
        qrData: 'vietqr://...',
        expiresAt: new Date().toISOString(),
        recordIds: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
      };
      mockPaymentServiceInstance.createPaymentOrder.mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/borrow/payments/create')
        .set('Authorization', 'Bearer valid-token')
        .send({
          record_ids: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
          payment_method: 'vietqr',
        });

      expect(res.status).toBe(201);
      expect(res.body.orderCode).toBe('TXN-20261005-ABCD1234');
      expect(res.body.amount).toBe(35000);
    });
  });

  describe('GET /borrow/payments/:orderCode/status', () => {
    it('returns current status of payment order', async () => {
      mockPaymentServiceInstance.getOrderStatus.mockResolvedValue({
        orderCode: 'TXN-20261005-ABCD1234',
        status: 'completed',
        amount: 35000,
        paidAt: new Date().toISOString(),
      });

      const res = await request(app).get('/borrow/payments/TXN-20261005-ABCD1234/status');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
    });
  });

  describe('POST /borrow/payments/webhook', () => {
    it('processes webhook and returns result', async () => {
      mockPaymentServiceInstance.processWebhook.mockResolvedValue({
        success: true,
        orderCode: 'TXN-20261005-ABCD1234',
        alreadyCompleted: false,
        activatedPatrons: ['patron-1'],
      });

      const res = await request(app)
        .post('/borrow/payments/webhook')
        .set('x-signature', 'valid-sig')
        .send({
          orderCode: 'TXN-20261005-ABCD1234',
          amount: 35000,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.activatedPatrons).toContain('patron-1');
    });

    it('extracts signature directly from body if header is not present', async () => {
      mockPaymentServiceInstance.processWebhook.mockResolvedValue({
        success: true,
        orderCode: 'TXN-20261005-ABCD1234',
        alreadyCompleted: false,
        activatedPatrons: [],
      });

      const res = await request(app)
        .post('/borrow/payments/webhook')
        .send({
          orderCode: 'TXN-20261005-ABCD1234',
          amount: 35000,
          signature: 'body-sig-123',
        });

      expect(res.status).toBe(200);
      expect(mockPaymentServiceInstance.processWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ orderCode: 'TXN-20261005-ABCD1234' }),
        'body-sig-123',
      );
    });
  });
});
