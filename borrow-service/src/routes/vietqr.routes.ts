import { Router } from 'express';
import { z } from 'zod';
import { PaymentService } from '../services/PaymentService';
import {
  issuePartnerToken,
  verifyPartnerToken,
  checkPartnerBasicAuth,
  VIETQR_TOKEN_TTL_SECONDS,
} from '../services/VietqrCallbackAuth';
import { HttpError } from '../../../shared/error-handler';

const okResponse = (reftransactionid: string, toastMessage: string) => ({
  error: false,
  errorReason: null,
  toastMessage,
  object: { reftransactionid },
});

const failResponse = (errorReason: string, toastMessage: string) => ({
  error: true,
  errorReason,
  toastMessage,
  object: null,
});

/**
 * VietQR Callback endpoints (partner side, PUBLIC - no staff auth).
 *
 * 1. POST /borrow/vietqr/token-generate
 *    VietQR calls us with Basic auth (credentials WE define via
 *    VIETQR_CALLBACK_USERNAME/PASSWORD) and receives a short-lived HS512 JWT
 *    to present on every transaction-sync callback.
 *
 * 2. POST /borrow/vietqr/transaction-sync
 *    VietQR POSTs every balance change (bankaccount, amount, transType,
 *    content, transactionid, transactiontime, referencenumber, orderId).
 *    We match orderId/content to a payment order and settle the debt.
 */
export function createVietqrRouter(service: PaymentService = new PaymentService()): Router {
  const router = Router();

  router.post('/token-generate', async (req, res) => {
    try {
      const username = checkPartnerBasicAuth(req.headers.authorization);
      const access_token = issuePartnerToken(username);
      res.json({ access_token, token_type: 'Bearer', expires_in: VIETQR_TOKEN_TTL_SECONDS });
    } catch (err: any) {
      const msg = err?.message ?? 'FAILED';
      if (msg === 'INVALID_AUTH_HEADER') {
        res.status(400).json({ status: 'FAILED', message: msg });
        return;
      }
      if (msg === 'INVALID_CREDENTIALS') {
        res.status(401).json({ status: 'FAILED', message: msg });
        return;
      }
      res.status(500).json({ status: 'FAILED', message: 'CALLBACK_AUTH_NOT_CONFIGURED' });
    }
  });

  router.post('/transaction-sync', async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json(failResponse('INVALID_AUTH_HEADER', 'Authorization header is missing or invalid'));
      return;
    }
    try {
      verifyPartnerToken(auth.slice('Bearer '.length).trim());
    } catch {
      res.status(401).json(failResponse('INVALID_TOKEN', 'Invalid or expired token'));
      return;
    }

    const parsed = z.object({
      bankaccount: z.string().optional(),
      amount: z.coerce.number(),
      transType: z.string().optional(),
      content: z.string().optional(),
      transactionid: z.string().min(1),
      transactiontime: z.coerce.number().optional(),
      referencenumber: z.string().optional(),
      orderId: z.string().optional(),
      terminalCode: z.string().optional(),
      subTerminalCode: z.string().optional(),
      serviceCode: z.string().optional(),
      sign: z.string().optional(),
    }).safeParse(req.body ?? {});

    if (!parsed.success) {
      res.status(400).json(failResponse('INVALID_BODY', 'Thiếu transactionid/amount trong callback'));
      return;
    }

    try {
      const result = await service.processVietqrCallback(parsed.data);
      res.json(okResponse(
        result.orderCode,
        result.duplicate ? 'Giao dịch đã được xử lý trước đó' : 'Đối soát giao dịch thành công',
      ));
    } catch (err: any) {
      const status = err instanceof HttpError ? err.statusCode : 400;
      const reason = status === 404 ? 'ORDER_NOT_FOUND' : 'TRANSACTION_FAILED';
      res.status(status === 404 ? 404 : 400).json(failResponse(reason, err?.message ?? reason));
    }
  });

  return router;
}

export default createVietqrRouter();
