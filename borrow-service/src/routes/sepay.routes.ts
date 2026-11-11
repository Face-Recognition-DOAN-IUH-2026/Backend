import { Router } from 'express';
import crypto from 'crypto';
import { PaymentService } from '../services/PaymentService';

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a.toLowerCase());
  const bufB = Buffer.from(b.toLowerCase());
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifySepayAuth(req: any): boolean {
  const expectedSecret = process.env.SEPAY_WEBHOOK_SECRET || process.env.SEPAY_API_KEY;
  if (!expectedSecret) {
    return true; // No secret configured, allow (e.g. local dev / open test)
  }

  // Method 1: Authorization Header (Apikey or Bearer)
  const authHeader = (req.headers.authorization || '') as string;
  if (authHeader) {
    const token = authHeader.startsWith('Apikey ')
      ? authHeader.slice(7).trim()
      : authHeader.replace(/^Bearer /i, '').trim();
    if (token === expectedSecret) {
      return true;
    }
  }

  // Method 2: X-SePay-Signature (HMAC-SHA256)
  const signatureHeader = (req.headers['x-sepay-signature'] || '') as string;
  if (signatureHeader) {
    const rawSignature = signatureHeader.replace(/^sha256=/i, '').trim();
    const timestampHeader = (req.headers['x-sepay-timestamp'] || '') as string;
    const rawBody = req.rawBody ? req.rawBody.toString('utf-8') : JSON.stringify(req.body);

    if (timestampHeader) {
      const sigWithTimestamp = crypto.createHmac('sha256', expectedSecret).update(`${timestampHeader}.${rawBody}`).digest('hex');
      if (timingSafeEqual(rawSignature, sigWithTimestamp)) {
        return true;
      }
    }

    const sigRaw = crypto.createHmac('sha256', expectedSecret).update(rawBody).digest('hex');
    if (timingSafeEqual(rawSignature, sigRaw)) {
      return true;
    }
  }

  return false;
}

export function createSepayRouter(service: PaymentService = new PaymentService()): Router {
  const router = Router();

  /**
   * POST /borrow/sepay/webhook
   * Dedicated SePay webhook endpoint.
   */
  router.post('/webhook', async (req, res, next) => {
    try {
      console.log('[SePay Callback] /borrow/sepay/webhook received payload:', JSON.stringify(req.body));
      if (!verifySepayAuth(req)) {
        console.warn('[SePay Callback] Unauthorized: Invalid SePay API Key or Signature');
        res.status(401).json({ success: false, message: 'Unauthorized: Invalid SePay API Key or Signature' });
        return;
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

