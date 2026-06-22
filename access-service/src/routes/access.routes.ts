import { Router } from 'express';
import { z } from 'zod';
import { accessService } from '../services/AccessService';
import { auth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { realtimeHub } from '../realtime/RealtimeHub';

const router = Router();

router.get('/events', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  realtimeHub.addSseClient(res);
});

router.get('/recent', async (req, res, next) => {
  try {
    res.json(await accessService.getRecent(Number(req.query.limit || 20)));
  } catch (error) {
    next(error);
  }
});

router.get('/logs', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    res.json(await accessService.getLogs({
      patronId: req.query.patron_id as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      limit: Number(req.query.limit || 200),
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/active', auth, requireRole(['admin', 'staff']), async (_req, res, next) => {
  try {
    res.json(await accessService.getActive());
  } catch (error) {
    next(error);
  }
});

router.get('/frequency', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    res.json(await accessService.getFrequency(Number(req.query.days || 7)));
  } catch (error) {
    next(error);
  }
});

router.get('/stats', auth, requireRole(['admin', 'staff']), async (_req, res, next) => {
  try {
    res.json(await accessService.getStats());
  } catch (error) {
    next(error);
  }
});

router.post('/test-broadcast', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const body = z.object({
      camera_id: z.string().default('kiosk'),
      status: z.string().default('granted'),
      patron_id: z.string().optional(),
      student_code: z.string().optional(),
      full_name: z.string().optional(),
      access_type: z.enum(['entry', 'exit']).optional(),
      score: z.number().optional(),
    }).passthrough().parse(req.body || {});
    const event = await accessService.recordRecognitionEvent({ ...body, source: 'manual-test' });
    res.json({ ok: true, event });
  } catch (error) {
    next(error);
  }
});

router.post('/force-exit', auth, requireRole(['admin', 'staff']), async (req, res, next) => {
  try {
    const body = z.object({
      patron_id: z.string(),
    }).parse(req.body || {});
    await accessService.setStatus(body.patron_id, 'outside', 'manual_override');
    res.json({ ok: true, message: 'Đã đánh dấu độc giả đã ra khỏi thư viện' });
  } catch (error) {
    next(error);
  }
});

export default router;
