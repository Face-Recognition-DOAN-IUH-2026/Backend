import express, { Express } from 'express';
import crypto from 'crypto';
import request from 'supertest';
import { createSepayRouter } from '../../routes/sepay.routes';

describe('SePay Callback Routes (/borrow/sepay)', () => {
  let app: Express;
  let mockService: any;
  const testSecret = 'whsec_test_secret_for_unit_tests_only_123456789';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SEPAY_API_KEY = testSecret;
    process.env.SEPAY_WEBHOOK_SECRET = testSecret;

    mockService = { processSepayWebhook: jest.fn() };

    app = express();
    app.use(express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }));
    app.use('/borrow/sepay', createSepayRouter(mockService));
  });

  const sepayPayload = {
    id: 12345,
    gateway: 'MBBank',
    transactionDate: '2026-11-11 15:30:00',
    accountNumber: '0395324779',
    code: 'TXN-20261111-d23fa651',
    content: 'TXN-20261111-d23fa651 chuyen tien',
    transferType: 'in',
    transferAmount: 35000,
    accumulated: 500000,
    referenceCode: 'MBVCB.12345678',
  };

  describe('POST /borrow/sepay/webhook', () => {
    it('returns 401 when API Key is missing or invalid', async () => {
      const res = await request(app)
        .post('/borrow/sepay/webhook')
        .send(sepayPayload);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 when API Key does not match', async () => {
      const res = await request(app)
        .post('/borrow/sepay/webhook')
        .set('Authorization', 'Apikey wrong-key')
        .send(sepayPayload);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('processes transaction successfully when Apikey header is valid', async () => {
      mockService.processSepayWebhook.mockResolvedValue({
        orderCode: 'TXN-20261111-d23fa651',
        duplicate: false,
      });

      const res = await request(app)
        .post('/borrow/sepay/webhook')
        .set('Authorization', `Apikey ${testSecret}`)
        .send(sepayPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.orderCode).toBe('TXN-20261111-d23fa651');
      expect(mockService.processSepayWebhook).toHaveBeenCalledWith(expect.objectContaining({
        id: 12345,
        transferAmount: 35000,
        transferType: 'in',
      }));
    });

    it('also accepts Bearer prefix for API key if configured that way', async () => {
      mockService.processSepayWebhook.mockResolvedValue({
        orderCode: 'TXN-20261111-d23fa651',
        duplicate: false,
      });

      const res = await request(app)
        .post('/borrow/sepay/webhook')
        .set('Authorization', `Bearer ${testSecret}`)
        .send(sepayPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('authenticates successfully with X-SePay-Signature and X-SePay-Timestamp HMAC-SHA256', async () => {
      mockService.processSepayWebhook.mockResolvedValue({
        orderCode: 'TXN-20261111-d23fa651',
        duplicate: false,
      });

      const rawPayload = JSON.stringify(sepayPayload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sig = crypto.createHmac('sha256', testSecret).update(`${timestamp}.${rawPayload}`).digest('hex');

      const res = await request(app)
        .post('/borrow/sepay/webhook')
        .set('X-SePay-Timestamp', timestamp)
        .set('X-SePay-Signature', `sha256=${sig}`)
        .set('Content-Type', 'application/json')
        .send(rawPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects invalid X-SePay-Signature', async () => {
      const rawPayload = JSON.stringify(sepayPayload);
      const timestamp = String(Math.floor(Date.now() / 1000));

      const res = await request(app)
        .post('/borrow/sepay/webhook')
        .set('X-SePay-Timestamp', timestamp)
        .set('X-SePay-Signature', 'sha256=invalidhexsignature0123456789abcdef0123456789abcdef0123456789abcdef')
        .set('Content-Type', 'application/json')
        .send(rawPayload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /borrow/sepay/health', () => {
    it('returns 200 ok', async () => {
      const res = await request(app).get('/borrow/sepay/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.provider).toBe('sepay');
    });
  });
});

