import { Router } from 'express';
import { z } from 'zod';
import { auth, AuthRequest, requireDynamicPermission } from '../middlewares/auth';
import { HttpError } from '../../../shared/error-handler';
import { PaymentService } from '../services/PaymentService';
import { lookupPatronsByIds } from '../clients/UserServiceClient';

export function createPaymentRouter(service: PaymentService = new PaymentService()): Router {
  const router = Router();

  /**
   * POST /borrow/payments/create
   * Creates an online payment order (VietQR / PayOS) for fine records.
   * Patron can pay their own debt, staff can generate QR for patron.
   */
  router.post('/create', auth, async (req: AuthRequest, res, next) => {
    try {
      const body = z.object({
        patron_id: z.string().uuid().optional(),
        record_ids: z.array(z.string().uuid()).min(1).max(50),
        payment_method: z.enum(['vietqr', 'payos', 'vnpay']).optional(),
      }).parse(req.body);

      const isStaffOrAdmin = req.user?.role === 'admin' || req.user?.role === 'staff';
      const patronId = (isStaffOrAdmin && body.patron_id) ? body.patron_id : (req.user?.id || body.patron_id);
      if (!patronId) {
        throw new HttpError(400, 'Thiếu thông tin patron_id');
      }

      const order = await service.createPaymentOrder(
        patronId,
        body.record_ids,
        body.payment_method || 'vietqr',
      );

      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /borrow/payments/pending
   * Staff-only: list VietQR orders awaiting reconciliation (pending + expired).
   */
  router.get('/pending', auth, requireDynamicPermission('borrows', 'update'), async (req: AuthRequest, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const orders = await service.listReconcilableOrders(limit);
      const patrons = await lookupPatronsByIds([...new Set(orders.map((o) => o.patronId))]).catch(() => new Map());
      res.json(orders.map((o) => ({
        ...o,
        patron: {
          id: o.patronId,
          full_name: (patrons.get(o.patronId) as any)?.full_name ?? (patrons.get(o.patronId) as any)?.fullName ?? null,
          student_code: (patrons.get(o.patronId) as any)?.student_code ?? (patrons.get(o.patronId) as any)?.studentCode ?? null,
        },
      })));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /borrow/payments/:orderCode/confirm
   * Staff-only: confirm money has arrived in the bank account (checked against
   * the bank statement) and settle the debt. Accepts pending + expired orders.
   */
  router.post('/:orderCode/confirm', auth, requireDynamicPermission('borrows', 'update'), async (req: AuthRequest, res, next) => {
    try {
      const { orderCode } = req.params;
      if (!orderCode) {
        throw new HttpError(400, 'Thiếu orderCode');
      }
      const body = z.object({
        note: z.string().max(500).optional(),
      }).parse(req.body ?? {});

      const result = await service.confirmManualReceipt(orderCode, req.user?.id || 'staff', body.note);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /borrow/payments/:orderCode/status
   * Check payment status by orderCode (used for polling or refresh).
   */
  router.get('/:orderCode/status', async (req, res, next) => {
    try {
      const { orderCode } = req.params;
      if (!orderCode) {
        throw new HttpError(400, 'Thiếu orderCode');
      }

      const status = await service.getOrderStatus(orderCode);
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /borrow/payments/webhook
   * Public webhook callback from Payment Gateway / Bank service.
   */
  router.post('/webhook', async (req, res, next) => {
    try {
      const signature = (
        req.headers['x-signature'] ||
        req.headers['webhook-signature'] ||
        req.headers['secure-hash'] ||
        req.body?.signature
      ) as string | undefined;

      const result = await service.processWebhook(req.body, signature);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createPaymentRouter();
