import { Router } from 'express';
import { z } from 'zod';
import { auth, AuthRequest } from '../middlewares/auth';
import { HttpError } from '../middlewares/errorHandler';
import { PaymentService } from '../services/PaymentService';

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
