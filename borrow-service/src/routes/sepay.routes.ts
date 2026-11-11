import { Router } from 'express';
import { PaymentService } from '../services/PaymentService';

export function createSepayRouter(service: PaymentService = new PaymentService()): Router {
  const router = Router();

  /**
   * POST /borrow/sepay/webhook
   * Dedicated SePay webhook endpoint.
   */
  router.post('/webhook', async (req, res, next) => {
    try {
      console.log('[SePay Callback] /borrow/sepay/webhook received payload:', JSON.stringify(req.body));
      const authHeader = req.headers.authorization || '';
      const expectedApiKey = process.env.SEPAY_API_KEY;
      if (expectedApiKey) {
        const token = authHeader.startsWith('Apikey ')
          ? authHeader.slice(7).trim()
          : authHeader.replace(/^Bearer /i, '').trim();
        if (token !== expectedApiKey) {
          console.warn('[SePay Callback] Unauthorized: Invalid SePay API Key');
          res.status(401).json({ success: false, message: 'Unauthorized: Invalid SePay API Key' });
          return;
        }
      }

      const result = await service.processSepayWebhook(req.body);
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', provider: 'sepay' });
  });

  return router;
}

export default createSepayRouter();

