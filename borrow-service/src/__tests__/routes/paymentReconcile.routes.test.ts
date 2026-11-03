import express, { Express } from 'express';
import request from 'supertest';
import { createPaymentRouter } from '../../routes/payment.routes';
import { errorHandler, HttpError } from '../../../../shared/error-handler';

/**
 * BLF-PAY-01 — staff-facing reconcile queue.
 *
 * When an online payment arrives for a debt that was already settled at the
 * counter, the order is quarantined as `reconcile_needed` so accounting can
 * refund it manually (decision D4). These tests cover the two endpoints that
 * make that ticket usable.
 */

// Patron enrichment calls the user-service; keep it off the network.
jest.mock('../../clients/UserServiceClient', () => ({
  lookupPatronsByIds: jest.fn().mockResolvedValue(new Map()),
  activateCardAutoFine: jest.fn(),
}));

jest.mock('../../middlewares/auth', () => ({
  auth: (req: any, res: any, next: any) => {
    if (!req.headers?.authorization) {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }
    req.user = { id: 'staff-1', email: 'staff@test.com', role: 'staff' };
    next();
  },
  // Deny when the caller asks for a patron-facing request, so the permission
  // wiring is exercised instead of assumed.
  requireDynamicPermission: (_resource: string, _action: string) =>
    (req: any, res: any, next: any) => {
      if (req.headers?.['x-test-role'] === 'patron') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      next();
    },
}));

describe('Payment reconcile routes (BLF-PAY-01)', () => {
  let app: Express;
  let service: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = {
      createPaymentOrder: jest.fn(),
      getOrderStatus: jest.fn(),
      processWebhook: jest.fn(),
      listReconcileOrders: jest.fn(),
      acknowledgeReconcile: jest.fn(),
    };

    app = express();
    app.use(express.json());
    app.use('/borrow/payments', createPaymentRouter(service));
    app.use(errorHandler);
  });

  describe('GET /borrow/payments/reconcile', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).get('/borrow/payments/reconcile');
      expect(res.status).toBe(401);
    });

    it('returns 403 when the caller lacks borrows:update', async () => {
      const res = await request(app)
        .get('/borrow/payments/reconcile')
        .set('Authorization', 'Bearer valid')
        .set('x-test-role', 'patron');

      expect(res.status).toBe(403);
      expect(service.listReconcileOrders).not.toHaveBeenCalled();
    });

    it('returns reconcile tickets with a patron summary', async () => {
      service.listReconcileOrders.mockResolvedValue({
        items: [
          {
            orderCode: 'TXN-20261102-AAAA1111',
            patronId: 'patron-1',
            amount: 50000,
            reconcileReason: 'all_records_already_paid',
            reconcileAmount: 50000,
            alreadyPaidRecordIds: ['rec-1'],
            createdAt: new Date('2026-11-02T03:00:00Z'),
            paidAt: new Date('2026-11-02T03:05:00Z'),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const res = await request(app)
        .get('/borrow/payments/reconcile')
        .set('Authorization', 'Bearer valid');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].reconcileAmount).toBe(50000);
      expect(service.listReconcileOrders).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'reconcile_needed', page: 1, pageSize: 20 }),
      );
    });

    it('rejects an unknown status filter with 400', async () => {
      const res = await request(app)
        .get('/borrow/payments/reconcile?status=banana')
        .set('Authorization', 'Bearer valid');

      expect(res.status).toBe(400);
      expect(service.listReconcileOrders).not.toHaveBeenCalled();
    });
  });

  describe('POST /borrow/payments/:orderCode/reconcile/ack', () => {
    it('returns 403 when the caller lacks borrows:update', async () => {
      const res = await request(app)
        .post('/borrow/payments/TXN-1/reconcile/ack')
        .set('Authorization', 'Bearer valid')
        .set('x-test-role', 'patron')
        .send({ note: 'Da chuyen khoan hoan tien' });

      expect(res.status).toBe(403);
      expect(service.acknowledgeReconcile).not.toHaveBeenCalled();
    });

    it('rejects a note shorter than 5 characters with 400', async () => {
      const res = await request(app)
        .post('/borrow/payments/TXN-1/reconcile/ack')
        .set('Authorization', 'Bearer valid')
        .send({ note: 'ok' });

      expect(res.status).toBe(400);
      expect(service.acknowledgeReconcile).not.toHaveBeenCalled();
    });

    it('acknowledges the refund and records the acting staff member', async () => {
      service.acknowledgeReconcile.mockResolvedValue({
        orderCode: 'TXN-1',
        status: 'refunded',
        alreadyAcknowledged: false,
        reconcileAckBy: 'staff-1',
      });

      const res = await request(app)
        .post('/borrow/payments/TXN-1/reconcile/ack')
        .set('Authorization', 'Bearer valid')
        .send({ note: 'Da chuyen khoan hoan tien cho doc gia' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('refunded');
      expect(service.acknowledgeReconcile).toHaveBeenCalledWith(
        'TXN-1',
        'staff-1',
        'Da chuyen khoan hoan tien cho doc gia',
      );
    });

    it('is idempotent on an already refunded order', async () => {
      service.acknowledgeReconcile.mockResolvedValue({
        orderCode: 'TXN-1',
        status: 'refunded',
        alreadyAcknowledged: true,
      });

      const res = await request(app)
        .post('/borrow/payments/TXN-1/reconcile/ack')
        .set('Authorization', 'Bearer valid')
        .send({ note: 'Xac nhan lai lan hai' });

      expect(res.status).toBe(200);
      expect(res.body.alreadyAcknowledged).toBe(true);
    });

    it('returns 409 when the order is not in reconcile state', async () => {
      service.acknowledgeReconcile.mockRejectedValue(
        new HttpError(409, 'Đơn hàng không ở trạng thái cần đối soát', 'ORDER_NOT_IN_RECONCILE'),
      );

      const res = await request(app)
        .post('/borrow/payments/TXN-1/reconcile/ack')
        .set('Authorization', 'Bearer valid')
        .send({ note: 'Thu xac nhan sai don' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ORDER_NOT_IN_RECONCILE');
    });
  });

  describe('GET /borrow/payments/:orderCode/status', () => {
    it('exposes the reconcile block so the patron app can explain the delay', async () => {
      service.getOrderStatus.mockResolvedValue({
        orderCode: 'TXN-1',
        status: 'reconcile_needed',
        amount: 50000,
        paidAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        recordIds: ['rec-1'],
        reconcile: {
          reason: 'all_records_already_paid',
          amount: 50000,
          requiresStaffAction: true,
        },
      });

      const res = await request(app).get('/borrow/payments/TXN-1/status');

      expect(res.status).toBe(200);
      expect(res.body.reconcile.requiresStaffAction).toBe(true);
    });
  });
});
