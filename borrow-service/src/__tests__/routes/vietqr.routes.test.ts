import express, { Express } from 'express';
import request from 'supertest';
import { createVietqrRouter } from '../../routes/vietqr.routes';
import { HttpError } from '../../../../shared/error-handler';

describe('VietQR Callback Routes (/borrow/vietqr)', () => {
  let app: Express;
  let mockService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VIETQR_CALLBACK_SECRET = 'test-256-bit-secret-0123456789abcdef';
    process.env.VIETQR_CALLBACK_USERNAME = 'vietqr-partner';
    process.env.VIETQR_CALLBACK_PASSWORD = 'partner-pass';

    mockService = { processVietqrCallback: jest.fn() };

    app = express();
    app.use(express.json());
    app.use('/borrow/vietqr', createVietqrRouter(mockService));
  });

  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

  describe('POST /borrow/vietqr/token-generate', () => {
    it('returns 400 when Authorization header is missing', async () => {
      const res = await request(app).post('/borrow/vietqr/token-generate').send({});
      expect(res.status).toBe(400);
      expect(res.body.status).toBe('FAILED');
    });

    it('returns 401 for wrong credentials', async () => {
      const res = await request(app)
        .post('/borrow/vietqr/token-generate')
        .set('Authorization', basic('vietqr-partner', 'wrong'))
        .send({});
      expect(res.status).toBe(401);
    });

    it('issues a Bearer token for correct credentials', async () => {
      const res = await request(app)
        .post('/borrow/vietqr/token-generate')
        .set('Authorization', basic('vietqr-partner', 'partner-pass'))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.token_type).toBe('Bearer');
      expect(res.body.expires_in).toBe(300);
      expect(typeof res.body.access_token).toBe('string');
    });
  });

  describe('POST /borrow/vietqr/transaction-sync', () => {
    const callbackBody = {
      bankaccount: '0395324779',
      amount: 50000,
      transType: 'C',
      content: 'VQRABC123456',
      transactionid: 'BANK-TXN-1',
      transactiontime: 1757342061000,
      referencenumber: 'REF-1',
      orderId: 'VQRABC123456',
    };

    const getBearer = async () => {
      const res = await request(app)
        .post('/borrow/vietqr/token-generate')
        .set('Authorization', basic('vietqr-partner', 'partner-pass'))
        .send({});
      return `Bearer ${res.body.access_token}`;
    };

    it('returns 401 when Bearer token is missing', async () => {
      const res = await request(app).post('/borrow/vietqr/transaction-sync').send(callbackBody);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe(true);
    });

    it('returns 401 for an invalid Bearer token', async () => {
      const res = await request(app)
        .post('/borrow/vietqr/transaction-sync')
        .set('Authorization', 'Bearer invalid')
        .send(callbackBody);
      expect(res.status).toBe(401);
      expect(res.body.errorReason).toBe('INVALID_TOKEN');
    });

    it('settles the order and returns VietQR success envelope', async () => {
      mockService.processVietqrCallback.mockResolvedValue({ orderCode: 'TXN-1', duplicate: false });
      const res = await request(app)
        .post('/borrow/vietqr/transaction-sync')
        .set('Authorization', await getBearer())
        .send(callbackBody);
      expect(res.status).toBe(200);
      expect(res.body.error).toBe(false);
      expect(res.body.object.reftransactionid).toBe('TXN-1');
      expect(mockService.processVietqrCallback).toHaveBeenCalledWith(expect.objectContaining({
        transactionid: 'BANK-TXN-1',
        orderId: 'VQRABC123456',
      }));
    });

    it('maps service 404 to ORDER_NOT_FOUND envelope', async () => {
      mockService.processVietqrCallback.mockRejectedValue(new HttpError(404, 'Không tìm thấy đơn hàng'));
      const res = await request(app)
        .post('/borrow/vietqr/transaction-sync')
        .set('Authorization', await getBearer())
        .send(callbackBody);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe(true);
      expect(res.body.errorReason).toBe('ORDER_NOT_FOUND');
    });
  });
});
